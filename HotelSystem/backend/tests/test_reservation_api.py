from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from app.context import get_command_context
from app.db import get_engine
from app.main import create_app
from app.models import (
    allocations,
    audit_events,
    booking_sources,
    durations,
    guests,
    mutation_receipts,
    pricing_revisions,
    rates,
    reservations,
    room_types,
    rooms,
)
from app.modules.reservations.schemas import GuestCreate, ReservationCreate
from app.modules.reservations.services import ReservationService

pytestmark = pytest.mark.postgres


@pytest.fixture
def api(pg_engine, isolated_company):
    context, ids = isolated_company
    application = create_app()
    application.dependency_overrides[get_engine] = lambda: pg_engine
    application.dependency_overrides[get_command_context] = lambda: context
    service = ReservationService(pg_engine, context)
    guest = service.create_guest(GuestCreate(name="API test guest"), uuid4())
    body = dict(
        guest_id=str(guest.id),
        booking_source_id=str(ids["source"]),
        room_id=str(ids["room"]),
        duration_id=str(ids["hourly"]),
        scheduled_start="2026-11-10T14:07:12.123456+08:00",
        adults=2,
        children=0,
    )
    with TestClient(application) as client:
        yield client, service, body, ids


def post(client, body, key=None):
    return client.post(
        "/api/v1/reservations", json=body, headers={"Idempotency-Key": str(key or uuid4())}
    )


def count_owned(engine, context, table):
    with engine.connect() as c:
        return c.scalar(
            sa.select(sa.func.count())
            .select_from(table)
            .where(table.c.company_id == context.company_id)
        )


def test_create_read_list_server_price_and_audit(api):
    client, service, body, _ids = api
    response = post(client, body)
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["version"] == result["pricing"]["reservation_version"] == 1
    assert result["reference"].startswith("HMS-")
    assert result["pricing"]["snapshot"]["total_minor"] == 110000
    assert result["allocation"]["scheduled_start"] == "2026-11-10T06:07:12.123456Z"
    assert result["allocation"]["scheduled_end"] == "2026-11-10T12:07:12.123456Z"
    assert result["audit"][0]["actor"] == "local-development"
    assert result["audit"][0]["reservation_version"] == 1
    assert client.get(f"/api/v1/reservations/{result['id']}").json() == result
    assert client.get("/api/v1/reservations").json() == [result]
    assert client.get("/api/v1/reservations?limit=1&offset=1").json() == []
    for table in (reservations, allocations, pricing_revisions):
        assert count_owned(service.engine, service.context, table) == 1
    # Guest creation is an independent audited/idempotent command.
    assert count_owned(service.engine, service.context, mutation_receipts) == 2
    assert count_owned(service.engine, service.context, audit_events) == 2
    assert client.patch(f"/api/v1/reservations/{result['id']}", json={}).status_code == 422


def test_nightly_price_uses_configured_nights_and_hotel_checkout(api):
    client, _service, body, ids = api
    body.update(duration_id=str(ids["two-nights"]), scheduled_start="2026-12-31T23:07:00+08:00")
    result = post(client, body)
    assert result.status_code == 201, result.text
    data = result.json()
    assert data["allocation"]["scheduled_end"] == "2027-01-02T04:00:00Z"
    snapshot = data["pricing"]["snapshot"]
    assert snapshot["total_minor"] == 440000
    assert snapshot["lines"][0]["quantity"] == 2
    assert snapshot["lines"][0]["unit_amount_minor"] == 220000
    assert snapshot["tax_status"] == "not_configured"


def test_receipt_replays_across_service_restart_and_conflicts_on_different_body(api):
    client, service, body, _ids = api
    key = uuid4()
    first = post(client, body, key)
    second = post(client, body, key)
    assert second.status_code == first.status_code == 201
    assert first.json() == second.json()
    fresh_service = ReservationService(service.engine, service.context)
    assert (
        fresh_service.create(ReservationCreate(**body), key).model_dump(mode="json") == first.json()
    )
    changed = post(client, dict(body, note="Different request"), key)
    assert changed.status_code == 409
    assert changed.json()["code"] == "idempotency_conflict"
    assert count_owned(service.engine, service.context, reservations) == 1


def test_retry_canonicalizes_equivalent_offsets_and_defaults(api):
    client, _service, body, _ids = api
    key = uuid4()
    first = post(client, body, key)
    retry = dict(body, scheduled_start="2026-11-10T06:07:12.123456Z", note="")
    assert post(client, retry, key).json() == first.json()


@pytest.mark.parametrize("field", ["price", "total_minor", "status", "company_id", "audit"])
def test_forged_authority_never_writes(api, field):
    client, service, body, _ids = api
    response = post(client, dict(body, **{field: 1}))
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"
    assert count_owned(service.engine, service.context, reservations) == 0


def test_required_key_missing_guest_and_cross_company_reads(api):
    client, service, body, _ids = api
    assert client.post("/api/v1/reservations", json=body).status_code == 422
    assert post(client, dict(body, guest_id=str(uuid4()))).status_code == 404
    assert client.get(f"/api/v1/reservations/{uuid4()}").status_code == 404
    assert count_owned(service.engine, service.context, reservations) == 0
    # Seeded references belong to another company and must not be selectable here.
    from app.seed import seed_id

    assert post(client, dict(body, room_id=str(seed_id("room-101")))).status_code == 404


def test_reference_and_guest_reads_are_company_scoped(api):
    client, service, body, ids = api
    response = client.get("/api/v1/reference-data")
    assert response.status_code == 200, response.text
    refs = response.json()
    assert refs["company"]["id"] == str(service.context.company_id)
    assert refs["rooms"][0]["id"] == str(ids["room"])
    assert len(refs["durations"]) == 3
    assert len(client.get("/api/v1/guests").json()) == 1
    assert client.get("/api/v1/guests?search=absent").json() == []
    assert client.get("/api/v1/guests?search=%25").json() == []
    assert client.get("/api/v1/reservations?limit=101").status_code == 422


@pytest.mark.parametrize(
    "table,column",
    [
        (rooms, "enabled"),
        (rooms, "operational"),
        (room_types, "enabled"),
        (durations, "enabled"),
        (booking_sources, "enabled"),
        (rates, "enabled"),
    ],
)
def test_inactive_reference_or_room_blocks_create(api, table, column):
    client, service, body, ids = api
    id = {
        rooms: ids["room"],
        room_types: ids["type"],
        durations: ids["hourly"],
        booking_sources: ids["source"],
        rates: ids["hourly-rate"],
    }[table]
    with service.engine.begin() as c:
        values = {column: False}
        if table is rooms and column == "operational":
            values["operational_status"] = "maintenance"
        c.execute(table.update().where(table.c.id == id).values(**values))
    assert post(client, body).status_code in (409, 422)
    assert count_owned(service.engine, service.context, reservations) == 0


def test_touching_intervals_allowed_and_overlap_rejected(api):
    client, service, body, _ids = api
    assert post(client, body).status_code == 201
    conflict = post(client, dict(body, scheduled_start="2026-11-10T15:00:00+08:00"))
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "room_conflict"
    assert (
        post(client, dict(body, scheduled_start="2026-11-10T20:07:12.123456+08:00")).status_code
        == 201
    )
    assert count_owned(service.engine, service.context, reservations) == 2


def test_historical_price_survives_configuration_changes(api):
    client, service, body, ids = api
    original = post(client, body).json()
    with service.engine.begin() as c:
        c.execute(
            rates.update().where(rates.c.id == ids["hourly-rate"]).values(unit_amount_minor=999999)
        )
        c.execute(room_types.update().where(room_types.c.id == ids["type"]).values(label="Renamed"))
        c.execute(rooms.update().where(rooms.c.id == ids["room"]).values(number="New number"))
    assert client.get(f"/api/v1/reservations/{original['id']}").json() == original


def test_overdue_physical_lock_blocks_future_booking(api):
    client, service, body, ids = api
    first = post(client, body).json()
    with service.engine.begin() as c:
        c.execute(
            rooms.update()
            .where(rooms.c.id == ids["room"])
            .values(current_occupancy_allocation_id=first["allocation"]["id"])
        )
    response = post(client, dict(body, scheduled_start="2027-01-01T14:00:00+08:00"))
    assert response.status_code == 409
    assert response.json()["code"] == "room_occupied"
    assert count_owned(service.engine, service.context, reservations) == 1


@pytest.mark.parametrize("same_key", [True, False])
def test_concurrent_command_requests_are_safe(api, same_key):
    client, service, body, _ids = api
    barrier = Barrier(2)
    keys = [uuid4(), uuid4()]
    if same_key:
        keys[1] = keys[0]

    def worker(key):
        barrier.wait(timeout=5)
        response = post(client, body, key)
        if response.status_code == 409:
            assert response.json()["code"] == "room_conflict"
            return "conflict"
        assert response.status_code == 201, response.text
        return response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(worker, keys))
    if same_key:
        assert results[0] == results[1]
    else:
        assert sum(result == "conflict" for result in results) == 1
    assert count_owned(service.engine, service.context, reservations) == 1
    assert count_owned(service.engine, service.context, allocations) == 1
    assert count_owned(service.engine, service.context, pricing_revisions) == 1
    assert count_owned(service.engine, service.context, mutation_receipts) == 2


@pytest.mark.parametrize(
    "failed_table",
    [
        "reservations",
        "room_allocations",
        "pricing_revisions",
        "operational_audit",
        "mutation_receipts",
    ],
)
def test_failure_after_each_insert_rolls_back_entire_booking_and_allows_retry(api, failed_table):
    _client, service, body, _ids = api
    key = uuid4()
    baseline_audits = count_owned(service.engine, service.context, audit_events)
    baseline_receipts = count_owned(service.engine, service.context, mutation_receipts)

    def fail_after_insert(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.startswith(f"INSERT INTO hms.{failed_table}"):
            raise RuntimeError("Synthetic failure after actual PostgreSQL insert")

    sa.event.listen(service.engine, "after_cursor_execute", fail_after_insert)
    try:
        with pytest.raises(RuntimeError, match="Synthetic failure"):
            service.create(ReservationCreate(**body), key)
    finally:
        sa.event.remove(service.engine, "after_cursor_execute", fail_after_insert)
    for table in (reservations, allocations, pricing_revisions):
        assert count_owned(service.engine, service.context, table) == 0
    assert count_owned(service.engine, service.context, audit_events) == baseline_audits
    assert count_owned(service.engine, service.context, mutation_receipts) == baseline_receipts
    assert count_owned(service.engine, service.context, guests) == 1  # Independent guest retained.
    assert service.create(ReservationCreate(**body), key).version == 1


def test_guest_creation_is_independent_idempotent_and_audited(api):
    client, service, _body, _ids = api
    key = str(uuid4())
    payload = dict(name="  Independent guest  ", phone=" 123 ")
    first = client.post("/api/v1/guests", json=payload, headers={"Idempotency-Key": key})
    retry = client.post("/api/v1/guests", json=payload, headers={"Idempotency-Key": key})
    assert first.status_code == retry.status_code == 201
    assert first.json() == retry.json()
    assert first.json()["name"] == "Independent guest"
    assert first.json()["phone"] == "123"
    conflict = client.post(
        "/api/v1/guests", json={"name": "Changed"}, headers={"Idempotency-Key": key}
    )
    assert conflict.status_code == 409
    assert count_owned(service.engine, service.context, guests) == 2
    assert count_owned(service.engine, service.context, reservations) == 0


def test_database_failure_is_redacted_and_has_explicit_error_code(api):
    from sqlalchemy.exc import OperationalError

    client, service, _body, _ids = api

    def unavailable(_connection, _cursor, _statement, _parameters, _context, _many):
        raise OperationalError("private SQL", {}, Exception("private-password"))

    sa.event.listen(service.engine, "before_cursor_execute", unavailable)
    try:
        response = client.get("/api/v1/reservations")
    finally:
        sa.event.remove(service.engine, "before_cursor_execute", unavailable)
    assert response.status_code == 503
    assert response.json()["code"] == "database_unavailable"
    assert "private" not in response.text


def test_zero_rate_is_valid_and_dirty_is_not_physical_occupancy(api):
    client, service, body, ids = api
    with service.engine.begin() as c:
        c.execute(
            rates.update().where(rates.c.id == ids["hourly-rate"]).values(unit_amount_minor=0)
        )
        c.execute(rooms.update().where(rooms.c.id == ids["room"]).values(housekeeping="dirty"))
    response = post(client, body)
    assert response.status_code == 201
    assert response.json()["pricing"]["snapshot"]["total_minor"] == 0
    # This creates a confirmed scheduled booking, not a check-in or cleaning transition.
    assert response.json()["allocation"]["actual_check_in"] is None
    assert response.json()["status"] == "confirmed"
