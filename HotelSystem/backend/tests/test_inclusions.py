from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from test_reservation_patch import patch_api as reservation_fixture
from test_reservation_patch import raw_state

from app.models import companies, room_type_inclusions, room_types
from app.modules.reservations.inclusions import reconcile

patch_api = reservation_fixture
pytestmark = pytest.mark.postgres


def key():
    return {"Idempotency-Key": str(uuid4())}


def write(client, kind, body, id=None, headers=None):
    return client.request(
        "PATCH" if id else "POST",
        "/api/v1/configuration/" + kind + ("/" + str(id) if id else ""),
        json=body,
        headers=headers or key(),
    )


def product(client, label):
    category = next(
        c
        for c in client.get("/api/v1/reference-data").json()["inventory_categories"]
        if c["type"] == "inclusion"
    )
    result = write(
        client,
        "products",
        dict(
            label=label,
            category_id=category["id"],
            unit_amount_minor=90000,
            available_for_sale=False,
        ),
    )
    assert result.status_code == 201, result.text
    return result.json()


def defaults(client, id, entries):
    type = next(
        t for t in client.get("/api/v1/reference-data").json()["room_types"] if t["id"] == str(id)
    )
    return write(
        client,
        "room-types",
        dict(label=type["label"], expected_version=type["version"], default_inclusions=entries),
        id,
    )


def edit(client, saved, entries, headers=None, **other):
    return client.post(
        f"/api/v1/reservations/{saved['id']}/edit-inclusions",
        json=dict(
            expected_version=saved["version"],
            guest_id=saved["guest"]["id"],
            inclusions=entries,
            **other,
        ),
        headers=headers or key(),
    )


def create(client, saved, ids, **other):
    result = client.post(
        "/api/v1/reservations",
        json=dict(
            guest_id=saved["guest"]["id"],
            booking_source_id=str(ids["source"]),
            room_id=str(ids["room"]),
            duration_id=str(ids["hourly"]),
            adults=1,
            scheduled_start="2026-12-20T14:00:00+08:00",
            **other,
        ),
        headers=key(),
    )
    assert result.status_code == 201, result.text
    return result.json()


def test_defaults_capture_preserve_and_manual_override(patch_api):
    client, service, saved, ids, app = patch_api
    p, manual = product(client, "Towel"), product(client, "Water")
    selected = [dict(product_id=p["id"], quantity=2)]
    configured = defaults(client, ids["type"], selected)
    assert configured.status_code == 200, configured.text
    assert configured.json()["default_inclusions"] == selected
    booking = create(client, saved, ids)
    assert booking["allocation"]["inclusions"] == [
        dict(**selected[0], label="Towel", source="default", overridden=False)
    ]
    assert booking["pricing"]["snapshot"]["total_minor"] == 110000
    assert defaults(client, ids["type"], [dict(product_id=p["id"], quantity=9)]).status_code == 200
    assert client.get(f"/api/v1/reservations/{booking['id']}").json() == booking
    current_type = next(
        t
        for t in client.get("/api/v1/reference-data").json()["room_types"]
        if t["id"] == str(ids["type"])
    )
    unrelated = write(
        client,
        "room-types",
        dict(
            label=current_type["label"],
            expected_version=current_type["version"],
            default_capacity=3,
        ),
        ids["type"],
    )
    assert unrelated.status_code == 200 and unrelated.json()["default_inclusions"] == [
        dict(product_id=p["id"], quantity=9)
    ]
    cleared = defaults(client, ids["type"], [])
    assert cleared.status_code == 200 and cleared.json()["default_inclusions"] == []
    assert client.get(f"/api/v1/reservations/{booking['id']}").json() == booking
    intent = [dict(product_id=p["id"], quantity=0), dict(product_id=manual["id"], quantity=3)]
    headers = key()
    result = edit(client, booking, intent, headers, note="Keep quantities")
    assert result.status_code == 200, result.text
    changed = result.json()
    assert changed["version"] == 2 and changed["pricing"] == booking["pricing"]
    assert changed["allocation"]["inclusions"][0]["overridden"]
    assert changed["allocation"]["inclusions"][1]["source"] == "manual"
    assert edit(client, booking, intent, headers, note="Keep quantities").json() == changed
    assert edit(client, booking, [], headers).status_code == 409
    assert edit(client, booking, intent).status_code == 409
    assert client.get(f"/api/v1/reservations/{booking['id']}").json() == changed
    event = next(
        e
        for e in raw_state(service)["operational_audit"]
        if e["event_type"] == "reservation.inclusions_updated"
    )
    assert event["before"]["allocation"]["inclusions"] == booking["allocation"]["inclusions"]
    assert event["after"]["allocation"]["inclusions"] == changed["allocation"]["inclusions"]


def test_initial_overrides_do_not_replace_other_server_defaults(patch_api):
    client, service, saved, ids, app = patch_api
    p, second = product(client, "First default"), product(client, "Second default")
    assert (
        defaults(
            client,
            ids["type"],
            [dict(product_id=p["id"], quantity=2), dict(product_id=second["id"], quantity=3)],
        ).status_code
        == 200
    )
    booking = create(
        client, saved, ids, inclusions=[dict(product_id=p["id"], quantity=0, overridden=True)]
    )
    assert {i["product_id"]: i["quantity"] for i in booking["allocation"]["inclusions"]} == {
        p["id"]: 0,
        second["id"]: 3,
    }


def test_type_transfer_reconciles_only_defaults_without_pricing_inclusions(patch_api):
    client, service, saved, ids, app = patch_api
    p, retired, manual = (
        product(client, "Shared"),
        product(client, "Old"),
        product(client, "Manual"),
    )
    assert (
        defaults(
            client,
            ids["type"],
            [dict(product_id=p["id"], quantity=2), dict(product_id=retired["id"], quantity=1)],
        ).status_code
        == 200
    )
    booking = create(client, saved, ids)
    changed = edit(
        client,
        booking,
        [
            dict(product_id=p["id"], quantity=4),
            dict(product_id=retired["id"], quantity=1),
            dict(product_id=manual["id"], quantity=3),
        ],
    ).json()
    target = write(
        client,
        "room-types",
        dict(label="Other", default_inclusions=[dict(product_id=p["id"], quantity=9)]),
    ).json()
    room = write(client, "rooms", dict(number="200", room_type_id=target["id"])).json()
    assert (
        write(
            client,
            "rates",
            dict(
                room_type_id=target["id"],
                booking_kind="hourly",
                duration_id=str(ids["hourly"]),
                unit_amount_minor=50000,
            ),
        ).status_code
        == 201
    )
    result = client.post(
        f"/api/v1/reservations/{booking['id']}/edit-stay",
        json=dict(
            expected_version=changed["version"],
            guest_id=changed["guest"]["id"],
            room_id=room["id"],
            duration_id=str(ids["hourly"]),
            scheduled_start=changed["allocation"]["scheduled_start"],
        ),
        headers=key(),
    )
    assert result.status_code == 200, result.text
    entries = result.json()["allocation"]["inclusions"]
    assert {e["product_id"]: e["quantity"] for e in entries} == {p["id"]: 4, manual["id"]: 3}
    assert result.json()["pricing"]["snapshot"]["total_minor"] == 50000
    assert result.json()["allocation"]["id"] == booking["allocation"]["id"]


@pytest.mark.parametrize(
    "stage",
    ["room_allocations", "reservations", "operational_audit", "mutation_receipts", "commit"],
)
def test_inclusion_command_rollback_retry(patch_api, stage):
    client, service, saved, ids, app = patch_api
    p = product(client, "Rollback towel")
    before, headers = raw_state(service), key()

    def fail_sql(conn, cursor, statement, params, context, many):
        if stage in statement.lower() and statement.lower().startswith(("insert", "update")):
            raise RuntimeError("Injected inclusion failure")

    def fail_commit(session):
        raise RuntimeError("Injected commit failure")

    target, event, handler = (
        (Session, "before_commit", fail_commit)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", fail_sql)
    )
    sa.event.listen(target, event, handler)
    intent = [dict(product_id=p["id"], quantity=1)]
    try:
        assert edit(client, saved, intent, headers).status_code >= 500
    finally:
        sa.event.remove(target, event, handler)
    assert raw_state(service) == before
    assert edit(client, saved, intent, headers).status_code == 200


@pytest.mark.parametrize("replay", [False, True])
def test_competing_writers_and_same_key_replay(patch_api, replay):
    client, service, saved, ids, app = patch_api
    p, barrier, headers = product(client, "Concurrent"), Barrier(2), key()

    def submit(index):
        barrier.wait()
        return edit(
            client,
            saved,
            [dict(product_id=p["id"], quantity=1 if replay else index + 1)],
            headers if replay else None,
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(submit, range(2))) == ([200, 200] if replay else [200, 409])
    assert service.get(saved["id"]).version == 2


def test_strict_validation_ownership_and_retired_reference(patch_api):
    client, service, saved, ids, app = patch_api
    p = product(client, "Retired")
    assert defaults(client, ids["type"], [dict(product_id=p["id"], quantity=1)]).status_code == 200
    old = raw_state(service)
    for quantity in (False, -1, 1.5, "2"):
        assert edit(client, saved, [dict(product_id=p["id"], quantity=quantity)]).status_code == 422
    assert defaults(client, ids["type"], [dict(product_id=p["id"], quantity=0)]).status_code == 422
    assert edit(client, saved, [dict(product_id=str(uuid4()), quantity=1)]).status_code == 404
    assert (
        edit(client, saved, [dict(product_id=p["id"], quantity=1, source="default")]).status_code
        == 422
    )
    assert edit(client, saved, [dict(product_id=p["id"], quantity=1)] * 2).status_code == 422
    assert raw_state(service) == old
    archived = write(
        client,
        "products",
        {k: p[k] for k in ("label", "category_id", "unit_amount_minor", "available_for_sale")}
        | dict(expected_version=p["version"], archived=True),
        p["id"],
    )
    assert archived.status_code == 200
    assert create(client, saved, ids)["allocation"]["inclusions"] == []
    assert defaults(client, ids["type"], [dict(product_id=p["id"], quantity=2)]).status_code == 200
    with service.engine.connect() as c:
        other = uuid4()
        c.execute(
            companies.insert().values(
                id=other,
                name="Uncommitted ownership boundary",
                currency="PHP",
                hotel_timezone="Asia/Manila",
            )
        )
        with pytest.raises(sa.exc.IntegrityError), c.begin_nested():
            c.execute(
                room_type_inclusions.insert().values(
                    company_id=other,
                    room_type_id=ids["type"],
                    product_id=p["id"],
                    quantity=1,
                    position=0,
                )
            )


def test_reconcile_zero_override_and_manual_priority():
    old = [
        dict(product_id="shared", label="Old", quantity=0, source="default", overridden=True),
        dict(product_id="manual", label="Manual", quantity=3, source="manual", overridden=False),
    ]
    defaults = [
        dict(product_id="shared", label="Current", quantity=2),
        dict(product_id="manual", label="New", quantity=9),
    ]
    result = reconcile(old, defaults)
    assert result[0] == old[1]
    assert result[1]["quantity"] == 2 and not result[1]["overridden"]


@pytest.mark.parametrize(
    "stage",
    [
        "room_types",
        "default_delete",
        "default_insert",
        "operational_audit",
        "mutation_receipts",
        "commit",
    ],
)
def test_default_list_replacement_rolls_back_with_its_version_audit_and_receipt(patch_api, stage):
    client, service, saved, ids, app = patch_api
    p = product(client, "Default rollback")
    assert defaults(client, ids["type"], [dict(product_id=p["id"], quantity=2)]).status_code == 200

    def state():
        with service.engine.connect() as c:
            return (
                raw_state(service),
                c.execute(
                    sa.select(room_types).where(
                        room_types.c.company_id == service.context.company_id
                    )
                )
                .mappings()
                .all(),
                c.execute(
                    sa.select(room_type_inclusions).where(
                        room_type_inclusions.c.company_id == service.context.company_id
                    )
                )
                .mappings()
                .all(),
            )

    before = state()

    def fail_sql(conn, cursor, statement, params, context, many):
        sql = statement.lower()
        matched = (
            (
                stage == "default_delete"
                and sql.startswith("delete")
                and "room_type_inclusions" in sql
            )
            or (
                stage == "default_insert"
                and sql.startswith("insert")
                and "room_type_inclusions" in sql
            )
            or (stage in sql and sql.startswith(("insert", "update")))
        )
        if matched:
            raise RuntimeError("Injected default replacement failure")

    def fail_commit(session):
        raise RuntimeError("Injected default commit failure")

    target, event, handler = (
        (Session, "before_commit", fail_commit)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", fail_sql)
    )
    version = next(
        t
        for t in client.get("/api/v1/reference-data").json()["room_types"]
        if t["id"] == str(ids["type"])
    )["version"]
    body = dict(
        label="Standard",
        expected_version=version,
        default_inclusions=[dict(product_id=p["id"], quantity=3)],
    )
    headers = key()
    sa.event.listen(target, event, handler)
    try:
        assert write(client, "room-types", body, ids["type"], headers).status_code >= 500
    finally:
        sa.event.remove(target, event, handler)
    assert state() == before
    result = write(client, "room-types", body, ids["type"], headers)
    assert result.status_code == 200 and result.json()["version"] == version + 1
    assert write(client, "room-types", body, ids["type"], headers).json() == result.json()


def test_same_value_override_is_recorded_without_pricing_revision(patch_api):
    client, service, saved, ids, app = patch_api
    p = product(client, "Explicit quantity")
    assert defaults(client, ids["type"], [dict(product_id=p["id"], quantity=2)]).status_code == 200
    booking = create(client, saved, ids)
    result = edit(client, booking, [dict(product_id=p["id"], quantity=2, overridden=True)])
    assert result.status_code == 200 and result.json()["allocation"]["inclusions"][0]["overridden"]
    assert result.json()["pricing"] == booking["pricing"]


def test_mixed_inclusion_discount_adjustment_save_is_one_transaction(patch_api):
    client, service, saved, ids, app = patch_api
    p = product(client, "Mixed entitlement")
    before = raw_state(service)
    result = edit(
        client,
        saved,
        [dict(product_id=p["id"], quantity=5)],
        note="Mixed draft",
        adults=3,
        adjustments=[dict(id=str(uuid4()), amount_minor=1000, reason="Adjustment")],
        discounts=[
            dict(
                id=str(uuid4()),
                label="Manual ten",
                scope="reservation",
                method="percentage",
                value="10",
                target_id="",
                currency="PHP",
            )
        ],
    )
    assert result.status_code == 200, result.text
    changed = result.json()
    assert changed["version"] == 2 and changed["pricing"]["revision"] == 2
    assert changed["pricing"]["snapshot"]["total_minor"] == 100000
    assert changed["allocation"]["inclusions"][0]["quantity"] == 5
    assert changed["allocation"]["adults"] == 3 and changed["note"] == "Mixed draft"
    assert all(
        row in raw_state(service)["pricing_revisions"] for row in before["pricing_revisions"]
    )
