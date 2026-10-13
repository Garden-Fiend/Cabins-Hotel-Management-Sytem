from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from app.context import CommandContext, get_command_context
from app.db import get_engine
from app.main import create_app
from app.models import (
    allocations,
    audit_events,
    mutation_receipts,
    pricing_revisions,
    rates,
    reservations,
    rooms,
)
from app.modules.reservations.schemas import GuestCreate, ReservationCreate, ReservationEdit
from app.modules.reservations.services import ReservationService

pytestmark = pytest.mark.postgres


@pytest.fixture
def patch_api(pg_engine, isolated_company):
    context, ids = isolated_company
    application = create_app()
    application.dependency_overrides[get_engine] = lambda: pg_engine
    application.dependency_overrides[get_command_context] = lambda: context
    service = ReservationService(pg_engine, context)
    guest = service.create_guest(GuestCreate(name="Patch test guest"), uuid4())
    saved = service.create(
        ReservationCreate(
            guest_id=guest.id,
            booking_source_id=ids["source"],
            room_id=ids["room"],
            duration_id=ids["hourly"],
            adults=2,
            children=1,
            note="Original note",
            scheduled_start="2026-11-10T14:07:12.123456+08:00",
        ),
        uuid4(),
    ).model_dump(mode="json")
    with TestClient(application, raise_server_exceptions=False) as client:
        yield client, service, saved, ids, application


def patch(client, id, body, key=None):
    return client.patch(
        f"/api/v1/reservations/{id}", json=body, headers={"Idempotency-Key": str(key or uuid4())}
    )


def details(client, id, body, key=None):
    return client.post(
        f"/api/v1/reservations/{id}/edit-details",
        json=body,
        headers={"Idempotency-Key": str(key or uuid4())},
    )


def test_guest_details_edit_is_atomic_captured_and_replayable(patch_api):
    client, service, saved, _ids, _app = patch_api
    guest = service.create_guest(GuestCreate(name="Corrected guest"), uuid4())
    before = raw_state(service)
    key = uuid4()
    body = dict(expected_version=1, guest_id=str(guest.id), note="Corrected", adults=4)
    result = details(client, saved["id"], body, key)
    assert result.status_code == 200, result.text
    canonical = result.json()
    assert canonical["guest"]["id"] == str(guest.id) and canonical["version"] == 2
    assert canonical["allocation"]["adults"] == 4
    assert canonical["pricing"] == saved["pricing"]
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == canonical
    after = raw_state(service)
    assert after["pricing_revisions"] == before["pricing_revisions"]
    event = next(
        row for row in after["operational_audit"] if row["event_type"] == "reservation.updated"
    )
    assert event["before"]["guest_id"] == saved["guest"]["id"]
    assert event["after"]["guest_id"] == str(guest.id)
    assert details(client, saved["id"], body, key).json() == canonical
    assert details(client, saved["id"], dict(body, note="Different"), key).status_code == 409
    assert details(client, saved["id"], body).status_code == 409
    assert raw_state(service) == after
    assert (
        patch(client, saved["id"], dict(expected_version=2, guest_id=str(guest.id))).status_code
        == 422
    )


def test_guest_details_rejects_unknown_guest_without_partial_changes(patch_api):
    client, service, saved, _ids, _app = patch_api
    before = raw_state(service)
    response = details(
        client, saved["id"], dict(expected_version=1, guest_id=str(uuid4()), adults=4)
    )
    assert response.status_code == 404
    assert raw_state(service) == before


def test_guest_details_commit_failure_rolls_back_and_key_can_retry(patch_api):
    client, service, saved, _ids, _app = patch_api
    guest = service.create_guest(GuestCreate(name="Rollback guest"), uuid4())
    before = raw_state(service)
    key, body = uuid4(), dict(expected_version=1, guest_id=str(guest.id), adults=4)

    def fail_commit(_connection):
        raise RuntimeError("Synthetic commit failure")

    sa.event.listen(service.engine, "commit", fail_commit)
    try:
        assert details(client, saved["id"], body, key).status_code == 500
    finally:
        sa.event.remove(service.engine, "commit", fail_commit)
    assert raw_state(service) == before
    assert details(client, saved["id"], body, key).status_code == 200


def stay_edit(client, saved, ids, **changes):
    body = dict(
        expected_version=saved["version"],
        guest_id=saved["guest"]["id"],
        room_id=saved["allocation"]["room_id"],
        duration_id=str(ids["overnight"]),
        scheduled_start=saved["allocation"]["scheduled_start"],
        **changes,
    )
    return client.post(
        f"/api/v1/reservations/{saved['id']}/edit-stay",
        json=body,
        headers={"Idempotency-Key": str(uuid4())},
    )


def test_stay_edit_appends_server_pricing_and_preserves_previous_capture(patch_api):
    client, service, saved, ids, _app = patch_api
    before = raw_state(service)
    result = stay_edit(client, saved, ids, note="New stay", adults=4)
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["version"] == 2 and data["allocation"]["id"] == saved["allocation"]["id"]
    assert data["allocation"]["scheduled_end"] == "2026-11-11T04:00:00Z"
    assert data["pricing"]["snapshot"]["total_minor"] == 220000
    assert data["pricing"]["revision"] == 2 and data["pricing"]["reservation_version"] == 2
    after = raw_state(service)
    assert all(row in after["pricing_revisions"] for row in before["pricing_revisions"])
    assert len(after["pricing_revisions"]) == 2
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == data
    assert stay_edit(client, saved, ids).status_code == 409
    assert raw_state(service) == after


def test_stay_edit_replay_conflict_and_unknown_room_roll_back(patch_api):
    client, service, saved, ids, _app = patch_api
    before = raw_state(service)
    body = dict(
        expected_version=1,
        guest_id=saved["guest"]["id"],
        room_id=str(uuid4()),
        duration_id=str(ids["overnight"]),
        scheduled_start=saved["allocation"]["scheduled_start"],
    )
    key = str(uuid4())
    path = f"/api/v1/reservations/{saved['id']}/edit-stay"
    assert client.post(path, json=body, headers={"Idempotency-Key": key}).status_code == 404
    assert raw_state(service) == before
    body["room_id"] = saved["allocation"]["room_id"]
    first = client.post(path, json=body, headers={"Idempotency-Key": key})
    assert first.status_code == 200, first.text
    after = raw_state(service)
    assert client.post(path, json=body, headers={"Idempotency-Key": key}).json() == first.json()
    assert (
        client.post(path, json=dict(body, adults=5), headers={"Idempotency-Key": key}).status_code
        == 409
    )
    assert raw_state(service) == after


@pytest.mark.parametrize(
    "table",
    [
        "room_allocations",
        "reservations",
        "pricing_revisions",
        "operational_audit",
        "mutation_receipts",
    ],
)
def test_stay_edit_each_write_failure_rolls_back(patch_api, table):
    client, service, saved, ids, _app = patch_api
    before = raw_state(service)

    def fail_after(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.lower().startswith((f"update hms.{table}", f"insert into hms.{table}")):
            raise RuntimeError("Synthetic write failure")

    sa.event.listen(service.engine, "after_cursor_execute", fail_after)
    try:
        response = stay_edit(client, saved, ids)
    finally:
        sa.event.remove(service.engine, "after_cursor_execute", fail_after)
    assert response.status_code == 500, response.text
    assert raw_state(service) == before


def test_arrival_only_edit_preserves_captured_duration_and_prices(patch_api):
    client, service, saved, ids, _app = patch_api
    before = raw_state(service)
    body = dict(
        expected_version=1,
        guest_id=saved["guest"]["id"],
        room_id=saved["allocation"]["room_id"],
        duration_id=str(ids["hourly"]),
        scheduled_start="2026-11-11T14:07:12.123456+08:00",
    )
    response = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-stay",
        json=body,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["allocation"]["scheduled_end"] == "2026-11-11T12:07:12.123456Z"
    assert data["pricing"] == saved["pricing"]
    assert raw_state(service)["pricing_revisions"] == before["pricing_revisions"]


def test_competing_room_transfers_have_one_winner_and_no_partial_loser(patch_api):
    client, service, saved, ids, _app = patch_api
    target, other_room = uuid4(), uuid4()
    with service.engine.begin() as c:
        for id, number in ((target, "202"), (other_room, "303")):
            c.execute(
                rooms.insert().values(
                    id=id,
                    company_id=service.context.company_id,
                    room_type_id=ids["type"],
                    number=number,
                )
            )
    other = service.create(
        ReservationCreate(
            guest_id=saved["guest"]["id"],
            booking_source_id=ids["source"],
            room_id=other_room,
            duration_id=ids["hourly"],
            adults=2,
            scheduled_start=saved["allocation"]["scheduled_start"],
        ),
        uuid4(),
    ).model_dump(mode="json")
    barrier = Barrier(2)

    def move(record):
        barrier.wait(timeout=5)
        body = dict(
            expected_version=1,
            guest_id=record["guest"]["id"],
            room_id=str(target),
            duration_id=str(ids["hourly"]),
            scheduled_start=record["allocation"]["scheduled_start"],
        )
        return client.post(
            f"/api/v1/reservations/{record['id']}/edit-stay",
            json=body,
            headers={"Idempotency-Key": str(uuid4())},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(move, (saved, other)))
    assert sorted(r.status_code for r in responses) == [200, 409]
    after = raw_state(service)
    assert sum(row["room_id"] == target for row in after["room_allocations"]) == 1
    assert sorted(row["version"] for row in after["reservations"]) == [1, 2]
    assert len(after["pricing_revisions"]) == 3


def test_stay_edit_disallows_occupied_or_final_reservations(patch_api):
    client, service, saved, ids, _app = patch_api
    with service.engine.begin() as c:
        c.execute(
            reservations.update()
            .where(reservations.c.id == saved["id"])
            .values(status="checked_out")
        )
    before = raw_state(service)
    assert stay_edit(client, saved, ids).status_code == 409
    assert raw_state(service) == before


def bill_edit(client, saved, adjustments, key=None, **changes):
    body = dict(
        expected_version=saved["version"], guest_id=saved["guest"]["id"], adjustments=adjustments
    )
    body.update(changes)
    return client.post(
        f"/api/v1/reservations/{saved['id']}/edit-billing",
        json=body,
        headers={"Idempotency-Key": str(key or uuid4())},
    )


def test_signed_adjustments_capture_exact_total_remove_once_and_preserve_history(patch_api):
    client, service, saved, ids, _app = patch_api
    a = dict(id=str(uuid4()), amount_minor=10025, reason="Correction A")
    b = dict(id=str(uuid4()), amount_minor=-20000, reason="Correction B")
    before = raw_state(service)
    key = uuid4()
    response = bill_edit(client, saved, [a, b], key, note="New bill note", adults=4)
    assert response.status_code == 200, response.text
    data = response.json()
    snapshot = data["pricing"]["snapshot"]
    assert snapshot["schema_version"] == 2 and snapshot["total_minor"] == 100025
    assert snapshot["adjustments"] == [a, b]
    assert snapshot["lines"] == saved["pricing"]["snapshot"]["lines"]
    assert (
        data["version"] == 2
        and data["note"] == "New bill note"
        and data["allocation"]["adults"] == 4
    )
    assert bill_edit(client, saved, [a, b], key, note="New bill note", adults=4).json() == data
    after = raw_state(service)
    assert bill_edit(client, saved, [a], key).status_code == 409
    assert bill_edit(client, saved, [a]).status_code == 409
    assert raw_state(service) == after
    removed = bill_edit(client, data, [b]).json()
    assert removed["pricing"]["snapshot"]["total_minor"] == 90000
    assert removed["pricing"]["snapshot"]["adjustments"] == [b]
    assert all(
        row in raw_state(service)["pricing_revisions"] for row in before["pricing_revisions"]
    )
    # Reassignment/duration changes preserve existing monetary corrections.
    moved = stay_edit(client, removed, ids)
    assert moved.status_code == 200, moved.text
    assert moved.json()["pricing"]["snapshot"]["total_minor"] == 200000
    assert moved.json()["pricing"]["snapshot"]["adjustments"] == [b]
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == moved.json()


@pytest.mark.parametrize(
    "kind",
    ["zero", "blank", "duplicate", "float", "boolean", "string", "overflow", "extra", "null"],
)
def test_adjustment_validation_rejects_without_any_mutation(patch_api, kind):
    client, service, saved, _ids, _app = patch_api
    entry = dict(id=str(uuid4()), amount_minor=100, reason="Correction")
    items = [entry]
    if kind == "zero":
        entry["amount_minor"] = 0
    if kind == "blank":
        entry["reason"] = "   "
    if kind == "duplicate":
        items.append(dict(entry, amount_minor=200))
    if kind == "float":
        entry["amount_minor"] = 1.5
    if kind == "boolean":
        entry["amount_minor"] = True
    if kind == "string":
        entry["amount_minor"] = "100"
    if kind == "overflow":
        entry["amount_minor"] = 2**53 - 1
    if kind == "extra":
        entry["actor"] = "Forged"
    if kind == "null":
        items = None
    before = raw_state(service)
    assert bill_edit(client, saved, items).status_code == 422
    assert raw_state(service) == before


def test_negative_adjustment_clamps_zero_and_keeps_raw_signed_amount(patch_api):
    client, _service, saved, _ids, _app = patch_api
    item = dict(id=str(uuid4()), amount_minor=-200000, reason="Waived")
    response = bill_edit(client, saved, [item])
    assert response.status_code == 200, response.text
    assert response.json()["pricing"]["snapshot"]["total_minor"] == 0
    assert response.json()["pricing"]["snapshot"]["adjustments"] == [item]


@pytest.mark.parametrize(
    "table",
    [
        "room_allocations",
        "reservations",
        "pricing_revisions",
        "operational_audit",
        "mutation_receipts",
        "commit",
    ],
)
def test_adjustment_failure_rolls_back_everything_and_retry_uses_same_key(patch_api, table):
    client, service, saved, _ids, _app = patch_api
    entry = dict(id=str(uuid4()), amount_minor=10025, reason="Correction")
    key = uuid4()
    before = raw_state(service)

    def fail_after(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.lower().startswith((f"update hms.{table}", f"insert into hms.{table}")):
            raise RuntimeError("Synthetic billing write failure")

    def fail_commit(_conn):
        raise RuntimeError("Synthetic billing commit failure")

    event, callback = (
        ("commit", fail_commit) if table == "commit" else ("after_cursor_execute", fail_after)
    )
    sa.event.listen(service.engine, event, callback)
    try:
        assert bill_edit(client, saved, [entry], key, adults=4).status_code == 500
    finally:
        sa.event.remove(service.engine, event, callback)
    assert raw_state(service) == before
    assert bill_edit(client, saved, [entry], key, adults=4).status_code == 200


def test_competing_bill_edits_accept_one_and_reject_stale_loser(patch_api):
    client, service, saved, _ids, _app = patch_api
    barrier = Barrier(2)

    def change(amount):
        barrier.wait(timeout=5)
        return bill_edit(
            client, saved, [dict(id=str(uuid4()), amount_minor=amount, reason="Competing")]
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(change, (10000, 20000)))
    assert sorted(r.status_code for r in responses) == [200, 409]
    after = raw_state(service)
    assert len(after["pricing_revisions"]) == 2 and after["reservations"][0]["version"] == 2


def purchase_product(client, amount=10125):
    category = client.post(
        "/api/v1/configuration/categories",
        json=dict(label="Supplies"),
        headers={"Idempotency-Key": str(uuid4())},
    ).json()
    response = client.post(
        "/api/v1/configuration/products",
        json=dict(label="Water", category_id=category["id"], unit_amount_minor=amount),
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    return response.json()


def purchases_edit(client, saved, charges, key=None, **changes):
    body = dict(expected_version=saved["version"], guest_id=saved["guest"]["id"], charges=charges)
    body.update(changes)
    return client.post(
        f"/api/v1/reservations/{saved['id']}/edit-charges",
        json=body,
        headers={"Idempotency-Key": str(key or uuid4())},
    )


def test_purchases_are_server_captured_historical_and_independently_removable(patch_api):
    client, service, saved, ids, _app = patch_api
    product = purchase_product(client)
    first = dict(id=str(uuid4()), product_id=product["id"], quantity=2, usage="purchase")
    key = uuid4()
    response = purchases_edit(client, saved, [first], key)
    assert response.status_code == 200, response.text
    data = response.json()
    snapshot = data["pricing"]["snapshot"]
    assert snapshot["schema_version"] == 3 and snapshot["total_minor"] == 130250
    assert snapshot["charges"][0]["unit_amount_minor"] == 10125
    assert purchases_edit(client, saved, [first], key).json() == data
    before = raw_state(service)
    assert purchases_edit(client, saved, [dict(first, quantity=3)], key).status_code == 409
    assert raw_state(service) == before
    changed = client.patch(
        f"/api/v1/configuration/products/{product['id']}",
        json=dict(
            label="Renamed water",
            category_id=product["category_id"],
            unit_amount_minor=20025,
            expected_version=1,
        ),
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert changed.status_code == 200
    assert client.get(f"/api/v1/reservations/{saved['id']}").json()["pricing"] == data["pricing"]
    second = dict(first, id=str(uuid4()), quantity=1)
    next_result = purchases_edit(client, data, [dict(first, quantity=3), second]).json()
    lines = next_result["pricing"]["snapshot"]["charges"]
    assert [(line["label"], line["unit_amount_minor"]) for line in lines] == [
        ("Water", 10125),
        ("Renamed water", 20025),
    ]
    assert next_result["pricing"]["snapshot"]["total_minor"] == 160400
    removed = purchases_edit(client, next_result, [second]).json()
    assert removed["pricing"]["snapshot"]["total_minor"] == 130025
    assert removed["pricing"]["snapshot"]["charges"][0]["id"] == second["id"]
    corrected = bill_edit(
        client, removed, [dict(id=str(uuid4()), amount_minor=-1000, reason="Correction")]
    ).json()
    assert corrected["pricing"]["snapshot"]["total_minor"] == 129025
    moved = stay_edit(client, corrected, ids)
    assert moved.status_code == 200, moved.text
    assert moved.json()["pricing"]["snapshot"]["total_minor"] == 239025
    assert (
        moved.json()["pricing"]["snapshot"]["charges"]
        == corrected["pricing"]["snapshot"]["charges"]
    )
    assert all(
        row in raw_state(service)["pricing_revisions"] for row in before["pricing_revisions"]
    )


@pytest.mark.parametrize(
    "kind",
    [
        "zero",
        "fraction",
        "boolean",
        "numeric_string",
        "duplicate",
        "forged_price",
        "overflow",
        "unknown_product",
        "inactive_product",
    ],
)
def test_purchase_validation_and_unavailable_products_leave_bill_unchanged(patch_api, kind):
    client, service, saved, _ids, _app = patch_api
    product = purchase_product(client, 2**53 - 1 if kind == "overflow" else 10125)
    charge = dict(id=str(uuid4()), product_id=product["id"], quantity=1)
    items = [charge]
    if kind == "zero":
        charge["quantity"] = 0
    if kind == "fraction":
        charge["quantity"] = 1.5
    if kind == "boolean":
        charge["quantity"] = True
    if kind == "numeric_string":
        charge["quantity"] = "1"
    if kind == "duplicate":
        items.append(dict(charge, quantity=2))
    if kind == "forged_price":
        charge["unit_amount_minor"] = 1
    if kind == "unknown_product":
        charge["product_id"] = str(uuid4())
    if kind == "inactive_product":
        assert (
            client.patch(
                f"/api/v1/configuration/products/{product['id']}",
                json=dict(
                    label="Water",
                    category_id=product["category_id"],
                    unit_amount_minor=10125,
                    enabled=False,
                    expected_version=1,
                ),
                headers={"Idempotency-Key": str(uuid4())},
            ).status_code
            == 200
        )
    before = raw_state(service)
    response = purchases_edit(client, saved, items)
    assert response.status_code == (404 if kind == "unknown_product" else 422), response.text
    assert raw_state(service) == before


@pytest.mark.parametrize(
    "table",
    [
        "room_allocations",
        "reservations",
        "pricing_revisions",
        "operational_audit",
        "mutation_receipts",
        "commit",
    ],
)
def test_purchase_failure_is_atomic_and_retryable(patch_api, table):
    client, service, saved, _ids, _app = patch_api
    product = purchase_product(client)
    item = dict(id=str(uuid4()), product_id=product["id"], quantity=2)
    key, before = uuid4(), raw_state(service)

    def fail_after(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.lower().startswith((f"update hms.{table}", f"insert into hms.{table}")):
            raise RuntimeError("Synthetic purchase write failure")

    def fail_commit(_conn):
        raise RuntimeError("Synthetic purchase commit failure")

    event, callback = (
        ("commit", fail_commit) if table == "commit" else ("after_cursor_execute", fail_after)
    )
    sa.event.listen(service.engine, event, callback)
    try:
        assert purchases_edit(client, saved, [item], key, adults=4).status_code == 500
    finally:
        sa.event.remove(service.engine, event, callback)
    assert raw_state(service) == before
    assert purchases_edit(client, saved, [item], key, adults=4).status_code == 200


def test_stay_and_purchases_commit_as_one_versioned_command(patch_api):
    client, _service, saved, ids, _app = patch_api
    product = purchase_product(client)
    body = dict(
        expected_version=1,
        guest_id=saved["guest"]["id"],
        room_id=saved["allocation"]["room_id"],
        duration_id=str(ids["overnight"]),
        scheduled_start=saved["allocation"]["scheduled_start"],
        charges=[dict(id=str(uuid4()), product_id=product["id"], quantity=2)],
        adults=4,
    )
    response = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-stay-charges",
        json=body,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["version"] == 2 and data["pricing"]["revision"] == 2
    assert data["pricing"]["snapshot"]["total_minor"] == 240250
    assert data["allocation"]["adults"] == 4


def test_removed_purchase_identity_cannot_be_reused(patch_api):
    client, service, saved, _ids, _app = patch_api
    product = purchase_product(client)
    intent = dict(id=str(uuid4()), product_id=product["id"], quantity=1)
    added = purchases_edit(client, saved, [intent]).json()
    removed = purchases_edit(client, added, []).json()
    before = raw_state(service)
    response = purchases_edit(client, removed, [intent])
    assert response.status_code == 422 and response.json()["code"] == "charge_identity_conflict"
    assert raw_state(service) == before


@pytest.mark.parametrize("status", ["cancelled", "checked_out", "no_show"])
def test_final_lifecycle_does_not_allow_new_bill_mutations(patch_api, status):
    client, service, saved, _ids, _app = patch_api
    with service.engine.begin() as c:
        c.execute(
            reservations.update().where(reservations.c.id == saved["id"]).values(status=status)
        )
    before = raw_state(service)
    assert bill_edit(client, saved, []).status_code == 409
    assert purchases_edit(client, saved, []).status_code == 409
    assert raw_state(service) == before


def test_simultaneous_purchase_replay_is_one_committed_capture(patch_api):
    client, service, saved, _ids, _app = patch_api
    product = purchase_product(client)
    key = uuid4()
    intent = dict(id=str(uuid4()), product_id=product["id"], quantity=2)
    barrier = Barrier(2)

    def submit(_index):
        barrier.wait(timeout=5)
        return purchases_edit(client, saved, [intent], key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit, (1, 2)))
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    state = raw_state(service)
    assert state["reservations"][0]["version"] == 2 and len(state["pricing_revisions"]) == 2


def raw_state(service):
    with service.engine.connect() as c:
        return {
            table.name: [
                dict(row)
                for row in c.execute(
                    sa.select(table)
                    .where(
                        table.c.company_id == service.context.company_id,
                    )
                    .order_by(table.c.id)
                ).mappings()
            ]
            for table in (
                reservations,
                allocations,
                pricing_revisions,
                audit_events,
                mutation_receipts,
            )
        }


def test_patch_persists_once_and_audits_accurate_before_after(patch_api):
    client, service, saved, _ids, _app = patch_api
    before = raw_state(service)
    result = patch(
        client, saved["id"], dict(expected_version=1, note=" Updated ", adults=3, children=0)
    )
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["version"] == 2 and data["note"] == "Updated"
    assert data["allocation"]["adults"] == 3 and data["allocation"]["children"] == 0
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == data
    assert client.get("/api/v1/reservations").json() == [data]
    after = raw_state(service)
    assert before["pricing_revisions"] == after["pricing_revisions"]
    assert data["pricing"] == saved["pricing"]
    assert data["created_at"] == saved["created_at"]
    for field in saved["allocation"]:
        if field not in ("adults", "children"):
            assert data["allocation"][field] == saved["allocation"][field]
    event = next(
        row for row in after["operational_audit"] if row["event_type"] == "reservation.updated"
    )
    assert event["before"] == dict(version=1, note="Original note", adults=2, children=1)
    assert event["after"] == dict(version=2, note="Updated", adults=3, children=0)
    assert event["actor"] == "local-development" and event["reservation_version"] == 2
    assert len(after["operational_audit"]) == len(before["operational_audit"]) + 1
    assert len(after["mutation_receipts"]) == len(before["mutation_receipts"]) + 1


def test_partial_patch_preserves_omitted_counts_and_clears_note(patch_api):
    client, _service, saved, _ids, _app = patch_api
    cleared = patch(client, saved["id"], dict(expected_version=1, note="   ")).json()
    assert cleared["note"] == "" and cleared["version"] == 2
    assert cleared["allocation"] == saved["allocation"]
    next_result = patch(client, saved["id"], dict(expected_version=2, children=0)).json()
    assert next_result["note"] == "" and next_result["allocation"]["adults"] == 2
    assert next_result["allocation"]["children"] == 0 and next_result["version"] == 3
    assert next_result["pricing"] == saved["pricing"]


def test_stale_version_rejected_without_any_writes(patch_api):
    client, service, saved, _ids, _app = patch_api
    assert patch(client, saved["id"], dict(expected_version=1, note="Winner")).status_code == 200
    before = raw_state(service)
    result = patch(client, saved["id"], dict(expected_version=1, adults=5, note="Stale"))
    assert result.status_code == 409 and result.json()["code"] == "version_conflict"
    assert raw_state(service) == before


def test_replay_returns_original_committed_result_after_later_edits(patch_api):
    client, service, saved, _ids, _app = patch_api
    key, body = uuid4(), dict(expected_version=1, note="First")
    first = patch(client, saved["id"], body, key)
    assert first.status_code == 200
    assert patch(client, saved["id"], dict(expected_version=2, children=0)).status_code == 200
    before = raw_state(service)
    replay = patch(client, saved["id"], body, key)
    assert replay.status_code == 200 and replay.json() == first.json()
    restarted = ReservationService(service.engine, service.context)
    assert (
        restarted.patch(saved["id"], ReservationEdit(**body), key).model_dump(mode="json")
        == first.json()
    )
    assert client.get(f"/api/v1/reservations/{saved['id']}").json()["version"] == 3
    assert raw_state(service) == before


def test_same_key_changed_body_or_target_conflicts(patch_api):
    client, service, saved, _ids, _app = patch_api
    key, body = uuid4(), dict(expected_version=1, note="First")
    assert patch(client, saved["id"], body, key).status_code == 200
    before = raw_state(service)
    for target, payload in (
        (saved["id"], dict(body, note="Different")),
        (str(uuid4()), body),
        (saved["id"], dict(body, expected_version=2)),
    ):
        result = patch(client, target, payload, key)
        assert result.status_code == 409 and result.json()["code"] == "idempotency_conflict"
    assert raw_state(service) == before


@pytest.mark.parametrize("same_key", [False, True])
def test_two_competing_http_edits_are_serialized(patch_api, same_key):
    client, service, saved, _ids, _app = patch_api
    barrier = Barrier(2)
    first_key, second_key = uuid4(), uuid4()
    requests = [
        (first_key, dict(expected_version=1, note="A")),
        (
            first_key if same_key else second_key,
            dict(expected_version=1, note="A" if same_key else "B"),
        ),
    ]

    def worker(args):
        key, body = args
        barrier.wait(timeout=5)
        return patch(client, saved["id"], body, key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(worker, requests))
    if same_key:
        assert [result.status_code for result in results] == [200, 200]
        assert results[0].json() == results[1].json()
    else:
        assert sorted(result.status_code for result in results) == [200, 409]
        assert (
            next(result for result in results if result.status_code == 409).json()["code"]
            == "version_conflict"
        )
    state = raw_state(service)
    assert state["reservations"][0]["version"] == 2
    assert (
        len(
            [
                row
                for row in state["operational_audit"]
                if row["event_type"] == "reservation.updated"
            ]
        )
        == 1
    )
    assert (
        len([row for row in state["mutation_receipts"] if row["operation"] == "reservation.patch"])
        == 1
    )
    assert client.get(f"/api/v1/reservations/{saved['id']}").json()["pricing"] == saved["pricing"]


@pytest.mark.parametrize(
    "statement_prefix",
    [
        "UPDATE hms.room_allocations",
        "UPDATE hms.reservations",
        "INSERT INTO hms.operational_audit",
        "INSERT INTO hms.mutation_receipts",
    ],
)
def test_failure_after_each_write_returns_no_success_and_rolls_back(patch_api, statement_prefix):
    client, service, saved, _ids, _app = patch_api
    key, body = uuid4(), dict(expected_version=1, note="Failure test", adults=3, children=0)
    before = raw_state(service)

    def fail_after_write(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.startswith(statement_prefix):
            raise RuntimeError("Synthetic failure after actual PostgreSQL write")

    sa.event.listen(service.engine, "after_cursor_execute", fail_after_write)
    try:
        result = patch(client, saved["id"], body, key)
    finally:
        sa.event.remove(service.engine, "after_cursor_execute", fail_after_write)
    assert result.status_code == 500
    assert raw_state(service) == before
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == saved
    retried = patch(client, saved["id"], body, key)
    assert retried.status_code == 200 and retried.json()["version"] == 2


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"note": "Missing version"},
        {"expected_version": 1},
        {"expected_version": 0, "note": "invalid"},
        {"expected_version": True, "note": "invalid"},
        {"expected_version": 1, "note": None},
        {"expected_version": 1, "adults": 0},
        {"expected_version": 1, "adults": 1.5},
        {"expected_version": 1, "adults": True},
        {"expected_version": 1, "children": -1},
        {"expected_version": 1, "children": "1"},
        {"expected_version": 1, "children": None},
        {"expected_version": 1, "note": "x" * 4001},
    ],
)
def test_invalid_patch_rejects_without_writes(patch_api, payload):
    client, service, saved, _ids, _app = patch_api
    before = raw_state(service)
    assert patch(client, saved["id"], payload).status_code == 422
    assert raw_state(service) == before


@pytest.mark.parametrize(
    "field",
    [
        "room_id",
        "duration_id",
        "scheduled_start",
        "scheduled_end",
        "guest_id",
        "status",
        "company_id",
        "price",
        "version",
        "audit",
        "actual_check_in",
        "discounts",
    ],
)
def test_out_of_scope_fields_reject_without_writes(patch_api, field):
    client, service, saved, _ids, _app = patch_api
    before = raw_state(service)
    assert (
        patch(client, saved["id"], dict(expected_version=1, note="no", **{field: "no"})).status_code
        == 422
    )
    assert raw_state(service) == before


def test_missing_key_unknown_resource_and_company_ownership(patch_api):
    client, service, saved, _ids, application = patch_api
    before = raw_state(service)
    body = dict(expected_version=1, note="Other company")
    assert client.patch(f"/api/v1/reservations/{saved['id']}", json=body).status_code == 422
    assert patch(client, str(uuid4()), body).status_code == 404
    application.dependency_overrides[get_command_context] = lambda: CommandContext(uuid4())
    assert patch(client, saved["id"], body).status_code == 404
    assert raw_state(service) == before


def test_patch_keeps_all_historical_pricing_rows_and_disabled_rate_information(patch_api):
    client, service, saved, ids, _app = patch_api
    with service.engine.begin() as c:
        old = (
            c.execute(
                sa.select(pricing_revisions).where(
                    pricing_revisions.c.reservation_id == saved["id"]
                )
            )
            .mappings()
            .one()
        )
        historical = dict(old, id=uuid4(), revision=2)
        c.execute(pricing_revisions.insert().values(**historical))
        c.execute(
            rates.update()
            .where(rates.c.id == ids["hourly-rate"])
            .values(enabled=False, unit_amount_minor=999999)
        )
    # Synthetic second captured revision tests preservation; not a UI-created pricing event.
    before = raw_state(service)
    prior_read = client.get(f"/api/v1/reservations/{saved['id']}").json()
    result = patch(client, saved["id"], dict(expected_version=1, adults=3))
    assert result.status_code == 200, result.text
    assert result.json()["pricing"] == prior_read["pricing"]
    assert raw_state(service)["pricing_revisions"] == before["pricing_revisions"]


def test_equal_value_patch_advances_once_and_cors_allows_only_registered_methods(patch_api):
    client, service, saved, _ids, _app = patch_api
    key, body = uuid4(), dict(expected_version=1, note=saved["note"])
    first = patch(client, saved["id"], body, key)
    assert first.status_code == 200 and first.json()["version"] == 2
    assert patch(client, saved["id"], body, key).json() == first.json()
    preflight = client.options(
        f"/api/v1/reservations/{saved['id']}",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "Idempotency-Key,Content-Type",
        },
    )
    assert preflight.status_code == 200
    assert "PATCH" in preflight.headers["access-control-allow-methods"]
    assert "DELETE" not in preflight.headers["access-control-allow-methods"]


def test_commit_failure_cannot_return_success_or_leave_a_receipt(patch_api):
    client, service, saved, _ids, _app = patch_api
    key, body = uuid4(), dict(expected_version=1, note="Commit failure", adults=3)
    before = raw_state(service)

    def fail_commit(_connection):
        raise RuntimeError("Synthetic failure immediately before database commit")

    sa.event.listen(service.engine, "commit", fail_commit)
    try:
        response = patch(client, saved["id"], body, key)
    finally:
        sa.event.remove(service.engine, "commit", fail_commit)
    assert response.status_code == 500
    assert raw_state(service) == before
    assert patch(client, saved["id"], body, key).json()["version"] == 2


def test_simultaneous_same_key_different_payload_rejects_the_loser(patch_api):
    client, service, saved, _ids, _app = patch_api
    key, barrier = uuid4(), Barrier(2)

    def worker(note):
        barrier.wait(timeout=5)
        return patch(client, saved["id"], dict(expected_version=1, note=note), key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(worker, ["A", "B"]))
    assert sorted(response.status_code for response in results) == [200, 409]
    loser = next(response for response in results if response.status_code == 409)
    assert loser.json()["code"] == "idempotency_conflict"
    state = raw_state(service)
    assert state["reservations"][0]["version"] == 2
    assert (
        len([row for row in state["mutation_receipts"] if row["operation"] == "reservation.patch"])
        == 1
    )
