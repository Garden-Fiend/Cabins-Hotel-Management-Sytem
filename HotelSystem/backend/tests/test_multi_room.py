from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from test_reservation_api import api as reservation_fixture
from test_reservation_patch import raw_state as base_state

from app.models import allocations, billing_documents, document_counters, rates, rooms

api = reservation_fixture
pytestmark = pytest.mark.postgres


def raw_state(service):
    result = base_state(service)
    with service.engine.connect() as c:
        result["rooms"] = [
            dict(row)
            for row in c.execute(
                sa.select(rooms)
                .where(rooms.c.company_id == service.context.company_id)
                .order_by(rooms.c.id)
            ).mappings()
        ]
    return result


def headers(key=None):
    return {"Idempotency-Key": str(key or uuid4())}


def write(client, path, body):
    response = client.post("/api/v1/" + path, json=body, headers=headers())
    assert response.status_code in (200, 201), response.text
    return response.json()


@pytest.fixture
def multi_api(api):
    client, service, body, ids = api
    extra = []
    for number in ("102", "103"):
        extra.append(
            write(
                client,
                "configuration/rooms",
                dict(number=number, room_type_id=str(ids["type"]), display_name=""),
            )
        )
    body = {k: v for k, v in body.items() if k not in ("room_id", "adults", "children")}
    body["allocations"] = [
        dict(room_id=str(ids["room"]), adults=2, children=0),
        dict(room_id=extra[0]["id"], adults=1),
    ]
    try:
        yield client, service, body, ids, extra
    finally:
        # Owned synthetic document cleanup, identical to the existing billing fixture.
        with service.engine.begin() as c:
            if c.scalar(
                sa.select(sa.func.count())
                .select_from(billing_documents)
                .where(billing_documents.c.company_id == service.context.company_id)
            ):
                c.execute(
                    sa.text(
                        "ALTER TABLE hms.billing_documents DISABLE TRIGGER billing_documents_guard"
                    )
                )
                c.execute(
                    billing_documents.delete().where(
                        billing_documents.c.company_id == service.context.company_id
                    )
                )
                c.execute(
                    sa.text(
                        "ALTER TABLE hms.billing_documents ENABLE TRIGGER billing_documents_guard"
                    )
                )
                c.execute(
                    document_counters.delete().where(
                        document_counters.c.company_id == service.context.company_id
                    )
                )


def edit_body(body, saved):
    result = dict(body, expected_version=saved["version"])
    captured = {
        d["id"]: {
            k: d[k]
            for k in (
                "id",
                "label",
                "scope",
                "method",
                "value",
                "target_id",
                "currency",
                "preset_id",
            )
            if k in d
        }
        for d in saved["pricing"]["snapshot"].get("discounts", [])
    }
    for d in saved["pricing"]["snapshot"].get("price_overrides", []):
        captured[d["id"]] = dict(
            id=d["id"],
            label=d["label"],
            scope=d["scope"],
            method="final_price",
            value="0",
            target_id=d["line_id"].removeprefix("room:") if d["scope"] == "room" else d["line_id"],
            currency=d["currency"],
            preset_id=d["preset_id"],
        )
    if "discounts" in body:
        result["discounts"] = [captured.get(d["id"], d) for d in body["discounts"]]
    by_room = {a["room_id"]: a for a in saved["allocations"] if not a["removed_at"]}
    result["allocations"] = [dict(a, id=by_room[a["room_id"]]["id"]) for a in body["allocations"]]
    return result


def action(client, saved, action, allocation=None, key=None):
    return client.post(
        f"/api/v1/reservations/{saved['id']}/room-lifecycle/{action}",
        json=dict(
            expected_version=saved["version"],
            **({"allocation_id": allocation} if allocation else {}),
        ),
        headers=headers(key),
    )


def test_plural_create_read_and_duplicate_key(multi_api):
    client, service, body, ids, extra = multi_api
    key = uuid4()
    result = client.post("/api/v1/multi-room-reservations", json=body, headers=headers(key))
    assert result.status_code == 201, result.text
    saved = result.json()
    assert saved["allocation"] is None and len(saved["allocations"]) == 2
    assert (
        saved["aggregate_status"] == "reserved"
        and saved["pricing"]["snapshot"]["total_minor"] == 220000
    )
    assert client.get("/api/v1/reservations/" + saved["id"]).json() == saved
    assert client.get("/api/v1/reservations").json() == [saved]
    assert (
        client.post("/api/v1/multi-room-reservations", json=body, headers=headers(key)).json()
        == saved
    )
    assert (
        client.post(
            "/api/v1/multi-room-reservations",
            json=body | dict(note="changed"),
            headers=headers(key),
        ).status_code
        == 409
    )
    before = raw_state(service)
    assert (
        client.post("/api/v1/multi-room-reservations", json=body, headers=headers()).status_code
        == 409
    )
    assert raw_state(service) == before


def test_add_remove_retains_identity_price_and_tombstone(multi_api):
    client, service, body, ids, extra = multi_api
    saved = write(client, "multi-room-reservations", body)
    edit = edit_body(body, saved)
    edit["allocations"].append(dict(room_id=extra[1]["id"], adults=1))
    changed = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert changed["pricing"]["snapshot"]["total_minor"] == 330000
    assert {a["id"] for a in saved["allocations"]} <= {a["id"] for a in changed["allocations"]}
    edit = edit_body(body, changed)
    final = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert final["pricing"]["snapshot"]["total_minor"] == 220000
    assert (
        len(final["allocations"]) == 3
        and len([a for a in final["allocations"] if a["state"] == "removed"]) == 1
    )
    assert len(raw_state(service)["pricing_revisions"]) == 3
    edit["expected_version"] = final["version"]
    edit["allocations"] = []
    assert (
        client.post(
            f"/api/v1/reservations/{saved['id']}/edit-allocations", json=edit, headers=headers()
        ).status_code
        == 422
    )


def test_independent_and_strict_bulk_lifecycle(multi_api):
    client, service, body, ids, extra = multi_api
    body["scheduled_start"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    saved = write(client, "multi-room-reservations", body)
    first = action(client, saved, "check-in", saved["allocations"][0]["id"])
    assert first.status_code == 200, first.text
    mixed = first.json()
    assert mixed["aggregate_status"] == "partially_checked_in"
    assert sorted(a["state"] for a in mixed["allocations"]) == ["checked_in", "reserved"]
    before = raw_state(service)
    assert action(client, mixed, "check-in").status_code == 409
    assert action(client, mixed, "check-out").status_code == 409
    assert raw_state(service) == before
    other = next(a for a in mixed["allocations"] if a["state"] == "reserved")
    occupied = action(client, mixed, "check-in", other["id"]).json()
    assert occupied["aggregate_status"] == "checked_in"
    key = uuid4()
    response = action(client, occupied, "check-out", key=key)
    assert response.status_code == 200, response.text
    out = response.json()
    assert out["status"] == "checked_out" and all(
        a["state"] == "checked_out" for a in out["allocations"]
    )
    assert action(client, occupied, "check-out", key=key).json() == out
    assert out["pricing"] == saved["pricing"]
    assert all(
        r["housekeeping"] == "dirty"
        for r in raw_state(service)["rooms"]
        if str(r["id"]) in {a["room_id"] for a in out["allocations"]}
    )


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
def test_multi_create_rollback_and_retry(multi_api, stage):
    client, service, body, ids, extra = multi_api
    baseline = raw_state(service)
    key = uuid4()

    def sql_fail(conn, cursor, statement, params, context, many):
        if statement.startswith(f"INSERT INTO hms.{stage}"):
            raise RuntimeError("multi fail")

    def fail_commit(session):
        raise RuntimeError("multi fail")

    target, event, handler = (
        (Session, "before_commit", fail_commit)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", sql_fail)
    )
    sa.event.listen(target, event, handler)
    try:
        with pytest.raises(RuntimeError, match="multi fail"):
            client.post("/api/v1/multi-room-reservations", json=body, headers=headers(key))
    finally:
        sa.event.remove(target, event, handler)
    assert raw_state(service) == baseline
    assert (
        client.post("/api/v1/multi-room-reservations", json=body, headers=headers(key)).status_code
        == 201
    )


def test_competing_shared_room_create_and_identical_replay(multi_api):
    client, service, body, ids, extra = multi_api
    barrier, key = Barrier(2), uuid4()

    def worker(_):
        barrier.wait(timeout=5)
        return client.post("/api/v1/multi-room-reservations", json=body, headers=headers(key))

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(worker, range(2)))
    assert [r.status_code for r in responses] == [201, 201]
    assert responses[0].json() == responses[1].json()
    assert len(raw_state(service)["reservations"]) == 1


def test_duplicate_room_and_client_price_rejected(multi_api):
    client, service, body, ids, extra = multi_api
    before = raw_state(service)
    duplicate = body | dict(allocations=[body["allocations"][0]] * 2)
    assert (
        client.post(
            "/api/v1/multi-room-reservations", json=duplicate, headers=headers()
        ).status_code
        == 422
    )
    bad = body | dict(total_minor=1)
    assert (
        client.post("/api/v1/multi-room-reservations", json=bad, headers=headers()).status_code
        == 422
    )
    assert raw_state(service) == before


def test_three_rooms_different_types_and_server_rates(multi_api):
    client, service, body, ids, extra = multi_api
    kind = write(client, "configuration/room-types", dict(label="Deluxe", default_capacity=3))
    write(
        client,
        "configuration/rates",
        dict(
            room_type_id=kind["id"],
            booking_kind="hourly",
            duration_id=str(ids["hourly"]),
            unit_amount_minor=170000,
        ),
    )
    response = client.patch(
        "/api/v1/configuration/rooms/" + extra[0]["id"],
        json=dict(
            expected_version=extra[0]["version"],
            number="102",
            room_type_id=kind["id"],
            display_name="",
        ),
        headers=headers(),
    )
    assert response.status_code == 200, response.text
    body["allocations"].append(dict(room_id=extra[1]["id"], adults=1))
    saved = write(client, "multi-room-reservations", body)
    assert saved["pricing"]["snapshot"]["total_minor"] == 390000
    assert [a["room_id"] for a in saved["allocations"]] == [
        a["room_id"] for a in body["allocations"]
    ]


def test_room_scoped_financial_attribution_and_capture_history(multi_api):
    from test_discount_presets import preset, selected
    from test_manual_discounts import intent

    client, service, body, ids, extra = multi_api
    cat = write(client, "configuration/categories", dict(label="Meals", type="ordinary"))
    meal = write(
        client,
        "configuration/products",
        dict(label="Meal", category_id=cat["id"], unit_amount_minor=10000, available_for_sale=True),
    )
    refs = client.get("/api/v1/reference-data").json()
    extra_cat = next(c for c in refs["inventory_categories"] if c["type"] == "extra")
    bed = write(
        client,
        "configuration/products",
        dict(
            label="Bed",
            category_id=extra_cat["id"],
            unit_amount_minor=5000,
            available_for_sale=False,
        ),
    )
    body["allocations"][0]["charges"] = [
        dict(id=str(uuid4()), product_id=meal["id"], quantity=2, usage="purchase")
    ]
    body["allocations"][1]["charges"] = [
        dict(id=str(uuid4()), product_id=bed["id"], quantity=1, usage="extra_charge")
    ]
    offer = preset(
        client,
        label="Room offer",
        scope="room",
        method="final_price",
        value="0",
        target_room_type_id=str(ids["type"]),
        rate_prices=[dict(rate_id=str(ids["hourly-rate"]), unit_amount_minor=90000)],
    )
    body["discounts"] = [
        selected(offer, extra[0]["id"]),
        intent("room", "percentage", "10", str(ids["room"])),
        intent("reservation", "percentage", "10", ""),
    ]
    body["adjustments"] = [
        dict(id=str(uuid4()), amount_minor=1000, reason="Service"),
        dict(id=str(uuid4()), amount_minor=-500, reason="Correction"),
    ]
    saved = write(client, "multi-room-reservations", body)
    raw = saved["pricing"]["snapshot"]
    assert raw["total_minor"] == 191300
    assert raw["price_overrides"][0]["line_id"] == "room:" + extra[0]["id"]
    assert raw["price_override_total_minor"] == 20000
    scoped = next(d for d in raw["discounts"] if d["scope"] == "room")
    assert scoped["amount_minor"] == 13000
    assert {a["line_id"] for a in scoped["allocations"]} == {
        "room:" + str(ids["room"]),
        body["allocations"][0]["charges"][0]["id"],
    }
    original_prices = raw_state(service)["pricing_revisions"]
    # Changing current prices does not reprice unrelated accommodation or purchases.
    with service.engine.begin() as c:
        c.execute(
            rates.update().where(rates.c.id == ids["hourly-rate"]).values(unit_amount_minor=220000)
        )
    edit = edit_body(body, saved) | dict(note="Preserved financial captures")
    updated = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert updated["pricing"] == saved["pricing"]
    assert raw_state(service)["pricing_revisions"] == original_prices


def test_nightly_inclusions_and_breakfast_are_per_allocation(multi_api):
    from test_breakfast import selection, setup

    client, service, body, ids, extra = multi_api
    meal, drink, _items = setup(client)
    refs = client.get("/api/v1/reference-data").json()
    inclusion = write(
        client,
        "configuration/products",
        dict(
            label="Towel",
            category_id=next(
                c["id"] for c in refs["inventory_categories"] if c["type"] == "inclusion"
            ),
            unit_amount_minor=100,
            available_for_sale=False,
        ),
    )
    body["duration_id"] = str(ids["overnight"])
    body["allocations"][0].update(
        inclusions=[dict(product_id=inclusion["id"], quantity=2)],
        breakfast=[selection(meal, drink, date="2026-11-11", guest=1)],
    )
    body["allocations"][1].update(
        inclusions=[dict(product_id=inclusion["id"], quantity=1)],
        breakfast=[selection(meal, drink, date="2026-11-11", guest=1)],
    )
    saved = write(client, "multi-room-reservations", body)
    assert saved["pricing"]["snapshot"]["total_minor"] == 440000
    assert [a["inclusions"][0]["quantity"] for a in saved["allocations"]] == [2, 1]
    assert all(a["breakfast"][0]["amount_minor"] == 0 for a in saved["allocations"])


def test_single_room_promotion_preserves_ids_and_old_hash_replay(multi_api):
    client, service, body, ids, extra = multi_api
    single = {k: v for k, v in body.items() if k != "allocations"} | dict(
        room_id=str(ids["room"]), adults=2
    )
    key = uuid4()
    original = client.post("/api/v1/reservations", json=single, headers=headers(key)).json()
    edit = body | dict(expected_version=original["version"])
    edit["allocations"] = [
        dict(body["allocations"][0], id=original["allocation"]["id"]),
        body["allocations"][1],
    ]
    promoted = write(client, f"reservations/{original['id']}/edit-allocations", edit)
    assert promoted["id"] == original["id"]
    assert original["allocation"]["id"] in {a["id"] for a in promoted["allocations"]}
    assert client.post("/api/v1/reservations", json=single, headers=headers(key)).json() == original
    assert (
        client.patch(
            f"/api/v1/reservations/{original['id']}",
            json=dict(expected_version=promoted["version"], note="Unsafe singular write"),
            headers=headers(),
        ).status_code
        == 409
    )
    assert len(raw_state(service)["pricing_revisions"]) == 2


def test_checked_in_financial_edit_keeps_occupancy_and_no_note_reprice(multi_api):
    client, service, body, ids, extra = multi_api
    body["scheduled_start"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    saved = write(client, "multi-room-reservations", body)
    occupied = action(client, saved, "check-in").json()
    edit = edit_body(body, occupied) | dict(
        note="Still occupied",
        adjustments=[dict(id=str(uuid4()), amount_minor=-100, reason="Courtesy")],
    )
    updated = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert updated["pricing"]["snapshot"]["total_minor"] == 219900
    assert all(a["state"] == "checked_in" and a["actual_check_in"] for a in updated["allocations"])
    assert [a["actual_check_in"] for a in updated["allocations"]] == [
        a["actual_check_in"] for a in occupied["allocations"]
    ]
    edit = edit_body(body, updated)
    edit["allocations"] = edit["allocations"][:1]
    before = raw_state(service)
    assert (
        client.post(
            f"/api/v1/reservations/{saved['id']}/edit-allocations", json=edit, headers=headers()
        ).status_code
        == 409
    )
    assert raw_state(service) == before


@pytest.mark.parametrize("same_key", [True, False])
def test_real_competing_creates_sorted_room_locks(multi_api, same_key):
    client, service, body, ids, extra = multi_api
    barrier, key = Barrier(2), uuid4()

    def worker(index):
        barrier.wait(timeout=5)
        data = (
            body
            if same_key or not index
            else body | dict(allocations=list(reversed(body["allocations"])))
        )
        return client.post(
            "/api/v1/multi-room-reservations", json=data, headers=headers(key if same_key else None)
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(worker, range(2)))
    assert sorted(r.status_code for r in responses) == ([201, 201] if same_key else [201, 409])
    assert len(raw_state(service)["reservations"]) == 1


def test_cross_company_or_unknown_room_rejected(multi_api):
    client, service, body, ids, extra = multi_api
    body["allocations"][1]["room_id"] = str(uuid4())
    before = raw_state(service)
    assert (
        client.post("/api/v1/multi-room-reservations", json=body, headers=headers()).status_code
        == 404
    )
    assert raw_state(service) == before


@pytest.mark.parametrize(
    "stage", ["allocation", "room", "reservation", "audit", "receipt", "commit"]
)
def test_bulk_lifecycle_failure_after_writes_rolls_back(multi_api, stage):
    client, service, body, ids, extra = multi_api
    body["scheduled_start"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    saved = write(client, "multi-room-reservations", body)
    before, key = raw_state(service), uuid4()
    prefix = {
        "allocation": "UPDATE hms.room_allocations",
        "room": "UPDATE hms.rooms",
        "reservation": "UPDATE hms.reservations",
        "audit": "INSERT INTO hms.operational_audit",
        "receipt": "INSERT INTO hms.mutation_receipts",
    }

    def sql_fail(conn, cursor, statement, params, context, many):
        if statement.startswith(prefix.get(stage, "NEVER")):
            raise RuntimeError("bulk rollback")

    def commit_fail(session):
        raise RuntimeError("bulk rollback")

    target, event, handler = (
        (Session, "before_commit", commit_fail)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", sql_fail)
    )
    sa.event.listen(target, event, handler)
    try:
        with pytest.raises(RuntimeError, match="bulk rollback"):
            action(client, saved, "check-in", key=key)
    finally:
        sa.event.remove(target, event, handler)
    assert raw_state(service) == before
    assert action(client, saved, "check-in", key=key).status_code == 200


def test_mixed_individual_checkout_and_dirty_bulk_rejection(multi_api):
    client, service, body, ids, extra = multi_api
    body["scheduled_start"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    saved = write(client, "multi-room-reservations", body)
    with service.engine.begin() as c:
        c.execute(rooms.update().where(rooms.c.id == ids["room"]).values(housekeeping="dirty"))
    before = raw_state(service)
    assert action(client, saved, "check-in").status_code == 409
    assert raw_state(service) == before
    with service.engine.begin() as c:
        c.execute(rooms.update().where(rooms.c.id == ids["room"]).values(housekeeping="clean"))
    occupied = action(client, saved, "check-in").json()
    partial = action(client, occupied, "check-out", occupied["allocations"][0]["id"]).json()
    assert (
        partial["aggregate_status"] == "partially_checked_out" and partial["status"] == "checked_in"
    )
    assert sorted(a["state"] for a in partial["allocations"]) == ["checked_in", "checked_out"]
    assert action(client, occupied, "check-out").status_code == 409


def test_multi_billing_capture_finalize_and_immutable_after_edit(multi_api):
    from test_billing_documents import draft, finalize

    client, service, body, ids, extra = multi_api
    saved = write(client, "multi-room-reservations", body)
    response = draft(client, saved)
    assert response.status_code == 201, response.text
    document = response.json()
    assert document["capture"]["schema_version"] == 2 and len(document["lines"]) == 2
    result = finalize(client, document)
    assert result.status_code == 200, result.text
    final = result.json()
    edited = edit_body(body, saved)
    edited["allocations"] = edited["allocations"][:1]
    newer = write(client, f"reservations/{saved['id']}/edit-allocations", edited)
    assert newer["pricing"]["snapshot"]["total_minor"] == 110000
    assert client.get("/api/v1/billing-documents/" + document["id"]).json() == final
    with pytest.raises(IntegrityError), service.engine.begin() as c:
        c.execute(
            billing_documents.update()
            .where(billing_documents.c.id == document["id"])
            .values(total_minor=1)
        )


def test_deferred_database_shared_stay_and_tombstone_guards(multi_api):
    client, service, body, ids, extra = multi_api
    saved = write(client, "multi-room-reservations", body)
    before = raw_state(service)
    with pytest.raises(IntegrityError), service.engine.begin() as c:
        c.execute(
            allocations.update()
            .where(allocations.c.id == saved["allocations"][0]["id"])
            .values(scheduled_end=sa.func.now() + sa.text("interval '100 days'"))
        )
    assert raw_state(service) == before
    with pytest.raises(IntegrityError), service.engine.begin() as c:
        c.execute(allocations.delete().where(allocations.c.id == saved["allocations"][0]["id"]))
    assert raw_state(service) == before


def test_arrival_only_keeps_captured_checkout_policy(multi_api):
    from datetime import time

    from app.models import companies

    client, service, body, ids, extra = multi_api
    body["duration_id"] = str(ids["overnight"])
    saved = write(client, "multi-room-reservations", body)
    old_end = datetime.fromisoformat(saved["shared_end"])
    with service.engine.begin() as c:
        c.execute(
            companies.update()
            .where(companies.c.id == service.context.company_id)
            .values(default_check_out_time=time(16))
        )
    edited = edit_body(body, saved)
    edited["scheduled_start"] = (
        datetime.fromisoformat(body["scheduled_start"]) + timedelta(days=1)
    ).isoformat()
    newer = write(client, f"reservations/{saved['id']}/edit-allocations", edited)
    assert datetime.fromisoformat(newer["shared_end"]) == old_end + timedelta(days=1)
    assert (
        newer["pricing"]["snapshot"]["total_minor"] == saved["pricing"]["snapshot"]["total_minor"]
    )


def test_added_room_uses_booked_shared_night_count_not_changed_definition(multi_api):
    from app.models import durations

    client, service, body, ids, extra = multi_api
    body["duration_id"] = str(ids["two-nights"])
    saved = write(client, "multi-room-reservations", body)
    with service.engine.begin() as c:
        c.execute(durations.update().where(durations.c.id == ids["two-nights"]).values(nights=5))
    edit = edit_body(body, saved)
    edit["allocations"].append(dict(room_id=extra[1]["id"], adults=1))
    newer = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert newer["shared_end"] == saved["shared_end"]
    assert {line["quantity"] for line in newer["pricing"]["snapshot"]["lines"]} == {2}
    assert newer["pricing"]["snapshot"]["total_minor"] == 1320000


def test_cancel_mixed_occupancy_then_record_only_retained_departure(multi_api):
    client, service, body, ids, extra = multi_api
    body["scheduled_start"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    saved = write(client, "multi-room-reservations", body)
    occupied = action(client, saved, "check-in", saved["allocations"][0]["id"]).json()
    cancelled = action(client, occupied, "cancel").json()
    assert cancelled["status"] == "cancelled"
    assert sum(a["blocks_availability"] for a in cancelled["allocations"]) == 1
    released = action(client, cancelled, "record-departure")
    assert released.status_code == 200, released.text
    assert not any(a["blocks_availability"] for a in released.json()["allocations"])
    assert released.json()["pricing"] == saved["pricing"]


def test_individual_checkout_with_another_reserved_projects_no_phantom_occupancy(multi_api):
    client, service, body, ids, extra = multi_api
    body["scheduled_start"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    saved = write(client, "multi-room-reservations", body)
    target = saved["allocations"][0]["id"]
    occupied = action(client, saved, "check-in", target).json()
    released = action(client, occupied, "check-out", target).json()
    assert released["status"] == "confirmed"
    assert released["aggregate_status"] == "partially_checked_out"


def test_tombstone_cannot_be_resurrected_or_existing_identity_omitted(multi_api):
    client, service, body, ids, extra = multi_api
    saved = write(client, "multi-room-reservations", body)
    edit = edit_body(body, saved)
    edit["allocations"][0].pop("id")
    assert (
        client.post(
            f"/api/v1/reservations/{saved['id']}/edit-allocations", json=edit, headers=headers()
        ).status_code
        == 422
    )
    edit = edit_body(body, saved)
    removed = edit["allocations"].pop()
    write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    before = raw_state(service)
    with pytest.raises(IntegrityError), service.engine.begin() as c:
        c.execute(
            allocations.update()
            .where(allocations.c.id == removed["id"])
            .values(removed_at=None, blocks_availability=True)
        )
    assert raw_state(service) == before


def test_foreign_context_cannot_read_edit_or_transition_real_aggregate(multi_api):
    from app.context import CommandContext, get_command_context

    client, service, body, ids, extra = multi_api
    saved = write(client, "multi-room-reservations", body)
    before = raw_state(service)
    client.app.dependency_overrides[get_command_context] = lambda: CommandContext(uuid4())
    try:
        assert client.get(f"/api/v1/reservations/{saved['id']}").status_code == 404
        assert client.get("/api/v1/reservations").json() == []
        assert (
            client.post(
                f"/api/v1/reservations/{saved['id']}/edit-allocations",
                json=edit_body(body, saved),
                headers=headers(),
            ).status_code
            == 404
        )
        assert action(client, saved, "check-in").status_code == 404
    finally:
        client.app.dependency_overrides[get_command_context] = lambda: service.context
    assert raw_state(service) == before


def test_plural_audit_preserves_exact_note_counts_and_lifecycle_instants(multi_api):
    client, service, body, ids, extra = multi_api
    body["scheduled_start"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    saved = write(client, "multi-room-reservations", body)
    edited = edit_body(body, saved) | dict(note="Updated note")
    edited["allocations"][0]["adults"] = 4
    newer = write(client, f"reservations/{saved['id']}/edit-allocations", edited)
    row = next(
        a
        for a in raw_state(service)["operational_audit"]
        if a["event_type"] == "reservation.multi_edit"
    )
    assert row["before"]["note"] == saved["note"]
    assert row["after"]["note"] == "Updated note"
    assert row["before"]["allocations"][0]["adults"] == 2
    assert row["after"]["allocations"][0]["adults"] == 4
    occupied = action(client, newer, "check-in").json()
    event = next(
        a
        for a in raw_state(service)["operational_audit"]
        if a["event_type"] == "reservation.multi_check_in"
    )
    assert event["before"]["version"] == 2 and event["after"]["version"] == 3
    assert all(a["actual_check_in"] is None for a in event["before"]["allocations"])
    assert [a["actual_check_in"] for a in event["after"]["allocations"]] == [
        a["actual_check_in"] for a in occupied["allocations"]
    ]


@pytest.mark.parametrize("same_key", [True, False])
def test_competing_plural_edits_accept_one_version_or_replay(multi_api, same_key):
    client, service, body, ids, extra = multi_api
    saved = write(client, "multi-room-reservations", body)
    edit = edit_body(body, saved) | dict(note="Reviewed edit")
    barrier, key = Barrier(2), uuid4()

    def worker(index):
        barrier.wait(timeout=5)
        return client.post(
            f"/api/v1/reservations/{saved['id']}/edit-allocations",
            json=edit if same_key else edit | dict(note=f"Edit {index}"),
            headers=headers(key if same_key else None),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(worker, range(2)))
    assert sorted(r.status_code for r in responses) == ([200, 200] if same_key else [200, 409])
    assert client.get(f"/api/v1/reservations/{saved['id']}").json()["version"] == 2
    assert len(raw_state(service)["pricing_revisions"]) == 1


@pytest.mark.parametrize(
    "stage", ["reservation", "allocation", "pricing", "audit", "receipt", "commit"]
)
def test_add_remove_financial_edit_rolls_back_all_stages_and_retries(multi_api, stage):
    client, service, body, ids, extra = multi_api
    saved = write(client, "multi-room-reservations", body)
    edit = edit_body(body, saved)
    edit["allocations"] = [edit["allocations"][0], dict(room_id=extra[1]["id"], adults=3)]
    edit["adjustments"] = [dict(id=str(uuid4()), amount_minor=-123, reason="Correction")]
    key, before = uuid4(), raw_state(service)
    prefix = {
        "reservation": "UPDATE hms.reservations",
        "allocation": "UPDATE hms.room_allocations",
        "pricing": "INSERT INTO hms.pricing_revisions",
        "audit": "INSERT INTO hms.operational_audit",
        "receipt": "INSERT INTO hms.mutation_receipts",
    }

    def sql_fail(conn, cursor, statement, params, context, many):
        if statement.startswith(prefix.get(stage, "NEVER")):
            raise RuntimeError("edit rollback")

    def commit_fail(session):
        raise RuntimeError("edit rollback")

    target, event, handler = (
        (Session, "before_commit", commit_fail)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", sql_fail)
    )
    sa.event.listen(target, event, handler)
    try:
        with pytest.raises(RuntimeError, match="edit rollback"):
            client.post(
                f"/api/v1/reservations/{saved['id']}/edit-allocations",
                json=edit,
                headers=headers(key),
            )
    finally:
        sa.event.remove(target, event, handler)
    assert raw_state(service) == before
    result = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-allocations", json=edit, headers=headers(key)
    )
    assert result.status_code == 200, result.text
    assert result.json()["version"] == 2
    assert result.json()["pricing"]["snapshot"]["total_minor"] == 219877
