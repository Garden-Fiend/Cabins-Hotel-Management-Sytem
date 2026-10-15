from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from test_discount_presets import preset, selected
from test_inclusions import write
from test_manual_discounts import command, intent
from test_reservation_patch import patch_api as reservation_fixture
from test_reservation_patch import raw_state

from app.models import discount_presets, durations, rates

patch_api = reservation_fixture
pytestmark = pytest.mark.postgres


def room_definition(client, saved, replacement=90000):
    line = saved["pricing"]["snapshot"]["lines"][0]
    return preset(
        client,
        method="final_price",
        value="0",
        scope="room",
        target_room_type_id=line["room_type_id"],
        rate_prices=[dict(rate_id=line["rate_id"], unit_amount_minor=replacement)],
    )


def test_hourly_override_is_separate_captured_and_replayable(patch_api):
    client, service, saved, ids, app = patch_api
    definition = room_definition(client, saved)
    override = selected(definition, saved["allocation"]["room_id"])
    discounts = [override, intent("room", "percentage", "10", saved["allocation"]["room_id"])]
    key = uuid4()
    response = command(client, saved, discounts, key)
    assert response.status_code == 200, response.text
    result = response.json()
    raw = result["pricing"]["snapshot"]
    assert raw["schema_version"] == 5 and raw["total_minor"] == 81000
    assert raw["discount_total_minor"] == 9000 and raw["price_override_total_minor"] == 20000
    capture = raw["price_overrides"][0]
    assert capture["original_unit_amount_minor"] == 110000
    assert capture["replacement_unit_amount_minor"] == 90000 and capture["quantity"] == 1
    assert capture["preset_id"] == definition["id"] and capture["preset_version"] == 1
    assert len(raw["discounts"]) == 1
    assert command(client, saved, discounts, key).json() == result
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == result
    assert command(client, saved, discounts).status_code == 409
    assert command(client, result, [override, override | dict(id=str(uuid4()))]).status_code == 422
    removed = command(client, result, [])
    assert (
        removed.status_code == 200
        and removed.json()["pricing"]["snapshot"]["total_minor"] == 110000
    )


def test_item_override_quantity_uses_captured_unit_prices_and_blocks_orphans(patch_api):
    client, service, saved, ids, app = patch_api
    category = write(client, "categories", dict(label="Meals", type="ordinary")).json()
    product = write(
        client, "products", dict(label="Meal", category_id=category["id"], unit_amount_minor=15000)
    ).json()
    definition = preset(
        client,
        scope="item",
        method="final_price",
        value="0",
        target_product_id=product["id"],
        replacement_unit_amount_minor=12000,
    )
    line_id = str(uuid4())
    charge = dict(id=line_id, product_id=product["id"], quantity=3, usage="purchase")
    override = selected(definition, line_id)
    discounts = [override, intent("item", "percentage", "10", line_id)]
    response = command(client, saved, discounts, charges=[charge])
    assert response.status_code == 200, response.text
    booked = response.json()
    assert booked["pricing"]["snapshot"]["total_minor"] == 142400
    definition_update = {
        k: definition[k]
        for k in (
            "label",
            "scope",
            "method",
            "value",
            "target_product_id",
            "replacement_unit_amount_minor",
        )
    }
    assert (
        write(
            client,
            "discount-presets",
            definition_update | dict(enabled=False, expected_version=definition["version"]),
            definition["id"],
        ).status_code
        == 200
    )
    assert (
        write(
            client,
            "products",
            dict(
                label="Changed meal",
                category_id=category["id"],
                unit_amount_minor=99000,
                expected_version=product["version"],
            ),
            product["id"],
        ).status_code
        == 200
    )
    # Omitted discount intents retain historical replacement terms while quantity changes.
    changed = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-charges",
        headers={"Idempotency-Key": str(uuid4())},
        json=dict(
            expected_version=booked["version"],
            guest_id=booked["guest"]["id"],
            charges=[charge | dict(quantity=2)],
        ),
    )
    assert changed.status_code == 200, changed.text
    updated = changed.json()
    raw = updated["pricing"]["snapshot"]
    assert raw["total_minor"] == 131600
    assert raw["price_overrides"][0]["quantity"] == 2 and raw["price_override_total_minor"] == 6000
    assert raw["charges"][0]["unit_amount_minor"] == 15000
    before = raw_state(service)
    invalid = command(client, updated, discounts, charges=[])
    assert invalid.status_code == 422 and raw_state(service) == before
    removed = command(client, updated, [], charges=[])
    assert (
        removed.status_code == 200
        and removed.json()["pricing"]["snapshot"]["price_overrides"] == []
    )


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
def test_override_failure_rolls_back_and_key_can_retry(patch_api, stage):
    client, service, saved, ids, app = patch_api
    override = selected(room_definition(client, saved), saved["allocation"]["room_id"])
    before, key = raw_state(service), uuid4()

    def sql_fail(conn, cursor, statement, params, context, many):
        if stage in statement.lower() and statement.lower().startswith(("insert", "update")):
            raise RuntimeError("Injected unit override failure")

    def commit_fail(session):
        raise RuntimeError("Injected unit override commit failure")

    target, event, handler = (
        (Session, "before_commit", commit_fail)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", sql_fail)
    )
    sa.event.listen(target, event, handler)
    try:
        assert command(client, saved, [override], key, adults=3).status_code >= 500
    finally:
        sa.event.remove(target, event, handler)
    assert raw_state(service) == before
    assert command(client, saved, [override], key, adults=3).status_code == 200


@pytest.mark.parametrize("same_key,same_payload", [(False, False), (True, True), (True, False)])
def test_override_concurrent_writers_and_replay(patch_api, same_key, same_payload):
    client, service, saved, ids, app = patch_api
    override = selected(room_definition(client, saved), saved["allocation"]["room_id"])
    barrier, key = Barrier(2), uuid4()

    def submit(index):
        barrier.wait()
        return command(
            client,
            saved,
            [override],
            key if same_key else None,
            adults=2 if same_payload else 2 + index,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert sorted(r.status_code for r in results) == ([200, 200] if same_payload else [200, 409])
    if same_payload:
        assert results[0].json() == results[1].json()
    assert service.get(saved["id"]).version == 2
    assert len(raw_state(service)["pricing_revisions"]) == 2


def test_initial_nightly_override_multiplies_unit_once(patch_api):
    client, service, saved, ids, app = patch_api
    definition = preset(
        client,
        method="final_price",
        value="0",
        scope="room",
        target_room_type_id=str(ids["type"]),
        rate_prices=[dict(rate_id=str(ids["nightly-rate"]), unit_amount_minor=190000)],
    )
    body = dict(
        guest_id=saved["guest"]["id"],
        booking_source_id=str(ids["source"]),
        room_id=str(ids["room"]),
        duration_id=str(ids["two-nights"]),
        scheduled_start="2026-12-15T14:00:00+08:00",
        adults=2,
        discounts=[selected(definition, str(ids["room"])), intent(method="percentage", value="10")],
    )
    key = str(uuid4())
    response = client.post("/api/v1/reservations", json=body, headers={"Idempotency-Key": key})
    assert response.status_code == 201, response.text
    result = response.json()
    raw = result["pricing"]["snapshot"]
    assert raw["lines"][0]["quantity"] == 2
    assert raw["price_overrides"][0]["original_unit_amount_minor"] == 220000
    assert raw["price_overrides"][0]["replacement_unit_amount_minor"] == 190000
    assert raw["price_override_total_minor"] == 60000
    assert raw["discount_total_minor"] == 38000 and raw["total_minor"] == 342000
    assert (
        client.post("/api/v1/reservations", json=body, headers={"Idempotency-Key": key}).json()
        == result
    )
    before = raw_state(service)
    forged = selected(definition, str(uuid4()))
    assert (
        command(client, result, [forged | dict(id=raw["price_overrides"][0]["id"])]).status_code
        == 422
    )
    assert raw_state(service) == before


def test_definition_edit_retirement_and_forged_capture_rejection(patch_api):
    client, service, saved, ids, app = patch_api
    definition = room_definition(client, saved)
    override = selected(definition, str(ids["room"]))
    booked = command(client, saved, [override]).json()
    capture = booked["pricing"]["snapshot"]["price_overrides"][0]
    override["label"] = capture["label"]
    fields = {
        k: definition[k]
        for k in ("label", "scope", "method", "value", "target_room_type_id", "rate_prices")
    }
    changed = write(
        client,
        "discount-presets",
        fields
        | dict(
            rate_prices=[dict(rate_id=str(ids["hourly-rate"]), unit_amount_minor=80000)],
            expected_version=1,
        ),
        definition["id"],
    )
    assert changed.status_code == 200, changed.text
    fields["rate_prices"] = changed.json()["rate_prices"]
    retired = write(
        client,
        "discount-presets",
        fields | dict(enabled=False, expected_version=2),
        definition["id"],
    )
    assert retired.status_code == 200
    current = command(client, booked, [override], adults=3)
    assert current.status_code == 200, current.text
    assert current.json()["pricing"]["snapshot"]["price_overrides"][0] == capture
    assert current.json()["pricing"]["snapshot"]["total_minor"] == 90000
    before = raw_state(service)
    assert command(client, current.json(), [override | dict(id=str(uuid4()))]).status_code == 422
    assert (
        command(
            client, current.json(), [override | dict(replacement_unit_amount_minor=1)]
        ).status_code
        == 422
    )
    assert (
        command(client, current.json(), [override | dict(method="fixed", value="1")]).status_code
        == 422
    )
    assert raw_state(service) == before


@pytest.mark.parametrize(
    "changes",
    [
        dict(rate_prices=[]),
        dict(rate_prices=None),
        dict(replacement_unit_amount_minor=1),
        dict(rate_prices=[dict(rate_id=str(uuid4()), unit_amount_minor=1)]),
        dict(rate_prices=[dict(rate_id="bad", unit_amount_minor=1)]),
        dict(value="1"),
        dict(scope="reservation", target_room_type_id=None),
    ],
)
def test_invalid_override_configuration_is_atomic(patch_api, changes):
    client, service, saved, ids, app = patch_api
    body = dict(
        label="Invalid offer",
        scope="room",
        method="final_price",
        value="0",
        target_room_type_id=str(ids["type"]),
        rate_prices=[dict(rate_id=str(ids["hourly-rate"]), unit_amount_minor=90000)],
    )
    before = raw_state(service)
    assert write(client, "discount-presets", body | changes).status_code in (404, 422)
    assert raw_state(service) == before


def test_rate_switch_requires_removal_and_nightly_quantity_reconciles(patch_api):
    client, service, saved, ids, app = patch_api
    definition = room_definition(client, saved)
    booked = command(client, saved, [selected(definition, str(ids["room"]))]).json()
    stay = dict(
        expected_version=booked["version"],
        guest_id=booked["guest"]["id"],
        room_id=str(ids["room"]),
        duration_id=str(ids["two-nights"]),
        scheduled_start=booked["allocation"]["scheduled_start"],
    )
    before = raw_state(service)
    assert (
        client.post(
            f"/api/v1/reservations/{saved['id']}/edit-stay",
            json=stay,
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 422
    )
    assert raw_state(service) == before
    result = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-stay",
        json=stay | dict(discounts=[]),
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert result.status_code == 200, result.text
    nightly = result.json()
    offer = preset(
        client,
        label="Nightly",
        method="final_price",
        value="0",
        scope="room",
        target_room_type_id=str(ids["type"]),
        rate_prices=[dict(rate_id=str(ids["nightly-rate"]), unit_amount_minor=190000)],
    )
    nightly = command(client, nightly, [selected(offer, str(ids["room"]))]).json()
    assert nightly["pricing"]["snapshot"]["total_minor"] == 380000
    stay.update(expected_version=nightly["version"], duration_id=str(ids["overnight"]))
    result = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-stay",
        json=stay,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert result.status_code == 200, result.text
    capture = result.json()["pricing"]["snapshot"]
    assert capture["total_minor"] == 190000 and capture["price_overrides"][0]["quantity"] == 1
    assert (
        capture["price_overrides"][0]["applied_at"]
        == nightly["pricing"]["snapshot"]["price_overrides"][0]["applied_at"]
    )


def test_database_rejects_missing_item_replacement_and_ordinary_override_metadata(patch_api):
    client, service, saved, ids, app = patch_api
    definition = room_definition(client, saved)
    category = write(client, "categories", dict(label="Check products", type="ordinary")).json()
    product = write(
        client,
        "products",
        dict(label="Check product", category_id=category["id"], unit_amount_minor=100),
    ).json()
    for values in [
        dict(
            scope="item",
            target_room_type_id=None,
            target_product_id=product["id"],
            replacement_unit_amount_minor=None,
            rate_prices=[],
        ),
        dict(method="fixed", value=10, rate_prices=definition["rate_prices"]),
    ]:
        with pytest.raises(IntegrityError) as rejected, service.engine.begin() as connection:
            connection.execute(
                discount_presets.update()
                .where(discount_presets.c.id == definition["id"])
                .values(**values)
            )
        assert (
            rejected.value.orig.diag.constraint_name
            == "ck_discount_presets_valid_override_configuration"
        )
    assert client.get("/api/v1/reference-data").status_code == 200


def test_retirement_after_current_rate_falls_preserves_old_price(patch_api):
    client, service, saved, ids, app = patch_api
    definition = room_definition(client, saved)
    booked = command(client, saved, [selected(definition, str(ids["room"]))]).json()
    with service.engine.begin() as connection:
        connection.execute(
            rates.update()
            .where(rates.c.id == ids["hourly-rate"])
            .values(unit_amount_minor=80000, enabled=False)
        )
    fields = {
        key: definition[key]
        for key in ("label", "scope", "method", "value", "target_room_type_id", "rate_prices")
    }
    retired = write(
        client,
        "discount-presets",
        fields | dict(enabled=False, expected_version=1),
        definition["id"],
    )
    assert retired.status_code == 200, retired.text
    assert (
        write(
            client,
            "discount-presets",
            fields | dict(enabled=True, expected_version=2),
            definition["id"],
        ).status_code
        == 422
    )
    capture = booked["pricing"]["snapshot"]["price_overrides"][0]
    selection = selected(definition, str(ids["room"])) | dict(
        id=capture["id"], label=capture["label"]
    )
    result = command(client, booked, [selection], adults=3)
    assert result.status_code == 200, result.text
    assert result.json()["pricing"]["snapshot"] == booked["pricing"]["snapshot"]


def test_inactive_package_rejects_new_final_price_but_retains_saved_capture(patch_api):
    client, service, saved, ids, app = patch_api
    definition = room_definition(client, saved)
    booked = command(client, saved, [selected(definition, str(ids["room"]))]).json()
    with service.engine.begin() as connection:
        connection.execute(
            durations.update().where(durations.c.id == ids["hourly"]).values(enabled=False)
        )
    old = booked["pricing"]["snapshot"]["price_overrides"][0]
    assert (
        command(
            client,
            booked,
            [selected(definition, str(ids["room"])) | dict(id=old["id"], label=old["label"])],
            adults=3,
        ).status_code
        == 200
    )
    current = service.get(saved["id"]).model_dump(mode="json")
    before = raw_state(service)
    assert command(client, current, [selected(definition, str(ids["room"]))]).status_code == 422
    assert raw_state(service) == before


def test_concurrent_definition_edit_and_new_application_capture_one_version(patch_api):
    client, service, saved, ids, app = patch_api
    definition = room_definition(client, saved)
    fields = {
        key: definition[key] for key in ("label", "scope", "method", "value", "target_room_type_id")
    }
    barrier = Barrier(2)

    def submit(index):
        barrier.wait()
        if index:
            return write(
                client,
                "discount-presets",
                fields
                | dict(
                    expected_version=1,
                    rate_prices=[dict(rate_id=str(ids["hourly-rate"]), unit_amount_minor=80000)],
                ),
                definition["id"],
            )
        return command(client, saved, [selected(definition, str(ids["room"]))])

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert [r.status_code for r in results] == [200, 200]
    capture = results[0].json()["pricing"]["snapshot"]["price_overrides"][0]
    assert (capture["preset_version"], capture["replacement_unit_amount_minor"]) in [
        (1, 90000),
        (2, 80000),
    ]
