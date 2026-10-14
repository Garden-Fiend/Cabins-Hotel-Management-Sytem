"""Explicit React/PostgreSQL verification. Never targets the development database."""

import json
import os
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4, uuid5

import httpx
import sqlalchemy as sa
from dotenv import dotenv_values

from app.db import make_engine
from app.models import (
    allocations,
    audit_events,
    booking_sources,
    breakfast_eligibility,
    categories,
    companies,
    discount_presets,
    durations,
    guests,
    mutation_receipts,
    pricing_revisions,
    products,
    rates,
    reservations,
    room_type_inclusions,
    room_types,
    rooms,
)
from app.settings import require_isolated_local_database

root = Path(__file__).resolve().parents[1]
url = dotenv_values(root / "backend" / ".env")["HMS_TEST_DATABASE_URL"]
require_isolated_local_database(url, test=True)
for frontend_port in (5183, 5184):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", frontend_port))  # Fail rather than stop/reuse an existing server.
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
base = f"http://127.0.0.1:{port}"
stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
report = root / "booking-tests" / "reports" / f"{stamp}-rich-api-integration"
report.mkdir(parents=True, exist_ok=False)
owner = uuid4()
ids = {key: uuid5(owner, key) for key in ("type", "room", "duration", "rate", "source")}
engine = make_engine(url)
process = None
log = (report / "api.log").open("w", encoding="utf-8")
environment = dict(os.environ)
for key in ("PYTHONHOME", "PYTHONPATH"):
    environment.pop(key, None)
api_environment = dict(
    environment,
    HMS_DATABASE_URL=url,
    HMS_COMPANY_ID=str(owner),
    HMS_ENV="development",
    HMS_CORS_ORIGINS=json.dumps(["http://127.0.0.1:5183"]),
)
try:
    with engine.begin() as c:
        c.execute(
            companies.insert().values(
                id=owner,
                name="React integration test",
                currency="PHP",
                hotel_timezone="Asia/Manila",
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
            durations.insert().values(
                id=ids["duration"],
                company_id=owner,
                source_id="6-hours",
                kind="hourly",
                minutes=360,
            )
        )
        c.execute(
            rates.insert().values(
                id=ids["rate"],
                company_id=owner,
                room_type_id=ids["type"],
                duration_id=ids["duration"],
                source_id="standard-6-hours",
                booking_kind="hourly",
                unit_amount_minor=110000,
                currency="PHP",
            )
        )
        c.execute(
            booking_sources.insert().values(
                id=ids["source"], company_id=owner, source_id="direct", label="Direct"
            )
        )
    process = subprocess.Popen(
        [
            sys.executable,
            "-I",
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=root / "backend",
        env=api_environment,
        stdout=log,
        stderr=log,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Verification API exited before readiness")
        try:
            if httpx.get(base + "/api/v1/health", timeout=1).status_code == 200:
                break
        except httpx.TransportError:
            pass
        time.sleep(0.1)
    else:
        raise RuntimeError("Verification API readiness timeout")
    node_environment = dict(
        environment, HMS_INTEGRATION_API=base, HMS_INTEGRATION_REPORT=str(report)
    )
    # Browser tooling receives only the API URL, never the database connection secret.
    for key in ("HMS_DATABASE_URL", "HMS_TEST_DATABASE_URL", "HMS_DB_PASSWORD"):
        node_environment.pop(key, None)
    result = subprocess.run(
        ["node", "integration-tests/browser-rich.mjs"],
        check=False,
        cwd=root,
        env=node_environment,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    if result.returncode:
        raise SystemExit(result.returncode)
    process.terminate()
    process.wait(timeout=10)
    process = subprocess.Popen(
        [
            sys.executable,
            "-I",
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=root / "backend",
        env=api_environment,
        stdout=log,
        stderr=log,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    for attempt in range(100):
        try:
            persisted = httpx.get(base + "/api/v1/reservations", timeout=1)
            if persisted.status_code == 200:
                records = persisted.json()
                assert len(records) == 4
                assert any(
                    r["note"] == "My retained draft" and r["allocation"]["adults"] == 5
                    for r in records
                )
                discount_record = next(r for r in records if r["note"] == "PW Discount booking")
                assert discount_record["pricing"]["snapshot"]["total_minor"] == 88000
                assert discount_record["pricing"]["snapshot"]["discounts"][0]["value"] == "20"
                assert discount_record["pricing"]["snapshot"]["lines"][0]["amount_minor"] == 110000
                capped_record = next(r for r in records if r["note"] == "PW Calendar Discount")
                assert capped_record["pricing"]["snapshot"]["total_minor"] == 0
                assert capped_record["pricing"]["snapshot"]["discount_total_minor"] == 160025
                refs_after_restart = httpx.get(base + "/api/v1/reference-data", timeout=1).json()
                assert any(
                    p["label"] == "PW Extra bed" and p["unit_amount_minor"] == 99999
                    for p in refs_after_restart["catalog_products"]
                )
                ready = next(r for r in refs_after_restart["rooms"] if r["number"] == "101")
                assert ready["housekeeping"] == "clean" and ready["version"] == 5
                assert any(
                    t["label"] == "PW Deluxe Updated" for t in refs_after_restart["room_types"]
                )
                assert any(r["unit_amount_minor"] == 125075 for r in refs_after_restart["rates"])
                assert (
                    next(
                        p
                        for p in refs_after_restart["catalog_products"]
                        if p["label"] == "PW Mineral water"
                    )["unit_amount_minor"]
                    == 25075
                )
                assert any(
                    r["pricing"]["revision"] == 5
                    and r["pricing"]["snapshot"]["total_minor"] == 150150
                    for r in records
                )
                break
        except httpx.TransportError:
            pass
        time.sleep(0.1)
    else:
        raise RuntimeError("API restart persistence check failed")
    print("PASS: rich browser records persisted after real backend process restart")
    with engine.connect() as c:
        count = c.scalar(
            sa.select(sa.func.count())
            .select_from(reservations)
            .where(reservations.c.company_id == owner)
        )
        revisions = c.execute(
            sa.select(pricing_revisions.c.revision, pricing_revisions.c.total_minor).where(
                pricing_revisions.c.company_id == owner
            )
        ).all()
        assert count == 4 and sorted(revisions) == sorted(
            [
                (1, 110000),
                (1, 110000),
                (2, 115025),
                (2, 150050),
                (3, 105000),
                (3, 195150),
                (4, 135075),
                (5, 150150),
                (1, 0),
                (1, 90000),
                (2, 85500),
                (3, 76000),
                (4, 72000),
                (5, 88000),
                (6, 104060),
                (7, 124120),
                (8, 88000),
                (9, 82500),
                (10, 88000),
                (11, 168040),
                (12, 164040),
                (13, 204060),
                (14, 88000),
            ]
        )
        evidence = {
            "company": str(owner),
            "database": "hms_test",
            "reservations": count,
            "pricing_revisions": [list(row) for row in revisions],
            "verified_readiness_and_configuration": True,
            "verified_manual_discounts_after_restart": True,
            "verified_extra_charges_after_restart": True,
        }
        (report / "postgres-verification.json").write_text(
            json.dumps(evidence, indent=2), encoding="utf-8"
        )
    print(f"PASS: actual PostgreSQL records verified; evidence {report}")
finally:
    if process is not None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    log.close()
    with engine.begin() as c:
        c.execute(
            rooms.update()
            .where(rooms.c.company_id == owner)
            .values(current_occupancy_allocation_id=None)
        )
        for table in (
            breakfast_eligibility,
            discount_presets,
            room_type_inclusions,
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
    engine.dispose()
    print("Synthetic hms_test company cleaned; development business records were not written.")
