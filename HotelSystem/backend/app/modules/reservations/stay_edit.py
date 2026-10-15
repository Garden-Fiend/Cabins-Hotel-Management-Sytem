"""Atomic pre-arrival assignment and schedule command; captured history is append-only."""

from uuid import UUID, uuid4

import sqlalchemy as sa

from app.errors import DomainError
from app.models import (
    allocations,
    audit_events,
    companies,
    durations,
    guests,
    pricing_revisions,
    rates,
    reservations,
    room_types,
    rooms,
)
from app.modules.billing.adjustments import adjusted_snapshot
from app.modules.billing.charges import capture_charges
from app.modules.reservations.breakfast import capture_breakfast
from app.modules.reservations.inclusions import capture_inclusions
from app.modules.reservations.pricing import HOTEL_ZONE, capture_price, stay_end
from app.modules.reservations.schemas import (
    AdjustmentCapture,
    ReservationRead,
    ReservationStayChargesEdit,
    ReservationStayEdit,
)
from app.mutations import replay_or_lock, request_hash, save_receipt


def edit_stay(service, id: UUID, request: ReservationStayEdit, key: UUID):
    purchases = isinstance(request, ReservationStayChargesEdit)
    operation = "reservation.stay_charges_edit" if purchases else "reservation.stay_edit"
    digest = request_hash(request, resource_id=id)
    with service.transaction() as session:
        replay = replay_or_lock(session, service.context, operation, key, digest)
        if replay is not None:
            return ReservationRead.model_validate(replay)
        reservation = service.owned(session, reservations, id, lock=True, exclusive=True)
        if reservation["multi_room"]:
            raise DomainError("plural_command_required", "Use the explicit multi-room command", 409)
        if reservation["version"] != request.expected_version:
            raise DomainError("version_conflict", "Reservation changed; reload before editing")
        if reservation["version"] >= 2**31 - 1:
            raise DomainError("version_exhausted", "Reservation version cannot be advanced")
        if reservation["status"] not in ("confirmed", "reserved"):
            raise DomainError(
                "invalid_transition",
                "Assignment and stay changes require an unoccupied pre-arrival reservation",
            )
        allocation = (
            session.execute(
                sa.select(allocations).where(
                    allocations.c.company_id == service.context.company_id,
                    allocations.c.reservation_id == id,
                )
            )
            .mappings()
            .one_or_none()
        )
        if allocation is None:
            raise DomainError("incomplete_reservation", "Reservation requires integrity review")
        # Global UUID order avoids opposing room transfers deadlocking. Lifecycle locks
        # reservation -> room -> allocation; create also holds the target room before writes.
        locked_rooms = {
            room_id: service.owned(session, rooms, room_id, lock=True)
            for room_id in sorted({allocation["room_id"], request.room_id}, key=str)
        }
        room = locked_rooms[request.room_id]
        allocation = service.owned(
            session, allocations, allocation["id"], lock=True, exclusive=True
        )
        if not allocation["blocks_availability"]:
            raise DomainError(
                "occupancy_integrity",
                "Pre-arrival allocation requires integrity review before stay changes",
            )
        if (
            allocation["actual_check_in"] is not None
            or allocation["actual_check_out"] is not None
            or any(
                item["current_occupancy_allocation_id"] == allocation["id"]
                for item in locked_rooms.values()
            )
        ):
            raise DomainError(
                "room_occupied", "Physical occupancy prevents assignment/stay changes"
            )
        if not room["enabled"] or room["archived"] or not room["operational"]:
            raise DomainError(
                "room_unavailable", "Target room is disabled, archived or non-operational"
            )
        if room["current_occupancy_allocation_id"] is not None:
            raise DomainError("room_occupied", "Target room has a physical occupancy lock")
        company = service.owned(session, companies, service.context.company_id, lock=True)
        service.owned(session, guests, request.guest_id, lock=True)
        duration = service.owned(session, durations, request.duration_id, lock=True)
        room_type = service.owned(session, room_types, room["room_type_id"], lock=True)
        if not duration["enabled"] or not room_type["enabled"] or room_type["archived"]:
            raise DomainError("inactive_reference", "Stay references must be active", 422)
        changed_price = (
            allocation["room_id"] != request.room_id
            or allocation["duration_id"] != request.duration_id
        )
        changed_start = allocation["scheduled_start"] != request.scheduled_start
        if not changed_price and not changed_start:
            raise DomainError(
                "unchanged_stay", "Use the details command for notes, counts or guest changes", 422
            )
        # Changing only arrival keeps the captured rate. Duration/assignment changes
        # explicitly capture the current configured rate without rewriting prior revisions.
        before = service.read_in_transaction(session, reservation).model_dump(mode="json")
        if changed_price:
            end = stay_end(request.scheduled_start, duration, company)
        elif duration["kind"] == "hourly":
            end = request.scheduled_start + (
                allocation["scheduled_end"] - allocation["scheduled_start"]
            )
        else:
            # Arrival-only changes retain the booked night count and captured checkout
            # wall-clock policy even if reference definitions changed since capture.
            captured_duration = dict(
                duration, nights=before["pricing"]["snapshot"]["lines"][0]["quantity"]
            )
            captured_company = dict(
                company,
                default_check_out_time=allocation["scheduled_end"].astimezone(HOTEL_ZONE).time(),
            )
            end = stay_end(request.scheduled_start, captured_duration, captured_company)
        if (
            session.scalar(
                sa.select(allocations.c.id)
                .where(
                    allocations.c.company_id == service.context.company_id,
                    allocations.c.id != allocation["id"],
                    allocations.c.room_id == request.room_id,
                    allocations.c.blocks_availability,
                    allocations.c.scheduled_start < end,
                    allocations.c.scheduled_end > request.scheduled_start,
                )
                .limit(1)
            )
            is not None
        ):
            raise DomainError("room_conflict", "Target room is already reserved for this interval")
        snapshot = None
        if changed_price:
            rate = (
                session.execute(
                    sa.select(rates)
                    .where(
                        rates.c.company_id == service.context.company_id,
                        rates.c.room_type_id == room_type["id"],
                        rates.c.enabled,
                        rates.c.booking_kind == duration["kind"],
                        rates.c.duration_id == duration["id"]
                        if duration["kind"] == "hourly"
                        else rates.c.duration_id.is_(None),
                    )
                    .with_for_update(read=True)
                )
                .mappings()
                .one_or_none()
            )
            if rate is None:
                raise DomainError(
                    "missing_rate", "No enabled accommodation rate is configured", 422
                )
            snapshot = capture_price(room, room_type, duration, rate)
        existing_adjustments = tuple(
            AdjustmentCapture(**item)
            for item in before["pricing"]["snapshot"].get("adjustments", [])
        )
        adjustments = (
            request.adjustments
            if "adjustments" in request.model_fields_set
            else existing_adjustments
        )
        if (
            purchases
            or "discounts" in request.model_fields_set
            or "adjustments" in request.model_fields_set
            or (snapshot is not None and before["pricing"]["snapshot"]["schema_version"] >= 2)
        ):
            captured = (
                snapshot.model_dump(mode="json")
                if snapshot is not None
                else before["pricing"]["snapshot"]
            )
            if "discounts" in before["pricing"]["snapshot"]:
                captured = {**captured, "discounts": before["pricing"]["snapshot"]["discounts"]}
            if "price_overrides" in before["pricing"]["snapshot"]:
                captured = {
                    **captured,
                    "price_overrides": before["pricing"]["snapshot"]["price_overrides"],
                }
            if "charges" in before["pricing"]["snapshot"]:
                captured = {**captured, "charges": before["pricing"]["snapshot"]["charges"]}
            if purchases:
                captured = {
                    **captured,
                    "charges": [
                        item.model_dump(mode="json")
                        for item in capture_charges(
                            service,
                            session,
                            before["pricing"]["snapshot"],
                            request.charges,
                            reservation_id=id,
                        )
                    ],
                }
            snapshot = adjusted_snapshot(
                captured,
                adjustments,
                request.discounts if "discounts" in request.model_fields_set else None,
                service=service,
                session=session,
            )
        counts = request.model_dump(exclude_unset=True, include={"adults", "children"})
        session.execute(
            allocations.update()
            .where(allocations.c.id == allocation["id"])
            .values(
                room_id=request.room_id,
                duration_id=request.duration_id,
                scheduled_start=request.scheduled_start,
                scheduled_end=end,
                breakfast=capture_breakfast(
                    service,
                    session,
                    request.scheduled_start,
                    end,
                    (
                        snapshot.lines[0].booking_kind
                        if snapshot
                        else before["pricing"]["snapshot"]["lines"][0]["booking_kind"]
                    ),
                    counts.get("adults", allocation["adults"])
                    + counts.get("children", allocation["children"]),
                    allocation["breakfast"],
                    request.breakfast if "breakfast" in request.model_fields_set else None,
                ),
                inclusions=capture_inclusions(
                    service,
                    session,
                    room_type["id"],
                    allocation["inclusions"],
                    request.inclusions if "inclusions" in request.model_fields_set else None,
                    switch=str(room_type["id"])
                    != before["pricing"]["snapshot"]["lines"][0]["room_type_id"],
                ),
                **counts,
            )
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
        if snapshot is not None:
            if before["pricing"]["revision"] >= 2**31 - 1:
                raise DomainError(
                    "pricing_version_exhausted", "Pricing revision cannot be advanced"
                )
            session.execute(
                pricing_revisions.insert().values(
                    id=uuid4(),
                    company_id=service.context.company_id,
                    reservation_id=id,
                    revision=before["pricing"]["revision"] + 1,
                    reservation_version=updated["version"],
                    currency=snapshot.currency,
                    total_minor=snapshot.total_minor,
                    calculation_version=snapshot.calculation_version,
                    snapshot=snapshot.model_dump(mode="json"),
                    created_at=sa.func.clock_timestamp(),
                )
            )
        after = service.read_in_transaction(session, updated).model_dump(mode="json")
        session.execute(
            audit_events.insert().values(
                id=uuid4(),
                company_id=service.context.company_id,
                reservation_id=id,
                event_type="reservation.stay_updated",
                reservation_version=updated["version"],
                actor=service.context.actor,
                attribution=service.context.attribution,
                occurred_at=sa.func.clock_timestamp(),
                before={
                    name: before[name]
                    for name in ("version", "guest", "note", "allocation", "pricing")
                },
                after={
                    name: after[name]
                    for name in ("version", "guest", "note", "allocation", "pricing")
                },
            )
        )
        result = service.read_in_transaction(session, updated)
        save_receipt(session, service.context, operation, key, digest, result, reservation_id=id)
        return result
