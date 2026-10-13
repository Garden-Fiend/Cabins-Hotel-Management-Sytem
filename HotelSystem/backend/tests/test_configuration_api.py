from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.context import get_command_context
from app.db import get_engine
from app.main import create_app
from app.models import (
    audit_events,
    categories,
    companies,
    durations,
    mutation_receipts,
    pricing_revisions,
    products,
    rates,
    room_types,
    rooms,
)
from app.modules.reservations.schemas import GuestCreate, ReservationCreate
from app.modules.reservations.services import ReservationService

pytestmark = pytest.mark.postgres


@pytest.fixture
def config_api(pg_engine, isolated_company):
    context, ids = isolated_company
    app = create_app()
    app.dependency_overrides[get_engine] = lambda: pg_engine
    app.dependency_overrides[get_command_context] = lambda: context
    service = ReservationService(pg_engine, context)
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, service, ids


def write(client, kind, body, id=None, key=None):
    path = f"/api/v1/configuration/{kind}" + (f"/{id}" if id else "")
    return client.request(
        "PATCH" if id else "POST", path, json=body, headers={"Idempotency-Key": str(key or uuid4())}
    )


def test_room_status_choices_persist_without_changing_readiness_or_identity(config_api):
    client, service, ids = config_api
    key = uuid4()
    body = dict(number="303", room_type_id=str(ids["type"]), operational_status="housekeeping")
    created = write(client, "rooms", body, key=key)
    assert created.status_code == 201, created.text
    room = created.json()
    assert room["operational_status"] == "housekeeping" and room["operational"] is False
    assert room["housekeeping"] == "clean"
    assert write(client, "rooms", body, key=key).json() == room
    assert (
        write(client, "rooms", dict(body, operational_status="maintenance"), key=key).status_code
        == 409
    )
    for status in ("maintenance", "operational"):
        result = write(
            client,
            "rooms",
            dict(body, operational_status=status, expected_version=room["version"]),
            room["id"],
        )
        assert result.status_code == 200, result.text
        updated = result.json()
        assert updated["id"] == room["id"] and updated["version"] == room["version"] + 1
        assert updated["operational_status"] == status
        assert updated["operational"] == (status == "operational")
        assert updated["housekeeping"] == "clean"
        room = updated
    with service.engine.connect() as c:
        with pytest.raises(sa.exc.IntegrityError), c.begin_nested():
            c.execute(
                rooms.update().where(rooms.c.id == room["id"]).values(operational_status="invented")
            )
        with pytest.raises(sa.exc.IntegrityError), c.begin_nested():
            c.execute(
                rooms.update()
                .where(rooms.c.id == room["id"])
                .values(operational_status="maintenance", operational=True)
            )


@pytest.mark.parametrize(
    "fields",
    [
        dict(operational_status="bad"),
        dict(operational_status=None),
        dict(operational_status="maintenance", operational=True),
    ],
)
def test_invalid_room_status_leaves_state_unchanged(config_api, fields):
    client, service, ids = config_api
    before = state(service)
    assert (
        write(
            client, "rooms", dict(number="303", room_type_id=str(ids["type"]), **fields)
        ).status_code
        == 422
    )
    assert state(service) == before


def test_legacy_room_request_hash_and_receipt_replay_remain_compatible(config_api):
    import hashlib
    import json

    from app.modules.configuration.schemas import RoomWrite

    client, service, ids = config_api
    key, body = uuid4(), dict(number="303", room_type_id=str(ids["type"]), operational=False)
    created = write(client, "rooms", body, key=key)
    assert created.status_code == 201
    assert created.json()["operational_status"] == "unavailable"
    payload = RoomWrite(**body).model_dump(mode="json", exclude={"operational_status"})
    old_hash = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    with service.engine.begin() as c:
        receipt = (
            c.execute(sa.select(mutation_receipts).where(mutation_receipts.c.request_key == key))
            .mappings()
            .one()
        )
        assert receipt["request_hash"] == old_hash
        legacy = dict(receipt["response"])
        legacy.pop("operational_status")
        c.execute(
            mutation_receipts.update()
            .where(mutation_receipts.c.id == receipt["id"])
            .values(response=legacy)
        )
    assert write(client, "rooms", body, key=key).json() == created.json()


def test_catalog_definitions_owned_versioned_replayable_and_exact(config_api):
    client, service, _ids = config_api
    category = write(client, "categories", dict(label="Supplies", type="ordinary")).json()
    key = uuid4()
    body = dict(label="Mineral water", category_id=category["id"], unit_amount_minor=12525)
    product = write(client, "products", body, key=key)
    assert product.status_code == 201, product.text
    assert product.json()["unit_amount_minor"] == 12525 and product.json()["version"] == 1
    assert write(client, "products", body, key=key).json() == product.json()
    assert write(client, "products", dict(body, unit_amount_minor=99), key=key).status_code == 409
    saved = product.json()
    updated = write(
        client, "products", dict(body, unit_amount_minor=15025, expected_version=1), saved["id"]
    )
    assert updated.status_code == 200 and updated.json()["version"] == 2
    assert write(client, "products", dict(body, expected_version=1), saved["id"]).status_code == 409
    refs = client.get("/api/v1/reference-data").json()
    assert refs["catalog_products"] == [updated.json()]
    assert refs["inventory_categories"] == [category]
    assert write(client, "products", dict(body, label="MINERAL WATER")).status_code == 409
    assert write(client, "products", dict(body, category_id=str(uuid4()))).status_code == 404
    assert (
        write(
            client,
            "categories",
            dict(label="Supplies", type="amenities", expected_version=1),
            category["id"],
        ).status_code
        == 409
    )
    with service.engine.connect() as c:
        assert (
            c.scalar(
                sa.select(sa.func.count())
                .select_from(products)
                .where(products.c.company_id == service.context.company_id)
            )
            == 1
        )


def test_catalog_amenities_and_strict_money_validation(config_api):
    client, _service, _ids = config_api
    category = write(client, "categories", dict(label="Room amenities", type="amenities")).json()
    body = dict(
        label="Towel", category_id=category["id"], unit_amount_minor=0, available_for_sale=False
    )
    assert write(client, "products", body).status_code == 201
    for overrides in (
        dict(unit_amount_minor=100),
        dict(available_for_sale=True),
        dict(unit_amount_minor=1.5),
        dict(unit_amount_minor=True),
        dict(unit_amount_minor="100"),
    ):
        assert (
            write(client, "products", dict(body, label=str(uuid4()), **overrides)).status_code
            == 422
        )


@pytest.mark.parametrize("target", ["catalog_products", "operational_audit", "mutation_receipts"])
def test_product_save_failure_rolls_back_and_same_key_retries(config_api, target):
    client, service, _ids = config_api
    category = write(client, "categories", dict(label="Supplies")).json()
    key, body = uuid4(), dict(label="Water", category_id=category["id"], unit_amount_minor=100)

    def fail(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lower().startswith(f"insert into hms.{target}"):
            raise RuntimeError("Synthetic catalog failure")

    sa.event.listen(service.engine, "after_cursor_execute", fail)
    try:
        assert write(client, "products", body, key=key).status_code == 500
    finally:
        sa.event.remove(service.engine, "after_cursor_execute", fail)
    assert client.get("/api/v1/reference-data").json()["catalog_products"] == []
    assert write(client, "products", body, key=key).status_code == 201


def test_catalog_company_ownership_is_enforced_by_postgresql(config_api):
    client, service, _ids = config_api
    category = write(client, "categories", dict(label="Owned category")).json()
    other = uuid4()
    with service.engine.connect() as c:
        transaction = c.begin()
        try:
            c.execute(
                companies.insert().values(
                    id=other,
                    name="Synthetic second scope",
                    currency="PHP",
                    hotel_timezone="Asia/Manila",
                )
            )
            with pytest.raises(sa.exc.IntegrityError) as error, c.begin_nested():
                c.execute(
                    products.insert().values(
                        id=uuid4(),
                        company_id=other,
                        source_id="synthetic",
                        label="Wrong company",
                        category_id=category["id"],
                        unit_amount_minor=100,
                    )
                )
            assert error.value.orig.sqlstate == "23503"
        finally:
            transaction.rollback()


def state(service):
    with service.engine.connect() as c:
        return {
            t.name: [
                dict(row)
                for row in c.execute(
                    sa.select(t)
                    .where(t.c.company_id == service.context.company_id)
                    .order_by(t.c.id)
                ).mappings()
            ]
            for t in (
                categories,
                products,
                room_types,
                rooms,
                durations,
                rates,
                pricing_revisions,
                audit_events,
                mutation_receipts,
            )
        }


def test_create_edit_and_reference_reads(config_api):
    client, service, _ids = config_api
    rt = write(
        client, "room-types", {"label": "Deluxe", "default_capacity": 3, "amenities": ["wifi"]}
    )
    assert rt.status_code == 201, rt.text
    type_id = rt.json()["id"]
    room = write(
        client,
        "rooms",
        {"number": "201", "room_type_id": type_id, "description": "Quiet", "capacity_override": 4},
    )
    assert room.status_code == 201, room.text
    room_id = room.json()["id"]
    assert room.json()["display_name"] == "Deluxe" and room.json()["version"] == 1
    cleared = write(
        client,
        "rooms",
        {
            "expected_version": 1,
            "number": "201",
            "room_type_id": type_id,
            "capacity_override": None,
            "description": "  ",
        },
        room_id,
    )
    assert cleared.status_code == 200 and cleared.json()["description"] == ""
    assert cleared.json()["capacity_override"] is None and cleared.json()["version"] == 2
    duration = write(client, "durations", {"label": "3 hours", "kind": "hourly", "minutes": 180})
    assert duration.status_code == 201, duration.text
    rate = write(
        client,
        "rates",
        {
            "room_type_id": type_id,
            "booking_kind": "hourly",
            "duration_id": duration.json()["id"],
            "unit_amount_minor": 123456,
        },
    )
    assert rate.status_code == 201, rate.text
    refs = client.get("/api/v1/reference-data").json()
    assert next(r for r in refs["rooms"] if r["id"] == room_id) == cleared.json()
    assert (
        next(r for r in refs["rates"] if r["id"] == rate.json()["id"])["unit_amount_minor"]
        == 123456
    )
    assert all(r["actor"] == "local-development" for r in state(service)["operational_audit"])


def test_reference_edits_preserve_captured_rates_and_schedule(config_api):
    client, service, ids = config_api
    guest = service.create_guest(GuestCreate(name="Capture test"), uuid4())
    saved = service.create(
        ReservationCreate(
            guest_id=guest.id,
            booking_source_id=ids["source"],
            room_id=ids["room"],
            duration_id=ids["hourly"],
            scheduled_start="2026-11-10T14:07:12.123456+08:00",
            adults=2,
        ),
        uuid4(),
    )
    before = state(service)["pricing_revisions"]
    rate = write(
        client,
        "rates",
        {
            "expected_version": 1,
            "room_type_id": str(ids["type"]),
            "booking_kind": "hourly",
            "duration_id": str(ids["hourly"]),
            "unit_amount_minor": 987654,
        },
        ids["hourly-rate"],
    )
    assert rate.status_code == 200, rate.text
    duration = write(
        client,
        "durations",
        {"expected_version": 1, "label": "Retimed package", "kind": "hourly", "minutes": 480},
        ids["hourly"],
    )
    assert duration.status_code == 200, duration.text
    assert service.get(saved.id).pricing == saved.pricing
    assert service.get(saved.id).allocation == saved.allocation
    assert state(service)["pricing_revisions"] == before
    renamed = write(
        client,
        "rooms",
        {"expected_version": 1, "number": "999", "room_type_id": str(ids["type"])},
        ids["room"],
    )
    assert renamed.status_code == 409 and renamed.json()["code"] == "assigned_room_number"
    disabled = write(
        client,
        "rooms",
        {
            "expected_version": 1,
            "number": "101",
            "room_type_id": str(ids["type"]),
            "enabled": False,
        },
        ids["room"],
    )
    assert disabled.status_code == 409 and disabled.json()["code"] == "active_assignment"


def test_replay_conflicts_versions_and_owned_references(config_api):
    client, service, ids = config_api
    body = {"expected_version": 1, "label": "Renamed standard", "default_capacity": 2}
    key = uuid4()
    updated = write(client, "room-types", body, ids["type"], key)
    assert updated.status_code == 200, updated.text
    before = state(service)
    assert write(client, "room-types", body, ids["type"], key).json() == updated.json()
    assert (
        write(client, "room-types", {**body, "label": "Other"}, ids["type"], key).json()["code"]
        == "idempotency_conflict"
    )
    assert write(client, "room-types", body, ids["type"]).json()["code"] == "version_conflict"
    assert (
        write(client, "rooms", {"number": "202", "room_type_id": str(uuid4())}).status_code == 404
    )
    assert state(service) == before


@pytest.mark.parametrize(
    "kind,body",
    [
        ("room-types", {"label": ""}),
        ("room-types", {"label": "Bad", "default_capacity": True}),
        ("rooms", {"number": "202", "room_type_id": str(uuid4()), "capacity_override": 1.5}),
        (
            "rooms",
            {
                "number": "202",
                "room_type_id": str(uuid4()),
                "current_occupancy_allocation_id": str(uuid4()),
            },
        ),
        ("durations", {"label": "Bad", "kind": "hourly", "minutes": 0}),
        ("durations", {"label": "Bad", "kind": "overnight", "nights": 2, "minutes": 60}),
        (
            "rates",
            {"room_type_id": str(uuid4()), "booking_kind": "hourly", "unit_amount_minor": 100},
        ),
        (
            "rates",
            {"room_type_id": str(uuid4()), "booking_kind": "overnight", "unit_amount_minor": 10.5},
        ),
        (
            "rates",
            {
                "room_type_id": str(uuid4()),
                "booking_kind": "overnight",
                "unit_amount_minor": 100,
                "currency": "USD",
            },
        ),
        ("room-types", {"label": "Bad", "company_id": str(uuid4())}),
    ],
)
def test_invalid_inputs_write_nothing(config_api, kind, body):
    client, service, _ids = config_api
    before = state(service)
    assert write(client, kind, body).status_code == 422
    assert state(service) == before


def test_duplicate_definitions_and_incompatible_rate_kind(config_api):
    client, _service, ids = config_api
    assert (
        write(client, "rooms", {"number": "101", "room_type_id": str(ids["type"])}).status_code
        == 409
    )
    assert write(client, "room-types", {"label": "standard"}).status_code == 409
    result = write(
        client,
        "rates",
        {
            "room_type_id": str(ids["type"]),
            "booking_kind": "hourly",
            "duration_id": str(ids["hourly"]),
            "unit_amount_minor": 1,
        },
    )
    assert result.status_code == 409
    result = write(
        client,
        "durations",
        {"expected_version": 1, "label": "Changed kind", "kind": "overnight", "nights": 1},
        ids["hourly"],
    )
    assert result.status_code == 409 and result.json()["code"] == "reference_in_use"


def test_concurrent_unique_label_and_version_updates(config_api):
    client, _service, ids = config_api
    barrier = Barrier(2)

    def create(_):
        barrier.wait()
        return write(client, "room-types", {"label": "Shared new type"}).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(create, range(2))) == [201, 409]
    barrier = Barrier(2)

    def edit(index):
        barrier.wait()
        return write(
            client,
            "durations",
            {"expected_version": 1, "label": f"Edit {index}", "kind": "hourly", "minutes": 360},
            ids["hourly"],
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(edit, range(2))) == [200, 409]


@pytest.mark.parametrize(
    "stage", ["room_types", "operational_audit", "mutation_receipts", "commit"]
)
def test_reference_transaction_failure_and_retry(config_api, stage):
    client, service, _ids = config_api
    before = state(service)

    def sql_fail(conn, cursor, statement, params, context, many):
        if stage in statement.lower() and statement.lower().startswith(("insert", "update")):
            raise RuntimeError("Injected configuration failure")

    def commit_fail(session):
        raise RuntimeError("Injected configuration commit failure")

    target, event, handler = (
        (Session, "before_commit", commit_fail)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", sql_fail)
    )
    sa.event.listen(target, event, handler)
    key = uuid4()
    try:
        assert write(client, "room-types", {"label": "Retryable"}, key=key).status_code >= 500
    finally:
        sa.event.remove(target, event, handler)
    assert state(service) == before
    assert write(client, "room-types", {"label": "Retryable"}, key=key).status_code == 201
