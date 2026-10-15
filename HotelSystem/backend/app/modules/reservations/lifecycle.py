"""Single-room lifecycle commands; scheduled facts and captured prices never change."""

from uuid import UUID, uuid4

import sqlalchemy as sa

from app.errors import DomainError
from app.models import allocations, audit_events, pricing_revisions, reservations, room_types, rooms
from app.modules.reservations.schemas import CancellationCommand, LifecycleCommand, ReservationRead
from app.mutations import replay_or_lock, request_hash, save_receipt

ACTIONS = {
    "check_in": "checked_in",
    "check_out": "checked_out",
    "cancel": "cancelled",
    "no_show": "no_show",
    "record_departure": "cancelled",
}


def facts(reservation, allocation, room):
    return {
        "version": reservation["version"],
        "status": reservation["status"],
        "actual_check_in": allocation["actual_check_in"].isoformat()
        if allocation["actual_check_in"]
        else None,
        "actual_check_out": allocation["actual_check_out"].isoformat()
        if allocation["actual_check_out"]
        else None,
        "blocks_availability": allocation["blocks_availability"],
        "housekeeping": room["housekeeping"],
        "occupancy_allocation_id": str(room["current_occupancy_allocation_id"])
        if room["current_occupancy_allocation_id"]
        else None,
    }


def transition(service, id: UUID, action: str, request: LifecycleCommand, key: UUID):
    if action not in ACTIONS:
        raise DomainError("unsupported_command", "Unsupported lifecycle command", 422)
    operation = f"reservation.{action}"
    digest = request_hash(request, resource_id=id)
    with service.transaction() as session:
        replay = replay_or_lock(session, service.context, operation, key, digest)
        if replay is not None:
            return ReservationRead.model_validate(replay)
        reservation = service.owned(session, reservations, id, lock=True, exclusive=True)
        if reservation["multi_room"]:
            raise DomainError("plural_command_required", "Use the explicit multi-room command", 409)
        if reservation["version"] != request.expected_version:
            raise DomainError("version_conflict", "Reservation changed; reload before retrying")
        if reservation["version"] >= 2**31 - 1:
            raise DomainError("version_exhausted", "Reservation version cannot be advanced")
        # Reservation ownership/version lock serializes allocation changes. Obtain the room
        # before allocation lock; create locks this same room before availability decisions.
        allocation = (
            session.execute(
                sa.select(allocations).where(
                    allocations.c.reservation_id == id,
                    allocations.c.company_id == service.context.company_id,
                )
            )
            .mappings()
            .one_or_none()
        )
        if allocation is None:
            raise DomainError("incomplete_reservation", "Reservation requires integrity review")
        room = service.owned(session, rooms, allocation["room_id"], lock=True)
        allocation = service.owned(
            session, allocations, allocation["id"], lock=True, exclusive=True
        )
        now = session.scalar(sa.select(sa.func.clock_timestamp()))
        before = facts(reservation, allocation, room)
        changes = {"blocks_availability": False}
        room_changes = {}
        status = reservation["status"]
        pointer = room["current_occupancy_allocation_id"]
        present = (
            allocation["actual_check_in"] is not None and allocation["actual_check_out"] is None
        )

        if present and (status not in ("checked_in", "cancelled") or pointer != allocation["id"]):
            raise DomainError("occupancy_integrity", "Physical occupancy requires integrity review")
        if pointer == allocation["id"] and not present:
            raise DomainError("occupancy_integrity", "Physical occupancy requires integrity review")
        if action == "check_in":
            if status not in ("confirmed", "reserved"):
                raise DomainError("invalid_transition", "Only confirmed reservations can check in")
            if (
                allocation["actual_check_in"] is not None
                or allocation["actual_check_out"] is not None
            ):
                raise DomainError(
                    "occupancy_integrity", "Actual timestamps require integrity review"
                )
            if not allocation["scheduled_start"] <= now < allocation["scheduled_end"]:
                raise DomainError(
                    "check_in_window", "Check-in is available only during the scheduled stay"
                )
            # Type retirement prevents new bookings, not service of captured assignments.
            service.owned(session, room_types, room["room_type_id"], lock=True)
            pricing = session.execute(
                sa.select(pricing_revisions.c.snapshot)
                .where(
                    pricing_revisions.c.reservation_id == id,
                    pricing_revisions.c.company_id == service.context.company_id,
                )
                .order_by(pricing_revisions.c.revision.desc())
                .limit(1)
            ).scalar_one_or_none()
            if pricing is None or str(room["room_type_id"]) != pricing["lines"][0]["room_type_id"]:
                raise DomainError(
                    "room_type_changed", "Room type no longer matches the captured assignment"
                )
            if not room["enabled"] or room["archived"] or not room["operational"]:
                raise DomainError(
                    "room_unavailable", "Assigned room must be active and operational"
                )
            if room["housekeeping"] != "clean":
                raise DomainError("room_not_ready", "Assigned room must be Clean before check-in")
            if pointer is not None:
                raise DomainError("room_occupied", "Room has another physical occupancy lock")
            if not allocation["blocks_availability"]:
                raise DomainError(
                    "allocation_integrity", "Scheduled allocation requires integrity review"
                )
            changes = {"actual_check_in": now, "blocks_availability": True}
            room_changes = {"current_occupancy_allocation_id": allocation["id"]}
        elif action == "no_show":
            if status not in ("confirmed", "reserved") or allocation["actual_check_in"] is not None:
                raise DomainError(
                    "invalid_transition", "Only unoccupied confirmed reservations can be no-show"
                )
            if now < allocation["scheduled_start"]:
                raise DomainError(
                    "no_show_window", "No-show is available only after scheduled arrival"
                )
        elif action == "cancel":
            if status not in ("confirmed", "reserved", "checked_in"):
                raise DomainError(
                    "invalid_transition", "Reservation cannot be cancelled in this state"
                )
            if not isinstance(request, CancellationCommand):
                raise DomainError(
                    "invalid_command", "Cancellation requires a vacated-room decision", 422
                )
            if status == "checked_in" and not present:
                raise DomainError(
                    "occupancy_integrity", "Checked-in occupancy requires integrity review"
                )
            if present and request.guest_has_vacated:
                changes["actual_check_out"] = now
                room_changes = {"current_occupancy_allocation_id": None, "housekeeping": "dirty"}
        else:
            required = "checked_in" if action == "check_out" else "cancelled"
            if status != required or not present:
                raise DomainError(
                    "invalid_transition", "Reservation has no supported active occupancy to release"
                )
            changes["actual_check_out"] = now
            room_changes = {"current_occupancy_allocation_id": None, "housekeeping": "dirty"}
        if present and now < allocation["actual_check_in"]:
            raise DomainError("occupancy_integrity", "Actual timestamps require integrity review")

        updated_allocation = (
            session.execute(
                allocations.update()
                .where(
                    allocations.c.id == allocation["id"],
                    allocations.c.company_id == service.context.company_id,
                )
                .values(**changes)
                .returning(allocations)
            )
            .mappings()
            .one()
        )
        if room_changes:
            if room["version"] >= 2**31 - 1:
                raise DomainError("version_exhausted", "Room version cannot be advanced")
            room_changes["version"] = room["version"] + 1
            room = (
                session.execute(
                    rooms.update()
                    .where(
                        rooms.c.id == room["id"], rooms.c.company_id == service.context.company_id
                    )
                    .values(**room_changes)
                    .returning(rooms)
                )
                .mappings()
                .one()
            )
        updated = (
            session.execute(
                reservations.update()
                .where(
                    reservations.c.id == id,
                    reservations.c.company_id == service.context.company_id,
                    reservations.c.version == request.expected_version,
                )
                .values(status=ACTIONS[action], version=reservations.c.version + 1, updated_at=now)
                .returning(reservations)
            )
            .mappings()
            .one_or_none()
        )
        if updated is None:
            raise DomainError("version_conflict", "Reservation changed; reload before retrying")
        session.execute(
            audit_events.insert().values(
                id=uuid4(),
                company_id=service.context.company_id,
                reservation_id=id,
                event_type=operation,
                reservation_version=updated["version"],
                actor=service.context.actor,
                attribution=service.context.attribution,
                occurred_at=now,
                before=before,
                after=facts(updated, updated_allocation, room),
            )
        )
        result = service.read_in_transaction(session, updated)
        save_receipt(session, service.context, operation, key, digest, result, reservation_id=id)
        return result
