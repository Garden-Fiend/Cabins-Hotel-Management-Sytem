"""Create a new cluster, migrate/seed, capture synthetic data, then dump/restore.

Never connects to hms_dev/hms_test. Leaves its uniquely named cluster intact for review.
No installed dependencies or application startup seeding are involved.
"""

import hashlib
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4


def command(*args, environment=None):
    result = subprocess.run(args, env=environment, capture_output=True, text=True)
    if result.returncode:
        # Do not emit commands/environment: connection credentials remain private.
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout


def main():
    root = Path(__file__).resolve().parents[1]
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    name = f"hms-recovery-{stamp.lower()}-{uuid4().hex[:8]}"
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 55433))  # Fail before creating anything if occupied.
    password = secrets.token_hex(24)
    environment = dict(os.environ, POSTGRES_PASSWORD=password)
    command(
        "docker",
        "run",
        "-d",
        "--name",
        name,
        "--label",
        "hms.purpose=recovery-rehearsal",
        "-p",
        "127.0.0.1:55433:5432",
        "-e",
        "POSTGRES_USER=hms_rehearsal",
        "-e",
        "POSTGRES_PASSWORD",
        "-e",
        "POSTGRES_DB=hms_rehearsal",
        "--mount",
        f"type=volume,source={name},target=/var/lib/postgresql/data",
        "postgres:17.6",
        environment=environment,
    )
    for _ in range(30):
        ready = subprocess.run(
            ["docker", "exec", name, "pg_isready", "-U", "hms_rehearsal", "-d", "hms_rehearsal"],
            capture_output=True,
        )
        if ready.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError("New recovery cluster did not become ready; retained for inspection")
    url = f"postgresql+psycopg://hms_rehearsal:{password}@127.0.0.1:55433/hms_rehearsal"
    os.environ.update(HMS_DATABASE_URL=url, HMS_ALLOW_RECOVERY_REHEARSAL="1", HMS_ENV="development")
    subprocess_environment = dict(os.environ)
    command(
        sys.executable, "-I", "-m", "alembic", "upgrade", "head", environment=subprocess_environment
    )

    import sqlalchemy as sa
    from fastapi.testclient import TestClient

    from app.db import Base, make_engine
    from app.main import app
    from app.seed import seed_id, seed_reference_data

    engine = make_engine(url)

    def inventory(target_engine):
        result = {}
        with target_engine.connect() as connection:
            for table in Base.metadata.sorted_tables:
                rows = [dict(row) for row in connection.execute(sa.select(table)).mappings()]
                serialized = json.dumps(
                    sorted(rows, key=lambda row: str(row)), default=str, sort_keys=True
                )
                result[table.name] = dict(
                    count=len(rows), sha256=hashlib.sha256(serialized.encode()).hexdigest()
                )
        return result

    seeded = seed_reference_data()
    first = inventory(engine)
    seed_reference_data()
    assert inventory(engine) == first, "Seed replay changed reference records"
    with TestClient(app) as client:

        def write(path, body, method="POST"):
            response = client.request(
                method, "/api/v1/" + path, json=body, headers={"Idempotency-Key": str(uuid4())}
            )
            assert response.status_code in (200, 201), response.text
            return response.json()

        guest = write("guests", dict(name="Synthetic recovery guest"))
        refs = client.get("/api/v1/reference-data").json()
        inclusion_category = next(
            c for c in refs["inventory_categories"] if c["type"] == "inclusion"
        )
        towel = write(
            "configuration/products",
            dict(
                label="Recovery towel",
                category_id=inclusion_category["id"],
                unit_amount_minor=0,
                available_for_sale=False,
            ),
        )
        type_id = str(seed_id("standard"))
        room_type = next(t for t in refs["room_types"] if t["id"] == type_id)
        write(
            f"configuration/room-types/{type_id}",
            dict(
                label=room_type["label"],
                expected_version=room_type["version"],
                default_inclusions=[dict(product_id=towel["id"], quantity=2)],
            ),
            "PATCH",
        )
        preset = write(
            "configuration/discount-presets",
            dict(label="Recovery preset", scope="reservation", method="fixed", value="50.25"),
        )
        request = dict(
            guest_id=guest["id"],
            room_id=str(seed_id("room-101")),
            duration_id=str(seed_id("1-night")),
            booking_source_id=str(seed_id("direct")),
            adults=1,
            scheduled_start="2026-12-20T14:00:00+08:00",
            discounts=[
                dict(
                    id=str(uuid4()),
                    preset_id=preset["id"],
                    label=preset["label"],
                    scope="reservation",
                    method="fixed",
                    value="50.25",
                )
            ],
        )
        booking = write("reservations", request)
        assert booking["allocation"]["inclusions"][0]["quantity"] == 2
        assert booking["pricing"]["snapshot"]["total_minor"] == 214975
        # Exercise new B7 records in the same independently isolated recovery target.
        collection_context = client.get(f"/api/v1/reservations/{booking['id']}/collections").json()[
            "summary"
        ]
        write(
            f"reservations/{booking['id']}/collections",
            dict(
                expected_version=booking["version"],
                source_id=collection_context["source_id"],
                capture_id=None,
                kind="collection",
                collector="hotel",
                component="accommodation",
                amount_minor=50000,
                currency="PHP",
                payment_method="cash",
                reference="",
                declaration="partial",
                reason="Recovery rehearsal evidence",
            ),
        )
        booking = client.get(f"/api/v1/reservations/{booking['id']}").json()
        collection_context = client.get(f"/api/v1/reservations/{booking['id']}/collections").json()
        original_collection = collection_context["items"][0]
        write(
            f"reservations/{booking['id']}/collections",
            dict(
                expected_version=booking["version"],
                source_id=collection_context["summary"]["source_id"],
                capture_id=None,
                kind="refund",
                collector="hotel",
                component="accommodation",
                amount_minor=10000,
                currency="PHP",
                payment_method="cash",
                reference="",
                declaration="partial",
                related_transaction_id=original_collection["id"],
                reason="Reviewed recovery refund",
            ),
        )
        booking = client.get(f"/api/v1/reservations/{booking['id']}").json()
        write(
            f"reservations/{booking['id']}/guest-obligation",
            dict(
                expected_version=booking["version"],
                expected_capture_id=None,
                expected_pricing_id=booking["pricing"]["id"],
                status="known",
                accommodation_minor=214975,
                evidence="Explicit recovery review",
            ),
        )
        booking = client.get(f"/api/v1/reservations/{booking['id']}").json()
        collection_context = client.get(f"/api/v1/reservations/{booking['id']}/collections").json()
        summary = collection_context["summary"]
        # An explicit release is preserved alongside automatic refund/basis compensations.
        active = next(
            row for row in reversed(summary["allocation_history"]) if row["kind"] == "allocate"
        )
        write(
            f"reservations/{booking['id']}/payment-allocations",
            dict(
                expected_version=summary["reservation_version"],
                expected_pricing_id=summary["pricing_id"],
                expected_obligation_id=summary["allocation_obligation_id"],
                kind="release",
                payment_id=active["payment_id"],
                component=active["component"],
                amount_minor=1,
                release_of=active["id"],
                reason="Recovery allocation linkage",
            ),
        )
        booking = client.get(f"/api/v1/reservations/{booking['id']}").json()
        collection_context = client.get(f"/api/v1/reservations/{booking['id']}/collections").json()
        expected = inventory(engine)
        head = command(
            sys.executable, "-I", "-m", "alembic", "current", environment=subprocess_environment
        ).strip()
        command(
            "docker",
            "exec",
            name,
            "pg_dump",
            "-U",
            "hms_rehearsal",
            "-d",
            "hms_rehearsal",
            "-Fc",
            "-f",
            "/tmp/hms-recovery.dump",
        )
        # This private cluster is new. CREATE refuses reuse of an existing target.
        command("docker", "exec", name, "createdb", "-U", "hms_rehearsal", "hms_restore")
        command(
            "docker",
            "exec",
            name,
            "pg_restore",
            "-U",
            "hms_rehearsal",
            "-d",
            "hms_restore",
            "--exit-on-error",
            "/tmp/hms-recovery.dump",
        )
        restored_url = url.rsplit("/", 1)[0] + "/hms_restore"
        restored = make_engine(restored_url)
        try:
            assert inventory(restored) == expected, "Restored raw records differ"
            from sqlalchemy.orm import Session

            from app.context import CommandContext
            from app.modules.reservations.services import ReservationService

            service = ReservationService(restored, CommandContext(seed_id("company")))
            from app.models import reservations

            with Session(restored) as session:
                reservation = service.owned(session, reservations, booking["id"])
                canonical = service.read_in_transaction(session, reservation).model_dump(
                    mode="json"
                )
            assert canonical == booking, "Restored canonical reservation differs"
            from app.modules.billing.collections import collection_read

            assert collection_read(service, booking["id"]) == collection_context
            restored_environment = dict(subprocess_environment, HMS_DATABASE_URL=restored_url)
            restored_head = command(
                sys.executable, "-I", "-m", "alembic", "current", environment=restored_environment
            ).strip()
            assert head == restored_head
            command(
                sys.executable, "-I", "-m", "alembic", "check", environment=restored_environment
            )
        finally:
            restored.dispose()
    evidence = dict(
        container=name,
        port=55433,
        source="hms_rehearsal",
        restored="hms_restore",
        migration_head=head,
        seed_counts=seeded,
        seed_replay_unchanged=True,
        raw_restore_identical=True,
        canonical_restore_identical=True,
        tables=expected,
    )
    destination = root / "verification" / f"recovery-rehearsal-{stamp}.json"
    destination.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    engine.dispose()
    command("docker", "stop", name)  # Retain this owned cluster/volume; free the rehearsal port.
    print(f"Recovery rehearsal passed; evidence: {destination.name}; cluster retained: {name}")


if __name__ == "__main__":
    main()
