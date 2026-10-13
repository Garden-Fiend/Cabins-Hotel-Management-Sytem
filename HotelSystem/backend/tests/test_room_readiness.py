from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.context import get_command_context
from app.db import get_engine
from app.main import create_app
from app.models import audit_events, mutation_receipts, rooms
from app.modules.reservations.lifecycle import transition
from app.modules.reservations.schemas import GuestCreate, LifecycleCommand, ReservationCreate
from app.modules.reservations.services import ReservationService

pytestmark = pytest.mark.postgres


@pytest.fixture
def readiness_api(pg_engine, isolated_company):
    context, ids = isolated_company
    app = create_app()
    app.dependency_overrides[get_engine] = lambda: pg_engine
    app.dependency_overrides[get_command_context] = lambda: context
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, ReservationService(pg_engine, context), ids


def command(client, room_id, version, state, key=None):
    return client.post(
        f"/api/v1/rooms/{room_id}/readiness",
        json={"expected_version": version, "housekeeping": state},
        headers={"Idempotency-Key": str(key or uuid4())},
    )


def raw_state(service):
    with service.engine.connect() as c:
        return {
            t.name: [
                dict(r)
                for r in c.execute(
                    sa.select(t)
                    .where(t.c.company_id == service.context.company_id)
                    .order_by(t.c.id)
                ).mappings()
            ]
            for t in (rooms, audit_events, mutation_receipts)
        }


def test_readiness_persists_versions_replay_and_audit(readiness_api):
    client, service, ids = readiness_api
    key = uuid4()
    cleaned = command(client, ids["room"], 1, "cleaning", key)
    assert cleaned.status_code == 200, cleaned.text
    assert cleaned.json()["version"] == 2 and cleaned.json()["housekeeping"] == "cleaning"
    assert client.get("/api/v1/reference-data").json()["rooms"][0] == cleaned.json()
    before = raw_state(service)
    assert command(client, ids["room"], 1, "cleaning", key).json() == cleaned.json()
    assert command(client, ids["room"], 1, "clean", key).json()["code"] == "idempotency_conflict"
    assert command(client, ids["room"], 1, "clean").json()["code"] == "version_conflict"
    assert raw_state(service) == before
    final = command(client, ids["room"], 2, "clean")
    assert final.status_code == 200 and final.json()["version"] == 3
    event = next(
        r for r in before["operational_audit"] if r["event_type"] == "room.readiness_changed"
    )
    assert (
        event["before"]["housekeeping"] == "clean" and event["after"]["housekeeping"] == "cleaning"
    )
    assert event["actor"] == "local-development" and event["reservation_id"] is None


def test_competing_room_versions_and_concurrent_replay(readiness_api):
    client, service, ids = readiness_api
    barrier = Barrier(2)

    def run(state):
        barrier.wait()
        return command(client, ids["room"], 1, state).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(run, ["clean", "cleaning"])) == [200, 409]
    key, barrier = uuid4(), Barrier(2)

    def same(_):
        barrier.wait()
        return command(client, ids["room"], 2, "cleaning", key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(same, range(2)))
    assert all(r.status_code == 200 for r in results)
    assert results[0].json() == results[1].json()
    assert raw_state(service)["rooms"][0]["version"] == 3


def test_physical_occupancy_blocks_readiness(readiness_api):
    client, service, ids = readiness_api
    guest = service.create_guest(GuestCreate(name="Occupied room test"), uuid4())
    saved = service.create(
        ReservationCreate(
            guest_id=guest.id,
            booking_source_id=ids["source"],
            room_id=ids["room"],
            duration_id=ids["hourly"],
            adults=1,
            scheduled_start=(datetime.now(UTC) - timedelta(hours=1)).isoformat(),
        ),
        uuid4(),
    )
    transition(service, saved.id, "check_in", LifecycleCommand(expected_version=1), uuid4())
    before = raw_state(service)
    result = command(client, ids["room"], 2, "cleaning")
    assert result.status_code == 409 and result.json()["code"] == "room_occupied"
    assert raw_state(service) == before


@pytest.mark.parametrize(
    "body",
    [
        {"expected_version": True, "housekeeping": "clean"},
        {"expected_version": 1, "housekeeping": "dirty"},
        {"expected_version": 1, "housekeeping": "clean", "operational": False},
        {"housekeeping": "clean"},
    ],
)
def test_strict_readiness_inputs(readiness_api, body):
    client, service, ids = readiness_api
    before = raw_state(service)
    result = client.post(
        f"/api/v1/rooms/{ids['room']}/readiness",
        json=body,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert result.status_code == 422 and raw_state(service) == before


@pytest.mark.parametrize("stage", ["rooms", "operational_audit", "mutation_receipts", "commit"])
def test_readiness_rollback_retry(readiness_api, stage):
    client, service, ids = readiness_api
    before = raw_state(service)

    def sql_fail(conn, cursor, statement, params, context, many):
        normalized = statement.lower()
        if stage in normalized and normalized.startswith(("update", "insert")):
            raise RuntimeError("Injected readiness failure")

    def commit_fail(session):
        raise RuntimeError("Injected readiness commit failure")

    target, event, handler = (
        (Session, "before_commit", commit_fail)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", sql_fail)
    )
    key = uuid4()
    sa.event.listen(target, event, handler)
    try:
        assert command(client, ids["room"], 1, "cleaning", key).status_code >= 500
    finally:
        sa.event.remove(target, event, handler)
    assert raw_state(service) == before
    assert command(client, ids["room"], 1, "cleaning", key).status_code == 200


def test_foreign_room_returns_not_found(readiness_api):
    client, service, _ids = readiness_api
    before = raw_state(service)
    assert command(client, uuid4(), 1, "cleaning").status_code == 404
    assert raw_state(service) == before
