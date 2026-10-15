from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from test_discount_presets import preset, selected
from test_final_price_api import room_definition
from test_inclusions import write
from test_manual_discounts import command, intent
from test_reservation_patch import patch_api as reservation_fixture
from test_reservation_patch import raw_state

from app.context import CommandContext, get_command_context
from app.models import billing_documents, document_counters, reservations
from app.settings import get_settings

patch_api = reservation_fixture
pytestmark = pytest.mark.postgres


@pytest.fixture
def billing_api(patch_api):
    client, service, saved, ids, app = patch_api
    try:
        yield patch_api
    finally:
        # Privileged test-owner cleanup only. No service/production bypass exists.
        # ACCESS EXCLUSIVE lock keeps the temporary trigger change invisible to other writers.
        assert service.engine.url.database == "hms_test"
        with service.engine.begin() as connection:
            connection.execute(
                sa.text("ALTER TABLE hms.billing_documents DISABLE TRIGGER billing_documents_guard")
            )
            connection.execute(
                billing_documents.delete().where(
                    billing_documents.c.company_id == service.context.company_id
                )
            )
            connection.execute(
                sa.text("ALTER TABLE hms.billing_documents ENABLE TRIGGER billing_documents_guard")
            )
            connection.execute(
                document_counters.delete().where(
                    document_counters.c.company_id == service.context.company_id
                )
            )


def draft(client, saved, key=None, **changes):
    return client.post(
        f"/api/v1/reservations/{saved['id']}/billing-documents",
        headers={"Idempotency-Key": str(key or uuid4())},
        json=dict(expected_reservation_version=saved["version"]) | changes,
    )


def finalize(client, document, key=None, **changes):
    return client.post(
        f"/api/v1/billing-documents/{document['id']}/finalize",
        headers={"Idempotency-Key": str(key or uuid4())},
        json=dict(expected_version=document["version"]) | changes,
    )


def own_state(service):
    result = raw_state(service)
    with service.engine.connect() as c:
        for table in (billing_documents, document_counters):
            result[table.name] = [
                dict(row)
                for row in c.execute(
                    sa.select(table).where(table.c.company_id == service.context.company_id)
                ).mappings()
            ]
    return result


def test_draft_finalize_replay_and_later_source_changes(billing_api):
    client, service, saved, ids, app = billing_api
    original = raw_state(service)
    key = uuid4()
    response = draft(client, saved, key)
    assert response.status_code == 201, response.text
    document = response.json()
    assert document["status"] == "draft" and document["number"] is None
    assert document["capture"]["pricing"] == saved["pricing"]
    assert document["total_minor"] == 110000
    assert document["lines"][0]["effective_unit_amount_minor"] == 110000
    assert draft(client, saved, key).json() == document
    assert draft(client, saved, key, expected_reservation_version=2).status_code == 409
    fk = uuid4()
    response = finalize(client, document, fk)
    assert response.status_code == 200, response.text
    final = response.json()
    assert final["number"] == "HMS-BILL-00000001" and final["version"] == 2
    assert final["capture"] == document["capture"] and final["created_at"] == document["created_at"]
    assert finalize(client, document, fk).json() == final
    assert finalize(client, document).status_code == 409
    assert finalize(client, final).status_code == 409
    assert draft(client, saved).status_code == 409
    assert client.get(f"/api/v1/billing-documents/{final['id']}").json() == final
    assert client.get(f"/api/v1/reservations/{saved['id']}/billing-documents").json() == [final]
    changed = command(client, saved, [intent(value="100")])
    assert changed.status_code == 200
    assert changed.json()["pricing"]["snapshot"]["total_minor"] == 100000
    assert client.get(f"/api/v1/billing-documents/{final['id']}").json() == final
    # Draft/finalize did not mutate the reservation/allocation or append a pricing revision.
    after = raw_state(service)
    assert len(after["pricing_revisions"]) == len(original["pricing_revisions"]) + 1
    assert len(after["operational_audit"]) == len(original["operational_audit"]) + 3


def test_override_discounts_extras_adjustments_and_zero_capture(billing_api):
    client, service, saved, ids, app = billing_api
    override = selected(room_definition(client, saved), str(ids["room"]))
    booked = command(
        client,
        saved,
        [override, intent(method="percentage", value="10")],
        adjustments=[dict(id=str(uuid4()), amount_minor=-500, reason="Correction")],
    )
    assert booked.status_code == 200, booked.text
    captured = draft(client, booked.json()).json()
    assert captured["total_minor"] == 80500
    assert captured["capture"]["pricing"]["snapshot"]["price_override_total_minor"] == 20000
    assert captured["lines"][0] == dict(
        source_line_id=f"room:{ids['room']}",
        source_kind="accommodation",
        source_id=str(ids["hourly-rate"]),
        label="Room 101 - Standard",
        quantity=1,
        original_unit_amount_minor=110000,
        effective_unit_amount_minor=90000,
        original_amount_minor=110000,
        effective_amount_minor=90000,
        discount_minor=9000,
        final_amount_minor=81000,
    )
    assert finalize(client, captured).status_code == 200


@pytest.mark.parametrize("change", ["note", "financial"])
def test_stale_source_rejects_without_refresh_or_partial_writes(billing_api, change):
    client, service, saved, ids, app = billing_api
    document = draft(client, saved).json()
    if change == "note":
        changed = client.patch(
            f"/api/v1/reservations/{saved['id']}",
            json=dict(expected_version=1, note="Changed"),
            headers={"Idempotency-Key": str(uuid4())},
        )
    else:
        changed = command(client, saved, [intent(value="100")])
    assert changed.status_code == 200
    before = own_state(service)
    response = finalize(client, document)
    assert response.status_code == 409 and response.json()["code"] == "stale_billing_source"
    assert own_state(service) == before
    assert client.get(f"/api/v1/billing-documents/{document['id']}").json() == document
    replacement = draft(client, changed.json())
    assert replacement.status_code == 201
    assert finalize(client, replacement.json()).status_code == 200


@pytest.mark.parametrize("same_key,separate_drafts", [(True, False), (False, False), (False, True)])
def test_competing_finalization_is_exactly_once(billing_api, same_key, separate_drafts):
    client, service, saved, ids, app = billing_api
    docs = [draft(client, saved).json()]
    docs.append(draft(client, saved).json() if separate_drafts else docs[0])
    key, barrier = uuid4(), Barrier(2)

    def submit(index):
        barrier.wait()
        return finalize(client, docs[index], key if same_key else None)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert sorted(r.status_code for r in results) == ([200, 200] if same_key else [200, 409])
    if same_key:
        assert results[0].json() == results[1].json()
    state = own_state(service)
    assert sum(d["status"] == "finalized" for d in state["billing_documents"]) == 1
    assert state["billing_document_counters"][0]["next_number"] == 2


@pytest.mark.parametrize(
    "stage",
    [
        "billing_document_counters",
        "billing_documents",
        "operational_audit",
        "mutation_receipts",
        "commit",
    ],
)
def test_finalize_rollback_including_number_allocation_and_retry(billing_api, stage):
    client, service, saved, ids, app = billing_api
    document = draft(client, saved).json()
    before, key = own_state(service), uuid4()

    def sql_fail(conn, cursor, statement, params, context, many):
        if stage in statement.lower() and statement.lower().startswith(("insert", "update")):
            raise RuntimeError("Injected document failure")

    def commit_fail(session):
        raise RuntimeError("Injected document commit failure")

    target, event, handler = (
        (Session, "before_commit", commit_fail)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", sql_fail)
    )
    sa.event.listen(target, event, handler)
    try:
        assert finalize(client, document, key).status_code >= 500
    finally:
        sa.event.remove(target, event, handler)
    assert own_state(service) == before
    response = finalize(client, document, key)
    assert response.status_code == 200, response.text
    assert response.json()["number"] == "HMS-BILL-00000001"


@pytest.mark.parametrize("operation", ["update", "delete", "reopen", "draft_capture"])
def test_database_immutability(billing_api, operation):
    client, service, saved, ids, app = billing_api
    document = draft(client, saved).json()
    if operation != "draft_capture":
        document = finalize(client, document).json()
    before = own_state(service)
    with pytest.raises(IntegrityError), service.engine.begin() as c:
        query = (
            billing_documents.delete()
            if operation == "delete"
            else billing_documents.update().values(
                **(
                    dict(
                        status="draft",
                        version=1,
                        number=None,
                        finalized_at=None,
                        finalized_by=None,
                        finalized_request_key=None,
                    )
                    if operation == "reopen"
                    else dict(total_minor=0)
                )
            )
        )
        c.execute(query.where(billing_documents.c.id == document["id"]))
    assert own_state(service) == before
    assert (
        client.patch(
            f"/api/v1/billing-documents/{document['id']}", json=dict(total_minor=0)
        ).status_code
        == 405
    )


def test_ownership_validation_ineligible_source_and_resource_bound_keys(billing_api):
    client, service, saved, ids, app = billing_api
    before = own_state(service)
    for payload in [
        {},
        {"expected_reservation_version": True},
        {"expected_reservation_version": "1"},
        {"expected_reservation_version": 1, "total_minor": 0},
    ]:
        assert (
            client.post(
                f"/api/v1/reservations/{saved['id']}/billing-documents",
                json=payload,
                headers={"Idempotency-Key": str(uuid4())},
            ).status_code
            == 422
        )
    assert (
        client.post(
            f"/api/v1/reservations/{saved['id']}/billing-documents",
            json=dict(expected_reservation_version=1),
        ).status_code
        == 422
    )
    assert own_state(service) == before
    foreign = uuid4()
    assert draft(client, saved | dict(id=str(foreign))).status_code == 404
    assert client.get(f"/api/v1/billing-documents/{foreign}").status_code == 404
    assert client.get(f"/api/v1/reservations/{foreign}/billing-documents").status_code == 404
    key = uuid4()
    document = draft(client, saved, key).json()
    assert draft(client, saved | dict(id=str(foreign)), key).status_code == 409
    fk = uuid4()
    assert finalize(client, document, fk).status_code == 200
    assert finalize(client, document, fk, expected_version=2).status_code == 409
    assert finalize(client, document | dict(id=str(foreign)), fk).status_code == 409


def test_real_foreign_company_cannot_read_capture_or_finalize(billing_api):
    client, service, saved, ids, app = billing_api
    document = draft(client, saved).json()
    original = app.dependency_overrides[get_command_context]
    assert get_settings().company_id != service.context.company_id
    app.dependency_overrides[get_command_context] = lambda: CommandContext(
        get_settings().company_id
    )
    before = own_state(service)
    try:
        assert draft(client, saved).status_code == 404
        assert finalize(client, document).status_code == 404
        assert client.get(f"/api/v1/billing-documents/{document['id']}").status_code == 404
        assert (
            client.get(f"/api/v1/reservations/{saved['id']}/billing-documents").status_code == 404
        )
    finally:
        app.dependency_overrides[get_command_context] = original
    assert own_state(service) == before


@pytest.mark.parametrize(
    "stage", ["billing_documents", "operational_audit", "mutation_receipts", "commit"]
)
def test_draft_creation_rollback_and_retry(billing_api, stage):
    client, service, saved, ids, app = billing_api
    before, key = own_state(service), uuid4()

    def fail_sql(conn, cursor, statement, params, context, many):
        if statement.lower().startswith("insert") and stage in statement.lower():
            raise RuntimeError("Injected draft creation failure")

    def fail_commit(session):
        raise RuntimeError("Injected draft commit failure")

    target, event, handler = (
        (Session, "before_commit", fail_commit)
        if stage == "commit"
        else (service.engine, "after_cursor_execute", fail_sql)
    )
    sa.event.listen(target, event, handler)
    try:
        assert draft(client, saved, key).status_code >= 500
    finally:
        sa.event.remove(target, event, handler)
    assert own_state(service) == before
    assert draft(client, saved, key).status_code == 201


def test_company_numbering_is_unique_under_distinct_reservation_finalizations(billing_api):
    client, service, saved, ids, app = billing_api
    other = client.post(
        "/api/v1/reservations",
        headers={"Idempotency-Key": str(uuid4())},
        json=dict(
            guest_id=saved["guest"]["id"],
            booking_source_id=str(ids["source"]),
            room_id=str(ids["room"]),
            duration_id=str(ids["hourly"]),
            scheduled_start="2026-12-10T14:00:00+08:00",
            adults=1,
        ),
    )
    assert other.status_code == 201, other.text
    docs = [draft(client, saved).json(), draft(client, other.json()).json()]
    barrier = Barrier(2)

    def submit(index):
        barrier.wait()
        return finalize(client, docs[index])

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert [r.status_code for r in results] == [200, 200]
    assert {r.json()["number"] for r in results} == {"HMS-BILL-00000001", "HMS-BILL-00000002"}


def test_extra_charges_and_zero_total_capture(billing_api):
    client, service, saved, ids, app = billing_api
    refs = client.get("/api/v1/reference-data").json()
    category = next(c for c in refs["inventory_categories"] if c["type"] == "extra")
    product = write(
        client,
        "products",
        dict(
            label="Extra",
            category_id=category["id"],
            unit_amount_minor=10025,
            available_for_sale=False,
        ),
    ).json()
    booked = command(
        client,
        saved,
        [intent(method="percentage", value="100")],
        charges=[dict(id=str(uuid4()), product_id=product["id"], quantity=2, usage="extra_charge")],
    )
    assert booked.status_code == 200, booked.text
    original = raw_state(service)
    document = draft(client, booked.json()).json()
    assert document["total_minor"] == 0
    assert document["lines"][1]["source_kind"] == "extra_charge"
    assert document["lines"][1]["quantity"] == 2
    assert document["lines"][1]["original_unit_amount_minor"] == 10025
    assert finalize(client, document).status_code == 200
    after = raw_state(service)
    for table in ("reservations", "room_allocations", "pricing_revisions"):
        assert after[table] == original[table]


def test_ineligible_reservation_and_counter_update_failure(billing_api):
    client, service, saved, ids, app = billing_api
    document = draft(client, saved).json()
    before = own_state(service)

    def fail(conn, cursor, statement, params, context, many):
        if statement.lower().startswith("update hms.billing_document_counters"):
            raise RuntimeError("Injected counter increment failure")

    sa.event.listen(service.engine, "after_cursor_execute", fail)
    try:
        assert finalize(client, document).status_code >= 500
    finally:
        sa.event.remove(service.engine, "after_cursor_execute", fail)
    assert own_state(service) == before
    with service.engine.begin() as c:
        c.execute(
            reservations.update().where(reservations.c.id == saved["id"]).values(status="cancelled")
        )
    before = own_state(service)
    assert draft(client, saved).status_code == 409
    assert finalize(client, document).status_code == 409
    assert own_state(service) == before


def test_purchased_unit_override_and_following_reductions_project_captured_units(billing_api):
    client, service, saved, ids, app = billing_api
    category = write(client, "categories", dict(label="Paid meals", type="ordinary")).json()
    product = write(
        client, "products", dict(label="Meal", category_id=category["id"], unit_amount_minor=15000)
    ).json()
    offer = preset(
        client,
        scope="item",
        method="final_price",
        value="0",
        target_product_id=product["id"],
        replacement_unit_amount_minor=12000,
    )
    line = str(uuid4())
    booked = command(
        client,
        saved,
        [
            selected(offer, line),
            intent("item", "percentage", "10", line),
            intent(method="percentage", value="10"),
        ],
        charges=[dict(id=line, product_id=product["id"], quantity=3, usage="purchase")],
    )
    assert booked.status_code == 200, booked.text
    document = draft(client, booked.json()).json()
    assert document["total_minor"] == 128160
    assert document["lines"][1]["original_unit_amount_minor"] == 15000
    assert document["lines"][1]["effective_unit_amount_minor"] == 12000
    assert document["lines"][1]["quantity"] == 3
    # Reservation reductions allocate against room-first original line order, not proportionally.
    assert document["lines"][1]["discount_minor"] == 3600
    assert document["lines"][1]["final_amount_minor"] == 32400
    assert finalize(client, document).status_code == 200


def test_identical_key_concurrent_draft_creation_and_finalize_validation(billing_api):
    client, service, saved, ids, app = billing_api
    key, barrier = uuid4(), Barrier(2)

    def submit(index):
        barrier.wait()
        return draft(client, saved, key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit, range(2)))
    assert [r.status_code for r in responses] == [201, 201]
    assert responses[0].json() == responses[1].json()
    document = responses[0].json()
    before = own_state(service)
    for payload in [
        {},
        {"expected_version": True},
        {"expected_version": "1"},
        {"expected_version": 1, "capture": {}},
    ]:
        assert (
            client.post(
                f"/api/v1/billing-documents/{document['id']}/finalize",
                json=payload,
                headers={"Idempotency-Key": str(uuid4())},
            ).status_code
            == 422
        )
    assert own_state(service) == before
    assert len(before["billing_documents"]) == 1
