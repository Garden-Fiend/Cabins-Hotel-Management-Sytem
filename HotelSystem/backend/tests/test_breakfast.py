from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from test_reservation_patch import patch_api as reservation_fixture
from test_reservation_patch import raw_state

from app.models import breakfast_eligibility, companies

patch_api = reservation_fixture
pytestmark = pytest.mark.postgres


def key():
    return {"Idempotency-Key": str(uuid4())}


def configuration(client, items, headers=None):
    refs = client.get("/api/v1/reference-data").json()
    return client.post(
        "/api/v1/configuration/breakfast",
        json=dict(expected_version=refs["company"]["breakfast_version"], items=items),
        headers=headers or key(),
    )


def setup(client):
    category = client.post(
        "/api/v1/configuration/categories", json=dict(label="Meals", type="ordinary"), headers=key()
    ).json()
    result = []
    for label, price in (("Breakfast meal", 15000), ("Coffee", 5000)):
        r = client.post(
            "/api/v1/configuration/products",
            json=dict(label=label, category_id=category["id"], unit_amount_minor=price),
            headers=key(),
        )
        assert r.status_code == 201, r.text
        result.append(r.json())
    meal, beverage = result
    items = [
        dict(product_id=meal["id"], kind="meal", enabled=True),
        dict(product_id=beverage["id"], kind="beverage", enabled=True),
    ]
    assert configuration(client, items).status_code == 200
    return meal, beverage, items


def selection(meal, beverage, date="2026-12-21", guest=1):
    return dict(
        service_date=date,
        guest_number=guest,
        status="included",
        meal_id=meal["id"],
        beverage_id=beverage["id"],
    )


def create(client, saved, ids, breakfast, **other):
    return client.post(
        "/api/v1/reservations",
        json=dict(
            guest_id=saved["guest"]["id"],
            booking_source_id=str(ids["source"]),
            room_id=str(ids["room"]),
            duration_id=other.pop("duration_id", str(ids["two-nights"])),
            adults=1,
            children=1,
            scheduled_start=other.pop("scheduled_start", "2026-12-20T14:00:00+08:00"),
            breakfast=breakfast,
            **other,
        ),
        headers=key(),
    )


def edit(client, saved, breakfast, headers=None, **other):
    return client.post(
        f"/api/v1/reservations/{saved['id']}/edit-breakfast",
        json=dict(
            expected_version=saved["version"],
            guest_id=saved["guest"]["id"],
            breakfast=breakfast,
            **other,
        ),
        headers=headers or key(),
    )


def test_nightly_zero_capture_and_separately_billed_purchase(patch_api):
    client, service, saved, ids, app = patch_api
    meal, beverage, _ = setup(client)
    intent = [selection(meal, beverage), selection(meal, beverage, "2026-12-22", 2)]
    created = create(client, saved, ids, intent)
    assert created.status_code == 201, created.text
    booked = created.json()
    assert all(
        i["amount_minor"] == 0 and i["quantity"] == 1 for i in booked["allocation"]["breakfast"]
    )
    assert len(booked["allocation"]["breakfast"]) == 2
    before = raw_state(service)
    result = edit(
        client,
        booked,
        intent,
        charges=[dict(id=str(uuid4()), product_id=meal["id"], quantity=2, usage="purchase")],
    )
    assert result.status_code == 200, result.text
    current = result.json()
    assert (
        current["pricing"]["snapshot"]["total_minor"]
        == booked["pricing"]["snapshot"]["total_minor"] + 30000
    )
    assert current["pricing"]["snapshot"]["charges"][0]["usage"] == "purchase"
    assert current["allocation"]["breakfast"] == booked["allocation"]["breakfast"]
    assert all(
        row in raw_state(service)["pricing_revisions"] for row in before["pricing_revisions"]
    )
    assert client.get(f"/api/v1/reservations/{current['id']}").json() == current


def test_skipped_clear_replay_and_captured_history(patch_api):
    client, service, saved, ids, app = patch_api
    meal, beverage, items = setup(client)
    booked = create(client, saved, ids, [selection(meal, beverage)]).json()
    assert configuration(client, [dict(i, enabled=False) for i in items]).status_code == 200
    r = client.patch(
        f"/api/v1/configuration/products/{meal['id']}",
        json={
            k: meal[k] for k in ("label", "category_id", "available_for_sale", "unit_amount_minor")
        }
        | dict(label="Changed label", unit_amount_minor=25000, expected_version=meal["version"]),
        headers=key(),
    )
    assert r.status_code == 200
    headers = key()
    changed = edit(
        client, booked, [selection(meal, beverage)], headers, note="Saved historical choices"
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["allocation"]["breakfast"][0]["meal_label"] == meal["label"]
    assert changed.json()["pricing"] == booked["pricing"]
    assert (
        edit(
            client, booked, [selection(meal, beverage)], headers, note="Saved historical choices"
        ).json()
        == changed.json()
    )
    assert edit(client, booked, [], headers).status_code == 409
    assert edit(client, booked, []).status_code == 409
    skipped = edit(
        client, changed.json(), [dict(service_date="2026-12-21", guest_number=1, status="skipped")]
    )
    assert (
        skipped.status_code == 200
        and skipped.json()["allocation"]["breakfast"][0]["meal_id"] is None
    )
    cleared = edit(client, skipped.json(), [])
    assert cleared.status_code == 200 and cleared.json()["allocation"]["breakfast"] == []


@pytest.mark.parametrize(
    "change",
    [
        dict(service_date="2026-12-20"),
        dict(service_date="2026-12-23"),
        dict(guest_number=3),
        dict(guest_number=True),
        dict(guest_number="1"),
        dict(guest_number=1.5),
        dict(meal_id=None),
        dict(status="skipped"),
        dict(amount_minor=100),
        dict(quantity=2),
    ],
)
def test_invalid_selection_rejected_without_mutation(patch_api, change):
    client, service, saved, ids, app = patch_api
    meal, beverage, _ = setup(client)
    before = raw_state(service)
    response = create(client, saved, ids, [dict(selection(meal, beverage), **change)])
    assert response.status_code == 422, response.text
    assert raw_state(service) == before


def test_hourly_ineligible_duplicate_and_foreign_products_reject(patch_api):
    client, service, saved, ids, app = patch_api
    meal, beverage, items = setup(client)
    assert (
        create(
            client, saved, ids, [selection(meal, beverage)], duration_id=str(ids["hourly"])
        ).status_code
        == 422
    )
    assert create(client, saved, ids, [selection(meal, beverage)] * 2).status_code == 422
    assert create(client, saved, ids, [selection(beverage, meal)]).status_code == 422
    assert (
        create(
            client, saved, ids, [dict(selection(meal, beverage), meal_id=str(uuid4()))]
        ).status_code
        == 404
    )
    assert configuration(client, [dict(product_id=str(uuid4()), kind="meal")]).status_code == 404


def test_count_patch_and_stay_changes_prune_only_out_of_scope_selections(patch_api):
    client, service, saved, ids, app = patch_api
    meal, beverage, _ = setup(client)
    booked = create(
        client, saved, ids, [selection(meal, beverage), selection(meal, beverage, "2026-12-22", 2)]
    ).json()
    changed = client.patch(
        f"/api/v1/reservations/{booked['id']}",
        json=dict(expected_version=1, children=0),
        headers=key(),
    )
    assert changed.status_code == 200 and len(changed.json()["allocation"]["breakfast"]) == 1
    assert changed.json()["pricing"] == booked["pricing"]
    moved = client.post(
        f"/api/v1/reservations/{booked['id']}/edit-stay",
        json=dict(
            expected_version=2,
            guest_id=booked["guest"]["id"],
            room_id=str(ids["room"]),
            duration_id=str(ids["hourly"]),
            scheduled_start=booked["allocation"]["scheduled_start"],
        ),
        headers=key(),
    )
    assert moved.status_code == 200 and moved.json()["allocation"]["breakfast"] == []


@pytest.mark.parametrize(
    "stage",
    ["room_allocations", "reservations", "operational_audit", "mutation_receipts", "commit"],
)
def test_breakfast_rollback_and_retry(patch_api, stage):
    client, service, saved, ids, app = patch_api
    meal, beverage, _ = setup(client)
    booked = create(client, saved, ids, []).json()
    before, headers = raw_state(service), key()

    def fail_sql(conn, cursor, statement, params, context, many):
        if stage in statement.lower() and statement.lower().startswith(("insert", "update")):
            raise RuntimeError("Injected breakfast failure")

    def fail_commit(session):
        raise RuntimeError("Injected breakfast commit failure")

    target, event, handler = (
        (Session, "before_commit", fail_commit)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", fail_sql)
    )
    sa.event.listen(target, event, handler)
    try:
        assert edit(client, booked, [selection(meal, beverage)], headers).status_code >= 500
    finally:
        sa.event.remove(target, event, handler)
    assert raw_state(service) == before
    assert edit(client, booked, [selection(meal, beverage)], headers).status_code == 200


@pytest.mark.parametrize("replay", [False, True])
def test_competing_breakfast_writers(patch_api, replay):
    client, service, saved, ids, app = patch_api
    meal, beverage, _ = setup(client)
    booked = create(client, saved, ids, []).json()
    headers, barrier = key(), Barrier(2)

    def submit(index):
        barrier.wait()
        return edit(
            client,
            booked,
            [selection(meal, beverage, guest=1 if replay else index + 1)],
            headers if replay else None,
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(submit, range(2))) == ([200, 200] if replay else [200, 409])
    assert service.get(booked["id"]).version == 2


@pytest.mark.parametrize(
    "stage",
    [
        "companies",
        "eligibility_delete",
        "eligibility_insert",
        "operational_audit",
        "mutation_receipts",
        "commit",
    ],
)
def test_eligibility_transaction_rolls_back_version_rows_audit_and_receipt(patch_api, stage):
    client, service, saved, ids, app = patch_api
    meal, beverage, items = setup(client)

    def state():
        with service.engine.connect() as c:
            return (
                raw_state(service),
                c.scalar(
                    sa.select(companies.c.breakfast_version).where(
                        companies.c.id == service.context.company_id
                    )
                ),
                c.execute(
                    sa.select(breakfast_eligibility)
                    .where(breakfast_eligibility.c.company_id == service.context.company_id)
                    .order_by(breakfast_eligibility.c.product_id)
                )
                .mappings()
                .all(),
            )

    before, headers = state(), key()
    version = client.get("/api/v1/reference-data").json()["company"]["breakfast_version"]
    body = dict(expected_version=version, items=[dict(i, enabled=False) for i in items])

    def fail_sql(conn, cursor, statement, params, context, many):
        sql = statement.lower()
        matched = (
            (
                stage == "eligibility_delete"
                and sql.startswith("delete")
                and "breakfast_eligibility" in sql
            )
            or (
                stage == "eligibility_insert"
                and sql.startswith("insert")
                and "breakfast_eligibility" in sql
            )
            or (stage in sql and sql.startswith(("insert", "update")))
        )
        if matched:
            raise RuntimeError("Injected eligibility failure")

    def fail_commit(session):
        raise RuntimeError("Injected eligibility commit failure")

    target, event, handler = (
        (Session, "before_commit", fail_commit)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", fail_sql)
    )
    sa.event.listen(target, event, handler)
    try:
        assert (
            client.post("/api/v1/configuration/breakfast", json=body, headers=headers).status_code
            >= 500
        )
    finally:
        sa.event.remove(target, event, handler)
    assert state() == before
    result = client.post("/api/v1/configuration/breakfast", json=body, headers=headers)
    assert result.status_code == 200 and result.json()["version"] == version + 1
    assert (
        client.post("/api/v1/configuration/breakfast", json=body, headers=headers).json()
        == result.json()
    )
    assert (
        client.post(
            "/api/v1/configuration/breakfast", json=dict(body, items=[]), headers=headers
        ).status_code
        == 409
    )
    assert (
        client.post("/api/v1/configuration/breakfast", json=body, headers=key()).status_code == 409
    )


def test_service_date_uses_manila_not_utc_arrival_date(patch_api):
    client, service, saved, ids, app = patch_api
    meal, beverage, _ = setup(client)
    assert (
        create(
            client, saved, ids, [selection(meal, beverage)], scheduled_start="2026-12-20T17:30:00Z"
        ).status_code
        == 422
    )
    valid = create(
        client,
        saved,
        ids,
        [selection(meal, beverage, "2026-12-22")],
        scheduled_start="2026-12-20T17:30:00Z",
    )
    assert valid.status_code == 201


def test_midnight_checkout_is_not_a_breakfast_service_date(patch_api):
    client, service, saved, ids, app = patch_api
    meal, beverage, _ = setup(client)
    with service.engine.begin() as c:
        c.execute(
            companies.update()
            .where(companies.c.id == service.context.company_id)
            .values(default_check_out_time="00:00")
        )
    assert create(client, saved, ids, [selection(meal, beverage, "2026-12-22")]).status_code == 422
    assert create(client, saved, ids, [selection(meal, beverage)]).status_code == 201


def test_protected_identity_config_validation_and_company_fk(patch_api):
    client, service, saved, ids, app = patch_api
    meal, beverage, items = setup(client)
    refs = client.get("/api/v1/reference-data").json()
    special = next(c for c in refs["inventory_categories"] if c["type"] == "breakfast")
    assert special["system_defined"]
    assert (
        client.post(
            "/api/v1/configuration/products",
            json=dict(
                label="Separate breakfast product", category_id=special["id"], unit_amount_minor=0
            ),
            headers=key(),
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/v1/configuration/categories/{special['id']}",
            json=dict(
                label="Breakfast",
                type="breakfast",
                enabled=False,
                expected_version=special["version"],
            ),
            headers=key(),
        ).status_code
        == 409
    )
    assert configuration(client, items * 2).status_code == 422
    assert configuration(client, [dict(items[0], kind="snack")]).status_code == 422
    assert configuration(client, [dict(items[0], enabled=1)]).status_code == 422
    third = client.post(
        "/api/v1/configuration/products",
        json=dict(label="FK boundary", category_id=meal["category_id"], unit_amount_minor=0),
        headers=key(),
    ).json()
    with service.engine.connect() as c:
        other = uuid4()
        c.execute(
            companies.insert().values(
                id=other,
                name="Uncommitted breakfast owner",
                currency="PHP",
                hotel_timezone="Asia/Manila",
            )
        )
        with pytest.raises(sa.exc.IntegrityError) as error, c.begin_nested():
            c.execute(
                breakfast_eligibility.insert().values(
                    company_id=other, product_id=third["id"], kind="meal", enabled=True
                )
            )
        assert error.value.orig.diag.constraint_name == "fk_breakfast_product_company"
