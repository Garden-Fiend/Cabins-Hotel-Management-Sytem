from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
import sqlalchemy as sa
from test_booking_financial_capture import setup
from test_collections import api as api
from test_collections import intent, post, read
from test_initial_financials import financial_body

from app.modules.billing import collections as stages
from app.modules.billing.allocation_models import payment_allocations

pytestmark = pytest.mark.postgres


def rich(api, amount=135000):
    client, _, body, _ = api
    request = financial_body(client, body)
    request.update(
        adjustments=[],
        discounts=[],
        collections={
            "collector": "hotel",
            "component": "accommodation",
            "amount_minor": amount,
            "payment_method": "cash",
            "declaration": "confirmed",
        },
    )
    response = client.post(
        "/api/v1/reservations", json=request, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 201, response.text
    return response.json()


def allocation(summary, payment_id, **changes):
    return dict(
        expected_version=summary["reservation_version"],
        expected_pricing_id=summary["pricing_id"],
        expected_obligation_id=summary["allocation_obligation_id"],
        kind="allocate",
        payment_id=payment_id,
        component="hotel_charges",
        amount_minor=25000,
        reason="Apply available hotel cash to meals",
        **changes,
    )


def write(client, saved, body, key=None):
    return client.post(
        f"/api/v1/reservations/{saved['id']}/payment-allocations",
        json=body,
        headers={"Idempotency-Key": str(key or uuid4())},
    )


def test_excess_cash_explicit_cross_component_allocation(api):
    client = api[0]
    saved = rich(api)
    before = read(client, saved)
    summary = before["summary"]
    payment = before["items"][0]
    assert summary["allocated_hotel_minor"] == 110000
    assert summary["unapplied_hotel_minor"] == 25000
    assert summary["component_outstanding"]["hotel_charges"] == 25000
    assert summary["coverage_status"] == "allocation_required"
    body = allocation(summary, payment["id"])
    key = uuid4()
    result = write(client, saved, body, key)
    assert result.status_code == 201, result.text
    assert write(client, saved, body, key).json() == result.json()
    assert write(client, saved, {**body, "amount_minor": 1}, key).status_code == 409
    after = read(client, saved)
    assert after["summary"]["unapplied_hotel_minor"] == 0
    assert after["summary"]["component_outstanding"]["hotel_charges"] == 0
    assert after["items"][0] == payment
    assert client.get(f"/api/v1/reservations/{saved['id']}").json()["pricing"] == saved["pricing"]


def test_refund_compensates_allocations_atomically(api):
    client = api[0]
    saved = rich(api)
    data = read(client, saved)
    assert (
        write(client, saved, allocation(data["summary"], data["items"][0]["id"])).status_code == 201
    )
    data = read(client, saved)
    original = data["items"][0]
    refund = intent(
        data["summary"],
        kind="refund",
        amount_minor=30000,
        related_transaction_id=original["id"],
        reason="Actual partial cash return",
    )
    result = post(client, saved, refund)
    assert result.status_code == 201, result.text
    after = read(client, saved)["summary"]
    assert after["allocated_hotel_minor"] == 105000
    assert after["unapplied_hotel_minor"] == 0
    assert len([event for event in after["allocation_history"] if event["kind"] == "release"]) == 2
    assert after["component_outstanding"] == {"accommodation": 5000, "hotel_charges": 25000}


def test_capacity_targets_foreign_context_and_stale(api):
    client = api[0]
    saved = rich(api)
    data = read(client, saved)
    body = allocation(data["summary"], data["items"][0]["id"])
    assert write(client, saved, {**body, "amount_minor": 25001}).status_code == 409
    assert write(client, saved, {**body, "expected_pricing_id": str(uuid4())}).status_code == 409
    assert write(client, saved, {**body, "payment_id": str(uuid4())}).status_code == 404
    assert write(client, saved, body).status_code == 201
    assert write(client, saved, body).status_code == 409


@pytest.mark.parametrize("point", ["version", "allocation", "audit", "receipt", "before_commit"])
def test_allocation_rollback_retry(api, monkeypatch, point):
    client = api[0]
    saved = rich(api)
    before = read(client, saved)
    body = allocation(before["summary"], before["items"][0]["id"])
    key = uuid4()

    def fail(name):
        if name == point:
            raise RuntimeError("Allocation failure")

    monkeypatch.setattr(stages, "stage", fail)
    with pytest.raises(RuntimeError):
        write(client, saved, body, key)
    assert read(client, saved) == before
    monkeypatch.setattr(stages, "stage", lambda name: None)
    assert write(client, saved, body, key).status_code == 201


def test_concurrent_allocations_and_refund(api):
    client = api[0]
    saved = rich(api)
    data = read(client, saved)
    body = allocation(data["summary"], data["items"][0]["id"])
    refund = intent(
        data["summary"],
        kind="refund",
        amount_minor=30000,
        related_transaction_id=data["items"][0]["id"],
        reason="Cash returned",
    )
    with ThreadPoolExecutor(2) as pool:
        futures = [
            pool.submit(write, client, saved, body),
            pool.submit(post, client, saved, refund),
        ]
        responses = [future.result() for future in futures]
    assert sorted(result.status_code for result in responses) == [201, 409]
    assert (
        read(client, saved)["summary"]["allocated_hotel_minor"]
        <= read(client, saved)["summary"]["net_hotel_minor"]
    )


def test_pricing_change_appends_releases_and_never_rewrites_events(api):
    client = api[0]
    saved = rich(api)
    before = read(client, saved)
    history = before["summary"]["allocation_history"]
    response = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-billing",
        json={
            "expected_version": 1,
            "guest_id": saved["guest"]["id"],
            "adjustments": [
                {"id": str(uuid4()), "amount_minor": -500, "reason": "Unclassified reduction"}
            ],
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 200, response.text
    after = read(client, saved)["summary"]
    assert after["allocation_history"][: len(history)] == history
    assert after["allocated_hotel_minor"] == 0 and after["unapplied_hotel_minor"] == 135000
    assert after["guest_balance_minor"] is None
    assert "unallocated_signed_adjustments" in after["unresolved_components"]
    assert len(response.json()["audit"]) == len(
        client.get(f"/api/v1/reservations/{saved['id']}").json()["audit"]
    )


def test_multiple_initial_payments_order_replay_and_atomic_failure(api, monkeypatch):
    client, _, body, _ = api
    entries = [
        dict(
            collector="hotel",
            component="accommodation",
            amount_minor=70000,
            payment_method="cash",
            declaration="partial",
        ),
        dict(
            collector="hotel",
            component="accommodation",
            amount_minor=40000,
            payment_method="card",
            reference="CARD-INITIAL",
            declaration="confirmed",
        ),
    ]
    request = {**body, "collections": entries}
    key = {"Idempotency-Key": str(uuid4())}
    from app.modules.billing import payment_allocations as module

    original = module.append_event

    def fail(*args, **kwargs):
        result = original(*args, **kwargs)
        if result["amount_minor"] == 40000:
            raise RuntimeError("Second staged allocation failed")
        return result

    monkeypatch.setattr(module, "append_event", fail)
    with pytest.raises(RuntimeError):
        client.post("/api/v1/reservations", json=request, headers=key)
    assert client.get("/api/v1/reservations").json() == []
    monkeypatch.setattr(module, "append_event", original)
    result = client.post("/api/v1/reservations", json=request, headers=key)
    assert result.status_code == 201, result.text
    saved = result.json()
    data = read(client, saved)
    assert saved["version"] == 1 and [row["ordinal"] for row in data["items"]] == [0, 1]
    assert data["summary"]["allocated_hotel_minor"] == 110000
    assert client.post("/api/v1/reservations", json=request, headers=key).json() == saved


def test_duplicate_reference_between_staged_entries_review_survives_new_key(api):
    client, _, body, _ = api
    entry = dict(
        collector="hotel",
        component="accommodation",
        amount_minor=10000,
        payment_method="bank",
        reference="SHARED-INITIAL",
        declaration="partial",
    )
    request = {**body, "collections": [entry.copy(), entry.copy()]}
    first = client.post(
        "/api/v1/reservations", json=request, headers={"Idempotency-Key": str(uuid4())}
    )
    assert first.status_code == 409, first.text
    assert first.json()["initial_ordinal"] == 1
    assert client.get("/api/v1/reservations").json() == []
    request["collections"][1].update(
        duplicate_token=first.json()["duplicate_token"],
        duplicate_acknowledged=True,
        duplicate_justification="Two separate payments on the same bank statement",
    )
    second = client.post(
        "/api/v1/reservations", json=request, headers={"Idempotency-Key": str(uuid4())}
    )
    assert second.status_code == 201, second.text
    assert read(client, second.json())["total"] == 2


def test_no_unapplied_money_means_no_transferable_cash(api):
    client = api[0]
    saved = rich(api, amount=100000)
    data = read(client, saved)
    assert data["summary"]["unapplied_hotel_minor"] == 0
    assert (
        write(client, saved, allocation(data["summary"], data["items"][0]["id"])).status_code == 409
    )


def test_event_history_is_database_immutable(api):
    _, service, _, _ = api
    saved = rich(api)
    with pytest.raises(sa.exc.IntegrityError), service.engine.begin() as connection:
        connection.execute(
            payment_allocations.delete().where(payment_allocations.c.reservation_id == saved["id"])
        )


def test_manual_release_reapply_and_full_reversal(api):
    client = api[0]
    saved = rich(api)
    data = read(client, saved)
    original = data["items"][0]
    first = data["summary"]["allocation_history"][0]
    release = allocation(data["summary"], original["id"])
    release.update(
        kind="release",
        component="accommodation",
        release_of=first["id"],
        amount_minor=10000,
        reason="Review application",
    )
    assert write(client, saved, release).status_code == 201
    data = read(client, saved)
    reapply = allocation(data["summary"], original["id"])
    reapply.update(component="accommodation", amount_minor=10000)
    assert write(client, saved, reapply).status_code == 201
    data = read(client, saved)
    reversal = intent(
        data["summary"],
        kind="reversal",
        amount_minor=135000,
        related_transaction_id=original["id"],
        reason="Incorrect recorded receipt",
    )
    assert post(client, saved, reversal).status_code == 201
    final = read(client, saved)["summary"]
    assert final["allocated_hotel_minor"] == final["unapplied_hotel_minor"] == 0
    assert final["allocation_history"][0] == first
    assert final["component_outstanding"] == {"accommodation": 110000, "hotel_charges": 25000}


def test_target_cap_is_independent_of_available_source_capacity(api):
    client = api[0]
    saved = rich(api, amount=200000)
    data = read(client, saved)
    body = allocation(data["summary"], data["items"][0]["id"])
    assert data["summary"]["unapplied_hotel_minor"] == 90000
    assert write(client, saved, {**body, "amount_minor": 25001}).status_code == 409
    assert read(client, saved) == data


def test_discount_reductions_without_collection_never_fabricate_funds(api):
    client, _, body, _ = api
    request = financial_body(client, body)
    request["adjustments"] = []
    saved = client.post(
        "/api/v1/reservations", json=request, headers={"Idempotency-Key": str(uuid4())}
    ).json()
    summary = read(client, saved)["summary"]
    assert saved["pricing"]["snapshot"]["discount_total_minor"] > 0
    assert summary["net_hotel_minor"] == summary["unapplied_hotel_minor"] == 0
    assert summary["payment_capacities"] == summary["allocation_history"] == []


def test_channel_accommodation_cannot_cover_extras_or_create_hotel_cash(api):
    client, _, body, _ = api
    request = setup(client, financial_body(client, body))
    request.update(
        adjustments=[],
        discounts=[],
        guest_obligation={
            "status": "known",
            "accommodation_minor": 90000,
            "evidence": "Guest voucher",
        },
        collections={
            "collector": "channel",
            "component": "accommodation",
            "amount_minor": 100000,
            "reference": "OTA-EVIDENCE",
            "declaration": "confirmed",
        },
    )
    response = client.post(
        "/api/v1/reservations", json=request, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 201, response.text
    saved = response.json()
    data = read(client, saved)
    assert data["summary"]["allocated_channel_minor"] == 90000
    assert data["summary"]["unapplied_channel_minor"] == 10000
    assert data["summary"]["net_hotel_minor"] == 0
    assert data["summary"]["component_outstanding"]["hotel_charges"] == 25000
    assert (
        write(client, saved, allocation(data["summary"], data["items"][0]["id"])).status_code == 409
    )


def test_offsetting_ambiguous_adjustments_still_require_review(api):
    client, _, body, _ = api
    request = financial_body(client, body)
    request["adjustments"][1]["amount_minor"] = -1000
    response = client.post(
        "/api/v1/reservations", json=request, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 201, response.text
    summary = read(client, response.json())["summary"]
    assert summary["guest_balance_minor"] is None
    assert summary["coverage_status"] == "requires_review"


def test_database_deferred_source_capacity_and_release_guards(api):
    client, service, _, _ = api
    saved = rich(api)
    original = read(client, saved)["summary"]["allocation_history"][0]
    # Even direct SQL cannot overspend the source or over-release an allocation.
    for kind, amount, release_of in [
        ("allocate", 25001, None),
        ("release", 110001, original["id"]),
    ]:
        with pytest.raises(sa.exc.IntegrityError), service.engine.begin() as connection:
            values = {
                key: value
                for key, value in original.items()
                if key not in {"id", "sequence", "recorded_at"}
            }
            values.update(
                id=uuid4(),
                kind=kind,
                amount_minor=amount,
                release_of=release_of,
                provenance="manual",
                reason="Guard assertion",
            )
            connection.execute(payment_allocations.insert().values(**values))
            connection.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    assert len(read(client, saved)["summary"]["allocation_history"]) == 1


def test_concurrent_allocations_do_not_double_spend(api):
    client = api[0]
    saved = rich(api)
    data = read(client, saved)
    body = allocation(data["summary"], data["items"][0]["id"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: write(client, saved, body), range(2)))
    assert sorted(response.status_code for response in responses) == [201, 409]
    after = read(client, saved)["summary"]
    assert after["allocated_hotel_minor"] == 135000
    assert after["unapplied_hotel_minor"] == 0


def test_foreign_company_and_other_reservation_payment_reject(api):
    from app.context import CommandContext
    from app.errors import DomainError
    from app.modules.billing.collection_schemas import AllocationCommand
    from app.modules.billing.payment_allocations import command
    from app.modules.reservations.services import ReservationService

    client, service, body, _ = api
    saved = rich(api)
    data = read(client, saved)
    request = allocation(data["summary"], data["items"][0]["id"])
    foreign = ReservationService(service.engine, CommandContext(uuid4()))
    with pytest.raises(DomainError) as error:
        command(foreign, saved["id"], AllocationCommand.model_validate(request), uuid4())
    assert error.value.status == 404
    other = client.post(
        "/api/v1/reservations",
        json={
            **body,
            "scheduled_start": "2026-11-12T14:00:00+08:00",
            "collections": {
                "collector": "hotel",
                "component": "accommodation",
                "amount_minor": 20000,
                "payment_method": "cash",
                "declaration": "partial",
            },
        },
        headers={"Idempotency-Key": str(uuid4())},
    ).json()
    other_payment = read(client, other)["items"][0]
    assert write(client, saved, {**request, "payment_id": other_payment["id"]}).status_code == 404
    assert read(client, saved) == data


def test_initial_reference_locks_serialize_opposite_entry_order(api):
    client, _, body, _ = api
    entries = [
        {
            "collector": "hotel",
            "component": "accommodation",
            "amount_minor": 10000,
            "payment_method": "bank",
            "reference": reference,
            "declaration": "partial",
        }
        for reference in ("LOCK-A", "LOCK-B")
    ]
    requests = [
        {**body, "collections": entries},
        {
            **body,
            "scheduled_start": "2026-11-12T14:00:00+08:00",
            "collections": list(reversed(entries)),
        },
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda request: client.post(
                    "/api/v1/reservations", json=request, headers={"Idempotency-Key": str(uuid4())}
                ),
                requests,
            )
        )
    assert sorted(response.status_code for response in responses) == [201, 409]
    rejected = next(response for response in responses if response.status_code == 409)
    assert rejected.json()["code"] == "duplicate_evidence_review"
    assert len(client.get("/api/v1/reservations").json()) == 1
