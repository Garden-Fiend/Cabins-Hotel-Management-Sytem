"""Recover only the exact fixture left by the first B6 finalized-document test teardown."""

from uuid import UUID, uuid5

import sqlalchemy as sa
from dotenv import dotenv_values

from app.db import Base, make_engine
from app.models import booking_sources, companies, reservations, rooms
from app.settings import require_isolated_local_database

values = dotenv_values(".env")
url = values["HMS_TEST_DATABASE_URL"]
require_isolated_local_database(url, test=True)
engine = make_engine(url)
owner = UUID("d6a02e3d-a1a4-4733-a25e-79eace144c4d")
triggers = {
    "billing_documents": "billing_documents_guard",
    "source_agreements": "source_agreement_guard",
    "booking_financial_captures": "booking_financial_capture_guard",
}
with engine.begin() as connection:
    assert connection.scalar(sa.text("SELECT current_database()")) == "hms_test"
    row = (
        connection.execute(sa.select(companies).where(companies.c.id == owner))
        .mappings()
        .one_or_none()
    )
    if row:
        assert row["name"] == "Isolated test scope"
        assert (
            connection.scalar(
                sa.select(booking_sources.c.id).where(
                    booking_sources.c.id == uuid5(owner, "source"),
                    booking_sources.c.company_id == owner,
                )
            )
            is not None
        )
        for table, trigger in triggers.items():
            connection.execute(sa.text(f"LOCK TABLE hms.{table} IN ACCESS EXCLUSIVE MODE"))
            connection.execute(sa.text(f"ALTER TABLE hms.{table} DISABLE TRIGGER {trigger}"))
        connection.execute(
            reservations.update()
            .where(reservations.c.company_id == owner)
            .values(multi_room=False, independent_stays=False)
        )
        connection.execute(
            rooms.update()
            .where(rooms.c.company_id == owner)
            .values(current_occupancy_allocation_id=None)
        )
        for name in (
            "booking_financial_captures",
            "source_agreements",
            "billing_documents",
            "billing_document_counters",
            "breakfast_eligibility",
            "discount_presets",
            "room_type_inclusions",
            "catalog_products",
            "inventory_categories",
            "mutation_receipts",
            "operational_audit",
            "pricing_revisions",
            "room_allocations",
            "reservations",
            "guests",
            "reference_rates",
            "rooms",
            "booking_sources",
            "durations",
            "room_types",
        ):
            table = Base.metadata.tables["hms." + name]
            connection.execute(table.delete().where(table.c.company_id == owner))
        connection.execute(companies.delete().where(companies.c.id == owner))
        for table, trigger in triggers.items():
            connection.execute(sa.text(f"ALTER TABLE hms.{table} ENABLE TRIGGER {trigger}"))
print("Exact B6 failed fixture cleanup complete")
