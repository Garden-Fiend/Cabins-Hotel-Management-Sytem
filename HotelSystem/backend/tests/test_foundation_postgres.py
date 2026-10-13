from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4, uuid5

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models import allocations, companies, durations, guests, rates, reservations, room_types
from app.seed import seed_id

pytestmark = pytest.mark.postgres


def test_rate_cannot_use_overnight_duration_for_hourly_price(pg_connection):
    with pytest.raises(IntegrityError) as exc:
        with pg_connection.begin_nested():
            pg_connection.execute(
                rates.insert().values(
                    id=uuid4(),
                    company_id=seed_id("company"),
                    room_type_id=seed_id("standard"),
                    source_id="bad-kind",
                    booking_kind="hourly",
                    duration_id=seed_id("1-night"),
                    currency="PHP",
                    unit_amount_minor=1,
                )
            )
    assert exc.value.orig.diag.constraint_name == "fk_rate_duration_company_kind"


def test_real_concurrent_overlap_has_exactly_one_winner(pg_engine, isolated_company):
    context, ids = isolated_company
    guest, bookings = uuid4(), [uuid4(), uuid4()]
    with pg_engine.begin() as c:
        c.execute(guests.insert().values(id=guest, company_id=context.company_id, name="Race"))
        c.execute(
            reservations.insert(),
            [
                dict(
                    id=id,
                    company_id=context.company_id,
                    guest_id=guest,
                    booking_source_id=ids["source"],
                )
                for id in bookings
            ],
        )
    start = datetime(2027, 1, 1, tzinfo=UTC)
    barrier = Barrier(2)

    def writer(id):
        try:
            with pg_engine.begin() as c:
                c.execute(sa.text("SET LOCAL statement_timeout = '8s'"))
                barrier.wait(timeout=5)
                c.execute(
                    allocations.insert().values(
                        id=uuid4(),
                        company_id=context.company_id,
                        reservation_id=id,
                        room_id=ids["room"],
                        duration_id=ids["hourly"],
                        scheduled_start=start,
                        scheduled_end=start + timedelta(hours=6),
                        adults=2,
                        children=0,
                    )
                )
            return "committed"
        except DBAPIError as exc:
            # Two simultaneous bare GiST inserts can deadlock; PostgreSQL aborts one.
            # Either path must prevent duplicate allocation. The API serializes with
            # FOR UPDATE on the room to give a deterministic application conflict.
            assert exc.orig.sqlstate in {"23P01", "40P01"}
            if exc.orig.sqlstate == "23P01":
                assert exc.orig.diag.constraint_name == "excl_active_room_overlap"
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(writer, bookings))
    assert sorted(outcomes) == ["committed", "conflict"]
    with pg_engine.connect() as c:
        assert (
            c.scalar(
                sa.select(sa.func.count())
                .select_from(allocations)
                .where(allocations.c.company_id == context.company_id)
            )
            == 1
        )


def test_disabled_duration_is_stored_as_a_reference_fact(pg_connection):
    pg_connection.execute(
        durations.update().where(durations.c.id == seed_id("6-hours")).values(enabled=False)
    )
    assert (
        pg_connection.scalar(
            sa.select(durations.c.enabled).where(durations.c.id == seed_id("6-hours"))
        )
        is False
    )


def test_seed_identity_conflict_fails_without_partial_reference_changes(
    pg_engine, isolated_company, monkeypatch
):
    from app import seed

    context, _ids = isolated_company
    monkeypatch.setattr(
        seed,
        "seed_id",
        lambda name: context.company_id if name == "company" else uuid5(context.company_id, name),
    )
    url = pg_engine.url.render_as_string(hide_password=False)
    with pytest.raises(IntegrityError):
        seed.seed_reference_data(url, test=True)
    with pg_engine.connect() as c:
        assert (
            c.scalar(
                sa.select(sa.func.count())
                .select_from(room_types)
                .where(room_types.c.company_id == context.company_id)
            )
            == 1
        )
        assert (
            c.scalar(
                sa.select(sa.func.count())
                .select_from(durations)
                .where(durations.c.company_id == context.company_id)
            )
            == 3
        )


def test_database_rejects_invalid_counts_and_unsupported_hotel_policy(pg_connection):
    with pytest.raises(IntegrityError):
        with pg_connection.begin_nested():
            pg_connection.execute(
                companies.update()
                .where(companies.c.id == seed_id("company"))
                .values(hotel_timezone="UTC")
            )
    with pytest.raises(IntegrityError):
        with pg_connection.begin_nested():
            pg_connection.execute(
                sa.text(
                    "UPDATE hms.companies SET default_check_out_time = TIME '24:00' WHERE id = :id"
                ),
                {"id": seed_id("company")},
            )
    guest, booking = uuid4(), uuid4()
    pg_connection.execute(
        guests.insert().values(id=guest, company_id=seed_id("company"), name="Test")
    )
    pg_connection.execute(
        reservations.insert().values(
            id=booking,
            company_id=seed_id("company"),
            guest_id=guest,
            booking_source_id=seed_id("direct"),
        )
    )
    with pytest.raises(IntegrityError) as exc:
        with pg_connection.begin_nested():
            pg_connection.execute(
                allocations.insert().values(
                    id=uuid4(),
                    company_id=seed_id("company"),
                    reservation_id=booking,
                    room_id=seed_id("room-101"),
                    duration_id=seed_id("6-hours"),
                    adults=0,
                    scheduled_start=datetime(2027, 2, 1, tzinfo=UTC),
                    scheduled_end=datetime(2027, 2, 2, tzinfo=UTC),
                )
            )
    assert exc.value.orig.diag.constraint_name == "ck_room_allocations_occupancy_counts"
