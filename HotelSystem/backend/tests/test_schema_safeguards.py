from datetime import UTC, datetime, time, timedelta
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.models import (
    allocations,
    audit_events,
    booking_sources,
    companies,
    durations,
    guests,
    mutation_receipts,
    pricing_revisions,
    rates,
    reservations,
    room_types,
    rooms,
)
from app.seed import seed_id

pytestmark = pytest.mark.postgres


@pytest.mark.parametrize("case", range(10))
def test_cross_company_references_rejected(pg_connection, case):
    c = pg_connection
    owner, other = seed_id("company"), uuid4()
    c.execute(
        companies.insert().values(
            id=other, name="Other test company", currency="PHP", hotel_timezone="Asia/Manila"
        )
    )
    gid, sid, rid, did, bid = (uuid4() for _ in range(5))
    c.execute(guests.insert().values(id=gid, company_id=other, name="Other guest"))
    c.execute(
        room_types.insert().values(id=sid, company_id=other, source_id="other", label="Other")
    )
    c.execute(
        durations.insert().values(
            id=did, company_id=other, source_id="other", kind="hourly", minutes=360
        )
    )
    c.execute(
        booking_sources.insert().values(
            id=bid, company_id=other, source_id="direct", label="Direct"
        )
    )
    c.execute(
        reservations.insert().values(id=rid, company_id=other, guest_id=gid, booking_source_id=bid)
    )
    local_guest, local_res = uuid4(), uuid4()
    c.execute(guests.insert().values(id=local_guest, company_id=owner, name="Local"))
    c.execute(
        reservations.insert().values(
            id=local_res,
            company_id=owner,
            guest_id=local_guest,
            booking_source_id=seed_id("direct"),
        )
    )
    start = datetime(2027, 1, 1, tzinfo=UTC)
    rate = dict(
        source_id="other-rate",
        booking_kind="hourly",
        currency="PHP",
        unit_amount_minor=100,
        room_type_id=seed_id("standard"),
        duration_id=did,
    )
    alloc = dict(
        reservation_id=local_res,
        room_id=seed_id("room-101"),
        duration_id=did,
        scheduled_start=start,
        scheduled_end=start + timedelta(hours=6),
    )
    cases = [
        (rooms, dict(room_type_id=sid, number="999")),
        (rates, dict(rate, room_type_id=sid, duration_id=seed_id("6-hours"))),
        (rates, rate),
        (reservations, dict(guest_id=gid, booking_source_id=seed_id("direct"))),
        (reservations, dict(guest_id=local_guest, booking_source_id=bid)),
        (allocations, dict(alloc, reservation_id=rid, duration_id=seed_id("6-hours"))),
        (allocations, alloc),
        (
            pricing_revisions,
            dict(
                reservation_id=rid,
                revision=1,
                currency="PHP",
                total_minor=100,
                calculation_version="test",
                snapshot={},
            ),
        ),
        (
            audit_events,
            dict(
                reservation_id=rid, event_type="test", actor="Test", attribution="local_development"
            ),
        ),
        (
            mutation_receipts,
            dict(
                reservation_id=rid,
                operation="test",
                request_key=uuid4(),
                request_hash="a" * 64,
                response={},
            ),
        ),
    ]
    table, values = cases[case]
    with pytest.raises(IntegrityError) as exc:
        with c.begin_nested():
            c.execute(table.insert().values(id=uuid4(), company_id=owner, **values))
    assert exc.value.orig.sqlstate == "23503"
    assert exc.value.orig.diag.constraint_name.endswith("_company")


@pytest.mark.parametrize("kind", ["hourly", "overnight"])
def test_only_one_enabled_rate_per_basis(pg_connection, kind):
    values = dict(
        company_id=seed_id("company"),
        room_type_id=seed_id("standard"),
        source_id=f"duplicate-{kind}",
        booking_kind=kind,
        duration_id=seed_id("6-hours") if kind == "hourly" else None,
        unit_amount_minor=12300,
        currency="PHP",
    )
    with pytest.raises(IntegrityError) as exc:
        with pg_connection.begin_nested():
            pg_connection.execute(rates.insert().values(id=uuid4(), **values))
    assert exc.value.orig.sqlstate == "23505"
    assert exc.value.orig.diag.constraint_name == (
        "uq_active_hourly_rate" if kind == "hourly" else "uq_active_nightly_rate"
    )
    pg_connection.execute(rates.insert().values(id=uuid4(), enabled=False, **values))


def test_hotel_times_are_local_defaults_and_customizable(pg_connection):
    row = (
        pg_connection.execute(sa.select(companies).where(companies.c.id == seed_id("company")))
        .mappings()
        .one()
    )
    assert row["default_check_in_time"] == time(14)
    assert row["default_check_out_time"] == time(12)
    pg_connection.execute(
        companies.update()
        .where(companies.c.id == seed_id("company"))
        .values(default_check_in_time=time(15, 30), default_check_out_time=time(11))
    )
    assert pg_connection.scalar(
        sa.select(companies.c.default_check_in_time).where(companies.c.id == seed_id("company"))
    ) == time(15, 30)
    with pytest.raises(IntegrityError):
        with pg_connection.begin_nested():
            pg_connection.execute(
                companies.update()
                .where(companies.c.id == seed_id("company"))
                .values(default_check_out_time=None)
            )
