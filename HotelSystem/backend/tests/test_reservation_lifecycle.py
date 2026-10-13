from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.context import CommandContext, get_command_context
from app.db import get_engine
from app.main import create_app
from app.models import (
    allocations,
    audit_events,
    mutation_receipts,
    pricing_revisions,
    reservations,
    rooms,
)
from app.modules.reservations.schemas import GuestCreate, ReservationCreate
from app.modules.reservations.services import ReservationService

pytestmark = pytest.mark.postgres


@pytest.fixture
def lifecycle_api(pg_engine, isolated_company):
    context, ids = isolated_company
    application = create_app()
    application.dependency_overrides[get_engine] = lambda: pg_engine
    application.dependency_overrides[get_command_context] = lambda: context
    service = ReservationService(pg_engine, context)
    guest = service.create_guest(GuestCreate(name="Lifecycle guest"), uuid4())
    saved = service.create(
        ReservationCreate(
            guest_id=guest.id,
            booking_source_id=ids["source"],
            room_id=ids["room"],
            duration_id=ids["hourly"],
            adults=2,
            scheduled_start=(datetime.now(UTC) - timedelta(hours=1)).isoformat(),
        ),
        uuid4(),
    ).model_dump(mode="json")
    with TestClient(application, raise_server_exceptions=False) as client:
        yield client, service, saved, ids, application
    # Cleanup the synthetic occupancy pointer before the fixture removes its allocation.
    with pg_engine.begin() as c:
        c.execute(
            rooms.update()
            .where(rooms.c.company_id == context.company_id)
            .values(current_occupancy_allocation_id=None)
        )


def command(client, saved, action, key=None, **extra):
    return client.post(
        f"/api/v1/reservations/{saved['id']}/{action}",
        headers={"Idempotency-Key": str(key or uuid4())},
        json={"expected_version": saved["version"], **extra},
    )


def state(service):
    with service.engine.connect() as c:
        return {
            table.name: [
                dict(r)
                for r in c.execute(
                    sa.select(table)
                    .where(table.c.company_id == service.context.company_id)
                    .order_by(table.c.id)
                ).mappings()
            ]
            for table in (
                rooms,
                reservations,
                allocations,
                pricing_revisions,
                audit_events,
                mutation_receipts,
            )
        }


def test_check_in_out_preserve_schedule_price_and_capture_occupancy(lifecycle_api):
    client, service, saved, ids, _ = lifecycle_api
    before = state(service)
    checked = command(client, saved, "check-in")
    assert checked.status_code == 200, checked.text
    data = checked.json()
    assert data["status"] == "checked_in" and data["version"] == 2
    assert data["allocation"]["actual_check_in"] is not None
    assert (
        str(state(service)["rooms"][0]["current_occupancy_allocation_id"])
        == data["allocation"]["id"]
    )
    out = command(client, data, "check-out")
    assert out.status_code == 200, out.text
    final = out.json()
    assert final["status"] == "checked_out" and final["version"] == 3
    assert (
        final["allocation"]["actual_check_out"] is not None
        and not final["allocation"]["blocks_availability"]
    )
    after = state(service)
    assert after["rooms"][0]["housekeeping"] == "dirty"
    assert after["rooms"][0]["current_occupancy_allocation_id"] is None
    assert final["pricing"] == saved["pricing"]
    assert before["pricing_revisions"] == after["pricing_revisions"]
    assert final["allocation"]["scheduled_start"] == saved["allocation"]["scheduled_start"]
    assert final["allocation"]["scheduled_end"] == saved["allocation"]["scheduled_end"]
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == final
    event = next(
        r for r in after["operational_audit"] if r["event_type"] == "reservation.check_out"
    )
    assert event["before"]["status"] == "checked_in" and event["after"]["housekeeping"] == "dirty"


@pytest.mark.parametrize("vacated", [True, False])
def test_cancel_occupied_and_record_departure(lifecycle_api, vacated):
    client, service, saved, _ids, _ = lifecycle_api
    checked = command(client, saved, "check-in").json()
    cancelled = command(client, checked, "cancel", guest_has_vacated=vacated)
    assert cancelled.status_code == 200, cancelled.text
    result = cancelled.json()
    assert result["status"] == "cancelled" and not result["allocation"]["blocks_availability"]
    if not vacated:
        assert state(service)["rooms"][0]["current_occupancy_allocation_id"] is not None
        assert result["allocation"]["actual_check_out"] is None
        departed = command(client, result, "record-departure")
        assert departed.status_code == 200, departed.text
        result = departed.json()
    assert state(service)["rooms"][0]["housekeeping"] == "dirty"
    assert state(service)["rooms"][0]["current_occupancy_allocation_id"] is None
    assert result["allocation"]["actual_check_out"] is not None
    assert result["pricing"] == saved["pricing"]


@pytest.mark.parametrize("action", ["cancel", "no-show"])
def test_unoccupied_cancellation_or_no_show_releases_schedule_not_readiness(lifecycle_api, action):
    client, service, saved, _ids, _ = lifecycle_api
    extra = {"guest_has_vacated": True} if action == "cancel" else {}
    result = command(client, saved, action, **extra)
    assert result.status_code == 200, result.text
    assert not result.json()["allocation"]["blocks_availability"]
    assert result.json()["allocation"]["actual_check_in"] is None
    assert state(service)["rooms"][0]["housekeeping"] == "clean"


@pytest.mark.parametrize("housekeeping", ["dirty", "cleaning"])
def test_dirty_check_in_has_no_partial_changes(lifecycle_api, housekeeping):
    client, service, saved, ids, _ = lifecycle_api
    with service.engine.begin() as c:
        c.execute(rooms.update().where(rooms.c.id == ids["room"]).values(housekeeping=housekeeping))
    before = state(service)
    result = command(client, saved, "check-in")
    assert result.status_code == 409 and result.json()["code"] == "room_not_ready"
    assert state(service) == before


@pytest.mark.parametrize("action", ["check-in", "no-show"])
def test_early_transition_rejected(lifecycle_api, action):
    client, service, saved, _ids, _ = lifecycle_api
    start = datetime.now(UTC) + timedelta(days=1)
    with service.engine.begin() as c:
        c.execute(
            allocations.update()
            .where(allocations.c.reservation_id == saved["id"])
            .values(scheduled_start=start, scheduled_end=start + timedelta(hours=6))
        )
    before = state(service)
    assert command(client, saved, action).status_code == 409
    assert state(service) == before


def test_replay_stale_changed_payload_and_foreign_ownership(lifecycle_api):
    client, service, saved, _ids, app = lifecycle_api
    key = uuid4()
    accepted = command(client, saved, "cancel", key, guest_has_vacated=True)
    assert accepted.status_code == 200
    before = state(service)
    assert command(client, saved, "cancel", key, guest_has_vacated=True).json() == accepted.json()
    assert (
        command(client, saved, "cancel", key, guest_has_vacated=False).json()["code"]
        == "idempotency_conflict"
    )
    assert command(client, saved, "no-show").json()["code"] == "version_conflict"
    assert state(service) == before
    app.dependency_overrides[get_command_context] = lambda: CommandContext(uuid4())
    assert command(client, saved, "check-in").status_code == 404
    assert state(service) == before


def test_competing_edits_one_winner(lifecycle_api):
    client, service, saved, _ids, _ = lifecycle_api
    barrier = Barrier(2)

    def run(action):
        barrier.wait()
        return command(
            client, saved, action, **({"guest_has_vacated": True} if action == "cancel" else {})
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, ["check-in", "cancel"]))
    assert sorted(results) == [200, 409]
    assert service.get(saved["id"]).version == 2


def test_concurrent_identical_key_mutates_once(lifecycle_api):
    client, service, saved, _ids, _ = lifecycle_api
    key, barrier = uuid4(), Barrier(2)

    def run(_):
        barrier.wait()
        result = command(client, saved, "check-in", key)
        assert result.status_code == 200, result.text
        return result.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert results[0] == results[1]
    assert service.get(saved["id"]).version == 2
    assert (
        len(
            [
                e
                for e in state(service)["operational_audit"]
                if e["event_type"] == "reservation.check_in"
            ]
        )
        == 1
    )


def test_future_booking_survives_late_checkout_and_occupied_room_blocks_new_create(lifecycle_api):
    client, service, saved, ids, _ = lifecycle_api
    template = dict(
        guest_id=saved["guest"]["id"],
        booking_source_id=ids["source"],
        room_id=ids["room"],
        duration_id=ids["hourly"],
        adults=1,
    )
    future = service.create(
        ReservationCreate(
            **template, scheduled_start=(datetime.now(UTC) + timedelta(days=1)).isoformat()
        ),
        uuid4(),
    )
    checked = command(client, saved, "check-in").json()
    from app.errors import DomainError

    with pytest.raises(DomainError, match="physical occupancy"):
        service.create(
            ReservationCreate(
                **template, scheduled_start=(datetime.now(UTC) + timedelta(days=2)).isoformat()
            ),
            uuid4(),
        )
    with service.engine.begin() as c:
        c.execute(
            allocations.update()
            .where(allocations.c.reservation_id == saved["id"])
            .values(scheduled_end=datetime.now(UTC) - timedelta(minutes=1))
        )
    out = command(client, checked, "check-out")
    assert out.status_code == 200, out.text
    assert out.json()["pricing"] == saved["pricing"]
    assert service.get(future.id).status == "confirmed"
    assert service.get(future.id).allocation.blocks_availability


@pytest.mark.parametrize(
    "stage",
    [
        "room_allocations",
        "rooms",
        "reservations",
        "operational_audit",
        "mutation_receipts",
        "commit",
    ],
)
def test_complete_rollback_and_retry(lifecycle_api, stage):
    client, service, saved, _ids, _ = lifecycle_api
    before = state(service)

    def fail(connection, cursor, statement, params, context, many):
        normalized = statement.lower()
        if stage in normalized and (
            normalized.startswith("update") or normalized.startswith("insert")
        ):
            raise RuntimeError("Injected lifecycle failure")

    def commit_fail(session):
        raise RuntimeError("Injected lifecycle commit failure")

    target, event, handler = (
        (Session, "before_commit", commit_fail)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", fail)
    )
    sa.event.listen(target, event, handler)
    key = uuid4()
    try:
        failed = command(client, saved, "check-in", key)
        assert failed.status_code >= 500
    finally:
        sa.event.remove(target, event, handler)
    assert state(service) == before
    assert command(client, saved, "check-in", key).status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"expected_version": True},
        {"expected_version": "1"},
        {"expected_version": 1, "status": "checked_in"},
    ],
)
def test_strict_lifecycle_input(lifecycle_api, body):
    client, service, saved, _ids, _ = lifecycle_api
    before = state(service)
    result = client.post(
        f"/api/v1/reservations/{saved['id']}/check-in",
        json=body,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert result.status_code == 422 and state(service) == before
