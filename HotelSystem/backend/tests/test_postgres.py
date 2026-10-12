from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.models import (
    allocations,
    audit_events,
    durations,
    guests,
    mutation_receipts,
    pricing_revisions,
    reservations,
    rooms,
)
from app.seed import seed_id, seed_reference_data

pytestmark = pytest.mark.postgres


def new_reservation(connection):
    guest_id, reservation_id = uuid4(), uuid4()
    company_id = seed_id("company")
    connection.execute(guests.insert().values(id=guest_id, company_id=company_id, name="Test only"))
    connection.execute(
        reservations.insert().values(
            id=reservation_id,
            company_id=company_id,
            guest_id=guest_id,
            booking_source_id=seed_id("direct"),
        )
    )
    return reservation_id


def allocation_values(reservation_id, start, end):
    return dict(
        id=uuid4(),
        company_id=seed_id("company"),
        reservation_id=reservation_id,
        room_id=seed_id("room-101"),
        duration_id=seed_id("6-hours"),
        scheduled_start=start,
        scheduled_end=end,
    )


def test_real_database_health(pg_engine):
    # pg_engine gates explicit integration access; health checks the independently migrated dev DB.
    with TestClient(app) as client:
        response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["database"] == "ok"


def test_overlapping_allocations_rejected_but_touching_allowed(pg_connection):
    start = datetime(2026, 11, 10, 6, 7, tzinfo=UTC)
    end = start + timedelta(hours=6)
    first = new_reservation(pg_connection)
    second = new_reservation(pg_connection)
    pg_connection.execute(allocations.insert().values(**allocation_values(first, start, end)))
    with pytest.raises(IntegrityError):
        with pg_connection.begin_nested():
            pg_connection.execute(
                allocations.insert().values(
                    **allocation_values(second, start + timedelta(minutes=1), end)
                )
            )
    pg_connection.execute(
        allocations.insert().values(**allocation_values(second, end, end + timedelta(hours=6)))
    )


def test_complete_aggregate_rollback(pg_engine):
    reservation_id = None
    with pytest.raises(RuntimeError):
        with pg_engine.begin() as connection:
            reservation_id = new_reservation(connection)
            start = datetime(2026, 12, 1, tzinfo=UTC)
            connection.execute(
                allocations.insert().values(
                    **allocation_values(reservation_id, start, start + timedelta(hours=6))
                )
            )
            connection.execute(
                pricing_revisions.insert().values(
                    id=uuid4(),
                    company_id=seed_id("company"),
                    reservation_id=reservation_id,
                    revision=1,
                    currency="PHP",
                    total_minor=110000,
                    calculation_version="foundation-test",
                    snapshot={"tax": "No tax configured"},
                )
            )
            connection.execute(
                audit_events.insert().values(
                    id=uuid4(),
                    company_id=seed_id("company"),
                    reservation_id=reservation_id,
                    event_type="created",
                    actor="Test",
                    attribution="local_development",
                )
            )
            connection.execute(
                mutation_receipts.insert().values(
                    id=uuid4(),
                    company_id=seed_id("company"),
                    reservation_id=reservation_id,
                    operation="create",
                    request_key=uuid4(),
                    request_hash="a" * 64,
                    response={},
                )
            )
            raise RuntimeError("Deliberate failure after all aggregate inserts")
    with pg_engine.connect() as connection:
        for table in [
            reservations,
            allocations,
            pricing_revisions,
            audit_events,
            mutation_receipts,
        ]:
            column = table.c.id if table is reservations else table.c.reservation_id
            assert (
                connection.scalar(
                    sa.select(sa.func.count()).select_from(table).where(column == reservation_id)
                )
                == 0
            )


def test_seed_repeat_never_rewrites_existing_values(pg_engine):
    url = pg_engine.url.render_as_string(hide_password=False)
    with pg_engine.begin() as connection:
        old_name = connection.scalar(
            sa.select(rooms.c.display_name).where(rooms.c.id == seed_id("room-101"))
        )
        connection.execute(
            rooms.update()
            .where(rooms.c.id == seed_id("room-101"))
            .values(display_name="Test-only retained override")
        )
    try:
        seed_reference_data(url, test=True)
        seed_reference_data(url, test=True)
        with pg_engine.connect() as connection:
            assert connection.scalar(sa.select(sa.func.count()).select_from(rooms)) == 1
            assert connection.scalar(sa.select(sa.func.count()).select_from(durations)) == 2
            assert (
                connection.scalar(
                    sa.select(rooms.c.display_name).where(rooms.c.id == seed_id("room-101"))
                )
                == "Test-only retained override"
            )
    finally:
        with pg_engine.begin() as connection:
            connection.execute(
                rooms.update()
                .where(rooms.c.id == seed_id("room-101"))
                .values(display_name=old_name)
            )


def test_invalid_duration_and_duplicate_request_key_rejected(pg_connection):
    with pytest.raises(IntegrityError):
        with pg_connection.begin_nested():
            pg_connection.execute(
                durations.insert().values(
                    id=uuid4(),
                    company_id=seed_id("company"),
                    source_id="invalid",
                    kind="hourly",
                    minutes=None,
                    nights=None,
                )
            )
    values = dict(
        company_id=seed_id("company"),
        operation="create",
        request_key=uuid4(),
        request_hash="b" * 64,
        response={},
    )
    pg_connection.execute(mutation_receipts.insert().values(id=uuid4(), **values))
    with pytest.raises(IntegrityError):
        with pg_connection.begin_nested():
            pg_connection.execute(mutation_receipts.insert().values(id=uuid4(), **values))
