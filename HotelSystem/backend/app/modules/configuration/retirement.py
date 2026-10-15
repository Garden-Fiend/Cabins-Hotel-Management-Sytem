"""Owned room/type retirement; configuration audit snapshots survive unused deletion."""

from typing import Literal
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.db import Base
from app.errors import DomainError
from app.models import audit_events, billing_documents, pricing_revisions, room_types, rooms
from app.modules.configuration.services import has_active_assignment
from app.modules.reservations.schemas import DTO, Positive
from app.mutations import replay_or_lock, request_hash, save_receipt


class RetirementIntent(DTO):
    expected_version: Positive
    action: Literal["archive", "restore", "delete"]


class RetirementRead(DTO):
    id: UUID
    version: Positive
    action: Literal["archive", "restore", "delete"]


def assert_unused(session, service, table, identity):
    # Includes rates, defaults, presets and every allocation, including tombstones.
    for dependent in Base.metadata.tables.values():
        for fk in dependent.foreign_keys:
            if fk.column is table.c.id:
                if session.scalar(
                    sa.select(sa.literal(True))
                    .select_from(dependent)
                    .where(fk.parent == identity)
                    .limit(1)
                ):
                    raise DomainError(
                        "reference_in_use",
                        "History or configuration uses this record; archive it instead",
                    )
    # JSON captures are deliberately not relational cascades. Keep their identities valid.
    for target, column in (
        (pricing_revisions, pricing_revisions.c.snapshot),
        (billing_documents, billing_documents.c.capture),
        (audit_events, audit_events.c.before),
        (audit_events, audit_events.c.after),
    ):
        predicate = [
            target.c.company_id == service.context.company_id,
            sa.cast(column, sa.Text).contains(str(identity)),
        ]
        if target is audit_events:
            # Own definition audit remains readable after deletion; it is not business use.
            kind = "rooms" if table is rooms else "room-types"
            predicate.append(
                ~sa.and_(
                    audit_events.c.event_type.like(f"configuration.{kind}.%"),
                    sa.or_(
                        audit_events.c.before["id"].astext == str(identity),
                        audit_events.c.after["id"].astext == str(identity),
                    ),
                )
            )
        if session.scalar(
            sa.select(sa.literal(True)).select_from(target).where(*predicate).limit(1)
        ):
            raise DomainError(
                "reference_in_use", "Historical records use this identity; archive it instead"
            )


def retire_definition(service, kind, identity, request, key):
    table = rooms if kind == "rooms" else room_types
    operation = f"configuration.{kind}.{request.action}"
    digest = request_hash(request, resource_id=identity)
    try:
        with service.transaction() as session:
            replay = replay_or_lock(session, service.context, operation, key, digest)
            if replay is not None:
                return RetirementRead.model_validate(replay)
            previous = service.owned(session, table, identity, lock=True, exclusive=True)
            if previous["version"] != request.expected_version:
                raise DomainError(
                    "version_conflict", "Definition changed; reload and review before retrying"
                )
            if (
                kind == "rooms"
                and request.action == "archive"
                and (
                    previous["current_occupancy_allocation_id"] is not None
                    or has_active_assignment(session, service, identity)
                )
            ):
                raise DomainError(
                    "active_assignment",
                    "This room has active reservations or occupancy; release them before archiving",
                )
            if request.action == "restore" and kind == "rooms":
                parent = service.owned(session, room_types, previous["room_type_id"], lock=True)
                if not parent["enabled"] or parent["archived"]:
                    raise DomainError(
                        "inactive_reference", "Restore the room type before restoring this room"
                    )
            version = previous["version"]
            changed = (
                request.action == "delete"
                or previous["archived"] != (request.action == "archive")
                or previous["enabled"] != (request.action == "restore")
            )
            if request.action == "delete":
                assert_unused(session, service, table, identity)
                session.execute(table.delete().where(table.c.id == identity))
            elif changed:
                if version >= 2**31 - 1:
                    raise DomainError("version_exhausted", "Definition version cannot be advanced")
                version += 1
                session.execute(
                    table.update()
                    .where(table.c.id == identity)
                    .values(
                        enabled=request.action == "restore",
                        archived=request.action == "archive",
                        version=version,
                    )
                )
            result = RetirementRead(id=identity, version=version, action=request.action)
            if changed:
                session.execute(
                    audit_events.insert().values(
                        id=uuid4(),
                        company_id=service.context.company_id,
                        event_type=operation,
                        actor=service.context.actor,
                        attribution=service.context.attribution,
                        occurred_at=sa.func.clock_timestamp(),
                        before={
                            "id": str(identity),
                            "version": previous["version"],
                            "enabled": previous["enabled"],
                            "archived": previous["archived"],
                            "label": previous["number"] if kind == "rooms" else previous["label"],
                        },
                        after=result.model_dump(mode="json"),
                    )
                )
            save_receipt(session, service.context, operation, key, digest, result)
            return result
    except IntegrityError as error:
        raise DomainError(
            "reference_in_use", "A dependent record prevents deletion; archive instead"
        ) from error
