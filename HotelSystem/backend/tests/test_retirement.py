from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from test_configuration_api import config_api as fixture
from test_configuration_api import state, write

from app.models import audit_events
from app.modules.reservations.schemas import GuestCreate, ReservationCreate

config_api = fixture
pytestmark = pytest.mark.postgres


def retire(client, kind, identity, action, version=1, key=None):
    return client.post(
        f"/api/v1/configuration/{kind}/{identity}/retirement",
        json={"expected_version": version, "action": action},
        headers={"Idempotency-Key": str(key or uuid4())},
    )


def booking(service, ids):
    guest = service.create_guest(GuestCreate(name="Retirement check"), uuid4())
    return dict(
        guest_id=str(guest.id),
        booking_source_id=str(ids["source"]),
        room_id=str(ids["room"]),
        duration_id=str(ids["hourly"]),
        scheduled_start=(datetime.now(UTC) + timedelta(days=2)).isoformat(),
        adults=2,
    )


def test_room_archive_restore_replay_noop_uniqueness_and_status(config_api):
    client, service, ids = config_api
    key = uuid4()
    archived = retire(client, "rooms", ids["room"], "archive", key=key)
    assert archived.status_code == 200, archived.text
    assert retire(client, "rooms", ids["room"], "archive", key=key).json() == archived.json()
    assert retire(client, "rooms", ids["room"], "archive", 2).json()["version"] == 2
    refs = client.get("/api/v1/reference-data").json()
    room = next(r for r in refs["rooms"] if r["id"] == str(ids["room"]))
    assert room["archived"] and not room["enabled"]
    assert room["housekeeping"] == "clean" and room["operational_status"] == "operational"
    assert (
        write(client, "rooms", dict(number="101", room_type_id=str(ids["type"]))).status_code == 409
    )
    assert (
        client.post(
            "/api/v1/reservations",
            json=booking(service, ids),
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 409
    )
    assert retire(client, "rooms", ids["room"], "restore", 2).json()["version"] == 3
    assert retire(client, "rooms", ids["room"], "archive", 1).status_code == 409


def test_type_archive_preserves_associations_and_individual_archives(config_api):
    client, service, ids = config_api
    body = booking(service, ids)
    assert retire(client, "room-types", ids["type"], "archive").status_code == 200
    assert (
        client.post(
            "/api/v1/reservations", json=body, headers={"Idempotency-Key": str(uuid4())}
        ).status_code
        == 422
    )
    assert retire(client, "rooms", ids["room"], "archive").status_code == 200
    assert retire(client, "rooms", ids["room"], "restore", 2).status_code == 409
    assert retire(client, "room-types", ids["type"], "restore", 2).status_code == 200
    refs = client.get("/api/v1/reference-data").json()
    assert refs["rooms"][0]["archived"]
    assert retire(client, "rooms", ids["room"], "restore", 2).status_code == 200
    assert (
        client.post(
            "/api/v1/reservations", json=body, headers={"Idempotency-Key": str(uuid4())}
        ).status_code
        == 201
    )


@pytest.mark.parametrize("kind", ["rooms", "room-types"])
def test_unused_delete_preserves_definition_audit_and_replays(config_api, kind):
    client, service, ids = config_api
    body = (
        dict(number="Unused", room_type_id=str(ids["type"]))
        if kind == "rooms"
        else dict(label="Unused")
    )
    record = write(client, kind, body).json()
    key = uuid4()
    result = retire(client, kind, record["id"], "delete", key=key)
    assert result.status_code == 200, result.text
    assert retire(client, kind, record["id"], "delete", key=key).json() == result.json()
    assert retire(client, kind, record["id"], "delete").status_code == 404
    assert retire(client, kind, uuid4(), "archive").status_code == 404
    assert record["id"] not in [
        r["id"]
        for r in client.get("/api/v1/reference-data").json()[
            "rooms" if kind == "rooms" else "room_types"
        ]
    ]
    with service.engine.connect() as c:
        assert (
            c.scalar(
                sa.select(sa.func.count())
                .select_from(audit_events)
                .where(audit_events.c.company_id == service.context.company_id)
            )
            == 2
        )


def test_used_room_archive_block_then_terminal_history_retained(config_api):
    client, service, ids = config_api
    saved = service.create(ReservationCreate(**booking(service, ids)), uuid4())
    before = state(service)["pricing_revisions"]
    assert retire(client, "rooms", ids["room"], "archive").status_code == 409
    assert retire(client, "rooms", ids["room"], "delete").status_code == 409
    response = client.post(
        f"/api/v1/reservations/{saved.id}/cancel",
        json={"expected_version": 1, "guest_has_vacated": True},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 200, response.text
    assert retire(client, "rooms", ids["room"], "archive").status_code == 200
    assert retire(client, "rooms", ids["room"], "delete", 2).status_code == 409
    assert client.get(f"/api/v1/reservations/{saved.id}").status_code == 200
    assert state(service)["pricing_revisions"] == before


def test_type_delete_dependencies_and_generic_disable(config_api):
    client, service, ids = config_api
    assert retire(client, "room-types", ids["type"], "delete").status_code == 409
    response = write(
        client, "room-types", dict(label="Standard", enabled=False, expected_version=1), ids["type"]
    )
    assert response.status_code == 200, response.text
    # Rooms remain associated and active; eligibility is controlled independently by type.
    assert client.get("/api/v1/reference-data").json()["rooms"][0]["enabled"]


def test_rate_dependency_blocks_empty_type_deletion(config_api):
    client, service, ids = config_api
    type_id = write(client, "room-types", dict(label="Rate only")).json()["id"]
    write(
        client,
        "rates",
        dict(room_type_id=type_id, booking_kind="overnight", unit_amount_minor=10000),
    )
    assert retire(client, "room-types", type_id, "delete").status_code == 409


def test_default_inclusions_block_empty_type_deletion(config_api):
    client, service, ids = config_api
    category = next(
        c
        for c in client.get("/api/v1/reference-data").json()["inventory_categories"]
        if c["type"] == "inclusion"
    )
    product = write(
        client,
        "products",
        dict(
            label="Retained towel",
            category_id=category["id"],
            unit_amount_minor=0,
            available_for_sale=False,
        ),
    ).json()
    response = write(
        client,
        "room-types",
        dict(
            label="Defaults only", default_inclusions=[dict(product_id=product["id"], quantity=2)]
        ),
    )
    assert response.status_code == 201, response.text
    assert retire(client, "room-types", response.json()["id"], "delete").status_code == 409


def test_existing_single_assignment_can_arrive_after_type_retirement(config_api):
    client, service, ids = config_api
    body = booking(service, ids)
    body["scheduled_start"] = (datetime.now(UTC) - timedelta(minutes=10)).isoformat()
    saved = service.create(ReservationCreate(**body), uuid4())
    assert retire(client, "room-types", ids["type"], "archive").status_code == 200
    response = client.post(
        f"/api/v1/reservations/{saved.id}/check-in",
        json={"expected_version": 1},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 200, response.text


def test_foreign_owned_room_is_not_disclosed(config_api, pg_engine, isolated_company):
    from app.context import CommandContext
    from app.errors import DomainError
    from app.modules.configuration.retirement import RetirementIntent, retire_definition
    from app.modules.reservations.services import ReservationService

    client, service, ids = config_api
    foreign = ReservationService(pg_engine, CommandContext(company_id=uuid4()))
    with pytest.raises(DomainError) as failure:
        retire_definition(
            foreign,
            "rooms",
            ids["room"],
            RetirementIntent(expected_version=1, action="delete"),
            uuid4(),
        )
    assert failure.value.status == 404


@pytest.mark.parametrize("stage", ["update", "audit", "receipt", "commit"])
@pytest.mark.parametrize("action", ["archive", "delete"])
def test_retirement_rollback_retry(config_api, monkeypatch, stage, action):
    client, service, ids = config_api
    before = state(service)
    execute = Session.execute

    def fail(self, statement, *args, **kwargs):
        result = execute(self, statement, *args, **kwargs)
        table = getattr(statement, "table", None)
        target = {
            "update": "rooms",
            "audit": "operational_audit",
            "receipt": "mutation_receipts",
        }.get(stage)
        if (
            table is not None
            and table.name == target
            and (
                getattr(statement, "is_update", False)
                or getattr(statement, "is_insert", False)
                or getattr(statement, "is_delete", False)
            )
        ):
            raise RuntimeError("forced retirement rollback")
        return result

    def fail_commit(self):
        raise RuntimeError("forced commit rollback")

    key = uuid4()
    try:
        with monkeypatch.context() as patch:
            if stage == "commit":
                sa.event.listen(Session, "before_commit", fail_commit)
            else:
                patch.setattr(Session, "execute", fail)
            assert retire(client, "rooms", ids["room"], action, key=key).status_code == 500
    finally:
        if stage == "commit":
            sa.event.remove(Session, "before_commit", fail_commit)
    assert state(service) == before
    assert retire(client, "rooms", ids["room"], action, key=key).status_code == 200


@pytest.mark.parametrize("action", ["archive", "delete"])
def test_concurrent_retirement_and_create(config_api, action):
    client, service, ids = config_api
    body = booking(service, ids)
    barrier = Barrier(2)

    def create():
        barrier.wait()
        return client.post(
            "/api/v1/reservations", json=body, headers={"Idempotency-Key": str(uuid4())}
        ).status_code

    def remove():
        barrier.wait()
        return retire(client, "rooms", ids["room"], action).status_code

    with ThreadPoolExecutor(2) as pool:
        first, second = pool.submit(create), pool.submit(remove)
        statuses = first.result(), second.result()
    assert statuses in ((201, 409), (409, 200), (404, 200)), statuses
