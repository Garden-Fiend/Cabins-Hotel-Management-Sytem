"""Concrete command boundary. The service, never the router, owns commit/rollback."""

from contextlib import contextmanager
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.context import CommandContext
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
from app.modules.reservations.breakfast import capture_breakfast
from app.modules.reservations.inclusions import capture_inclusions
from app.modules.reservations.pricing import capture_price, stay_end
from app.modules.reservations.schemas import (
    AllocationRead,
    AuditRead,
    GuestCreate,
    GuestRead,
    PricingRead,
    ReservationCreate,
    ReservationDetailsEdit,
    ReservationEdit,
    ReservationRead,
)
from app.mutations import replay_or_lock, request_hash, save_receipt


class ReservationService:
    def __init__(self, engine, context: CommandContext):
        self.engine, self.context = engine, context

    @contextmanager
    def transaction(self):
        with Session(self.engine) as session, session.begin():
            # Bound lock waits, including advisory/row/exclusion locks. Failed commands roll back.
            session.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
            session.execute(sa.text("SET LOCAL statement_timeout = '10s'"))
            yield session

    def owned(self, session, table, id, *, lock=False, exclusive=False):
        statement = sa.select(table).where(table.c.id == id)
        if table is companies:
            statement = statement.where(table.c.id == self.context.company_id)
        else:
            statement = statement.where(table.c.company_id == self.context.company_id)
        if lock:
            statement = statement.with_for_update(read=not exclusive and table is not rooms)
        row = session.execute(statement).mappings().one_or_none()
        if row is None:
            raise DomainError("not_found", "Requested resource was not found", 404)
        return row

    def create_guest(self, request: GuestCreate, key: UUID) -> GuestRead:
        digest = request_hash(request)
        with self.transaction() as session:
            replay = replay_or_lock(session, self.context, "guest.create", key, digest)
            if replay is not None:
                return GuestRead.model_validate(replay)
            self.owned(session, companies, self.context.company_id, lock=True)
            row = (
                session.execute(
                    guests.insert()
                    .values(
                        id=uuid4(),
                        company_id=self.context.company_id,
                        **request.model_dump(),
                    )
                    .returning(guests)
                )
                .mappings()
                .one()
            )
            result = GuestRead.model_validate(row)
            session.execute(
                audit_events.insert().values(
                    id=uuid4(),
                    company_id=self.context.company_id,
                    event_type="guest.created",
                    actor=self.context.actor,
                    attribution=self.context.attribution,
                    after=result.model_dump(mode="json"),
                )
            )
            save_receipt(session, self.context, "guest.create", key, digest, result)
            return result

    def list_guests(self, *, limit=100, offset=0, search="") -> list[GuestRead]:
        with self.transaction() as session:
            statement = sa.select(guests).where(guests.c.company_id == self.context.company_id)
            if search:
                # Literal substring search: user %/_ must not become wildcard filters.
                statement = statement.where(guests.c.name.contains(search, autoescape=True))
            rows = session.execute(
                statement.order_by(guests.c.name, guests.c.id).limit(limit).offset(offset)
            ).mappings()
            return [GuestRead.model_validate(row) for row in rows]

    def create(self, request: ReservationCreate, key: UUID) -> ReservationRead:
        digest = request_hash(request)
        with self.transaction() as session:
            replay = replay_or_lock(session, self.context, "reservation.create", key, digest)
            if replay is not None:
                return ReservationRead.model_validate(replay)
            room = self.owned(session, rooms, request.room_id, lock=True)
            if not room["enabled"] or room["archived"] or not room["operational"]:
                raise DomainError(
                    "room_unavailable", "Room is disabled, archived or non-operational"
                )
            # Physical occupancy is separate from scheduled end, including overdue stays.
            if room["current_occupancy_allocation_id"] is not None:
                raise DomainError("room_occupied", "Room has a current physical occupancy lock")
            company = self.owned(session, companies, self.context.company_id, lock=True)
            guest = self.owned(session, guests, request.guest_id, lock=True)
            source = self.owned(session, booking_sources, request.booking_source_id, lock=True)
            duration = self.owned(session, durations, request.duration_id, lock=True)
            room_type = self.owned(session, room_types, room["room_type_id"], lock=True)
            if (
                not source["enabled"]
                or not duration["enabled"]
                or not room_type["enabled"]
                or room_type["archived"]
            ):
                raise DomainError(
                    "inactive_reference", "Booking references must be enabled/direct", 422
                )
            # Housekeeping does not equal occupancy. Dirty may be booked; future check-in
            # must separately enforce clean readiness. Capacity is descriptive, not a new cap.
            statement = (
                sa.select(rates)
                .where(
                    rates.c.company_id == self.context.company_id,
                    rates.c.room_type_id == room_type["id"],
                    rates.c.enabled,
                    rates.c.booking_kind == duration["kind"],
                    rates.c.duration_id == duration["id"]
                    if duration["kind"] == "hourly"
                    else rates.c.duration_id.is_(None),
                )
                .with_for_update(read=True)
            )
            rate = session.execute(statement).mappings().one_or_none()
            if rate is None:
                raise DomainError(
                    "missing_rate", "No enabled accommodation rate is configured", 422
                )
            end = stay_end(request.scheduled_start, duration, company)
            if (
                session.scalar(
                    sa.select(allocations.c.id)
                    .where(
                        allocations.c.room_id == room["id"],
                        allocations.c.blocks_availability,
                        allocations.c.scheduled_start < end,
                        allocations.c.scheduled_end > request.scheduled_start,
                    )
                    .limit(1)
                )
                is not None
            ):
                raise DomainError("room_conflict", "Room is already reserved for this interval")
            snapshot = capture_price(room, room_type, duration, rate)
            reservation_id = uuid4()
            if request.charges or request.discounts or request.adjustments:
                from app.modules.billing.adjustments import adjusted_snapshot
                from app.modules.billing.charges import capture_charges

                raw = snapshot.model_dump(mode="json")
                if request.charges:
                    raw["charges"] = [
                        item.model_dump(mode="json")
                        for item in capture_charges(
                            self, session, raw, request.charges, reservation_id=reservation_id
                        )
                    ]
                snapshot = adjusted_snapshot(
                    raw,
                    request.adjustments,
                    request.discounts if request.discounts else None,
                    service=self,
                    session=session,
                )
            from app.modules.reservations.financial_capture import (
                apply_capture,
                check_reference,
                persist_capture,
                prepare_capture,
            )

            commercial = prepare_capture(
                self, session, source, request.booking_financials, snapshot
            )
            reference = (
                request.booking_financials.external_reference if request.booking_financials else ""
            )
            check_reference(self, session, source["id"], reference)
            if commercial:
                snapshot = apply_capture(snapshot, commercial)
            reservation = (
                session.execute(
                    reservations.insert()
                    .values(
                        id=reservation_id,
                        company_id=self.context.company_id,
                        guest_id=guest["id"],
                        booking_source_id=source["id"],
                        booking_source_label=source["label"],
                        external_booking_reference=reference or None,
                        note=request.note,
                    )
                    .returning(reservations)
                )
                .mappings()
                .one()
            )
            persist_capture(self, session, reservation_id, commercial)
            session.execute(
                allocations.insert().values(
                    id=uuid4(),
                    company_id=self.context.company_id,
                    reservation_id=reservation_id,
                    room_id=room["id"],
                    duration_id=duration["id"],
                    scheduled_start=request.scheduled_start,
                    scheduled_end=end,
                    adults=request.adults,
                    children=request.children,
                    breakfast=capture_breakfast(
                        self,
                        session,
                        request.scheduled_start,
                        end,
                        duration["kind"],
                        request.adults + request.children,
                        intents=request.breakfast,
                    ),
                    inclusions=capture_inclusions(
                        self,
                        session,
                        room_type["id"],
                        intents=request.inclusions
                        if "inclusions" in request.model_fields_set
                        else None,
                        switch=True,
                        merge=True,
                    ),
                )
            )
            session.execute(
                pricing_revisions.insert().values(
                    id=uuid4(),
                    company_id=self.context.company_id,
                    reservation_id=reservation_id,
                    revision=1,
                    reservation_version=1,
                    currency=snapshot.currency,
                    total_minor=snapshot.total_minor,
                    calculation_version=snapshot.calculation_version,
                    snapshot=snapshot.model_dump(mode="json"),
                )
            )
            session.execute(
                audit_events.insert().values(
                    id=uuid4(),
                    company_id=self.context.company_id,
                    reservation_id=reservation_id,
                    event_type="reservation.created",
                    reservation_version=1,
                    actor=self.context.actor,
                    attribution=self.context.attribution,
                    after=dict(
                        version=1,
                        guest_id=str(guest["id"]),
                        room_id=str(room["id"]),
                        booking_source_id=str(source["id"]),
                        scheduled_start=request.scheduled_start.isoformat(),
                        scheduled_end=end.isoformat(),
                        adults=request.adults,
                        children=request.children,
                        note=request.note,
                        pricing=snapshot.model_dump(mode="json"),
                        inclusions=self.read_in_transaction(
                            session, reservation
                        ).allocation.model_dump(mode="json")["inclusions"],
                    ),
                )
            )
            from app.modules.billing.collections import initial_financial_records

            initial_financial_records(self, session, reservation, request, key)
            result = self.read_in_transaction(session, reservation)
            save_receipt(
                session,
                self.context,
                "reservation.create",
                key,
                digest,
                result,
                reservation_id=reservation_id,
            )
            return result  # Session.begin commits before this result reaches the router.

    def patch(
        self, id: UUID, request: ReservationEdit, key: UUID, *, details=False
    ) -> ReservationRead:
        if details != isinstance(request, ReservationDetailsEdit):
            raise DomainError("unsupported_command", "Use the explicit details contract", 422)
        operation = "reservation.details_edit" if details else "reservation.patch"
        digest = request_hash(request, resource_id=id)
        with self.transaction() as session:
            replay = replay_or_lock(session, self.context, operation, key, digest)
            if replay is not None:
                return ReservationRead.model_validate(replay)
            reservation = self.owned(session, reservations, id, lock=True, exclusive=True)
            if reservation["multi_room"]:
                raise DomainError(
                    "plural_command_required", "Use the multi-room edit contract", 409
                )
            if reservation["version"] != request.expected_version:
                raise DomainError("version_conflict", "Reservation changed; reload before editing")
            if reservation["version"] >= 2**31 - 1:
                raise DomainError("version_exhausted", "Reservation version cannot be advanced")
            if details:
                self.owned(session, guests, request.guest_id, lock=True)
            allocation = (
                session.execute(
                    sa.select(allocations)
                    .where(
                        allocations.c.reservation_id == id,
                        allocations.c.company_id == self.context.company_id,
                    )
                    .with_for_update()
                )
                .mappings()
                .one_or_none()
            )
            if allocation is None:
                raise DomainError("incomplete_reservation", "Reservation requires integrity review")
            before = dict(
                version=reservation["version"],
                note=reservation["note"],
                adults=allocation["adults"],
                children=allocation["children"],
            )
            changes = request.model_dump(exclude_unset=True, exclude={"expected_version"})
            if details:
                before["guest_id"] = str(reservation["guest_id"])
            # Only these count columns can change; IDs, interval, occupancy and prices stay intact.
            counts = {field: changes[field] for field in ("adults", "children") if field in changes}
            if counts:
                if allocation["breakfast"]:
                    old_pricing = self.read_in_transaction(session, reservation).pricing.snapshot
                    before["breakfast"] = allocation["breakfast"]
                    counts["breakfast"] = capture_breakfast(
                        self,
                        session,
                        allocation["scheduled_start"],
                        allocation["scheduled_end"],
                        old_pricing.lines[0].booking_kind,
                        counts.get("adults", allocation["adults"])
                        + counts.get("children", allocation["children"]),
                        allocation["breakfast"],
                    )
                session.execute(
                    allocations.update()
                    .where(
                        allocations.c.id == allocation["id"],
                        allocations.c.company_id == self.context.company_id,
                    )
                    .values(**counts)
                )
            updated = (
                session.execute(
                    reservations.update()
                    .where(
                        reservations.c.id == id,
                        reservations.c.company_id == self.context.company_id,
                        reservations.c.version == request.expected_version,
                    )
                    .values(
                        note=changes.get("note", reservation["note"]),
                        guest_id=changes.get("guest_id", reservation["guest_id"]),
                        version=reservations.c.version + 1,
                        # now() is transaction-start time, possibly before a competing lock holder.
                        updated_at=sa.func.clock_timestamp(),
                    )
                    .returning(reservations)
                )
                .mappings()
                .one_or_none()
            )
            if updated is None:
                raise DomainError("version_conflict", "Reservation changed; reload before editing")
            after = dict(before, **changes, version=updated["version"])
            if "breakfast" in counts:
                after["breakfast"] = counts["breakfast"]
            if details:
                after["guest_id"] = str(updated["guest_id"])
            session.execute(
                audit_events.insert().values(
                    id=uuid4(),
                    company_id=self.context.company_id,
                    reservation_id=id,
                    event_type="reservation.updated",
                    reservation_version=updated["version"],
                    actor=self.context.actor,
                    attribution=self.context.attribution,
                    occurred_at=sa.func.clock_timestamp(),
                    before=before,
                    after=after,
                )
            )
            result = self.read_in_transaction(session, updated)
            save_receipt(session, self.context, operation, key, digest, result, reservation_id=id)
            return result  # Commit must succeed before a canonical response leaves this service.

    def read_in_transaction(self, session, reservation):
        if reservation["multi_room"]:
            from app.modules.reservations.multi import read_multi

            return read_multi(self, session, reservation)
        id = reservation["id"]
        allocation = (
            session.execute(
                sa.select(allocations).where(
                    allocations.c.reservation_id == id,
                    allocations.c.company_id == self.context.company_id,
                )
            )
            .mappings()
            .one_or_none()
        )
        pricing = (
            session.execute(
                sa.select(pricing_revisions)
                .where(
                    pricing_revisions.c.reservation_id == id,
                    pricing_revisions.c.company_id == self.context.company_id,
                )
                .order_by(pricing_revisions.c.revision.desc())
                .limit(1)
            )
            .mappings()
            .one_or_none()
        )
        if allocation is None or pricing is None:
            raise DomainError(
                "incomplete_reservation", "Reservation requires integrity review", 409
            )
        events = session.execute(
            sa.select(audit_events)
            .where(
                audit_events.c.reservation_id == id,
                audit_events.c.company_id == self.context.company_id,
            )
            .order_by(audit_events.c.occurred_at, audit_events.c.id)
        ).mappings()
        return ReservationRead(
            booking_source_label=reservation["booking_source_label"]
            or (lambda source: source["initial_label"] or source["label"])(
                self.owned(session, booking_sources, reservation["booking_source_id"])
            ),
            **{
                name: reservation[name]
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
                )
            },
            reference=f"HMS-{reservation['business_number']:06d}",
            guest=GuestRead.model_validate(self.owned(session, guests, reservation["guest_id"])),
            allocation=AllocationRead(
                **{name: allocation[name] for name in AllocationRead.model_fields}
            ),
            pricing=PricingRead(
                id=pricing["id"],
                revision=pricing["revision"],
                reservation_version=pricing["reservation_version"],
                captured_at=pricing["created_at"],
                snapshot=pricing["snapshot"],
            ),
            audit=[
                AuditRead(
                    **{name: row[name] for name in AuditRead.model_fields if name != "description"},
                    description=(row["after"] or {}).get("description"),
                )
                for row in events
            ],
        )

    def get(self, id: UUID) -> ReservationRead:
        with self.transaction() as session:
            reservation = self.owned(session, reservations, id, lock=True)
            return self.read_in_transaction(session, reservation)

    def list(
        self, *, limit=100, offset=0, external_reference="", source_id=None
    ) -> list[ReservationRead]:
        with self.transaction() as session:
            from app.models import booking_financial_captures

            criteria = []
            if external_reference:
                reference = external_reference.strip()
                current = reservations.c.external_booking_reference == reference
                historical = sa.select(booking_financial_captures.c.id).where(
                    booking_financial_captures.c.reservation_id == reservations.c.id,
                    booking_financial_captures.c.company_id == self.context.company_id,
                    booking_financial_captures.c.snapshot["input"]["external_reference"].astext
                    == reference,
                )
                if source_id is not None:
                    current = sa.and_(current, reservations.c.booking_source_id == source_id)
                    historical = historical.where(
                        booking_financial_captures.c.source_id == source_id
                    )
                criteria.append(sa.or_(current, historical.exists()))
            elif source_id is not None:
                criteria.append(reservations.c.booking_source_id == source_id)
            rows = (
                session.execute(
                    sa.select(reservations)
                    .where(
                        reservations.c.company_id == self.context.company_id,
                        *criteria,
                    )
                    .order_by(reservations.c.business_number)
                    .limit(limit)
                    .offset(offset)
                    .with_for_update(read=True)
                )
                .mappings()
                .all()
            )
            return [self.read_in_transaction(session, row) for row in rows]
