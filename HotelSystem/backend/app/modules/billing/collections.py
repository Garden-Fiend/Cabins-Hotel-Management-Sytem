"""B7 operational collection commands. No payment execution, pricing edits or document writes."""

import hashlib
import json
from uuid import UUID, uuid4, uuid5

import sqlalchemy as sa
from pydantic import RootModel

from app.errors import DomainError
from app.models import (
    audit_events,
    booking_financial_captures,
    booking_sources,
    pricing_revisions,
    reservations,
)
from app.modules.billing.collection_models import collection_transactions as transactions
from app.modules.billing.collection_models import guest_obligations as bases
from app.modules.billing.collection_schemas import MAX_MINOR, correction_capacity, reference_key
from app.modules.reservations.booking_financials import hotel_amounts
from app.mutations import replay_or_lock, request_hash, save_receipt


class Result(RootModel[dict]):
    pass


class DuplicateReview(DomainError):
    def __init__(self, token, matches, ordinal=None):
        super().__init__(
            "duplicate_evidence_review", "Review matching evidence and explicitly justify reuse"
        )
        self.token, self.matches = token, matches
        self.ordinal = ordinal

    def response(self):
        return {
            **super().response(),
            "duplicate_token": self.token,
            "matches": self.matches,
            "initial_ordinal": self.ordinal,
        }


def stage(name):
    """Named transactional boundaries for failure-injection tests."""


def rows(session, table, owner, identity):
    return list(
        session.execute(
            sa.select(table)
            .where(table.c.company_id == owner, table.c.reservation_id == identity)
            .order_by(
                table.c.reservation_version,
                table.c.ordinal if table is transactions else table.c.id,
            )
        ).mappings()
    )


def current_context(service, session, parent):
    price = (
        session.execute(
            sa.select(pricing_revisions)
            .where(
                pricing_revisions.c.reservation_id == parent["id"],
                pricing_revisions.c.company_id == service.context.company_id,
            )
            .order_by(pricing_revisions.c.revision.desc())
            .limit(1)
        )
        .mappings()
        .one()
    )
    return price, price["snapshot"].get("channel")


def provenance(service, parent, capture, version):
    return dict(
        company_id=service.context.company_id,
        reservation_id=parent["id"],
        reservation_version=version,
        source_id=UUID(capture["source_id"]) if capture else parent["booking_source_id"],
        capture_id=UUID(capture["id"]) if capture else None,
        source_label=capture["source_label"]
        if capture
        else parent["booking_source_label"] or "Direct",
        external_reference=capture["input"]["external_reference"]
        if capture
        else parent["external_booking_reference"] or "",
        actor=service.context.actor,
        attribution=service.context.attribution,
    )


def checked_version(parent, version):
    if parent["version"] != version:
        raise DomainError(
            "version_conflict",
            "Reservation changed; reload and review without discarding this draft",
        )


def audit(service, session, parent, event, after):
    session.execute(
        audit_events.insert().values(
            id=uuid4(),
            company_id=service.context.company_id,
            reservation_id=parent["id"],
            reservation_version=parent["version"],
            event_type=event,
            actor=service.context.actor,
            attribution=service.context.attribution,
            after=Result(after).model_dump(mode="json"),
        )
    )
    stage("audit")


def advance(session, parent):
    result = (
        session.execute(
            reservations.update()
            .where(reservations.c.id == parent["id"])
            .values(version=parent["version"] + 1, updated_at=sa.func.clock_timestamp())
            .returning(reservations)
        )
        .mappings()
        .one()
    )
    stage("version")
    return result


def evidence_lock(context, intent):
    evidence = reference_key(intent)
    if evidence is None:
        return None
    identity = json.dumps([str(context.company_id), *evidence], ensure_ascii=False)
    lock = int.from_bytes(
        hashlib.blake2b(identity.encode(), digest_size=8).digest(), "big", signed=True
    )
    return lock


def duplicate_review(service, session, intent, context, initial_reservation_id=None):
    evidence = reference_key(intent)
    if evidence is None:
        return {}
    collector, method, reference = evidence
    identity = json.dumps([str(service.context.company_id), *evidence], ensure_ascii=False)
    lock = int.from_bytes(
        hashlib.blake2b(identity.encode(), digest_size=8).digest(), "big", signed=True
    )
    session.execute(sa.select(sa.func.pg_advisory_xact_lock(lock)))
    matches = list(
        session.execute(
            sa.select(
                transactions.c.id,
                transactions.c.reservation_id,
                transactions.c.kind,
                transactions.c.amount_minor,
                transactions.c.ordinal,
            )
            .where(
                transactions.c.company_id == service.context.company_id,
                transactions.c.collector == collector,
                transactions.c.normalized_method == method,
                transactions.c.normalized_reference == reference,
            )
            .order_by(transactions.c.id)
        ).mappings()
    )
    if not matches:
        if intent.duplicate_acknowledged or intent.duplicate_token:
            raise DomainError("duplicate_context_changed", "Evidence matches changed; review again")
        return {}
    safe = Result({"matches": [dict(row) for row in matches]}).model_dump(mode="json")["matches"]
    if initial_reservation_id:
        for match in safe:
            if match["reservation_id"] == str(initial_reservation_id):
                match["reservation_id"] = "initial reservation (staged)"
    reviewed_intent = intent.model_dump(
        mode="json",
        exclude={"duplicate_token", "duplicate_acknowledged", "duplicate_justification"},
    )
    token_matches = [dict(match) for match in safe]
    for match in token_matches:
        if match["reservation_id"] == "initial reservation (staged)":
            match["id"] = f"staged-payment:{match['ordinal']}"
    token = hashlib.sha256(
        json.dumps([identity, token_matches, reviewed_intent, context], sort_keys=True).encode()
    ).hexdigest()
    if not intent.duplicate_acknowledged or intent.duplicate_token != token:
        raise DuplicateReview(
            token, safe, context.get("ordinal") if initial_reservation_id else None
        )
    return dict(token=token, matches=safe, justification=intent.duplicate_justification)


def insert_collection(
    service,
    session,
    parent,
    intent,
    *,
    initial=False,
    review_context=None,
    ordinal=0,
    transaction_id=None,
):
    price, current = current_context(service, session, parent)
    capture = current
    if not initial:
        if intent.source_id is None:
            raise DomainError(
                "collection_context_required", "Review the source/capture before recording", 422
            )
        service.owned(session, booking_sources, intent.source_id)
        if intent.capture_id:
            capture = service.owned(session, booking_financial_captures, intent.capture_id)[
                "snapshot"
            ]
            if UUID(capture["source_id"]) != intent.source_id or UUID(capture["id"]) not in {
                row["id"]
                for row in rows(
                    session, booking_financial_captures, service.context.company_id, parent["id"]
                )
            }:
                raise DomainError(
                    "collection_context_conflict",
                    "Capture does not belong to this reservation/source",
                )
        elif intent.kind == "collection" and (
            current or intent.source_id != parent["booking_source_id"]
        ):
            raise DomainError(
                "collection_context_conflict", "Review exact historical capture attribution"
            )
    elif (
        intent.kind != "collection"
        or intent.related_transaction_id
        or intent.capture_id
        or intent.source_id
    ):
        raise DomainError(
            "invalid_initial_collection",
            "Initial save accepts only collections with server-resolved context",
            422,
        )
    if intent.collector == "channel" and capture is None:
        raise DomainError(
            "channel_capture_required",
            "Verified channel payment requires captured channel terms",
            422,
        )
    if (
        parent["status"] in ("cancelled", "no_show")
        and intent.kind == "collection"
        and not intent.reason.strip()
    ):
        raise DomainError(
            "collection_reason_required",
            "Explain collection on this cancelled/no-show booking",
            422,
        )
    facts = provenance(service, parent, capture, parent["version"])
    if intent.kind != "collection":
        original = service.owned(session, transactions, intent.related_transaction_id)
        if original["reservation_id"] != parent["id"]:
            raise DomainError("not_found", "Original collection not found", 404)
        corrections = (
            session.execute(
                sa.select(transactions).where(
                    transactions.c.related_transaction_id == original["id"]
                )
            )
            .mappings()
            .all()
        )
        try:
            correction_capacity(original, corrections, intent)
        except ValueError as error:
            raise DomainError("correction_capacity_conflict", str(error)) from None
        # The historical source label/reference stays exactly as originally recorded.
        facts.update(
            {
                key: original[key]
                for key in ("source_id", "capture_id", "source_label", "external_reference")
            }
        )
    review = duplicate_review(
        service,
        session,
        intent,
        review_context if initial else str(parent["id"]),
        parent["id"] if initial else None,
    )
    evidence = reference_key(intent)
    value = {
        **facts,
        "id": transaction_id or uuid4(),
        "ordinal": ordinal,
        **{
            name: getattr(intent, name)
            for name in (
                "kind",
                "collector",
                "component",
                "amount_minor",
                "currency",
                "payment_method",
                "reference",
                "declaration",
                "reason",
                "related_transaction_id",
            )
        },
        "normalized_reference": evidence[2] if evidence else "",
        "normalized_method": evidence[1] if evidence else "",
        "duplicate_review": review,
    }
    saved = (
        session.execute(transactions.insert().values(**value).returning(transactions))
        .mappings()
        .one()
    )
    stage("transaction")
    audit(service, session, parent, "billing.collection_recorded", dict(saved))
    from app.modules.billing.payment_allocations import auto_allocate, synchronize

    if intent.kind == "collection":
        auto_allocate(session, service.context, parent["id"], [saved["id"]])
    else:
        synchronize(session, service.context, parent["id"])
    return saved


def insert_basis(service, session, parent, intent):
    price, capture = current_context(service, session, parent)
    if capture is None:
        _, accommodation, _ = hotel_amounts(price["snapshot"])
        if intent.status != "known" or intent.accommodation_minor != accommodation:
            raise DomainError(
                "direct_obligation_is_canonical",
                "Direct guest obligation follows saved hotel pricing; "
                "use the existing pricing controls to change it",
                422,
            )
    value = {
        **provenance(service, parent, capture, parent["version"]),
        "id": uuid4(),
        "pricing_id": price["id"],
        **intent.model_dump(
            exclude={"expected_version", "expected_pricing_id", "expected_capture_id"}
        ),
    }
    saved = session.execute(bases.insert().values(**value).returning(bases)).mappings().one()
    stage("obligation")
    audit(service, session, parent, "billing.guest_obligation_reviewed", dict(saved))
    from app.modules.billing.payment_allocations import auto_allocate

    auto_allocate(
        session,
        service.context,
        parent["id"],
        [
            row["id"]
            for row in rows(session, transactions, service.context.company_id, parent["id"])
            if row["kind"] == "collection"
        ],
    )


def summary(service, session, parent):
    history = rows(session, transactions, service.context.company_id, parent["id"])
    obligations = rows(session, bases, service.context.company_id, parent["id"])
    price, capture = current_context(service, session, parent)
    _, accommodation, charges = hotel_amounts(price["snapshot"])
    adjustments = sum(a["amount_minor"] for a in price["snapshot"].get("adjustments", []))
    # Unclassified signed adjustments cannot be assigned to a guest-obligation component safely.
    unresolved = ["unallocated_signed_adjustments"] if adjustments else []
    basis = obligations[-1] if obligations else None
    source = service.owned(session, booking_sources, parent["booking_source_id"])
    non_direct = capture is not None or source["classification"] != "direct"
    if non_direct:
        current_basis = (
            basis
            and basis["pricing_id"] == price["id"]
            and basis["capture_id"] == (UUID(capture["id"]) if capture else None)
        )
        accommodation = (
            basis["accommodation_minor"] if current_basis and basis["status"] == "known" else None
        )
        if accommodation is None:
            unresolved.append("guest_accommodation_obligation_requires_review")
    nets = {
        collector: {component: 0 for component in ("accommodation", "hotel_charges")}
        for collector in ("hotel", "channel")
    }
    gross = {kind: 0 for kind in ("collection", "refund", "reversal")}
    rollups = {}
    for row in history:
        sign = 1 if row["kind"] == "collection" else -1
        nets[row["collector"]][row["component"]] += sign * row["amount_minor"]
        gross[row["kind"]] += row["amount_minor"]
        key = str(row["source_id"])
        group = rollups.setdefault(key, {"source_id": key, "hotel_minor": 0, "channel_minor": 0})
        group[row["collector"] + "_minor"] += sign * row["amount_minor"]
    hotel, channel = (sum(nets[c].values()) for c in ("hotel", "channel"))
    accommodation_residual = (
        None
        if accommodation is None
        else accommodation - nets["hotel"]["accommodation"] - nets["channel"]["accommodation"]
    )
    charges_residual = charges - nets["hotel"]["hotel_charges"]
    if accommodation_residual is not None and (
        (accommodation_residual < 0 < charges_residual)
        or (charges_residual < 0 < accommodation_residual)
    ):
        unresolved.append("cross_component_credit_requires_review")
    balance = None if unresolved else accommodation_residual + charges_residual
    for amount in [
        hotel,
        channel,
        charges_residual,
        accommodation_residual,
        balance,
        *gross.values(),
    ]:
        if amount is not None and abs(amount) > MAX_MINOR:
            raise DomainError(
                "money_range_exceeded",
                "Collection aggregate exceeds supported exact PHP range",
                422,
            )
    result = dict(
        reservation_version=parent["version"],
        pricing_id=price["id"],
        capture_id=UUID(capture["id"]) if capture else None,
        source_id=parent["booking_source_id"],
        currency="PHP",
        obligation=dict(basis) if basis else None,
        obligation_history=[dict(row) for row in obligations],
        accommodation_obligation_minor=accommodation,
        hotel_charges_minor=charges,
        accommodation_residual_minor=accommodation_residual,
        hotel_charges_residual_minor=charges_residual,
        guest_balance_minor=balance,
        coverage_status="requires_review"
        if unresolved
        else "credit"
        if balance < 0
        else "covered"
        if balance == 0
        else "partial"
        if hotel + channel
        else "unpaid",
        unresolved_components=unresolved,
        net_hotel_minor=hotel,
        net_channel_minor=channel,
        gross=gross,
        component_collections=nets,
        source_rollups=list(rollups.values()),
        payout_status="not_recorded_b8",
    )
    from app.modules.billing.payment_allocations import allocation_summary

    result.update(allocation_summary(session, service.context, parent["id"]))
    return result


def collection_read(service, identity, *, limit=100, offset=0):
    with service.transaction() as session:
        parent = service.owned(session, reservations, identity, lock=True)
        history = rows(session, transactions, service.context.company_id, identity)
        return Result(
            dict(
                items=[dict(row) for row in history[offset : offset + limit]],
                total=len(history),
                summary=summary(service, session, parent),
            )
        ).model_dump(mode="json")


def record(service, identity, request, key, *, obligation=False):
    operation = "billing.obligation_review" if obligation else "billing.collection"
    digest = request_hash(request, resource_id=identity)
    with service.transaction() as session:
        replay = replay_or_lock(session, service.context, operation, key, digest)
        if replay is not None:
            return replay
        parent = service.owned(session, reservations, identity, lock=True, exclusive=True)
        checked_version(parent, request.expected_version)
        if obligation:
            price, capture = current_context(service, session, parent)
            if request.expected_pricing_id != price["id"] or request.expected_capture_id != (
                UUID(capture["id"]) if capture else None
            ):
                raise DomainError(
                    "obligation_context_conflict",
                    "Pricing or commercial capture changed; review again",
                )
        parent = advance(session, parent)
        if obligation:
            insert_basis(service, session, parent, request)
        else:
            insert_collection(service, session, parent, request)
        result = Result(dict(summary=summary(service, session, parent)))
        save_receipt(
            session, service.context, operation, key, digest, result, reservation_id=identity
        )
        stage("receipt")
        stage("before_commit")
        return result.model_dump(mode="json")


def initial_financial_records(service, session, parent, request, key):
    if request.guest_obligation is not None:
        insert_basis(service, session, parent, request.guest_obligation)
    if request.collections is not None:
        intents = (
            request.collections
            if isinstance(request.collections, tuple)
            else (request.collections,)
        )
        for lock in sorted(
            {
                value
                for item in intents
                if (value := evidence_lock(service.context, item)) is not None
            }
        ):
            session.execute(sa.select(sa.func.pg_advisory_xact_lock(lock)))
        body = request.model_dump(mode="json", exclude={"collections"})
        body["collections"] = [
            item.model_dump(
                mode="json",
                exclude={"duplicate_acknowledged", "duplicate_token", "duplicate_justification"},
            )
            for item in intents
        ]
        for index, item in enumerate(intents):
            insert_collection(
                service,
                session,
                parent,
                item,
                initial=True,
                review_context={"body": body, "ordinal": index},
                ordinal=index,
                transaction_id=uuid5(service.context.company_id, f"initial-payment:{key}:{index}"),
            )
    if request.collections is not None or request.guest_obligation is not None:
        summary(service, session, parent)
