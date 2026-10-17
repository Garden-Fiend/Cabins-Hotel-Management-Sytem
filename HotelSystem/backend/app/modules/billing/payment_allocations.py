"""Append-only component allocations, using existing pricing results and B7 payment capacity."""

import json
from uuid import UUID, uuid4

import sqlalchemy as sa

from app.errors import DomainError
from app.models import audit_events, booking_sources, pricing_revisions, reservations
from app.modules.billing.allocation_models import payment_allocations as events
from app.modules.billing.collection_models import collection_transactions as payments
from app.modules.billing.collection_models import guest_obligations as bases
from app.modules.reservations.booking_financials import hotel_amounts

COMPONENTS = ("accommodation", "hotel_charges")


def owned_rows(session, table, context, identity):
    query = sa.select(table).where(
        table.c.company_id == context.company_id, table.c.reservation_id == identity
    )
    if table is events:
        query = query.order_by(table.c.sequence)
    elif table is payments:
        query = query.order_by(table.c.reservation_version, table.c.ordinal)
    else:
        query = query.order_by(table.c.reservation_version)
    return list(session.execute(query).mappings())


def capacities(history):
    result = {row["id"]: row["amount_minor"] for row in history if row["kind"] == "collection"}
    for row in history:
        if row["kind"] != "collection":
            result[row["related_transaction_id"]] -= row["amount_minor"]
    return result


def active_allocations(history):
    active = {
        row["id"]: {**row, "active_minor": row["amount_minor"]}
        for row in history
        if row["kind"] == "allocate"
    }
    for row in history:
        if row["kind"] == "release":
            active[row["release_of"]]["active_minor"] -= row["amount_minor"]
    return [row for row in active.values() if row["active_minor"]]


def view(session, context, identity):
    parent = (
        session.execute(
            sa.select(reservations).where(
                reservations.c.company_id == context.company_id, reservations.c.id == identity
            )
        )
        .mappings()
        .one()
    )
    price = (
        session.execute(
            sa.select(pricing_revisions)
            .where(
                pricing_revisions.c.company_id == context.company_id,
                pricing_revisions.c.reservation_id == identity,
            )
            .order_by(pricing_revisions.c.revision.desc())
            .limit(1)
        )
        .mappings()
        .one()
    )
    capture = price["snapshot"].get("channel")
    _, accommodation, charges = hotel_amounts(price["snapshot"])
    basis_rows = owned_rows(session, bases, context, identity)
    basis = basis_rows[-1] if basis_rows else None
    classification = session.scalar(
        sa.select(booking_sources.c.classification).where(
            booking_sources.c.id == parent["booking_source_id"],
            booking_sources.c.company_id == context.company_id,
        )
    )
    valid_basis = (
        basis
        and basis["pricing_id"] == price["id"]
        and basis["capture_id"] == (UUID(capture["id"]) if capture else None)
        and basis["status"] == "known"
    )
    if capture or classification != "direct":
        accommodation = basis["accommodation_minor"] if valid_basis else None
    unresolved = []
    if accommodation is None:
        unresolved.append("guest_accommodation_obligation_requires_review")
    ambiguous = any(a["amount_minor"] != 0 for a in price["snapshot"].get("adjustments", []))
    if ambiguous:
        unresolved.append("unallocated_signed_adjustments")
    history = owned_rows(session, payments, context, identity)
    event_history = owned_rows(session, events, context, identity)
    return dict(
        parent=parent,
        price=price,
        basis=basis if valid_basis else None,
        limits={
            "accommodation": None if ambiguous else accommodation,
            "hotel_charges": None if ambiguous else charges,
        },
        obligations={"accommodation": accommodation, "hotel_charges": charges},
        unresolved=unresolved,
        history=history,
        capacities=capacities(history),
        events=event_history,
        active=active_allocations(event_history),
    )


def append_event(
    session, context, state, payment_id, component, amount, kind, reason, provenance, release=None
):
    value = dict(
        id=uuid4(),
        company_id=context.company_id,
        reservation_id=state["parent"]["id"],
        reservation_version=state["parent"]["version"],
        payment_id=payment_id,
        component=component,
        amount_minor=amount,
        kind=kind,
        reason=reason,
        provenance=provenance,
        actor=context.actor,
        pricing_id=release["pricing_id"] if release else state["price"]["id"],
        obligation_id=release["obligation_id"]
        if release
        else state["basis"]["id"]
        if component == "accommodation" and state["basis"]
        else None,
        release_of=release["id"] if release else None,
    )
    row = session.execute(events.insert().values(**value).returning(events)).mappings().one()
    session.execute(
        audit_events.insert().values(
            id=uuid4(),
            company_id=context.company_id,
            reservation_id=state["parent"]["id"],
            reservation_version=state["parent"]["version"],
            event_type=f"billing.payment_allocation_{kind}",
            actor=context.actor,
            attribution=context.attribution,
            after=json.loads(json.dumps(dict(row), default=str)),
        )
    )
    return row


def synchronize(session, context, identity):
    """Parent is locked by the caller. Append compensation before commit, never on GET."""
    if not session.scalar(
        sa.select(events.c.id)
        .where(events.c.company_id == context.company_id, events.c.reservation_id == identity)
        .limit(1)
    ):
        return
    state = view(session, context, identity)
    remaining = dict(state["capacities"])
    targets = dict(state["limits"])
    for row in state["active"]:
        component = row["component"]
        basis_id = state["basis"]["id"] if component == "accommodation" and state["basis"] else None
        valid = (
            row["pricing_id"] == state["price"]["id"]
            and row["obligation_id"] == basis_id
            and targets[component] is not None
        )
        keep = (
            min(
                row["active_minor"],
                max(0, remaining[row["payment_id"]]),
                max(0, targets[component]),
            )
            if valid
            else 0
        )
        remaining[row["payment_id"]] -= keep
        if targets[component] is not None:
            targets[component] -= keep
        if keep < row["active_minor"]:
            append_event(
                session,
                context,
                state,
                row["payment_id"],
                component,
                row["active_minor"] - keep,
                "release",
                "Pricing/obligation context changed"
                if not valid
                else "Refund/reversal or target capacity reduced",
                "compensation",
                row,
            )


def auto_allocate(session, context, identity, payment_ids):
    synchronize(session, context, identity)
    for payment_id in payment_ids:
        state = view(session, context, identity)
        payment = next(
            row
            for row in state["history"]
            if row["id"] == payment_id and row["kind"] == "collection"
        )
        component = payment["component"]
        limit = state["limits"][component]
        if limit is None:
            continue
        used = sum(
            row["active_minor"] for row in state["active"] if row["payment_id"] == payment_id
        )
        covered = sum(
            row["active_minor"] for row in state["active"] if row["component"] == component
        )
        amount = min(state["capacities"][payment_id] - used, max(0, limit - covered))
        if amount > 0:
            append_event(
                session,
                context,
                state,
                payment_id,
                component,
                amount,
                "allocate",
                "Declared component with authoritative remaining obligation",
                "automatic",
            )


def allocation_summary(session, context, identity):
    state = view(session, context, identity)
    by_id = {row["id"]: row for row in state["history"] if row["kind"] == "collection"}
    hotel_allocated = channel_allocated = 0
    components = {component: 0 for component in COMPONENTS}
    for row in state["active"]:
        components[row["component"]] += row["active_minor"]
        if by_id[row["payment_id"]]["collector"] == "hotel":
            hotel_allocated += row["active_minor"]
        else:
            channel_allocated += row["active_minor"]
    sources = []
    for payment_id, capacity in state["capacities"].items():
        used = sum(
            row["active_minor"] for row in state["active"] if row["payment_id"] == payment_id
        )
        payment = by_id[payment_id]
        sources.append(
            dict(
                payment_id=payment_id,
                collector=payment["collector"],
                component=payment["component"],
                remaining_minor=capacity,
                refundable_minor=capacity,
                allocated_minor=used,
                unapplied_minor=capacity - used,
            )
        )
    hotel = sum(row["remaining_minor"] for row in sources if row["collector"] == "hotel")
    channel = sum(row["remaining_minor"] for row in sources if row["collector"] == "channel")
    outstanding = {
        component: None
        if state["limits"][component] is None
        else state["limits"][component] - components[component]
        for component in COMPONENTS
    }
    credits = {
        component: sum(row["unapplied_minor"] for row in sources if row["component"] == component)
        for component in COMPONENTS
    }
    balance = None if state["unresolved"] else sum(state["limits"].values()) - hotel - channel
    unapplied_hotel = hotel - hotel_allocated
    status = (
        "requires_review"
        if state["unresolved"]
        else "allocation_required"
        if sum(outstanding.values()) and unapplied_hotel
        else "credit"
        if balance < 0
        else "covered"
        if not sum(outstanding.values())
        else "partial"
        if hotel + channel
        else "unpaid"
    )
    return dict(
        allocated_hotel_minor=hotel_allocated,
        unapplied_hotel_minor=unapplied_hotel,
        allocated_channel_minor=channel_allocated,
        unapplied_channel_minor=channel - channel_allocated,
        payment_capacities=sources,
        component_outstanding=outstanding,
        component_credits=credits,
        accommodation_residual_minor=outstanding["accommodation"],
        hotel_charges_residual_minor=outstanding["hotel_charges"],
        guest_balance_minor=balance,
        coverage_status=status,
        unresolved_components=state["unresolved"],
        allocation_obligation_id=state["basis"]["id"] if state["basis"] else None,
        allocation_history=[dict(row) for row in state["events"]],
        component_targets=[
            dict(
                id=f"{identity}:{component}",
                component=component,
                pricing_id=state["price"]["id"],
                obligation_id=state["basis"]["id"]
                if component == "accommodation" and state["basis"]
                else None,
                obligation_minor=state["limits"][component],
            )
            for component in COMPONENTS
        ],
    )


def command(service, identity, request, key):
    from app.modules.billing.collections import (
        Result,
        advance,
        audit,
        checked_version,
        stage,
        summary,
    )
    from app.mutations import replay_or_lock, request_hash, save_receipt

    operation = "billing.payment_allocation"
    digest = request_hash(request, resource_id=identity)
    with service.transaction() as session:
        replay = replay_or_lock(session, service.context, operation, key, digest)
        if replay is not None:
            return replay
        parent = service.owned(session, reservations, identity, lock=True, exclusive=True)
        checked_version(parent, request.expected_version)
        state = view(session, service.context, identity)
        expected_basis = state["basis"]["id"] if state["basis"] else None
        if (
            request.expected_pricing_id != state["price"]["id"]
            or request.expected_obligation_id != expected_basis
        ):
            raise DomainError(
                "allocation_context_changed", "Pricing/obligation changed; reload and review"
            )
        payment = service.owned(session, payments, request.payment_id)
        if payment["reservation_id"] != identity or payment["kind"] != "collection":
            raise DomainError("not_found", "Original collection not found", 404)
        parent = advance(session, parent)
        synchronize(session, service.context, identity)
        state = view(session, service.context, identity)
        release = None
        if request.kind == "release":
            release = next(
                (row for row in state["active"] if row["id"] == request.release_of), None
            )
            if (
                release is None
                or release["payment_id"] != request.payment_id
                or release["component"] != request.component
                or request.amount_minor > release["active_minor"]
            ):
                raise DomainError(
                    "allocation_release_conflict",
                    "Choose an active allocation with sufficient remaining amount",
                )
        else:
            if payment["collector"] != "hotel":
                raise DomainError(
                    "channel_allocation_restricted",
                    "Channel payments cover reviewed accommodation automatically; "
                    "they cannot fund hotel extras",
                )
            limit = state["limits"][request.component]
            if limit is None:
                raise DomainError(
                    "allocation_requires_review",
                    "Target obligation requires review; ambiguous adjustments are not distributed",
                )
            used = sum(
                row["active_minor"]
                for row in state["active"]
                if row["payment_id"] == request.payment_id
            )
            covered = sum(
                row["active_minor"]
                for row in state["active"]
                if row["component"] == request.component
            )
            if (
                request.amount_minor > state["capacities"][request.payment_id] - used
                or request.amount_minor > limit - covered
            ):
                raise DomainError(
                    "allocation_capacity_conflict",
                    "Allocation exceeds available funds or target obligation",
                )
        saved = append_event(
            session,
            service.context,
            state,
            request.payment_id,
            request.component,
            request.amount_minor,
            request.kind,
            request.reason,
            "manual",
            release,
        )
        stage("allocation")
        audit(service, session, parent, "billing.payment_allocation_reviewed", dict(saved))
        result = Result(dict(summary=summary(service, session, parent)))
        save_receipt(
            session, service.context, operation, key, digest, result, reservation_id=identity
        )
        stage("receipt")
        stage("before_commit")
        return result.model_dump(mode="json")
