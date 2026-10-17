"""B3 real PostgreSQL contracts; B2 fixtures/financial helpers remain authoritative."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from test_multi_room import (
    action,
    edit_body,
    headers,
    raw_state,
    write,
)
from test_multi_room import api as api
from test_multi_room import multi_api as multi_api
from test_multi_room import (
    test_add_remove_financial_edit_rolls_back_all_stages_and_retries as edit_rollback_case,
)
from test_multi_room import (
    test_multi_create_rollback_and_retry as rollback_case,
)
from test_multi_room import (
    test_real_competing_creates_sorted_room_locks as competing_case,
)

from app.models import rates, reservations

pytestmark = pytest.mark.postgres


def independent(body, ids):
    body["allocations"][1]["stay"] = dict(
        scheduled_start="2026-11-11T14:00:00+08:00", duration_id=str(ids["two-nights"])
    )
    return body


def custom_edit(body, saved):
    result = edit_body(body, saved)
    for intent in result["allocations"]:
        source = next(a for a in saved["allocations"] if a["id"] == intent["id"])
        if not source["uses_reservation_stay"]:
            intent["stay"] = dict(
                scheduled_start=source["scheduled_start"], duration_id=source["duration_id"]
            )
    return result


def test_mixed_stays_capture_own_intervals_and_derived_range(multi_api):
    client, service, body, ids, extra = multi_api
    saved = write(client, "multi-room-reservations", independent(body, ids))
    assert saved["stay_mode"] == "independent" and saved["shared_duration_id"] is None
    assert saved["shared_start"] == saved["allocations"][0]["scheduled_start"]
    assert saved["shared_end"] == saved["allocations"][1]["scheduled_end"]
    assert saved["allocations"][1]["scheduled_end"] == "2026-11-13T04:00:00Z"
    assert saved["pricing"]["snapshot"]["total_minor"] == 550000
    assert [a["uses_reservation_stay"] for a in saved["allocations"]] == [True, False]
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == saved
    assert client.get("/api/v1/reservations").json() == [saved]


def test_three_rooms_different_duration_bases(multi_api):
    client, service, body, ids, extra = multi_api
    body["allocations"][1]["stay"] = dict(
        scheduled_start="2026-11-11T14:00:00+08:00", duration_id=str(ids["overnight"])
    )
    body["allocations"].append(
        dict(
            room_id=extra[1]["id"],
            adults=1,
            stay=dict(
                scheduled_start="2026-11-12T16:00:00+08:00", duration_id=str(ids["two-nights"])
            ),
        )
    )
    saved = write(client, "multi-room-reservations", body)
    assert saved["pricing"]["snapshot"]["total_minor"] == 770000
    assert [line["quantity"] for line in saved["pricing"]["snapshot"]["lines"]] == [1, 1, 2]


@pytest.mark.parametrize("change", ["reversed", "wrong_end", "quantity", "kind", "foreign"])
def test_invalid_custom_stays_reject_without_writes(multi_api, change):
    client, service, body, ids, extra = multi_api
    independent(body, ids)
    stay = body["allocations"][1]["stay"]
    stay.update(
        {
            "reversed": {"scheduled_end": "2026-11-10T00:00:00Z"},
            "wrong_end": {"scheduled_end": "2026-11-20T00:00:00Z"},
            "quantity": {"quantity": 2},
            "kind": {"kind": "weekly"},
            "foreign": {"duration_id": str(uuid4())},
        }[change]
    )
    before = raw_state(service)
    response = client.post("/api/v1/multi-room-reservations", json=body, headers=headers())
    assert response.status_code == (404 if change == "foreign" else 422), response.text
    assert raw_state(service) == before


def test_availability_uses_each_room_not_parent_range(multi_api):
    client, service, body, ids, extra = multi_api
    write(client, "multi-room-reservations", independent(body, ids))
    another = {
        **body,
        "scheduled_start": "2026-11-11T14:00:00+08:00",
        "allocations": [dict(room_id=str(ids["room"]), adults=1)],
    }
    assert (
        client.post("/api/v1/multi-room-reservations", json=another, headers=headers()).status_code
        == 201
    )
    another["allocations"] = [dict(room_id=extra[0]["id"], adults=1)]
    before = raw_state(service)
    assert (
        client.post("/api/v1/multi-room-reservations", json=another, headers=headers()).status_code
        == 409
    )
    assert raw_state(service) == before


def test_edit_reprices_only_changed_duration_and_preserves_other_capture(multi_api):
    client, service, body, ids, extra = multi_api
    saved = write(client, "multi-room-reservations", independent(body, ids))
    with service.engine.begin() as c:
        c.execute(
            rates.update().where(rates.c.id == ids["hourly-rate"]).values(unit_amount_minor=999999)
        )
    edit = custom_edit(body, saved)
    edit["allocations"][1]["stay"]["duration_id"] = str(ids["overnight"])
    newer = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert newer["pricing"]["snapshot"]["lines"][0] == saved["pricing"]["snapshot"]["lines"][0]
    assert newer["pricing"]["snapshot"]["total_minor"] == 330000
    assert newer["allocations"][0] == saved["allocations"][0]
    assert newer["shared_end"] == "2026-11-12T04:00:00Z"
    assert (
        client.post(
            f"/api/v1/reservations/{saved['id']}/edit-allocations", json=edit, headers=headers()
        ).status_code
        == 409
    )
    assert len(raw_state(service)["pricing_revisions"]) == 2


def test_reset_and_omitted_custom_stay_have_distinct_semantics(multi_api):
    client, service, body, ids, extra = multi_api
    saved = write(client, "multi-room-reservations", independent(body, ids))
    edit = custom_edit(body, saved)
    edit["allocations"][1].pop("stay")
    unchanged = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert unchanged["allocations"] == saved["allocations"]
    edit["expected_version"] = unchanged["version"]
    edit["allocations"][1]["stay"] = None
    reset = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert reset["shared_duration_id"] == body["duration_id"]
    assert all(a["uses_reservation_stay"] for a in reset["allocations"])
    assert reset["pricing"]["snapshot"]["total_minor"] == 220000


def test_custom_replay_resource_hash_and_database_derived_range(multi_api):
    client, service, body, ids, extra = multi_api
    key = uuid4()
    independent(body, ids)
    response = client.post("/api/v1/multi-room-reservations", json=body, headers=headers(key))
    saved = response.json()
    assert response.status_code == 201, response.text
    assert (
        client.post("/api/v1/multi-room-reservations", json=body, headers=headers(key)).json()
        == saved
    )
    body["allocations"][1]["stay"]["scheduled_start"] = "2026-11-12T14:00:00+08:00"
    assert (
        client.post("/api/v1/multi-room-reservations", json=body, headers=headers(key)).status_code
        == 409
    )
    before = raw_state(service)
    with pytest.raises(IntegrityError), service.engine.begin() as c:
        c.execute(
            reservations.update()
            .where(reservations.c.id == saved["id"])
            .values(shared_end=sa.func.now())
        )
    assert raw_state(service) == before


def test_individual_window_and_atomic_bulk_use_own_stays(multi_api):
    client, service, body, ids, extra = multi_api
    body["scheduled_start"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    body["allocations"][1]["stay"] = dict(
        scheduled_start=(datetime.now(UTC) + timedelta(days=1)).isoformat(),
        duration_id=str(ids["hourly"]),
    )
    saved = write(client, "multi-room-reservations", body)
    before = raw_state(service)
    assert action(client, saved, "check-in").status_code == 409
    assert raw_state(service) == before
    assert action(client, saved, "check-in", saved["allocations"][1]["id"]).status_code == 409
    occupied = action(client, saved, "check-in", saved["allocations"][0]["id"]).json()
    edit = custom_edit(body, occupied)
    edit["allocations"][1]["stay"]["scheduled_start"] = (
        datetime.now(UTC) + timedelta(days=2)
    ).isoformat()
    assert (
        client.post(
            f"/api/v1/reservations/{saved['id']}/edit-allocations", json=edit, headers=headers()
        ).status_code
        == 409
    )
    assert action(client, occupied, "check-out", saved["allocations"][0]["id"]).status_code == 200


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
def test_custom_create_rollback(multi_api, stage):
    independent(multi_api[2], multi_api[3])
    rollback_case(multi_api, stage)


@pytest.mark.parametrize("same_key", [True, False])
def test_custom_competing_creates(multi_api, same_key):
    independent(multi_api[2], multi_api[3])
    competing_case(multi_api, same_key)


@pytest.mark.parametrize(
    "stage", ["reservation", "allocation", "pricing", "audit", "receipt", "commit"]
)
def test_custom_edit_rollback(multi_api, stage):
    independent(multi_api[2], multi_api[3])
    edit_rollback_case(multi_api, stage)


def test_custom_entitlements_financials_and_immutable_document(multi_api):
    from test_billing_documents import draft, finalize
    from test_breakfast import selection, setup
    from test_discount_presets import preset, selected
    from test_manual_discounts import intent

    client, service, body, ids, extra = multi_api
    independent(body, ids)
    meal, drink, _ = setup(client)
    refs = client.get("/api/v1/reference-data").json()
    extra_cat = next(c["id"] for c in refs["inventory_categories"] if c["type"] == "extra")
    inclusion_cat = next(c["id"] for c in refs["inventory_categories"] if c["type"] == "inclusion")
    product = write(
        client,
        "configuration/products",
        dict(
            label="Extra", category_id=extra_cat, unit_amount_minor=5000, available_for_sale=False
        ),
    )
    inclusion = write(
        client,
        "configuration/products",
        dict(
            label="Towel",
            category_id=inclusion_cat,
            unit_amount_minor=300,
            available_for_sale=False,
        ),
    )
    body["allocations"][0]["inclusions"] = [
        dict(product_id=inclusion["id"], quantity=0, overridden=True)
    ]
    from test_inclusions import defaults

    assert (
        defaults(client, ids["type"], [dict(product_id=inclusion["id"], quantity=1)]).status_code
        == 200
    )
    body["allocations"][1]["inclusions"] = [dict(product_id=inclusion["id"], quantity=2)]
    body["allocations"][1]["breakfast"] = [
        selection(meal, drink, date="2026-11-12", guest=1),
        selection(meal, drink, date="2026-11-13", guest=1),
    ]
    body["allocations"][1]["charges"] = [
        dict(id=str(uuid4()), product_id=product["id"], quantity=1, usage="extra_charge")
    ]
    offer = preset(
        client,
        label="Nightly offer",
        scope="room",
        method="final_price",
        value="0",
        target_room_type_id=str(ids["type"]),
        rate_prices=[dict(rate_id=str(ids["nightly-rate"]), unit_amount_minor=200000)],
    )
    body["discounts"] = [
        selected(offer, extra[0]["id"]),
        intent("room", "percentage", "10", extra[0]["id"]),
        intent("reservation", "percentage", "10", ""),
    ]
    body["adjustments"] = [
        dict(id=str(uuid4()), amount_minor=1000, reason="Service"),
        dict(id=str(uuid4()), amount_minor=-500, reason="Courtesy"),
    ]
    saved = write(client, "multi-room-reservations", body)
    # 110000 + (400000 + 5000) * .9, then reservation .9, then signed 500.
    assert saved["pricing"]["snapshot"]["total_minor"] == 427550
    assert saved["allocations"][0]["breakfast"] == []
    assert len(saved["allocations"][1]["breakfast"]) == 2
    assert saved["allocations"][0]["inclusions"][0]["quantity"] == 0
    doc = draft(client, saved).json()
    assert doc["capture"]["schema_version"] == 3
    assert [a["scheduled_end"] for a in doc["capture"]["allocations"]] == [
        a["scheduled_end"] for a in saved["allocations"]
    ]
    final = finalize(client, doc)
    assert final.status_code == 200, final.text
    history = raw_state(service)["pricing_revisions"]
    edit = custom_edit(body, saved)
    edit["allocations"][1]["stay"]["scheduled_start"] = "2026-11-12T14:00:00+08:00"
    # Prune the first date; retain its historical selection in the operational audit.
    edit["allocations"][1]["breakfast"] = [selection(meal, drink, date="2026-11-13", guest=1)]
    newer = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert newer["pricing"] == saved["pricing"]
    assert raw_state(service)["pricing_revisions"] == history
    assert len(newer["allocations"][1]["breakfast"]) == 1
    assert client.get("/api/v1/billing-documents/" + doc["id"]).json() == final.json()
    # Hourly stay cannot receive a complimentary nightly selection.
    edit = custom_edit(body, newer)
    edit["allocations"][0]["breakfast"] = [selection(meal, drink, date="2026-11-11", guest=1)]
    before = raw_state(service)
    assert (
        client.post(
            f"/api/v1/reservations/{saved['id']}/edit-allocations", json=edit, headers=headers()
        ).status_code
        == 422
    )
    assert raw_state(service) == before


def test_old_b2_hash_excludes_omitted_custom_fields(multi_api):
    import hashlib
    import json

    from app.modules.reservations.multi_schemas import MultiCreate
    from app.mutations import request_hash

    request = MultiCreate.model_validate(multi_api[2])
    original = request.model_dump(
        mode="json", exclude={"discounts", "booking_financials", "collections", "guest_obligation"}
    )
    for value in original["allocations"]:
        value.pop("stay")
    digest = hashlib.sha256(
        json.dumps(original, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    assert request_hash(request) == digest


def test_concurrent_different_allocation_stay_edits_reject_stale_then_review(multi_api):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    client, service, body, ids, extra = multi_api
    saved = write(client, "multi-room-reservations", independent(body, ids))
    barrier = Barrier(2)

    def worker(index):
        edit = custom_edit(body, saved)
        edit["allocations"][index]["stay"] = dict(
            duration_id=edit["allocations"][index]
            .get("stay", {})
            .get("duration_id", body["duration_id"]),
            scheduled_start=f"2026-11-{14 + index}T14:00:00+08:00",
        )
        barrier.wait(timeout=5)
        return index, client.post(
            f"/api/v1/reservations/{saved['id']}/edit-allocations", json=edit, headers=headers()
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(worker, range(2)))
    assert sorted(r.status_code for _, r in results) == [200, 409]
    winner = next(r.json() for _, r in results if r.status_code == 200)
    loser = next(index for index, r in results if r.status_code == 409)
    # Review from the winner's canonical schedules, retaining its other allocation.
    edit = custom_edit(body, winner)
    edit["allocations"][loser]["stay"] = dict(
        duration_id=winner["allocations"][loser]["duration_id"],
        scheduled_start=f"2026-11-{14 + loser}T14:00:00+08:00",
    )
    merged = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert merged["version"] == 3
    assert (
        merged["allocations"][1 - loser]["scheduled_start"]
        == winner["allocations"][1 - loser]["scheduled_start"]
    )


def test_reset_uses_captured_template_basis_after_duration_definition_changes(multi_api):
    from app.models import durations

    client, service, body, ids, extra = multi_api
    body["duration_id"] = str(ids["overnight"])
    body["allocations"] = body["allocations"][:1]
    saved = write(client, "multi-room-reservations", body)
    with service.engine.begin() as c:
        c.execute(durations.update().where(durations.c.id == ids["overnight"]).values(nights=2))
    edit = edit_body(body, saved)
    edit["allocations"].append(
        dict(
            room_id=extra[0]["id"],
            adults=1,
            stay=dict(
                scheduled_start="2026-11-12T14:00:00+08:00", duration_id=str(ids["overnight"])
            ),
        )
    )
    custom = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert [line["quantity"] for line in custom["pricing"]["snapshot"]["lines"]] == [1, 2]
    reset = custom_edit(edit, custom)
    reset["allocations"][1]["stay"] = None
    result = write(client, f"reservations/{saved['id']}/edit-allocations", reset)
    assert result["allocations"][1]["scheduled_end"] == result["allocations"][0]["scheduled_end"]
    assert [line["quantity"] for line in result["pricing"]["snapshot"]["lines"]] == [1, 1]
    assert result["pricing"]["snapshot"]["total_minor"] == 440000


def test_inheritance_mode_and_unused_template_changes_reject_after_check_in(multi_api):
    client, service, body, ids, extra = multi_api
    body["scheduled_start"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    body["allocations"][1]["stay"] = dict(
        scheduled_start=body["scheduled_start"], duration_id=body["duration_id"]
    )
    body["allocations"][0]["stay"] = dict(body["allocations"][1]["stay"])
    saved = write(client, "multi-room-reservations", body)
    occupied = action(client, saved, "check-in").json()
    edit = custom_edit(body, occupied)
    edit["allocations"][1]["stay"] = None
    before = raw_state(service)
    assert (
        client.post(
            f"/api/v1/reservations/{saved['id']}/edit-allocations", json=edit, headers=headers()
        ).status_code
        == 409
    )
    assert raw_state(service) == before
    edit = custom_edit(body, occupied)
    edit["scheduled_start"] = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    assert (
        client.post(
            f"/api/v1/reservations/{saved['id']}/edit-allocations", json=edit, headers=headers()
        ).status_code
        == 409
    )
    assert raw_state(service) == before
