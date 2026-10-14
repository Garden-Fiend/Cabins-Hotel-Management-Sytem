from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from test_inclusions import write
from test_manual_discounts import command, intent
from test_reservation_patch import patch_api as reservation_fixture
from test_reservation_patch import raw_state

from app.models import pricing_revisions

patch_api = reservation_fixture
pytestmark = pytest.mark.postgres


def preset(client, **extra):
    result = write(
        client,
        "discount-presets",
        dict(label="Preset", scope="reservation", method="percentage", value="10") | extra,
    )
    assert result.status_code == 201, result.text
    return result.json()


def selected(definition, target=""):
    return intent(
        definition["scope"],
        definition["method"],
        definition["value"],
        target,
        preset_id=definition["id"],
    )


def test_preset_terms_are_server_owned_and_captured_history_survives_retirement(patch_api):
    client, service, saved, ids, app = patch_api
    definition = preset(client)
    request_key = uuid4()
    forged = selected(definition) | dict(label="Forged name", value="99")
    result = command(client, saved, [forged], request_key)
    assert result.status_code == 200, result.text
    captured = result.json()
    discount = captured["pricing"]["snapshot"]["discounts"][0]
    assert discount["label"] == "Preset" and discount["value"] == "10"
    assert discount["provenance"] == "preset" and discount["preset_version"] == 1
    assert captured["pricing"]["snapshot"]["total_minor"] == 99000
    assert command(client, saved, [forged], request_key).json() == captured
    assert command(client, saved, [forged | dict(value="98")], request_key).status_code == 409
    changed = write(
        client,
        "discount-presets",
        {
            k: definition[k]
            for k in (
                "label",
                "scope",
                "method",
                "value",
                "currency",
                "target_room_type_id",
                "target_product_id",
            )
        }
        | dict(enabled=False, expected_version=definition["version"]),
        definition["id"],
    )
    assert changed.status_code == 200, changed.text
    retained = {
        k: discount[k]
        for k in ("id", "label", "scope", "method", "value", "target_id", "currency", "preset_id")
    }
    response = command(client, captured, [retained], note="Historical preset retained")
    assert response.status_code == 200, response.text
    assert response.json()["pricing"]["snapshot"]["discounts"][0] == discount
    assert command(client, response.json(), [retained | dict(value="50")]).status_code == 422
    assert command(client, response.json(), [selected(definition)]).status_code == 422
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == response.json()


def test_room_preset_excludes_purchases_while_manual_room_discount_includes_them(patch_api):
    client, service, saved, ids, app = patch_api
    category = write(client, "categories", dict(label="Paid", type="ordinary")).json()
    product = write(
        client,
        "products",
        dict(label="Paid meal", category_id=category["id"], unit_amount_minor=10000),
    ).json()
    definition = preset(
        client,
        label="Room preset",
        scope="room",
        method="percentage",
        value="100",
        target_room_type_id=str(ids["type"]),
    )
    charge_id = str(uuid4())
    result = command(
        client,
        saved,
        [selected(definition, saved["allocation"]["room_id"])],
        charges=[dict(id=charge_id, product_id=product["id"], quantity=1, usage="purchase")],
    )
    assert result.status_code == 200, result.text
    assert result.json()["pricing"]["snapshot"]["total_minor"] == 10000
    discount = result.json()["pricing"]["snapshot"]["discounts"][0]
    assert [a["line_id"] for a in discount["allocations"]] == [
        f"room:{saved['allocation']['room_id']}"
    ]
    retained = {
        k: discount[k]
        for k in ("id", "label", "scope", "method", "value", "target_id", "currency", "preset_id")
    }
    changed = command(
        client,
        result.json(),
        [retained, intent("room", "percentage", "100", saved["allocation"]["room_id"])],
    )
    assert changed.status_code == 200 and changed.json()["pricing"]["snapshot"]["total_minor"] == 0
    item = preset(
        client,
        label="Item preset",
        scope="item",
        method="fixed",
        value="25",
        target_product_id=product["id"],
    )
    item_result = command(client, changed.json(), [selected(item, charge_id)])
    assert item_result.status_code == 200, item_result.text
    assert item_result.json()["pricing"]["snapshot"]["total_minor"] == 117500
    with service.engine.connect() as c:
        assert (
            c.scalar(
                sa.select(sa.func.count())
                .select_from(pricing_revisions)
                .where(pricing_revisions.c.company_id == service.context.company_id)
            )
            == 4
        )


def test_preset_configuration_replay_stale_ownership_and_validation(patch_api):
    client, service, saved, ids, app = patch_api
    body = dict(label="Fixed", scope="reservation", method="fixed", value="100.25")
    headers = {"Idempotency-Key": str(uuid4())}
    first = write(client, "discount-presets", body, headers=headers)
    assert first.status_code == 201
    assert write(client, "discount-presets", body | dict(label=" fixed ")).status_code == 409
    assert write(client, "discount-presets", body, headers=headers).json() == first.json()
    assert (
        write(client, "discount-presets", body | dict(value="101"), headers=headers).status_code
        == 409
    )
    definition = first.json()
    edit_body = body | dict(expected_version=1, enabled=False)
    assert write(client, "discount-presets", edit_body, definition["id"]).status_code == 200
    assert write(client, "discount-presets", edit_body, definition["id"]).status_code == 409
    for fields in [
        dict(method="final_price"),
        dict(value="0"),
        dict(value="NaN"),
        dict(method="percentage", value="101"),
        dict(scope="room"),
        dict(value=10),
        dict(scope="item", target_product_id=str(uuid4())),
    ]:
        assert write(client, "discount-presets", body | fields).status_code in [422, 404]
    assert command(client, saved, [intent(preset_id=str(uuid4()))]).status_code == 404


@pytest.mark.parametrize("stage", ["reservation", "pricing", "audit", "receipt"])
def test_preset_booking_rolls_back_and_retries(patch_api, stage):
    client, service, saved, ids, app = patch_api
    definition = preset(client)
    before = raw_state(service)
    request_key = uuid4()
    names = {
        "reservation": "reservations",
        "pricing": "pricing_revisions",
        "audit": "operational_audit",
        "receipt": "mutation_receipts",
    }

    def fail(connection, cursor, statement, parameters, context, executemany):
        if (
            statement.lstrip().startswith(("INSERT", "UPDATE"))
            and f"hms.{names[stage]}" in statement
        ):
            raise RuntimeError("Synthetic preset rollback")

    sa.event.listen(service.engine, "after_cursor_execute", fail)
    try:
        assert command(client, saved, [selected(definition)], request_key).status_code >= 500
    finally:
        sa.event.remove(service.engine, "after_cursor_execute", fail)
    assert raw_state(service) == before
    assert command(client, saved, [selected(definition)], request_key).status_code == 200


def test_competing_preset_mutations_are_version_checked(patch_api):
    client, service, saved, ids, app = patch_api
    definition = preset(client)
    barrier = Barrier(2)

    def send(_):
        barrier.wait()
        return command(client, saved, [selected(definition)])

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(send, [1, 2]))
    assert sorted(r.status_code for r in responses) == [200, 409]


def test_small_percentage_is_plain_decimal_and_preserves_exact_capture(patch_api):
    client, service, saved, ids, app = patch_api
    definition = preset(client, value="0.00000001")
    assert definition["value"] == "0.00000001"
    result = command(client, saved, [selected(definition)])
    assert result.status_code == 200, result.text
    captured = result.json()["pricing"]["snapshot"]
    assert captured["discounts"][0]["value"] == "0.00000001"
    assert captured["total_minor"] == 110000


def test_fixed_definition_rounding_is_exact_before_frontend_float_conversion(patch_api):
    client, service, saved, ids, app = patch_api
    definition = preset(client, method="fixed", value="90071992547409.91")
    assert definition["value"] == "90071992547409.91"
    rounded = preset(client, label="Rounded fixed", method="fixed", value="10.005")
    assert rounded["value"] == "10.01"
    body = dict(label="Exact request identity", scope="reservation", method="fixed", value="10.005")
    headers = {"Idempotency-Key": str(uuid4())}
    first = write(client, "discount-presets", body, headers=headers)
    assert first.status_code == 201
    assert write(client, "discount-presets", body, headers=headers).json() == first.json()
    assert (
        write(client, "discount-presets", body | dict(value="10.01"), headers=headers).status_code
        == 409
    )


def test_room_rate_change_requires_explicit_removal_of_captured_preset(patch_api):
    client, service, saved, ids, app = patch_api
    definition = preset(client, scope="room", target_room_type_id=str(ids["type"]))
    result = command(client, saved, [selected(definition, saved["allocation"]["room_id"])])
    assert result.status_code == 200, result.text
    booked = result.json()
    before = raw_state(service)
    body = dict(
        expected_version=booked["version"],
        guest_id=booked["guest"]["id"],
        room_id=booked["allocation"]["room_id"],
        duration_id=str(ids["overnight"]),
        scheduled_start=booked["allocation"]["scheduled_start"],
    )
    headers = {"Idempotency-Key": str(uuid4())}
    invalid = client.post(
        f"/api/v1/reservations/{booked['id']}/edit-stay", json=body, headers=headers
    )
    assert invalid.status_code == 422, invalid.text
    assert raw_state(service) == before
    accepted = client.post(
        f"/api/v1/reservations/{booked['id']}/edit-stay",
        json=body | dict(discounts=[]),
        headers=headers,
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["pricing"]["snapshot"]["discounts"] == []
