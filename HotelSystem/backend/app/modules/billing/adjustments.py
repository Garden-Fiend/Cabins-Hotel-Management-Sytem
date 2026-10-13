"""Saved operational adjustment command. No invoice, payment or ledger posting."""

from uuid import uuid4

import sqlalchemy as sa

from app.errors import DomainError
from app.models import allocations, audit_events, guests, pricing_revisions, reservations
from app.modules.billing.charges import capture_charges
from app.modules.reservations.schemas import (
    MAX_MINOR,
    AdjustedPricingSnapshot,
    AdjustmentCapture,
    ChargedPricingSnapshot,
    ReservationRead,
)
from app.mutations import replay_or_lock, request_hash, save_receipt


def adjusted_snapshot(captured, adjustments):
    subtotal = sum(line["amount_minor"] for line in captured["lines"]) + sum(
        item["amount_minor"] for item in captured.get("charges", [])
    )
    total = subtotal + sum(item.amount_minor for item in adjustments)
    if (
        subtotal > MAX_MINOR
        or abs(total) > MAX_MINOR
        or abs(sum(item.amount_minor for item in adjustments)) > MAX_MINOR
    ):
        raise DomainError(
            "price_out_of_range", "Adjusted amount exceeds supported exact monetary range", 422
        )
    model = ChargedPricingSnapshot if "charges" in captured else AdjustedPricingSnapshot
    return model(
        **{
            **captured,
            "schema_version": 3 if "charges" in captured else 2,
            "calculation_version": "direct-charges-v1"
            if "charges" in captured
            else "direct-adjustments-v1",
            "adjustments": adjustments,
            "total_minor": max(0, total),
        }
    )


def save_adjustments(service, id, request, key, *, purchases=False):
    operation = "reservation.charges_edit" if purchases else "reservation.billing_edit"
    digest = request_hash(request, resource_id=id)
    with service.transaction() as session:
        replay = replay_or_lock(session, service.context, operation, key, digest)
        if replay is not None:
            return ReservationRead.model_validate(replay)
        reservation = service.owned(session, reservations, id, lock=True, exclusive=True)
        if reservation["version"] != request.expected_version:
            raise DomainError("version_conflict", "Reservation changed; reload before editing")
        if reservation["version"] >= 2**31 - 1:
            raise DomainError("version_exhausted", "Reservation version cannot be advanced")
        if reservation["status"] not in ("confirmed", "reserved", "checked_in"):
            raise DomainError(
                "invalid_transition",
                "This reservation lifecycle no longer permits operational bill editing",
            )
        service.owned(session, guests, request.guest_id, lock=True)
        allocation = (
            session.execute(
                sa.select(allocations)
                .where(
                    allocations.c.company_id == service.context.company_id,
                    allocations.c.reservation_id == id,
                )
                .with_for_update()
            )
            .mappings()
            .one_or_none()
        )
        if allocation is None:
            raise DomainError("incomplete_reservation", "Reservation requires integrity review")
        previous = service.read_in_transaction(session, reservation).model_dump(mode="json")
        captured = previous["pricing"]["snapshot"]
        if purchases:
            captured = {
                **captured,
                "charges": [
                    item.model_dump(mode="json")
                    for item in capture_charges(
                        service, session, captured, request.charges, reservation_id=id
                    )
                ],
            }
        adjustments = (
            request.adjustments
            if "adjustments" in request.model_fields_set
            else tuple(AdjustmentCapture(**item) for item in captured.get("adjustments", []))
        )
        snapshot = adjusted_snapshot(captured, adjustments)
        counts = request.model_dump(exclude_unset=True, include={"adults", "children"})
        if counts:
            session.execute(
                allocations.update().where(allocations.c.id == allocation["id"]).values(**counts)
            )
        updated = (
            session.execute(
                reservations.update()
                .where(
                    reservations.c.id == id,
                    reservations.c.company_id == service.context.company_id,
                    reservations.c.version == request.expected_version,
                )
                .values(
                    guest_id=request.guest_id,
                    note=request.note
                    if "note" in request.model_fields_set
                    else reservation["note"],
                    version=reservations.c.version + 1,
                    updated_at=sa.func.clock_timestamp(),
                )
                .returning(reservations)
            )
            .mappings()
            .one_or_none()
        )
        if updated is None:
            raise DomainError("version_conflict", "Reservation changed; reload before editing")
        if previous["pricing"]["revision"] >= 2**31 - 1:
            raise DomainError("pricing_version_exhausted", "Pricing revision cannot be advanced")
        session.execute(
            pricing_revisions.insert().values(
                id=uuid4(),
                company_id=service.context.company_id,
                reservation_id=id,
                revision=previous["pricing"]["revision"] + 1,
                reservation_version=updated["version"],
                currency=snapshot.currency,
                total_minor=snapshot.total_minor,
                calculation_version=snapshot.calculation_version,
                snapshot=snapshot.model_dump(mode="json"),
                created_at=sa.func.clock_timestamp(),
            )
        )
        current = service.read_in_transaction(session, updated).model_dump(mode="json")
        session.execute(
            audit_events.insert().values(
                id=uuid4(),
                company_id=service.context.company_id,
                reservation_id=id,
                event_type="reservation.billing_updated",
                reservation_version=updated["version"],
                actor=service.context.actor,
                attribution=service.context.attribution,
                occurred_at=sa.func.clock_timestamp(),
                before={
                    field: previous[field]
                    for field in ("version", "note", "guest", "allocation", "pricing")
                },
                after={
                    field: current[field]
                    for field in ("version", "note", "guest", "allocation", "pricing")
                },
            )
        )
        result = service.read_in_transaction(session, updated)
        save_receipt(session, service.context, operation, key, digest, result, reservation_id=id)
        return result
