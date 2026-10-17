"""Reviewed commercial corrections append captures; finalized bills are never rewritten."""

from uuid import UUID, uuid4

import sqlalchemy as sa
from pydantic import Field

from app.errors import DomainError
from app.models import (
    audit_events,
    billing_documents,
    booking_financial_captures,
    booking_sources,
    pricing_revisions,
    reservations,
)
from app.modules.billing.adjustments import adjusted_snapshot
from app.modules.reservations.booking_financials import BookingFinancialIntent, CapturedBookingTerms
from app.modules.reservations.financial_capture import (
    apply_capture,
    check_reference,
    persist_capture,
    prepare_capture,
)
from app.modules.reservations.multi import ensure_version
from app.modules.reservations.multi_schemas import IndependentRead, MultiRead
from app.modules.reservations.schemas import DTO, AdjustmentCapture, Positive, ReservationRead
from app.mutations import replay_or_lock, request_hash, save_receipt


class BookingFinancialCorrection(DTO):
    expected_version: Positive
    booking_source_id: UUID
    booking_financials: BookingFinancialIntent
    reason: str = Field(min_length=1, max_length=1000)


def read_result(raw):
    cls = (
        IndependentRead
        if raw.get("stay_mode") == "independent"
        else MultiRead
        if raw.get("allocation", 1) is None
        else ReservationRead
    )
    return cls.model_validate(raw)


def financial_history(service, identity):
    with service.transaction() as session:
        service.owned(session, reservations, identity)
        return [
            CapturedBookingTerms.model_validate(row)
            for row in session.scalars(
                sa.select(booking_financial_captures.c.snapshot)
                .where(
                    booking_financial_captures.c.reservation_id == identity,
                    booking_financial_captures.c.company_id == service.context.company_id,
                )
                .order_by(booking_financial_captures.c.reservation_version.desc())
            )
        ]


def correct_financials(service, identity, request, key):
    operation = "reservation.booking_financial_correction"
    digest = request_hash(request, resource_id=identity)
    with service.transaction() as session:
        replay = replay_or_lock(session, service.context, operation, key, digest)
        if replay is not None:
            return read_result(replay)
        parent = service.owned(session, reservations, identity, lock=True, exclusive=True)
        ensure_version(parent, request.expected_version)
        if parent["status"] in ("cancelled", "no_show"):
            raise DomainError(
                "invalid_transition", "Cancelled/no-show bookings cannot change contractual terms"
            )
        if session.scalar(
            sa.select(billing_documents.c.id)
            .where(
                billing_documents.c.reservation_id == identity,
                billing_documents.c.company_id == service.context.company_id,
                billing_documents.c.status == "finalized",
            )
            .limit(1)
        ):
            raise DomainError(
                "finalized_bill_correction_required",
                "A finalized bill exists; its correction workflow is required "
                "before changing commercial terms",
            )
        sources = {
            id: service.owned(session, booking_sources, id, lock=True)
            for id in sorted({parent["booking_source_id"], request.booking_source_id}, key=str)
        }
        source = sources[request.booking_source_id]
        if not source["enabled"] and request.booking_source_id != parent["booking_source_id"]:
            raise DomainError("inactive_reference", "Choose an enabled booking source", 422)
        before = service.read_in_transaction(session, parent)
        raw = before.pricing.snapshot.model_dump(mode="json")
        raw.pop("channel", None)
        raw.pop("channel_figures", None)
        raw["schema_version"] = 6 if parent["multi_room"] else 5
        base = adjusted_snapshot(
            raw,
            [AdjustmentCapture.model_validate(a) for a in raw.get("adjustments", [])],
            service=service,
            session=session,
        )
        capture = prepare_capture(
            service,
            session,
            source,
            request.booking_financials,
            base,
            version=parent["version"] + 1,
            reason=request.reason,
            previous=before.pricing.snapshot.model_dump(mode="json").get("channel"),
        )
        reference = request.booking_financials.external_reference
        check_reference(service, session, source["id"], reference, identity)
        snapshot = apply_capture(base, capture)
        updated = (
            session.execute(
                reservations.update()
                .where(reservations.c.id == identity)
                .values(
                    booking_source_id=source["id"],
                    booking_source_label=source["label"],
                    external_booking_reference=reference or None,
                    version=parent["version"] + 1,
                    updated_at=sa.func.clock_timestamp(),
                )
                .returning(reservations)
            )
            .mappings()
            .one()
        )
        persist_capture(service, session, identity, capture)
        session.execute(
            pricing_revisions.insert().values(
                id=uuid4(),
                company_id=service.context.company_id,
                reservation_id=identity,
                revision=before.pricing.revision + 1,
                reservation_version=updated["version"],
                currency="PHP",
                total_minor=snapshot.total_minor,
                calculation_version=snapshot.calculation_version,
                snapshot=snapshot.model_dump(mode="json"),
            )
        )
        session.execute(
            audit_events.insert().values(
                id=uuid4(),
                company_id=service.context.company_id,
                reservation_id=identity,
                reservation_version=updated["version"],
                event_type="reservation.booking_financials_corrected",
                actor=service.context.actor,
                attribution=service.context.attribution,
                before={
                    "booking_source_id": str(parent["booking_source_id"]),
                    "channel": before.pricing.snapshot.model_dump(mode="json").get("channel"),
                    "pricing_id": str(before.pricing.id),
                },
                after={
                    "description": f"Reviewed commercial correction: {request.reason}",
                    "capture": capture,
                },
            )
        )
        result = service.read_in_transaction(session, updated)
        save_receipt(
            session, service.context, operation, key, digest, result, reservation_id=identity
        )
        return result
