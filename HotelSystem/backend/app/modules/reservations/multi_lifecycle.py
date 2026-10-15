"""Allocation-targeted and strict all-room atomic lifecycle commands."""

import sqlalchemy as sa

from app.errors import DomainError
from app.models import allocations, reservations, rooms
from app.modules.reservations.multi import (
    active_rows,
    aggregate,
    audit_facts,
    ensure_version,
    read_multi,
    record,
    state,
)
from app.modules.reservations.multi_schemas import IndependentRead, MultiRead
from app.mutations import replay_or_lock, request_hash, save_receipt


def transition_multi(service, id, action, request, key):
    if action not in ("check_in", "check_out", "cancel", "no_show", "record_departure"):
        raise DomainError("unsupported_command", "Unsupported room lifecycle action", 422)
    operation = f"reservation.multi_{action}"
    digest = request_hash(request, resource_id=id)
    with service.transaction() as session:
        replay = replay_or_lock(session, service.context, operation, key, digest)
        if replay is not None:
            return (
                IndependentRead if replay.get("stay_mode") == "independent" else MultiRead
            ).model_validate(replay)
        parent = service.owned(session, reservations, id, lock=True, exclusive=True)
        ensure_version(parent, request.expected_version)
        if not parent["multi_room"]:
            raise DomainError("single_room_contract", "Use the existing single-room lifecycle")
        rows = [r for r in active_rows(service, session, id) if r["removed_at"] is None]
        targets = [
            r for r in rows if request.allocation_id is None or r["id"] == request.allocation_id
        ]
        if action == "record_departure" and request.allocation_id is None:
            targets = [
                r
                for r in targets
                if r["state"] == "cancelled"
                and r["actual_check_in"] is not None
                and r["actual_check_out"] is None
            ]
        if not targets:
            raise DomainError("not_found", "Allocation was not found", 404)
        room_rows = {
            room_id: service.owned(session, rooms, room_id, lock=True)
            for room_id in sorted({r["room_id"] for r in targets}, key=str)
        }
        before = read_multi(service, session, parent)
        snapshot = before.pricing.snapshot
        now = session.scalar(sa.select(sa.func.clock_timestamp()))
        prepared = []
        # Validate every intended target before issuing any mutation.
        for row in targets:
            room = room_rows[row["room_id"]]
            status, present = (
                state(row, parent),
                row["actual_check_in"] is not None and row["actual_check_out"] is None,
            )
            if (present and room["current_occupancy_allocation_id"] != row["id"]) or (
                room["current_occupancy_allocation_id"] == row["id"] and not present
            ):
                raise DomainError(
                    "occupancy_integrity", f"Room {room['number']} occupancy requires review"
                )
            change, room_change = {}, {}
            if action == "check_in":
                if (
                    status != "reserved"
                    or row["actual_check_in"]
                    or row["actual_check_out"]
                    or not row["blocks_availability"]
                ):
                    raise DomainError(
                        "invalid_transition", f"Room {room['number']} is not reserved for check-in"
                    )
                if not row["scheduled_start"] <= now < row["scheduled_end"]:
                    raise DomainError(
                        "check_in_window", f"Room {room['number']} is outside its scheduled stay"
                    )
                line = next(line for line in snapshot.lines if line.room_id == row["room_id"])
                if room["room_type_id"] != line.room_type_id:
                    raise DomainError("room_type_changed", "Assigned room type changed")
                if (
                    not room["enabled"]
                    or room["archived"]
                    or not room["operational"]
                    or room["current_occupancy_allocation_id"]
                ):
                    raise DomainError(
                        "room_unavailable", f"Room {room['number']} is unavailable or occupied"
                    )
                if room["housekeeping"] != "clean":
                    raise DomainError("room_not_ready", f"Room {room['number']} must be Clean")
                change = dict(state="checked_in", actual_check_in=now)
                room_change = dict(current_occupancy_allocation_id=row["id"])
            elif action in ("check_out", "record_departure"):
                required = "checked_in" if action == "check_out" else "cancelled"
                if status != required or not present:
                    raise DomainError(
                        "invalid_transition",
                        f"Room {room['number']} has no eligible occupancy to release",
                    )
                change = dict(
                    state="checked_out" if action == "check_out" else "cancelled",
                    actual_check_out=now,
                    blocks_availability=False,
                )
                room_change = dict(current_occupancy_allocation_id=None, housekeeping="dirty")
            elif action == "no_show":
                if status != "reserved" or present or now < row["scheduled_start"]:
                    raise DomainError(
                        "invalid_transition", f"Room {room['number']} is not eligible for no-show"
                    )
                change = dict(state="no_show", blocks_availability=False)
            else:
                if status not in ("reserved", "checked_in"):
                    raise DomainError(
                        "invalid_transition", f"Room {room['number']} cannot be cancelled"
                    )
                change = dict(
                    state="cancelled", blocks_availability=present and not request.guest_has_vacated
                )
                if present and request.guest_has_vacated:
                    change["actual_check_out"] = now
                    room_change = dict(current_occupancy_allocation_id=None, housekeeping="dirty")
            if present and now < row["actual_check_in"]:
                raise DomainError("occupancy_integrity", "Actual time cannot precede check-in")
            if room_change and room["version"] >= 2**31 - 1:
                raise DomainError("version_exhausted", "Room version cannot advance")
            prepared.append((row, change, room_change))
        for row, change, room_change in prepared:
            session.execute(
                allocations.update()
                .where(
                    allocations.c.id == row["id"],
                    allocations.c.company_id == service.context.company_id,
                )
                .values(**change)
            )
            if room_change:
                session.execute(
                    rooms.update()
                    .where(
                        rooms.c.id == row["room_id"],
                        rooms.c.company_id == service.context.company_id,
                    )
                    .values(**room_change, version=rooms.c.version + 1)
                )
        canonical = active_rows(service, session, id)
        status, _ = aggregate(canonical)
        updated = (
            session.execute(
                reservations.update()
                .where(
                    reservations.c.id == id,
                    reservations.c.company_id == service.context.company_id,
                    reservations.c.version == request.expected_version,
                )
                .values(status=status, version=reservations.c.version + 1, updated_at=now)
                .returning(reservations)
            )
            .mappings()
            .one()
        )
        record(
            service,
            session,
            updated,
            operation,
            audit_facts(before.model_dump(mode="json")),
            dict(
                **audit_facts(read_multi(service, session, updated).model_dump(mode="json")),
                scope="all" if request.allocation_id is None else "individual",
                description=(
                    "All rooms"
                    if request.allocation_id is None
                    else "Room " + room_rows[targets[0]["room_id"]]["number"]
                )
                + " "
                + action.replace("_", " "),
                targeted_allocations=[str(t["id"]) for t in targets],
            ),
        )
        result = read_multi(service, session, updated)
        save_receipt(session, service.context, operation, key, digest, result, reservation_id=id)
        return result
