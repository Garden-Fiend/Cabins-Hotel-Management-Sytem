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
report = root / "booking-tests" / "reports" / f"{stamp}-discount-presets"
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
        ["node", "integration-tests/browser-presets.mjs"],
        check=False,
        cwd=root,
        env=node_environment,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    if result.returncode:
        raise SystemExit(result.returncode)
    records = httpx.get(base + "/api/v1/reservations", timeout=5).json()
    assert len(records) == 3
    saved = next(r for r in records if r["note"] == "Historical preset stays ten")
    assert saved["pricing"]["snapshot"]["total_minor"] == 95850
    assert len(saved["pricing"]["snapshot"]["discounts"]) == 3
    args = process.args
    process.terminate()
    process.wait(timeout=10)
    process = subprocess.Popen(
        args,
        cwd=root / "backend",
        env=api_environment,
        stdout=log,
        stderr=log,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    for attempt in range(100):
        try:
            r = httpx.get(base + "/api/v1/reservations/" + saved["id"], timeout=1)
            if r.status_code == 200:
                assert r.json() == saved
                break
        except httpx.TransportError:
            pass
        time.sleep(0.1)
    else:
        raise RuntimeError("Owned preset API restart verification failed")
    with engine.connect() as c:
        prices = c.execute(
            sa.select(pricing_revisions.c.revision, pricing_revisions.c.total_minor).where(
                pricing_revisions.c.company_id == owner
            )
        ).all()
        assert sorted(prices) == [(1, 99000), (1, 99000), (1, 110000), (2, 120000), (3, 95850)]
    (report / "postgres-verification.json").write_text(
        json.dumps(
            {
                "database": "hms_test",
                "company": str(owner),
                "reservations": 3,
                "pricing_revisions": [list(r) for r in prices],
                "restart_verified": True,
                "discounts": saved["pricing"]["snapshot"]["discounts"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"PASS: preset browser and actual PostgreSQL/restart verification; {report}")
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
