"""Bounded room readiness, independent of configuration CRUD or financial commands."""

from uuid import UUID, uuid4

import sqlalchemy as sa

from app.errors import DomainError
from app.models import audit_events, rooms
from app.modules.reservations.references import RoomRead
from app.modules.reservations.schemas import RoomReadinessCommand
from app.mutations import replay_or_lock, request_hash, save_receipt


def set_readiness(service, id: UUID, request: RoomReadinessCommand, key: UUID):
    operation = "room.readiness"
    digest = request_hash(request, resource_id=id)
    with service.transaction() as session:
        replay = replay_or_lock(session, service.context, operation, key, digest)
        if replay is not None:
            return RoomRead.model_validate(replay)
        room = service.owned(session, rooms, id, lock=True)
        if room["version"] != request.expected_version:
            raise DomainError("version_conflict", "Room changed; reload before retrying")
        if room["version"] >= 2**31 - 1:
            raise DomainError("version_exhausted", "Room version cannot be advanced")
        if room["current_occupancy_allocation_id"] is not None:
            raise DomainError("room_occupied", "Occupied rooms cannot change readiness")
        before = {
            "room_id": str(id),
            "version": room["version"],
            "housekeeping": room["housekeeping"],
        }
        updated = (
            session.execute(
                rooms.update()
                .where(
                    rooms.c.id == id,
                    rooms.c.company_id == service.context.company_id,
                    rooms.c.version == request.expected_version,
                )
                .values(housekeeping=request.housekeeping, version=rooms.c.version + 1)
                .returning(rooms)
            )
            .mappings()
            .one_or_none()
        )
        if updated is None:
            raise DomainError("version_conflict", "Room changed; reload before retrying")
        session.execute(
            audit_events.insert().values(
                id=uuid4(),
                company_id=service.context.company_id,
                event_type="room.readiness_changed",
                actor=service.context.actor,
                attribution=service.context.attribution,
                occurred_at=sa.func.clock_timestamp(),
                before=before,
                after={
                    "room_id": str(id),
                    "version": updated["version"],
                    "housekeeping": updated["housekeeping"],
                },
            )
        )
        result = RoomRead(**{name: updated[name] for name in RoomRead.model_fields})
        save_receipt(session, service.context, operation, key, digest, result)
        return result
