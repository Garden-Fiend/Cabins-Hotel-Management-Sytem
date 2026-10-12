from uuid import NAMESPACE_URL, uuid5

from sqlalchemy.dialects.postgresql import insert

from app.db import make_engine
from app.models import booking_sources, companies, durations, rates, room_types, rooms
from app.settings import get_settings, require_isolated_local_database


def seed_id(name: str):
    return uuid5(NAMESPACE_URL, "hms-local-reference:" + name)


def seed_reference_data(url: str | None = None, *, test: bool = False) -> dict[str, int]:
    settings = get_settings()
    if settings.env != "development":
        raise ValueError("Reference seeding is development-only")
    target = url or settings.database_url.get_secret_value()
    require_isolated_local_database(target, test=test)
    company_id = seed_id("company")
    type_id = seed_id("standard")
    entries = [
        (
            companies,
            [
                {
                    "id": company_id,
                    "name": "HMS Development",
                    "currency": "PHP",
                    "hotel_timezone": "Asia/Manila",
                }
            ],
        ),
        (
            room_types,
            [
                {
                    "id": type_id,
                    "company_id": company_id,
                    "source_id": "standard",
                    "label": "Standard",
                }
            ],
        ),
        (
            rooms,
            [
                {
                    "id": seed_id("room-101"),
                    "company_id": company_id,
                    "room_type_id": type_id,
                    "number": "101",
                }
            ],
        ),
        (
            durations,
            [
                {
                    "id": seed_id("6-hours"),
                    "company_id": company_id,
                    "source_id": "6-hours",
                    "kind": "hourly",
                    "minutes": 360,
                    "nights": None,
                },
                {
                    "id": seed_id("1-night"),
                    "company_id": company_id,
                    "source_id": "1-night",
                    "kind": "overnight",
                    "minutes": None,
                    "nights": 1,
                },
            ],
        ),
        (
            rates,
            [
                {
                    "id": seed_id("standard-6-hours"),
                    "company_id": company_id,
                    "room_type_id": type_id,
                    "source_id": "standard-6-hours",
                    "booking_kind": "hourly",
                    "duration_id": seed_id("6-hours"),
                    "unit_amount_minor": 110000,
                    "currency": "PHP",
                },
                {
                    "id": seed_id("standard-nightly"),
                    "company_id": company_id,
                    "room_type_id": type_id,
                    "source_id": "standard-nightly",
                    "booking_kind": "overnight",
                    "duration_id": None,
                    "unit_amount_minor": 220000,
                    "currency": "PHP",
                },
            ],
        ),
        (
            booking_sources,
            [
                {
                    "id": seed_id("direct"),
                    "company_id": company_id,
                    "source_id": "direct",
                    "label": "Direct",
                }
            ],
        ),
    ]
    engine = make_engine(target)
    try:
        with engine.begin() as connection:
            for table, rows in entries:
                connection.execute(insert(table).values(rows).on_conflict_do_nothing())
    finally:
        engine.dispose()
    return {table.name: len(rows) for table, rows in entries}


if __name__ == "__main__":
    print("Reference seed completed without updating existing records:", seed_reference_data())
