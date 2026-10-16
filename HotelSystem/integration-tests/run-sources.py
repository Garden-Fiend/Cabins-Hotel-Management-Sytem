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
    agreements,
    allocations,
    audit_events,
    billing_documents,
    booking_sources,
    breakfast_eligibility,
    categories,
    companies,
    discount_presets,
    document_counters,
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
report = root / "booking-tests" / "reports" / f"{stamp}-sources"
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
        ["node", "integration-tests/browser-sources.mjs"],
        check=False,
        cwd=root,
        env=node_environment,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    if result.returncode:
        raise SystemExit(result.returncode)
    expected = json.loads((report / "expected.json").read_text(encoding="utf-8"))
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
            response = httpx.get(base + "/api/v1/reference-data", timeout=1)
            if response.status_code == 200:
                assert response.json() == expected["references"]
                break
        except httpx.TransportError:
            pass
        time.sleep(0.1)
    else:
        raise RuntimeError("Owned API restart failed")
    assert httpx.get(base + "/api/v1/reservations", timeout=5).json() == expected["reservations"]
    for document in expected["documents"]:
        assert (
            httpx.get(base + "/api/v1/billing-documents/" + document["id"], timeout=5).json()
            == document
        )
    with engine.connect() as c:
        from app.modules.configuration.sources import AgreementRead

        rows = c.execute(
            sa.select(agreements)
            .where(agreements.c.company_id == owner)
            .order_by(agreements.c.source_id, agreements.c.revision)
        ).mappings()
        raw_agreements = [AgreementRead.model_validate(row).model_dump(mode="json") for row in rows]
        assert raw_agreements == expected["references"]["source_agreements"]
        raw_rooms = list(c.execute(sa.select(rooms).where(rooms.c.company_id == owner)).mappings())
        raw_types = list(
            c.execute(sa.select(room_types).where(room_types.c.company_id == owner)).mappings()
        )
        for key, rows in (("rooms", raw_rooms), ("room_types", raw_types)):
            assert len(rows) == len(expected["references"][key])
            for item in expected["references"][key]:
                raw = next(row for row in rows if str(row["id"]) == item["id"])
                assert raw["enabled"] == item["enabled"] and raw["archived"] == item["archived"]
                assert raw["version"] == item["version"]
        audit_count = c.scalar(
            sa.select(sa.func.count())
            .select_from(audit_events)
            .where(audit_events.c.company_id == owner)
        )
    (report / "postgres-verification.json").write_text(
        json.dumps(
            {
                "database": "hms_test",
                "restart_verified": True,
                "room_count": len(raw_rooms),
                "type_count": len(raw_types),
                "agreement_count": len(raw_agreements),
                "audit_count": audit_count,
                "reservations": len(expected["reservations"]),
                "documents": len(expected["documents"]),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"PASS: sources browser and SQL/restart verification; {report}")

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
        c.execute(sa.text("LOCK TABLE hms.source_agreements IN ACCESS EXCLUSIVE MODE"))
        c.execute(
            sa.text("ALTER TABLE hms.source_agreements DISABLE TRIGGER source_agreement_guard")
        )
        c.execute(agreements.delete().where(agreements.c.company_id == owner))
        c.execute(
            sa.text("ALTER TABLE hms.source_agreements ENABLE TRIGGER source_agreement_guard")
        )
        c.execute(
            sa.text("ALTER TABLE hms.billing_documents DISABLE TRIGGER billing_documents_guard")
        )
        c.execute(billing_documents.delete().where(billing_documents.c.company_id == owner))
        c.execute(
            sa.text("ALTER TABLE hms.billing_documents ENABLE TRIGGER billing_documents_guard")
        )
        c.execute(document_counters.delete().where(document_counters.c.company_id == owner))
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
            agreements,
            billing_documents,
            document_counters,
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
