"""Plural allocation aggregate. One transaction, one pricing pipeline, one reservation."""

from uuid import uuid4

import sqlalchemy as sa

from app.errors import DomainError
from app.models import (
    allocations,
    audit_events,
    booking_sources,
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
from app.modules.reservations.allocation_stays import resolve_stays
from app.modules.reservations.breakfast import capture_breakfast
from app.modules.reservations.inclusions import capture_inclusions
from app.modules.reservations.multi_schemas import (
    IndependentAllocationRead,
    IndependentRead,
    MultiAllocationRead,
    MultiAuditRead,
    MultiRead,
)
from app.modules.reservations.pricing import capture_price, stay_end
from app.modules.reservations.schemas import AllocationRead, AuditRead, GuestRead, PricingRead
from app.mutations import replay_or_lock, request_hash, save_receipt


def active_rows(service, session, id):
    return list(
        session.execute(
            sa.select(allocations)
            .where(
                allocations.c.reservation_id == id,
                allocations.c.company_id == service.context.company_id,
            )
            .order_by(allocations.c.id)
        ).mappings()
    )


def state(row, parent):
    if row["state"]:
        return row["state"]
    if row["actual_check_out"]:
        return "checked_out" if parent["status"] != "cancelled" else "cancelled"
    if row["actual_check_in"]:
        return "checked_in" if parent["status"] != "cancelled" else "cancelled"
    return parent["status"] if parent["status"] in ("cancelled", "no_show") else "reserved"


def aggregate(rows):
    states = [r["state"] for r in rows if r["removed_at"] is None]
    if not states:
        raise DomainError("allocation_integrity", "Reservation must retain an active allocation")
    if all(s == "reserved" for s in states):
        return "confirmed", "reserved"
    if all(s == "checked_out" for s in states):
        return "checked_out", "checked_out"
    if all(s == "cancelled" for s in states):
        return "cancelled", "cancelled"
    if all(s == "no_show" for s in states):
        return "no_show", "no_show"
    present = any(
        r.get("actual_check_in") is not None and r.get("actual_check_out") is None
        for r in rows
        if r["removed_at"] is None
    )
    if present:
        return (
            "checked_in",
            "partially_checked_in"
            if "reserved" in states
            else "partially_checked_out"
            if "checked_out" in states
            else "checked_in",
        )
    if "reserved" in states:
        return "confirmed", "partially_checked_out" if "checked_out" in states else "reserved"
    return "checked_out", "checked_out"


def read_multi(service, session, parent):
    rows = active_rows(service, session, parent["id"])
    histories = list(
        session.execute(
            sa.select(pricing_revisions)
            .where(
                pricing_revisions.c.reservation_id == parent["id"],
                pricing_revisions.c.company_id == service.context.company_id,
            )
            .order_by(pricing_revisions.c.revision.desc())
        ).mappings()
    )
    if not histories:
        raise DomainError("incomplete_reservation", "Pricing requires integrity review")
    allocation_reads = []
    for row in rows:
        label = next(
            (
                line
                for history in histories
                if row["removed_at"] is None or history["created_at"] <= row["removed_at"]
                for line in history["snapshot"]["lines"]
                if line.get("allocation_id", str(row["id"])) == str(row["id"])
                and line["room_id"] == str(row["room_id"])
            ),
            None,
        )
        if not label:
            raise DomainError("allocation_integrity", "Allocation capture is missing")
        allocation_reads.append(
            (IndependentAllocationRead if parent["independent_stays"] else MultiAllocationRead)(
                **(
                    {"uses_reservation_stay": row["uses_reservation_stay"]}
                    if parent["independent_stays"]
                    else {}
                ),
                **{name: row[name] for name in AllocationRead.model_fields},
                state=state(row, parent),
                removed_at=row["removed_at"],
                room_number=label["room_number"],
                room_type_label=label["room_type_label"],
            )
        )
    projection = aggregate([dict(r, state=state(r, parent)) for r in rows])[1]
    price = histories[0]
    rank = {line["allocation_id"]: index for index, line in enumerate(price["snapshot"]["lines"])}
    allocation_reads.sort(
        key=lambda a: (a.removed_at is not None, rank.get(str(a.id), len(rank)), str(a.id))
    )
    events = session.execute(
        sa.select(audit_events)
        .where(
            audit_events.c.reservation_id == parent["id"],
            audit_events.c.company_id == service.context.company_id,
        )
        .order_by(audit_events.c.occurred_at, audit_events.c.id)
    ).mappings()
    default_end = None
    if parent["independent_stays"]:
        inherited = next(
            (r for r in rows if r["removed_at"] is None and r["uses_reservation_stay"]), None
        )
        default_end = (
            inherited["scheduled_end"]
            if inherited
            else stay_end(
                parent["default_stay_start"],
                service.owned(session, durations, parent["default_duration_id"]),
                service.owned(session, companies, parent["company_id"]),
            )
        )
    return (IndependentRead if parent["independent_stays"] else MultiRead)(
        **(
            {
                "stay_defaults": {
                    "scheduled_start": parent["default_stay_start"],
                    "scheduled_end": default_end,
                    "duration_id": parent["default_duration_id"],
                }
            }
            if parent["independent_stays"]
            else {}
        ),
        **{
            name: parent[name]
            for name in (
                "id",
                "company_id",
                "business_number",
                "version",
                "status",
                "booking_source_id",
                "note",
                "created_at",
                "updated_at",
                "shared_start",
                "shared_end",
                "shared_duration_id",
            )
        },
        reference=f"HMS-{parent['business_number']:06d}",
        guest=GuestRead.model_validate(service.owned(session, guests, parent["guest_id"])),
        allocations=tuple(allocation_reads),
        aggregate_status=projection,
        pricing=PricingRead(
            id=price["id"],
            revision=price["revision"],
            reservation_version=price["reservation_version"],
            captured_at=price["created_at"],
            snapshot=price["snapshot"],
        ),
        audit=[
            MultiAuditRead(
                **{name: row[name] for name in AuditRead.model_fields},
                description=(row["after"] or {}).get(
                    "description", row["event_type"].replace("reservation.", "").replace("_", " ")
                ),
            )
            for row in events
        ],
    )


def ensure_version(parent, expected):
    if parent["version"] != expected:
        raise DomainError("version_conflict", "Reservation changed; reload and review")
    if parent["version"] >= 2**31 - 1:
        raise DomainError("version_exhausted", "Version cannot advance")


def audit_facts(value):
    """Business facts without recursively capturing earlier audit events/contact details."""
    if value is None:
        return None
    return {
        "version": value["version"],
        "status": value["status"],
        "guest_id": value["guest"]["id"],
        "booking_source_id": value["booking_source_id"],
        "note": value["note"],
        "allocations": value.get("allocations", [value.get("allocation")]),
        "shared_start": value.get("shared_start"),
        "shared_end": value.get("shared_end"),
        "shared_duration_id": value.get("shared_duration_id"),
        "stay_defaults": value.get("stay_defaults"),
        "pricing": value["pricing"],
    }


def record(service, session, parent, operation, before, after):
    session.execute(
        audit_events.insert().values(
            id=uuid4(),
            company_id=service.context.company_id,
            reservation_id=parent["id"],
            reservation_version=parent["version"],
            event_type=operation,
            actor=service.context.actor,
            attribution=service.context.attribution,
            occurred_at=sa.func.clock_timestamp(),
            before=before,
            after=after,
        )
    )


def save_multi(service, request, key, id=None):
    operation = "reservation.multi_edit" if id else "reservation.multi_create"
    digest = request_hash(request, resource_id=id)
    with service.transaction() as session:
        replay = replay_or_lock(session, service.context, operation, key, digest)
        if replay is not None:
            return (
                IndependentRead if replay.get("stay_mode") == "independent" else MultiRead
            ).model_validate(replay)
        parent = service.owned(session, reservations, id, lock=True, exclusive=True) if id else None
        if parent:
            ensure_version(parent, request.expected_version)
            old_rows = active_rows(service, session, id)
            if parent["status"] not in ("confirmed", "reserved", "checked_in"):
                raise DomainError(
                    "invalid_transition",
                    "Final reservation states cannot accept new operational billing edits",
                )
            previous = service.read_in_transaction(session, parent).model_dump(mode="json")
            old = previous["pricing"]["snapshot"]
        else:
            if any(item.id for item in request.allocations):
                raise DomainError(
                    "invalid_allocation", "New allocations receive server identities", 422
                )
            old_rows, previous, old = [], None, {}
        owner = service.context.company_id
        # Lock the complete old/new physical set in the same UUID order, including removals.
        room_rows = {
            room_id: service.owned(session, rooms, room_id, lock=True)
            for room_id in sorted(
                {r["room_id"] for r in old_rows} | {i.room_id for i in request.allocations}, key=str
            )
        }
        company = service.owned(session, companies, owner, lock=True)
        service.owned(session, durations, request.duration_id, lock=True)
        service.owned(session, guests, request.guest_id, lock=True)
        source = service.owned(session, booking_sources, request.booking_source_id, lock=True)
        unchanged_source = parent and parent["booking_source_id"] == request.booking_source_id
        if (not source["enabled"] and not unchanged_source) or source["source_id"] != "direct":
            raise DomainError("inactive_reference", "Enabled direct source required", 422)
        resolved = resolve_stays(service, session, request, old_rows, old, company)
        independent = bool(
            (parent and parent["independent_stays"])
            or any(intent.stay is not None for intent in request.allocations)
        )
        current_rows = [row for row in old_rows if row["removed_at"] is None]
        membership_changed = {r["id"] for r in current_rows} != {i.id for i in request.allocations}
        changed_schedule = any(
            (
                row["scheduled_start"],
                row["scheduled_end"],
                row["duration_id"],
                row["uses_reservation_stay"],
            )
            != (
                resolved[row["room_id"]][0],
                resolved[row["room_id"]][1],
                resolved[row["room_id"]][2]["id"],
                resolved[row["room_id"]][4],
            )
            for row in current_rows
            if row["room_id"] in resolved
        )
        if (
            parent
            and (
                membership_changed
                or changed_schedule
                or (
                    parent["independent_stays"]
                    and (
                        parent["default_stay_start"] != request.scheduled_start
                        or parent["default_duration_id"] != request.duration_id
                    )
                )
            )
            and any(state(row, parent) != "reserved" for row in current_rows)
        ):
            raise DomainError(
                "invalid_transition",
                "Add/remove and stay changes require every active room to remain reserved",
            )
        overall_start = min(value[0] for value in resolved.values())
        overall_end = max(value[1] for value in resolved.values())
        duration_ids = {value[2]["id"] for value in resolved.values()}
        common_duration = next(iter(duration_ids)) if len(duration_ids) == 1 else None
        parent_stay = dict(
            shared_start=overall_start, shared_end=overall_end, shared_duration_id=common_duration
        )
        if independent:
            parent_stay.update(
                independent_stays=True,
                default_stay_start=request.scheduled_start,
                default_duration_id=request.duration_id,
            )
        reservation_id = id or uuid4()
        now = session.scalar(sa.select(sa.func.clock_timestamp()))
        old_by_id = {r["id"]: r for r in old_rows}
        lines, prepared, charge_intents, charge_owners = [], [], [], {}
        retained = set()
        for intent in request.allocations:
            original = old_by_id.get(intent.id)
            start, end, duration, captured_duration, inherited = resolved[intent.room_id]
            if intent.id is None and any(
                r["removed_at"] is None and r["room_id"] == intent.room_id for r in old_rows
            ):
                raise DomainError(
                    "invalid_allocation",
                    "Retain the canonical identity of an existing room allocation",
                    422,
                )
            if intent.id and (
                original is None
                or original["removed_at"] is not None
                or original["room_id"] != intent.room_id
            ):
                raise DomainError(
                    "invalid_allocation",
                    "Keep the original allocation identity and room; add/remove for reassignment",
                    422,
                )
            room = room_rows[intent.room_id]
            allocation_id = intent.id or uuid4()
            retained.add(allocation_id)
            old_line = (
                next(
                    (line for line in old.get("lines", []) if str(room["id"]) == line["room_id"]),
                    None,
                )
                if original
                else None
            )
            changed_stay = (
                original is None
                or original["scheduled_start"] != start
                or original["scheduled_end"] != end
                or original["duration_id"] != duration["id"]
            )
            same_basis = bool(
                old_line
                and old_line["quantity"]
                == (captured_duration["nights"] if duration["kind"] == "overnight" else 1)
            )
            if (
                original
                and inherited
                and not original["uses_reservation_stay"]
                and duration["kind"] == "hourly"
            ):
                same_basis = (
                    same_basis
                    and end - start == original["scheduled_end"] - original["scheduled_start"]
                )
            preserve_rate = bool(
                original and original["duration_id"] == duration["id"] and same_basis
            )
            if changed_stay:
                if (
                    not room["enabled"]
                    or room["archived"]
                    or not room["operational"]
                    or room["current_occupancy_allocation_id"]
                ):
                    raise DomainError(
                        "room_unavailable",
                        f"Room {room['number']} is inactive or physically occupied",
                    )
                kind = service.owned(session, room_types, room["room_type_id"], lock=True)
                if not kind["enabled"] or kind["archived"]:
                    raise DomainError("inactive_reference", "Room type is inactive", 422)
                rate = (
                    session.execute(
                        sa.select(rates)
                        .where(
                            rates.c.company_id == owner,
                            rates.c.room_type_id == kind["id"],
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
                if rate is None and not preserve_rate:
                    raise DomainError(
                        "missing_rate", f"Room {room['number']} has no active rate", 422
                    )
                line = (
                    old_line
                    if preserve_rate
                    else capture_price(room, kind, captured_duration, rate).model_dump(mode="json")[
                        "lines"
                    ][0]
                )
                conflict = session.scalar(
                    sa.select(allocations.c.id)
                    .where(
                        allocations.c.room_id == room["id"],
                        allocations.c.blocks_availability,
                        allocations.c.reservation_id != reservation_id,
                        allocations.c.scheduled_start < end,
                        allocations.c.scheduled_end > start,
                    )
                    .limit(1)
                )
                if conflict:
                    raise DomainError(
                        "room_conflict", f"Room {room['number']} conflicts with another reservation"
                    )
            else:
                if old_line is None:
                    raise DomainError("allocation_integrity", "Captured room price is missing")
                line = old_line
            # An arrival-only edit checks the new interval but retains its captured rate.
            if preserve_rate:
                line = old_line
            lines.append(dict(line, allocation_id=str(allocation_id)))
            inclusions = capture_inclusions(
                service,
                session,
                room["room_type_id"],
                original["inclusions"] if original else (),
                intents=intent.inclusions,
                switch=original is None,
                merge=True,
            )
            breakfast = capture_breakfast(
                service,
                session,
                start,
                end,
                duration["kind"],
                intent.adults + intent.children,
                original["breakfast"] if original else (),
                intents=intent.breakfast,
            )
            prepared.append(
                dict(
                    id=allocation_id,
                    scheduled_start=start,
                    scheduled_end=end,
                    duration_id=duration["id"],
                    uses_reservation_stay=inherited,
                    room_id=room["id"],
                    adults=intent.adults,
                    children=intent.children,
                    inclusions=inclusions,
                    breakfast=breakfast,
                )
            )
            for charge in intent.charges:
                old_charge = next(
                    (c for c in old.get("charges", []) if c["id"] == str(charge.id)), None
                )
                if old_charge and old_charge.get(
                    "allocation_id", str(original["id"]) if original else None
                ) != str(allocation_id):
                    raise DomainError(
                        "invalid_charge_owner",
                        "Captured charges cannot move between allocations",
                        422,
                    )
                charge_owners[str(charge.id)] = str(allocation_id)
                charge_intents.append(charge)
        raw = dict(
            old,
            lines=lines,
            schema_version=6,
            price_overrides=old.get("price_overrides", []),
            discounts=old.get("discounts", []),
        )
        captures = capture_charges(
            service, session, old, charge_intents, reservation_id=reservation_id
        )
        raw["charges"] = [
            dict(c.model_dump(mode="json"), allocation_id=charge_owners[str(c.id)])
            for c in captures
        ]
        snapshot = adjusted_snapshot(
            raw, request.adjustments, request.discounts, service=service, session=session
        )
        if parent:
            parent = (
                session.execute(
                    reservations.update()
                    .where(
                        reservations.c.id == id,
                        reservations.c.company_id == owner,
                        reservations.c.version == request.expected_version,
                    )
                    .values(
                        multi_room=True,
                        **parent_stay,
                        guest_id=request.guest_id,
                        booking_source_id=request.booking_source_id,
                        note=request.note,
                        version=reservations.c.version + 1,
                        updated_at=now,
                    )
                    .returning(reservations)
                )
                .mappings()
                .one()
            )
        else:
            parent = (
                session.execute(
                    reservations.insert()
                    .values(
                        id=reservation_id,
                        company_id=owner,
                        multi_room=True,
                        **parent_stay,
                        guest_id=request.guest_id,
                        booking_source_id=request.booking_source_id,
                        note=request.note,
                    )
                    .returning(reservations)
                )
                .mappings()
                .one()
            )
        removed = [r for r in old_rows if r["removed_at"] is None and r["id"] not in retained]
        for row in removed:
            session.execute(
                allocations.update()
                .where(allocations.c.id == row["id"])
                .values(state="removed", removed_at=now, blocks_availability=False)
            )
        for row in prepared:
            identity = row.pop("id")
            values = dict(
                row,
                state=state(old_by_id[identity], parent) if identity in old_by_id else "reserved",
                blocks_availability=old_by_id[identity]["blocks_availability"]
                if identity in old_by_id
                else True,
            )
            if identity in old_by_id:
                session.execute(
                    allocations.update()
                    .where(allocations.c.id == identity, allocations.c.company_id == owner)
                    .values(**values)
                )
            else:
                session.execute(
                    allocations.insert().values(
                        id=identity, company_id=owner, reservation_id=reservation_id, **values
                    )
                )
        revision = previous["pricing"]["revision"] + 1 if previous else 1
        if revision >= 2**31:
            raise DomainError("version_exhausted", "Pricing revision cannot advance")
        if not previous or snapshot.model_dump(mode="json") != old:
            session.execute(
                pricing_revisions.insert().values(
                    id=uuid4(),
                    company_id=owner,
                    reservation_id=reservation_id,
                    reservation_version=parent["version"],
                    revision=revision,
                    currency="PHP",
                    total_minor=snapshot.total_minor,
                    calculation_version=snapshot.calculation_version,
                    snapshot=snapshot.model_dump(mode="json"),
                )
            )
        after = audit_facts(read_multi(service, session, parent).model_dump(mode="json"))
        after["removed"] = [str(r["id"]) for r in removed]
        after["description"] = (
            "Updated reservation details, room allocations and captured billing"
            if previous
            else "Created reservation with room allocation stays"
        )
        record(
            service,
            session,
            parent,
            operation,
            audit_facts(previous),
            after,
        )
        for row in active_rows(service, session, reservation_id):
            room = room_rows.get(row["room_id"])
            if row["id"] not in old_by_id:
                record(
                    service,
                    session,
                    parent,
                    "reservation.room_added",
                    None,
                    dict(
                        allocation_id=str(row["id"]),
                        description=f"Room {room['number']} added with captured accommodation",
                    ),
                )
            elif row["id"] in {r["id"] for r in removed}:
                record(
                    service,
                    session,
                    parent,
                    "reservation.room_removed",
                    dict(allocation_id=str(row["id"])),
                    dict(
                        description=f"Room {room['number']} removed; historical allocation retained"
                    ),
                )
            elif any(
                row[field] != old_by_id[row["id"]][field]
                for field in (
                    "scheduled_start",
                    "scheduled_end",
                    "duration_id",
                    "uses_reservation_stay",
                )
            ):

                def stay_facts(value):
                    return dict(
                        allocation_id=str(value["id"]),
                        scheduled_start=value["scheduled_start"].isoformat(),
                        scheduled_end=value["scheduled_end"].isoformat(),
                        duration_id=str(value["duration_id"]),
                        uses_reservation_stay=value["uses_reservation_stay"],
                    )

                record(
                    service,
                    session,
                    parent,
                    "reservation.room_stay_changed",
                    stay_facts(old_by_id[row["id"]]),
                    dict(
                        **stay_facts(row),
                        description=(
                            f"Room {room['number']} arrival/departure or duration changed; "
                            "captured pricing reviewed"
                        ),
                    ),
                )
        result = read_multi(service, session, parent)
        save_receipt(
            session, service.context, operation, key, digest, result, reservation_id=reservation_id
        )
        return result
