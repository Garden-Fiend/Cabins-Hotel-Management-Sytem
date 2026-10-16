"""Recover only exact new fixture owners after the recorded B5 cleanup-import failure."""

import hashlib
import json
from pathlib import Path
from uuid import uuid5

import sqlalchemy as sa
from dotenv import dotenv_values

from app.db import Base, make_engine
from app.models import booking_sources, companies, reservations, rooms
from app.settings import require_isolated_local_database

root = Path(__file__).resolve().parents[1]
url = dotenv_values(root / ".env")["HMS_TEST_DATABASE_URL"]
require_isolated_local_database(url, test=True)
baseline = json.loads((root / "verification/b5-before-20261016.json").read_text())["hms_test"][
    "companies"
]
engine = make_engine(url)
evidence = root / "verification/b5-failed-fixture-owners.json"
if not evidence.exists():
    raise SystemExit("Recovery requires its recorded exact-owner manifest")
recorded_owners = set(json.loads(evidence.read_text())["owners"])
with engine.begin() as c:
    owners = []
    for row in c.execute(sa.select(companies)).mappings():
        if str(row["id"]) not in recorded_owners:
            continue
        old = {key: row[key] for key in baseline["columns"]}
        digest = hashlib.sha256(json.dumps(old, sort_keys=True, default=str).encode()).hexdigest()
        if digest in baseline["rows"]:
            continue
        if row["name"] != "Isolated test scope":
            raise RuntimeError("Unexpected nonfixture company; stop")
        if (
            c.scalar(
                sa.select(booking_sources.c.id).where(
                    booking_sources.c.id == uuid5(row["id"], "source"),
                    booking_sources.c.company_id == row["id"],
                )
            )
            is None
        ):
            raise RuntimeError("Fixture ownership proof missing")
        owners.append(row["id"])
    for table, trigger in [
        ("billing_documents", "billing_documents_guard"),
        ("source_agreements", "source_agreement_guard"),
    ]:
        c.execute(sa.text(f"LOCK TABLE hms.{table} IN ACCESS EXCLUSIVE MODE"))
        c.execute(sa.text(f"ALTER TABLE hms.{table} DISABLE TRIGGER {trigger}"))
    for owner in owners:
        c.execute(
            reservations.update()
            .where(reservations.c.company_id == owner)
            .values(multi_room=False, independent_stays=False)
        )
        c.execute(
            rooms.update()
            .where(rooms.c.company_id == owner)
            .values(current_occupancy_allocation_id=None)
        )
        for name in (
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
            c.execute(table.delete().where(table.c.company_id == owner))
        c.execute(companies.delete().where(companies.c.id == owner))
    for table, trigger in [
        ("billing_documents", "billing_documents_guard"),
        ("source_agreements", "source_agreement_guard"),
    ]:
        c.execute(sa.text(f"ALTER TABLE hms.{table} ENABLE TRIGGER {trigger}"))
print(f"Cleaned {len(owners)} exact proven fixture owners; original companies retained")
