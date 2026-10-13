from pathlib import Path
from uuid import uuid4, uuid5

import pytest
from dotenv import dotenv_values

from app.context import CommandContext
from app.db import make_engine
from app.models import (
    allocations,
    audit_events,
    booking_sources,
    categories,
    companies,
    durations,
    guests,
    mutation_receipts,
    pricing_revisions,
    products,
    rates,
    reservations,
    room_types,
    rooms,
)
from app.seed import seed_reference_data
from app.settings import require_isolated_local_database


def pytest_addoption(parser):
    parser.addoption("--postgres", action="store_true", help="Opt into isolated hms_test DB checks")


@pytest.fixture(scope="session")
def pg_engine(request):
    if not request.config.getoption("--postgres"):
        pytest.skip("Run explicitly with --postgres against the isolated hms_test database")
    values = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
    url = values.get("HMS_TEST_DATABASE_URL")
    if not url:
        pytest.fail("Configure HMS_TEST_DATABASE_URL before opting into PostgreSQL tests")
    require_isolated_local_database(url, test=True)
    seed_reference_data(url, test=True)
    engine = make_engine(url)
    yield engine
    engine.dispose()


@pytest.fixture
def pg_connection(pg_engine):
    with pg_engine.connect() as connection:
        transaction = connection.begin()
        yield connection
        transaction.rollback()


@pytest.fixture
def isolated_company(pg_engine):
    """Committed concurrency/API fixtures; cleanup only this newly generated company UUID."""
    owner = uuid4()
    ids = {
        name: uuid5(owner, name)
        for name in (
            "type",
            "room",
            "hourly",
            "overnight",
            "two-nights",
            "hourly-rate",
            "nightly-rate",
            "source",
        )
    }
    with pg_engine.begin() as c:
        c.execute(
            companies.insert().values(
                id=owner, name="Isolated test scope", currency="PHP", hotel_timezone="Asia/Manila"
            )
        )
        c.execute(
            room_types.insert().values(
                id=ids["type"], company_id=owner, source_id="standard", label="Standard"
            )
        )
        c.execute(
            rooms.insert().values(
                id=ids["room"], company_id=owner, room_type_id=ids["type"], number="101"
            )
        )
        c.execute(
            durations.insert(),
            [
                dict(
                    id=ids["hourly"],
                    company_id=owner,
                    source_id="6-hours",
                    kind="hourly",
                    minutes=360,
                    nights=None,
                ),
                dict(
                    id=ids["overnight"],
                    company_id=owner,
                    source_id="1-night",
                    kind="overnight",
                    minutes=None,
                    nights=1,
                ),
                dict(
                    id=ids["two-nights"],
                    company_id=owner,
                    source_id="2-nights",
                    kind="overnight",
                    minutes=None,
                    nights=2,
                ),
            ],
        )
        c.execute(
            rates.insert(),
            [
                dict(
                    id=ids["hourly-rate"],
                    company_id=owner,
                    room_type_id=ids["type"],
                    source_id="standard-6-hours",
                    booking_kind="hourly",
                    duration_id=ids["hourly"],
                    currency="PHP",
                    unit_amount_minor=110000,
                ),
                dict(
                    id=ids["nightly-rate"],
                    company_id=owner,
                    room_type_id=ids["type"],
                    source_id="standard-nightly",
                    booking_kind="overnight",
                    duration_id=None,
                    currency="PHP",
                    unit_amount_minor=220000,
                ),
            ],
        )
        c.execute(
            booking_sources.insert().values(
                id=ids["source"], company_id=owner, source_id="direct", label="Direct"
            )
        )
    try:
        yield CommandContext(owner), ids
    finally:
        with pg_engine.begin() as c:
            c.execute(
                rooms.update()
                .where(rooms.c.company_id == owner)
                .values(current_occupancy_allocation_id=None)
            )
            for table in (
                products,
                categories,
                mutation_receipts,
                audit_events,
                pricing_revisions,
                allocations,
                reservations,
                guests,
                rates,
                rooms,
                booking_sources,
                durations,
                room_types,
            ):
                c.execute(table.delete().where(table.c.company_id == owner))
            c.execute(companies.delete().where(companies.c.id == owner))
