import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from test_reservation_api import api as reservation_fixture
from test_reservation_patch import raw_state

from app.modules.reservations.schemas import ReservationCreate
from app.mutations import request_hash

pytestmark = pytest.mark.postgres
api = reservation_fixture


def header(key=None):
    return {"Idempotency-Key": str(key or uuid4())}


def financial_body(client, body):
    def write(path, value):
        response = client.post(f"/api/v1/configuration/{path}", json=value, headers=header())
        assert response.status_code == 201, response.text
        return response.json()

    ordinary = write("categories", dict(label="Meals", type="ordinary"))
    extra = next(
        c
        for c in client.get("/api/v1/reference-data").json()["inventory_categories"]
        if c["type"] == "extra"
    )
    meal = write(
        "products",
        dict(
            label="Meal",
            category_id=ordinary["id"],
            unit_amount_minor=10000,
            available_for_sale=True,
        ),
    )
    bed = write(
        "products",
        dict(
            label="Extra bed",
            category_id=extra["id"],
            unit_amount_minor=5000,
            available_for_sale=False,
        ),
    )
    return body | dict(
        charges=[
            dict(id=str(uuid4()), product_id=meal["id"], usage="purchase", quantity=2),
            dict(id=str(uuid4()), product_id=bed["id"], usage="extra_charge", quantity=1),
        ],
        adjustments=[
            dict(id=str(uuid4()), amount_minor=1000, reason="Late service"),
            dict(id=str(uuid4()), amount_minor=-500, reason="Courtesy"),
        ],
        discounts=[
            dict(
                id=str(uuid4()),
                label="Ten percent",
                scope="reservation",
                method="percentage",
                value="10",
                target_id="",
                currency="PHP",
            )
        ],
    )


def test_mixed_initial_capture_read_replay_and_history(api):
    client, service, body, _ids = api
    body = financial_body(client, body)
    key = header()
    response = client.post("/api/v1/reservations", json=body, headers=key)
    assert response.status_code == 201, response.text
    saved = response.json()
    capture = saved["pricing"]["snapshot"]
    assert saved["version"] == saved["pricing"]["revision"] == 1
    assert capture["total_minor"] == 122000
    assert capture["discount_total_minor"] == 13500
    assert [c["usage"] for c in capture["charges"]] == ["purchase", "extra_charge"]
    assert capture["adjustments"] == body["adjustments"]
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == saved
    before = raw_state(service)
    assert client.post("/api/v1/reservations", json=body, headers=key).json() == saved
    changed = body | {"adjustments": [body["adjustments"][0] | {"amount_minor": 1001}]}
    assert client.post("/api/v1/reservations", json=changed, headers=key).status_code == 409
    assert raw_state(service) == before
    event = next(e for e in before["operational_audit"] if e["event_type"] == "reservation.created")
    assert event["after"]["pricing"] == capture


@pytest.mark.parametrize("amount,total", [(1000, 111000), (-1000, 109000), (-200000, 0)])
def test_signed_adjustment_and_zero_clamp(api, amount, total):
    client, _service, body, _ids = api
    body["adjustments"] = [dict(id=str(uuid4()), amount_minor=amount, reason="Initial correction")]
    result = client.post("/api/v1/reservations", json=body, headers=header())
    assert result.status_code == 201, result.text
    assert result.json()["pricing"]["snapshot"]["total_minor"] == total


@pytest.mark.parametrize(
    "bad",
    [
        None,
        [{"id": str(uuid4()), "amount_minor": 0, "reason": "Zero"}],
        [{"id": str(uuid4()), "amount_minor": True, "reason": "Bool"}],
        [{"id": str(uuid4()), "amount_minor": 1.5, "reason": "Fraction"}],
        [{"id": str(uuid4()), "amount_minor": 100, "reason": " "}],
        [{"id": str(uuid4()), "amount_minor": 100, "reason": "Forged", "actor": "staff"}],
    ],
)
def test_invalid_adjustments_reject_without_writes(api, bad):
    client, service, body, _ids = api
    before = raw_state(service)
    assert (
        client.post(
            "/api/v1/reservations", json=body | {"adjustments": bad}, headers=header()
        ).status_code
        == 422
    )
    assert raw_state(service) == before


def test_duplicate_identity_and_client_price_reject(api):
    client, service, body, _ids = api
    body = financial_body(client, body)
    before = raw_state(service)
    duplicate = body | {"adjustments": [body["adjustments"][0]] * 2}
    assert client.post("/api/v1/reservations", json=duplicate, headers=header()).status_code == 422
    body["charges"][0]["unit_amount_minor"] = 1
    assert client.post("/api/v1/reservations", json=body, headers=header()).status_code == 422
    assert raw_state(service) == before


@pytest.mark.parametrize(
    "stage",
    [
        "reservations",
        "room_allocations",
        "pricing_revisions",
        "operational_audit",
        "mutation_receipts",
        "commit",
    ],
)
def test_complete_create_rollback_and_original_key_retry(api, stage):
    client, service, body, _ids = api
    body = financial_body(client, body)
    before, key = raw_state(service), header()

    def sql_fail(conn, cursor, statement, params, context, many):
        if statement.startswith(f"INSERT INTO hms.{stage}"):
            raise RuntimeError("B1 injected failure")

    def commit_fail(session):
        raise RuntimeError("B1 injected commit failure")

    target, name, handler = (
        (Session, "before_commit", commit_fail)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", sql_fail)
    )
    sa.event.listen(target, name, handler)
    try:
        with pytest.raises(RuntimeError, match="B1 injected"):
            client.post("/api/v1/reservations", json=body, headers=key)
    finally:
        sa.event.remove(target, name, handler)
    assert raw_state(service) == before
    retry = client.post("/api/v1/reservations", json=body, headers=key)
    assert retry.status_code == 201, retry.text
    assert retry.json()["pricing"]["snapshot"]["total_minor"] == 122000


def test_concurrent_duplicate_create_one_capture(api):
    client, service, body, _ids = api
    body = financial_body(client, body)
    barrier, key = Barrier(2), header()

    def worker(_):
        barrier.wait(timeout=5)
        return client.post("/api/v1/reservations", json=body, headers=key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(worker, range(2)))
    assert all(r.status_code == 201 for r in responses)
    assert responses[0].json() == responses[1].json()
    state = raw_state(service)
    assert len(state["reservations"]) == len(state["pricing_revisions"]) == 1


def test_omitted_adjustments_keep_old_create_hash(api):
    _client, _service, body, _ids = api
    request = ReservationCreate(**body)
    old = request.model_dump(
        mode="json",
        exclude={
            "adjustments",
            "charges",
            "discounts",
            "inclusions",
            "breakfast",
            "booking_financials",
            "collections",
            "guest_obligation",
        },
    )
    expected = hashlib.sha256(
        json.dumps(old, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    assert request_hash(request) == expected
    assert request_hash(ReservationCreate(**body, adjustments=[])) != expected


def test_nightly_all_initial_components_share_one_capture(api):
    from test_breakfast import selection
    from test_discount_presets import preset, selected

    client, service, body, ids = api
    body = financial_body(client, body)
    # Different category name from the existing meal setup.
    category = client.post(
        "/api/v1/configuration/categories",
        json=dict(label="Breakfast products", type="ordinary"),
        headers=header(),
    ).json()
    recipes = []
    for label in ("Recipe meal", "Recipe drink"):
        recipes.append(
            client.post(
                "/api/v1/configuration/products",
                json=dict(label=label, category_id=category["id"], unit_amount_minor=100),
                headers=header(),
            ).json()
        )
    refs = client.get("/api/v1/reference-data").json()
    eligibility = client.post(
        "/api/v1/configuration/breakfast",
        json=dict(
            expected_version=refs["company"]["breakfast_version"],
            items=[
                dict(product_id=p["id"], kind=kind, enabled=True)
                for p, kind in zip(recipes, ("meal", "beverage"), strict=True)
            ],
        ),
        headers=header(),
    )
    assert eligibility.status_code == 200, eligibility.text
    inclusion_category = next(c for c in refs["inventory_categories"] if c["type"] == "inclusion")
    inclusion = client.post(
        "/api/v1/configuration/products",
        json=dict(
            label="Included towel",
            category_id=inclusion_category["id"],
            unit_amount_minor=100,
            available_for_sale=False,
        ),
        headers=header(),
    ).json()
    nightly = next(r for r in refs["rates"] if r["booking_kind"] == "overnight")
    offer = preset(
        client,
        label="Night offer",
        scope="room",
        method="final_price",
        value="0",
        target_room_type_id=refs["room_types"][0]["id"],
        rate_prices=[dict(rate_id=nightly["id"], unit_amount_minor=200000)],
    )
    body.update(
        duration_id=str(ids["overnight"]),
        inclusions=[dict(product_id=inclusion["id"], quantity=2)],
        breakfast=[selection(*recipes, date="2026-11-11")],
    )
    body["discounts"].insert(0, selected(offer, str(ids["room"])))
    response = client.post("/api/v1/reservations", json=body, headers=header())
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["pricing"]["snapshot"]["total_minor"] == 203000
    assert saved["pricing"]["snapshot"]["price_override_total_minor"] == 20000
    assert saved["allocation"]["inclusions"][0]["quantity"] == 2
    assert saved["allocation"]["breakfast"][0]["unit_amount_minor"] == 0
    assert len(raw_state(service)["pricing_revisions"]) == 1
