from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from test_reservation_patch import patch_api as reservation_fixture
from test_reservation_patch import raw_state

from app.modules.billing.discounts import calculate_discounts
from app.modules.reservations.schemas import ManualDiscountIntent, ReservationCreate

patch_api = reservation_fixture


def intent(scope="reservation", method="fixed", value="100", target="", **extra):
    return dict(
        id=str(uuid4()),
        label="Courtesy",
        scope=scope,
        method=method,
        value=value,
        target_id=str(target),
        **extra,
    )


def command(client, saved, discounts, key=None, **extra):
    return client.post(
        f"/api/v1/reservations/{saved['id']}/edit-discounts",
        json={
            "expected_version": saved["version"],
            "guest_id": saved["guest"]["id"],
            "discounts": discounts,
            **extra,
        },
        headers={"Idempotency-Key": str(key or uuid4())},
    )


def test_staging_balance_caps_allocation_and_rounding():
    room, charge = str(uuid4()), str(uuid4())
    raw = {
        "lines": [{"room_id": room, "amount_minor": 110000}],
        "charges": [{"id": charge, "amount_minor": 20025}],
        "adjustments": [{"amount_minor": -500}],
    }
    discounts = [
        intent(method="percentage", value="10"),
        intent("room", "fixed", "100", room),
        intent("item", "percentage", "50", charge),
    ]
    captures, reduction, total = calculate_discounts(raw, discounts)
    assert [d["order"] for d in captures] == [2, 0, 1]
    assert [d["amount_minor"] for d in captures] == [11001, 10000, 10013]
    assert reduction == 31014 and total == 98511
    assert sum(a["amount_minor"] for a in captures[1]["allocations"]) == 10000
    captures, _, total = calculate_discounts(
        raw, [intent(value="999999"), intent(method="percentage", value="100")]
    )
    assert [d["amount_minor"] for d in captures] == [130025, 0] and total == 0
    assert (
        calculate_discounts(
            {"lines": [{"room_id": room, "amount_minor": 1}]},
            [intent(method="percentage", value="50")],
        )[0][0]["amount_minor"]
        == 1
    )
    assert (
        calculate_discounts(
            {"lines": [{"room_id": room, "amount_minor": 100}]}, [intent(value="0.005")]
        )[0][0]["amount_minor"]
        == 1
    )


@pytest.mark.parametrize(
    "fields",
    [
        dict(value=10),
        dict(value=True),
        dict(value="NaN"),
        dict(value="-1"),
        dict(value="0"),
        dict(value="101", method="percentage"),
        dict(method="final_price"),
        dict(scope="all"),
        dict(amount_minor=1),
        dict(source_preset_id=str(uuid4())),
        dict(currency="USD"),
    ],
)
def test_invalid_intents_rejected(fields):
    with pytest.raises(ValueError):
        ManualDiscountIntent.model_validate({**intent(), **fields})


@pytest.mark.postgres
def test_persist_edit_remove_replay_and_original_captures(patch_api):
    client, service, saved, ids, _app = patch_api
    before = raw_state(service)
    key, d = uuid4(), intent(method="percentage", value="10")
    result = command(client, saved, [d], key)
    assert result.status_code == 200, result.text
    updated = result.json()
    assert updated["version"] == saved["version"] + 1
    assert updated["pricing"]["snapshot"]["total_minor"] == 99000
    assert updated["pricing"]["snapshot"]["lines"] == saved["pricing"]["snapshot"]["lines"]
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == updated
    assert command(client, saved, [d], key).json() == updated
    assert (
        command(client, saved, [dict(d, value="20")], key).json()["code"] == "idempotency_conflict"
    )
    assert command(client, saved, [d]).json()["code"] == "version_conflict"
    after = raw_state(service)
    for row in before["pricing_revisions"]:
        assert row in after["pricing_revisions"]
    audit = [
        row
        for row in after["operational_audit"]
        if row["event_type"] == "reservation.billing_updated"
    ][-1]
    assert audit["before"]["pricing"] == saved["pricing"]
    assert audit["after"]["pricing"] == updated["pricing"]
    # Note/count PATCH has no new pricing revision.
    patched = client.patch(
        f"/api/v1/reservations/{saved['id']}",
        json={"expected_version": updated["version"], "note": "Unrelated"},
        headers={"Idempotency-Key": str(uuid4())},
    ).json()
    assert patched["pricing"] == updated["pricing"]
    edited = command(client, patched, [dict(d, value="20")]).json()
    assert edited["pricing"]["snapshot"]["total_minor"] == 88000
    cleared = command(client, edited, []).json()
    assert cleared["pricing"]["snapshot"]["total_minor"] == 110000
    assert cleared["pricing"]["snapshot"]["discounts"] == []


@pytest.mark.postgres
@pytest.mark.parametrize("bad", ["duplicate", "unknown-room", "unknown-item", "null"])
def test_invalid_targets_or_list_roll_back(patch_api, bad):
    client, service, saved, _ids, _app = patch_api
    before = raw_state(service)
    d = intent()
    values = (
        [d, d]
        if bad == "duplicate"
        else [intent("room" if bad == "unknown-room" else "item", target=uuid4())]
        if bad.startswith("unknown")
        else None
    )
    assert command(client, saved, values).status_code == 422
    assert raw_state(service) == before


@pytest.mark.postgres
@pytest.mark.parametrize(
    "stage",
    [
        "room_allocations",
        "reservations",
        "pricing_revisions",
        "operational_audit",
        "mutation_receipts",
        "commit",
    ],
)
def test_failure_rolls_back_all_and_same_key_retries(patch_api, stage):
    client, service, saved, _ids, _app = patch_api
    before, key = raw_state(service), uuid4()

    def sql_fail(conn, cursor, statement, params, context, many):
        if stage in statement.lower() and statement.lower().startswith(("insert", "update")):
            raise RuntimeError("Injected discount failure")

    def commit_fail(session):
        raise RuntimeError("Injected discount commit failure")

    target, event, handler = (
        (Session, "before_commit", commit_fail)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", sql_fail)
    )
    sa.event.listen(target, event, handler)
    d = intent()
    try:
        assert command(client, saved, [d], key, adults=3).status_code >= 500
    finally:
        sa.event.remove(target, event, handler)
    assert raw_state(service) == before
    assert command(client, saved, [d], key, adults=3).status_code == 200


@pytest.mark.postgres
@pytest.mark.parametrize("same_key,same_payload", [(False, False), (True, True), (True, False)])
def test_competing_edits_and_replay(patch_api, same_key, same_payload):
    client, service, saved, _ids, _app = patch_api
    barrier, key, d = Barrier(2), uuid4(), intent()

    def submit(index):
        barrier.wait()
        return command(
            client,
            saved,
            [d if same_payload else dict(d, value=str(100 + index))],
            key if same_key else None,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert sorted(r.status_code for r in results) == ([200, 200] if same_payload else [200, 409])
    if same_payload:
        assert results[0].json() == results[1].json()
    assert service.get(saved["id"]).version == 2
    assert len(raw_state(service)["pricing_revisions"]) == 2


@pytest.mark.postgres
def test_create_discounts_and_historical_request_hash(patch_api):
    client, service, saved, ids, _app = patch_api
    body = dict(
        guest_id=saved["guest"]["id"],
        booking_source_id=str(ids["source"]),
        room_id=str(ids["room"]),
        duration_id=str(ids["hourly"]),
        scheduled_start="2026-12-10T14:00:00+08:00",
        adults=1,
        discounts=[intent(value="100")],
    )
    key = uuid4()
    created = client.post("/api/v1/reservations", json=body, headers={"Idempotency-Key": str(key)})
    assert created.status_code == 201, created.text
    assert created.json()["pricing"]["snapshot"]["total_minor"] == 100000
    assert (
        client.post("/api/v1/reservations", json=body, headers={"Idempotency-Key": str(key)}).json()
        == created.json()
    )
    import hashlib
    import json

    from app.mutations import request_hash

    old = ReservationCreate(**{k: v for k, v in body.items() if k != "discounts"})
    previous_hash = hashlib.sha256(
        json.dumps(
            old.model_dump(
                mode="json",
                exclude={"discounts", "charges", "adjustments", "inclusions", "breakfast"},
            ),
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    assert request_hash(old) == previous_hash


@pytest.mark.postgres
def test_purchase_quantity_edits_recalculate_discounts_from_captured_prices(patch_api):
    client, service, saved, ids, app = patch_api

    def headers():
        return {"Idempotency-Key": str(uuid4())}

    category = client.post(
        "/api/v1/configuration/categories",
        json={"label": "Meals", "type": "ordinary"},
        headers=headers(),
    ).json()
    product = client.post(
        "/api/v1/configuration/products",
        json={"label": "Meal", "category_id": category["id"], "unit_amount_minor": 20025},
        headers=headers(),
    ).json()
    charge = dict(id=str(uuid4()), product_id=product["id"], quantity=2)
    d = intent("room", "percentage", "10", ids["room"])
    created = command(client, saved, [d], charges=[charge]).json()
    assert created["pricing"]["snapshot"]["total_minor"] == 135045
    assert created["pricing"]["snapshot"]["discounts"][0]["amount_minor"] == 15005
    item = intent("item", "fixed", "25.005", charge["id"])
    stack = command(client, created, [d, item]).json()
    assert stack["pricing"]["snapshot"]["discount_total_minor"] == 17506
    # Current product/rate changes cannot rewrite captures.
    client.patch(
        f"/api/v1/configuration/products/{product['id']}",
        json={
            "expected_version": 1,
            "label": "Changed",
            "category_id": category["id"],
            "unit_amount_minor": 99999,
        },
        headers=headers(),
    )
    before = raw_state(service)
    response = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-charges",
        json={
            "expected_version": stack["version"],
            "guest_id": saved["guest"]["id"],
            "charges": [dict(charge, quantity=3)],
        },
        headers=headers(),
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["pricing"]["snapshot"]["charges"][0]["unit_amount_minor"] == 20025
    assert updated["pricing"]["snapshot"]["charges"][0]["label"] == "Meal"
    assert updated["pricing"]["snapshot"]["total_minor"] == 150566
    assert updated["pricing"]["snapshot"]["lines"] == saved["pricing"]["snapshot"]["lines"]
    for row in before["pricing_revisions"]:
        assert row in raw_state(service)["pricing_revisions"]
    before = raw_state(service)
    # Removing a targeted line without addressing its discount fails atomically.
    bad = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-charges",
        json={
            "expected_version": updated["version"],
            "guest_id": saved["guest"]["id"],
            "charges": [],
        },
        headers=headers(),
    )
    assert bad.status_code == 422 and raw_state(service) == before
    removed = command(client, updated, [d], charges=[]).json()
    assert removed["pricing"]["snapshot"]["total_minor"] == 99000
    # Assignment/duration command retains and recalculates room discount with new base capture.
    moved = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-stay",
        json={
            "expected_version": removed["version"],
            "guest_id": saved["guest"]["id"],
            "room_id": str(ids["room"]),
            "duration_id": str(ids["overnight"]),
            "scheduled_start": saved["allocation"]["scheduled_start"],
        },
        headers=headers(),
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["pricing"]["snapshot"]["total_minor"] == 198000
    assert moved.json()["pricing"]["snapshot"]["discounts"][0]["amount_minor"] == 22000


@pytest.mark.postgres
def test_ownership_terminal_states_and_resource_bound_keys(patch_api):
    from app.context import CommandContext, get_command_context
    from app.models import reservations

    client, service, saved, _ids, app = patch_api
    before = raw_state(service)
    owner = service.context
    app.dependency_overrides[get_command_context] = lambda: CommandContext(company_id=uuid4())
    assert command(client, saved, [intent()]).status_code == 404
    app.dependency_overrides[get_command_context] = lambda: owner
    assert raw_state(service) == before
    key, d = uuid4(), intent()
    assert command(client, saved, [d], key).status_code == 200
    other = dict(saved, id=str(uuid4()))
    assert command(client, other, [d], key).json()["code"] == "idempotency_conflict"
    with service.engine.begin() as c:
        c.execute(
            reservations.update()
            .where(reservations.c.id == saved["id"])
            .values(status="checked_out")
        )
    current = service.get(saved["id"]).model_dump(mode="json")
    before = raw_state(service)
    assert command(client, current, [d]).json()["code"] == "invalid_transition"
    assert raw_state(service) == before


@pytest.mark.postgres
def test_nightly_quantity_and_captured_rate_are_preserved(patch_api):
    client, service, saved, ids, _app = patch_api
    duration = client.post(
        "/api/v1/configuration/durations",
        json={"label": "Three nights", "kind": "overnight", "nights": 3},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert duration.status_code == 201
    body = {
        "guest_id": saved["guest"]["id"],
        "booking_source_id": str(ids["source"]),
        "room_id": str(ids["room"]),
        "duration_id": duration.json()["id"],
        "scheduled_start": "2026-12-15T14:00:00+08:00",
        "adults": 2,
        "discounts": [
            intent(method="percentage", value="10"),
            intent("room", "fixed", "100", ids["room"]),
        ],
    }
    result = client.post(
        "/api/v1/reservations", json=body, headers={"Idempotency-Key": str(uuid4())}
    )
    assert result.status_code == 201, result.text
    captured = result.json()["pricing"]["snapshot"]
    assert captured["lines"][0]["quantity"] == 3
    assert captured["lines"][0]["unit_amount_minor"] == 220000
    assert captured["lines"][0]["amount_minor"] == 660000
    assert captured["total_minor"] == 585000
    assert [d["amount_minor"] for d in captured["discounts"]] == [65000, 10000]
