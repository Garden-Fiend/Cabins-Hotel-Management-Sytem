from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from test_reservation_patch import patch_api as reservation_fixture
from test_reservation_patch import raw_state

from app.models import categories

patch_api = reservation_fixture
pytestmark = pytest.mark.postgres


def key():
    return {"Idempotency-Key": str(uuid4())}


def catalog(client):
    refs = client.get("/api/v1/reference-data").json()
    category = next(c for c in refs["inventory_categories"] if c["type"] == "extra")
    assert category["system_defined"] and category["label"] == "Extra Charges"
    product = client.post(
        "/api/v1/configuration/products",
        json={
            "label": "Extra bed",
            "category_id": category["id"],
            "unit_amount_minor": 50025,
            "available_for_sale": False,
        },
        headers=key(),
    )
    assert product.status_code == 201, product.text
    return category, product.json()


def bill(client, saved, charges, headers=None, **fields):
    return client.post(
        f"/api/v1/reservations/{saved['id']}/edit-charges",
        json={
            "expected_version": saved["version"],
            "guest_id": saved["guest"]["id"],
            "charges": charges,
            **fields,
        },
        headers=headers or key(),
    )


def test_protected_identity_and_safe_colliding_names(patch_api):
    client, service, saved, ids, app = patch_api
    extra, product = catalog(client)
    ordinary = client.post(
        "/api/v1/configuration/categories",
        json={"label": "Extra Charges", "type": "ordinary"},
        headers=key(),
    )
    assert ordinary.status_code == 201, ordinary.text
    assert ordinary.json()["id"] != extra["id"] and not ordinary.json()["system_defined"]
    same_name = client.post(
        "/api/v1/configuration/products",
        json={"label": "Extra bed", "category_id": ordinary.json()["id"], "unit_amount_minor": 100},
        headers=key(),
    )
    assert same_name.status_code == 201
    before = raw_state(service)
    assert (
        client.patch(
            f"/api/v1/configuration/categories/{extra['id']}",
            json={"expected_version": extra["version"], "label": "Changed", "enabled": False},
            headers=key(),
        ).status_code
        == 409
    )
    assert raw_state(service) == before
    with service.engine.connect() as c:
        with pytest.raises(sa.exc.IntegrityError), c.begin_nested():
            c.execute(
                categories.update().where(categories.c.id == extra["id"]).values(enabled=False)
            )
    renamed = client.patch(
        f"/api/v1/configuration/categories/{extra['id']}",
        json={"expected_version": extra["version"], "label": "Operational extras", "type": "extra"},
        headers=key(),
    )
    assert (
        renamed.status_code == 200
        and renamed.json()["id"] == extra["id"]
        and renamed.json()["system_defined"]
    )
    charge = dict(id=str(uuid4()), product_id=product["id"], quantity=1, usage="purchase")
    assert bill(client, saved, [charge]).status_code == 422
    assert (
        bill(
            client, saved, [dict(charge, product_id=same_name.json()["id"], usage="extra_charge")]
        ).status_code
        == 422
    )


def test_capture_replay_discount_eligibility_quantity_and_removal(patch_api):
    client, service, saved, ids, app = patch_api
    extra, product = catalog(client)
    charge = dict(id=str(uuid4()), product_id=product["id"], quantity=2, usage="extra_charge")
    headers = key()
    result = bill(client, saved, [charge], headers)
    assert result.status_code == 200, result.text
    current = result.json()
    assert current["pricing"]["snapshot"]["total_minor"] == 210050
    assert current["pricing"]["snapshot"]["charges"][0]["usage"] == "extra_charge"
    assert bill(client, saved, [charge], headers).json() == current
    assert (
        bill(client, saved, [dict(charge, quantity=3)], headers).json()["code"]
        == "idempotency_conflict"
    )
    assert bill(client, saved, [charge]).json()["code"] == "version_conflict"
    client.patch(
        f"/api/v1/configuration/products/{product['id']}",
        json={
            "expected_version": 1,
            "label": "New label",
            "category_id": extra["id"],
            "unit_amount_minor": 99999,
            "available_for_sale": False,
        },
        headers=key(),
    )
    before = raw_state(service)
    # Manual room discount includes extras; item targets the exact captured extra line.
    discounts = [
        {
            "id": str(uuid4()),
            "label": "Room courtesy",
            "scope": "room",
            "method": "percentage",
            "value": "10",
            "target_id": str(ids["room"]),
        },
        {
            "id": str(uuid4()),
            "label": "Extra courtesy",
            "scope": "item",
            "method": "fixed",
            "value": "25",
            "target_id": charge["id"],
        },
    ]
    changed = bill(client, current, [dict(charge, quantity=3)], discounts=discounts)
    assert changed.status_code == 200, changed.text
    current = changed.json()
    captured = current["pricing"]["snapshot"]
    assert (
        captured["charges"][0]["unit_amount_minor"] == 50025
        and captured["charges"][0]["label"] == "Extra bed"
    )
    assert captured["total_minor"] == 231567
    assert captured["lines"] == saved["pricing"]["snapshot"]["lines"]
    assert all(
        row in raw_state(service)["pricing_revisions"] for row in before["pricing_revisions"]
    )
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == current
    assert bill(client, current, [dict(charge, usage="purchase")]).status_code == 422
    removed = bill(client, current, [], discounts=[discounts[0]])
    assert (
        removed.status_code == 200 and removed.json()["pricing"]["snapshot"]["total_minor"] == 99000
    )


@pytest.mark.parametrize(
    "stage",
    ["reservations", "pricing_revisions", "operational_audit", "mutation_receipts", "commit"],
)
def test_full_rollback_and_retry(patch_api, stage):
    client, service, saved, ids, app = patch_api
    _, product = catalog(client)
    before = raw_state(service)

    def fail_sql(conn, cursor, statement, params, context, many):
        if stage in statement.lower() and statement.lower().startswith(("insert", "update")):
            raise RuntimeError("Injected extra failure")

    def fail_commit(session):
        raise RuntimeError("Injected extra commit failure")

    target, event, handler = (
        (Session, "before_commit", fail_commit)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", fail_sql)
    )
    sa.event.listen(target, event, handler)
    headers = key()
    charge = dict(id=str(uuid4()), product_id=product["id"], quantity=1, usage="extra_charge")
    try:
        assert bill(client, saved, [charge], headers).status_code >= 500
    finally:
        sa.event.remove(target, event, handler)
    assert raw_state(service) == before
    assert bill(client, saved, [charge], headers).status_code == 200


@pytest.mark.parametrize("replay", [False, True])
def test_competing_versions_and_concurrent_identical_replay(patch_api, replay):
    client, service, saved, ids, app = patch_api
    _, product = catalog(client)
    barrier, headers = Barrier(2), key()
    charge = dict(id=str(uuid4()), product_id=product["id"], quantity=1, usage="extra_charge")

    def submit(index):
        barrier.wait()
        return bill(
            client,
            saved,
            [charge if replay else dict(charge, quantity=index + 1)],
            headers if replay else None,
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(submit, range(2))) == ([200, 200] if replay else [200, 409])
    assert service.get(saved["id"]).version == 2


def test_initial_extra_capture_is_transactional_and_replayable(patch_api):
    client, service, saved, ids, app = patch_api
    _, product = catalog(client)
    charge = dict(id=str(uuid4()), product_id=product["id"], quantity=1, usage="extra_charge")
    body = {
        "guest_id": saved["guest"]["id"],
        "booking_source_id": str(ids["source"]),
        "room_id": str(ids["room"]),
        "duration_id": str(ids["hourly"]),
        "scheduled_start": "2026-12-20T14:00:00+08:00",
        "adults": 1,
        "charges": [charge],
    }
    headers = key()
    created = client.post("/api/v1/reservations", json=body, headers=headers)
    assert created.status_code == 201, created.text
    assert created.json()["pricing"]["snapshot"]["total_minor"] == 160025
    assert created.json()["pricing"]["snapshot"]["charges"][0]["usage"] == "extra_charge"
    assert client.post("/api/v1/reservations", json=body, headers=headers).json() == created.json()
