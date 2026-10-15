"""Real loopback HTTP + API restart verification in hms_test, with scoped cleanup.

Does not write hms_dev. Creates an isolated synthetic company/room and deletes only
its own UUID-scoped rows. Never resets a database or starts a visible GUI process.
"""

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
    billing_documents,
    booking_sources,
    categories,
    companies,
    document_counters,
    durations,
    guests,
    mutation_receipts,
    pricing_revisions,
    rates,
    reservations,
    room_types,
    rooms,
)
from app.settings import require_isolated_local_database

root = Path(__file__).resolve().parents[1]
url = dotenv_values(root / ".env")["HMS_TEST_DATABASE_URL"]
require_isolated_local_database(url, test=True)
engine = make_engine(url)
owner = uuid4()
ids = {key: uuid5(owner, key) for key in ("room", "type", "duration", "rate", "source")}
process = None
stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
log = (root / "verification" / f"http-billing-documents-{stamp}.log").open("w", encoding="utf-8")
with socket.socket() as port_probe:
    port_probe.bind(("127.0.0.1", 0))
    port = port_probe.getsockname()[1]
base = f"http://127.0.0.1:{port}"
environment = dict(os.environ)
for key in ("PYTHONHOME", "PYTHONPATH"):
    environment.pop(key, None)
environment.update(HMS_DATABASE_URL=url, HMS_COMPANY_ID=str(owner), HMS_ENV="development")


def start_server():
    global process
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
        cwd=root,
        env=environment,
        stdout=log,
        stderr=log,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Verification API exited before readiness")
        try:
            response = httpx.get(base + "/api/v1/health", timeout=1)
            if response.status_code == 200 and response.json()["database"] == "ok":
                return
        except httpx.TransportError:
            pass
        time.sleep(0.1)
    raise RuntimeError("Verification API readiness timed out")


def stop_server():
    global process
    if process is not None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        process = None


try:
    with engine.begin() as c:
        c.execute(
            companies.insert().values(
                id=owner,
                name="Synthetic HTTP verification",
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
                source_id="6-hour-rate",
                room_type_id=ids["type"],
                duration_id=ids["duration"],
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
    start_server()
    with httpx.Client(base_url=base, timeout=10) as client:
        assert client.get("/api/v1/live").status_code == 200
        assert client.get("/api/v1/reference-data").status_code == 200
        response = client.post(
            "/api/v1/guests",
            json={"name": "Synthetic HTTP guest"},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert response.status_code == 201, response.text
        body = dict(
            guest_id=response.json()["id"],
            booking_source_id=str(ids["source"]),
            room_id=str(ids["room"]),
            duration_id=str(ids["duration"]),
            adults=2,
            children=0,
            scheduled_start="2026-11-10T14:07:12.123456+08:00",
        )
        key = str(uuid4())
        first = client.post("/api/v1/reservations", json=body, headers={"Idempotency-Key": key})
        assert first.status_code == 201, first.text
        saved = first.json()
        assert saved["pricing"]["snapshot"]["total_minor"] == 110000
        assert saved["allocation"]["scheduled_start"] == "2026-11-10T06:07:12.123456Z"
        patch_key = str(uuid4())
        patch_body = dict(expected_version=1, note="Verified PATCH", adults=3, children=0)
        patch_response = client.patch(
            f"/api/v1/reservations/{saved['id']}",
            json=patch_body,
            headers={"Idempotency-Key": patch_key},
        )
        assert patch_response.status_code == 200, patch_response.text
        patched = patch_response.json()
        assert patched["version"] == 2 and patched["note"] == "Verified PATCH"
        assert patched["pricing"] == saved["pricing"]
    stop_server()
    start_server()
    with httpx.Client(base_url=base, timeout=10) as client:
        assert client.get(f"/api/v1/reservations/{saved['id']}").json() == patched
        assert client.get("/api/v1/reservations").json() == [patched]
        replay = client.post("/api/v1/reservations", json=body, headers={"Idempotency-Key": key})
        assert replay.status_code == 201 and replay.json() == saved
        conflict = client.post(
            "/api/v1/reservations",
            json=dict(body, note="Changed"),
            headers={"Idempotency-Key": key},
        )
        assert conflict.status_code == 409 and conflict.json()["code"] == "idempotency_conflict"
        replay_patch = client.patch(
            f"/api/v1/reservations/{saved['id']}",
            json=patch_body,
            headers={"Idempotency-Key": patch_key},
        )
        assert replay_patch.status_code == 200 and replay_patch.json() == patched
        stale = client.patch(
            f"/api/v1/reservations/{saved['id']}",
            json=dict(expected_version=1, note="Stale"),
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert stale.status_code == 409 and stale.json()["code"] == "version_conflict"
        conflict_patch = client.patch(
            f"/api/v1/reservations/{saved['id']}",
            json=dict(patch_body, note="Different"),
            headers={"Idempotency-Key": patch_key},
        )
        assert conflict_patch.status_code == 409
        assert conflict_patch.json()["code"] == "idempotency_conflict"
        draft_key, final_key = str(uuid4()), str(uuid4())
        draft_body = dict(expected_reservation_version=patched["version"])
        draft_response = client.post(
            f"/api/v1/reservations/{saved['id']}/billing-documents",
            json=draft_body,
            headers={"Idempotency-Key": draft_key},
        )
        assert draft_response.status_code == 201, draft_response.text
        document = draft_response.json()
        final_response = client.post(
            f"/api/v1/billing-documents/{document['id']}/finalize",
            json=dict(expected_version=1),
            headers={"Idempotency-Key": final_key},
        )
        assert final_response.status_code == 200, final_response.text
        finalized = final_response.json()
    stop_server()
    start_server()
    with httpx.Client(base_url=base, timeout=10) as client:
        assert client.get(f"/api/v1/billing-documents/{document['id']}").json() == finalized
        assert client.get(f"/api/v1/reservations/{saved['id']}/billing-documents").json() == [
            finalized
        ]
        replay = client.post(
            f"/api/v1/billing-documents/{document['id']}/finalize",
            json=dict(expected_version=1),
            headers={"Idempotency-Key": final_key},
        )
        assert replay.status_code == 200 and replay.json() == finalized
        replay = client.post(
            f"/api/v1/reservations/{saved['id']}/billing-documents",
            json=draft_body,
            headers={"Idempotency-Key": draft_key},
        )
        assert replay.status_code == 201 and replay.json() == document
        current = client.get(f"/api/v1/reservations/{saved['id']}").json()
        assert current["pricing"] == patched["pricing"] and current["version"] == patched["version"]
    evidence = dict(
        timestamp=stamp,
        database="hms_test",
        health="PASS",
        create="PASS",
        read_after_process_restart="PASS",
        durable_idempotent_replay="PASS",
        changed_body_conflict="PASS",
        patch="PASS",
        patch_get_after_restart="PASS",
        durable_patch_replay="PASS",
        stale_patch="PASS",
        changed_patch_body_conflict="PASS",
        pricing_unchanged="PASS",
        synthetic_company=str(owner),
        document_read_after_restart="PASS",
        durable_draft_and_finalization_replay="PASS",
        number=finalized["number"],
        capture_hash=finalized["capture_hash"],
    )
    with engine.connect() as c:
        counts = {
            table.name: c.scalar(
                sa.select(sa.func.count()).select_from(table).where(table.c.company_id == owner)
            )
            for table in (
                guests,
                reservations,
                allocations,
                pricing_revisions,
                audit_events,
                mutation_receipts,
                billing_documents,
                document_counters,
            )
        }
    assert counts == dict(
        guests=1,
        reservations=1,
        room_allocations=1,
        pricing_revisions=1,
        operational_audit=5,
        mutation_receipts=5,
        billing_documents=1,
        billing_document_counters=1,
    )
    evidence["counts_before_cleanup"] = counts
    with engine.connect() as c:
        raw = (
            c.execute(sa.select(billing_documents).where(billing_documents.c.id == document["id"]))
            .mappings()
            .one()
        )
        assert raw["capture"] == finalized["capture"] and raw["total_minor"] == 110000
except Exception as error:
    (root / "verification" / f"http-billing-documents-failed-{stamp}.json").write_text(
        json.dumps(dict(status="FAIL", error=str(error)), indent=2), encoding="utf-8"
    )
    raise
finally:
    stop_server()
    log.close()
    with engine.begin() as c:
        # Project-owner test maintenance, restricted to this script's random synthetic company.
        # Exclusive table lock makes the trigger maintenance transaction invisible to other writers.
        c.execute(
            sa.text("ALTER TABLE hms.billing_documents DISABLE TRIGGER billing_documents_guard")
        )
        c.execute(billing_documents.delete().where(billing_documents.c.company_id == owner))
        c.execute(
            sa.text("ALTER TABLE hms.billing_documents ENABLE TRIGGER billing_documents_guard")
        )
        for table in (
            document_counters,
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

evidence["cleanup"] = "Only synthetic company rows removed; verification API stopped"
path = root / "verification" / f"http-billing-documents-{stamp}.json"
path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
print("PASS: real HTTP billing draft/finalize/read and durable replay survived API process restart")
print("PASS: hms_test synthetic rows cleaned; hms_dev was never written")
print(f"Evidence: {path.name}")
