from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
import sqlalchemy as sa
from test_booking_financial_capture import setup
from test_initial_financials import financial_body
from test_reservation_api import api as api

from app.modules.billing import collections as module
from app.modules.billing.collection_models import collection_transactions, guest_obligations

pytestmark = pytest.mark.postgres


def create(api, *, channel=False, **changes):
    client, _, body, _ = api
    body = setup(client, body) if channel else body
    response = client.post(
        "/api/v1/reservations", json={**body, **changes}, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 201, response.text
    return response.json()


def read(client, saved):
    result = client.get(f"/api/v1/reservations/{saved['id']}/collections")
    assert result.status_code == 200, result.text
    return result.json()


def intent(summary, **changes):
    return {
        "expected_version": summary["reservation_version"],
        "source_id": summary["source_id"],
        "capture_id": summary["capture_id"],
        "collector": "hotel",
        "component": "accommodation",
        "amount_minor": 20000,
        "payment_method": "cash",
        "declaration": "confirmed",
        **changes,
    }


def post(client, saved, body, key=None):
    return client.post(
        f"/api/v1/reservations/{saved['id']}/collections",
        json=body,
        headers={"Idempotency-Key": str(key or uuid4())},
    )


def test_hotel_cash_refunds_reversal_and_history(api):
    client = api[0]
    saved = create(api)
    before = client.get(f"/api/v1/reservations/{saved['id']}").json()["pricing"]
    result = post(client, saved, intent(read(client, saved)["summary"], amount_minor=200000))
    assert result.status_code == 201, result.text
    data = read(client, saved)
    original = data["items"][0]
    assert data["summary"]["guest_balance_minor"] == -90000
    refund = intent(
        data["summary"],
        kind="refund",
        related_transaction_id=original["id"],
        reason="Returned cash",
        amount_minor=50000,
    )
    assert post(client, saved, refund).status_code == 201
    data = read(client, saved)
    assert data["summary"]["net_hotel_minor"] == 150000
    assert (
        post(
            client,
            saved,
            {
                **refund,
                "expected_version": data["summary"]["reservation_version"],
                "amount_minor": 160000,
            },
        ).status_code
        == 409
    )
    assert (
        post(
            client,
            saved,
            {
                **refund,
                "expected_version": data["summary"]["reservation_version"],
                "kind": "reversal",
                "amount_minor": 200000,
            },
        ).status_code
        == 409
    )
    assert client.get(f"/api/v1/reservations/{saved['id']}").json()["pricing"] == before
    assert read(client, saved)["items"][0] == original


def test_channel_unknown_then_review_known_and_extras(api):
    client = api[0]
    saved = create(api, channel=True, adjustments=[])
    assert read(client, saved)["items"] == []
    result = post(
        client,
        saved,
        intent(
            read(client, saved)["summary"],
            collector="channel",
            payment_method=None,
            reference="Payment evidence",
            amount_minor=90000,
        ),
    )
    assert result.status_code == 201, result.text
    summary = read(client, saved)["summary"]
    assert (
        summary["guest_balance_minor"] is None and summary["coverage_status"] == "requires_review"
    )
    review = client.post(
        f"/api/v1/reservations/{saved['id']}/guest-obligation",
        json={
            "expected_version": summary["reservation_version"],
            "expected_capture_id": summary["capture_id"],
            "expected_pricing_id": summary["pricing_id"],
            "status": "known",
            "accommodation_minor": 90000,
            "evidence": "Reviewed OTA guest obligation",
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert review.status_code == 200, review.text
    summary = read(client, saved)["summary"]
    assert summary["guest_balance_minor"] == 0 and summary["net_hotel_minor"] == 0
    assert summary["net_channel_minor"] == 90000
    assert saved["pricing"]["snapshot"]["total_minor"] == 100000


def test_duplicate_review_bound_replay_and_stale(api):
    client = api[0]
    saved = create(api)
    first = intent(read(client, saved)["summary"], payment_method="bank", reference=" Batch-X ")
    assert post(client, saved, first).status_code == 201
    body = intent(read(client, saved)["summary"], payment_method="BANK", reference="batch-x")
    duplicate = post(client, saved, body)
    assert duplicate.status_code == 409, duplicate.text
    review = duplicate.json()
    assert review["code"] == "duplicate_evidence_review" and len(review["matches"]) == 1
    body.update(
        duplicate_acknowledged=True,
        duplicate_justification="Shared reference reviewed",
        duplicate_token=review["duplicate_token"],
    )
    key = uuid4()
    changed_review = post(client, saved, {**body, "amount_minor": 1})
    assert changed_review.status_code == 409
    assert changed_review.json()["code"] == "duplicate_evidence_review"
    saved_response = post(client, saved, body, key)
    assert saved_response.status_code == 201, saved_response.text
    assert post(client, saved, body, key).json() == saved_response.json()
    assert post(client, saved, {**body, "amount_minor": 1}, key).status_code == 409
    assert post(client, saved, body).status_code == 409
    changed = intent(
        read(client, saved)["summary"],
        payment_method="bank",
        reference="batch-x",
        duplicate_acknowledged=True,
        duplicate_justification="Old review",
        duplicate_token=review["duplicate_token"],
    )
    assert post(client, saved, changed).json()["code"] == "duplicate_evidence_review"


@pytest.mark.parametrize("point", ["version", "transaction", "audit", "receipt", "before_commit"])
def test_rollback_retry(api, monkeypatch, point):
    client = api[0]
    saved = create(api)
    before = read(client, saved)
    body = intent(before["summary"])
    key = uuid4()

    def fail(name):
        if name == point:
            raise RuntimeError("Injected failure")

    monkeypatch.setattr(module, "stage", fail)
    with pytest.raises(RuntimeError):
        post(client, saved, body, key)
    assert read(client, saved) == before
    monkeypatch.setattr(module, "stage", lambda name: None)
    assert post(client, saved, body, key).status_code == 201


def test_initial_atomic_and_no_backfill(api):
    client = api[0]
    saved = create(
        api,
        collections={
            "collector": "hotel",
            "component": "accommodation",
            "amount_minor": 10000,
            "payment_method": "cash",
            "declaration": "partial",
        },
    )
    assert saved["version"] == 1
    data = read(client, saved)
    assert data["summary"]["net_hotel_minor"] == 10000
    assert data["items"][0]["reservation_version"] == 1


def test_full_reversal_and_immutable_sql(api):
    client, service, _, _ = api
    saved = create(api)
    assert post(client, saved, intent(read(client, saved)["summary"])).status_code == 201
    data = read(client, saved)
    body = intent(
        data["summary"],
        kind="reversal",
        related_transaction_id=data["items"][0]["id"],
        reason="Incorrect record",
    )
    assert post(client, saved, body).status_code == 201
    data = read(client, saved)
    assert data["summary"]["net_hotel_minor"] == 0
    assert (
        post(
            client, saved, {**body, "expected_version": data["summary"]["reservation_version"]}
        ).status_code
        == 409
    )
    with pytest.raises(sa.exc.IntegrityError), service.engine.begin() as connection:
        connection.execute(
            collection_transactions.update()
            .where(collection_transactions.c.reservation_id == saved["id"])
            .values(amount_minor=1)
        )
    with service.engine.connect() as connection:
        assert (
            connection.scalar(
                sa.select(sa.func.count())
                .select_from(guest_obligations)
                .where(guest_obligations.c.reservation_id == saved["id"])
            )
            == 0
        )


def test_concurrent_same_key_and_refunds(api):
    client = api[0]
    saved = create(api)
    body = intent(read(client, saved)["summary"])
    key = uuid4()
    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(lambda _: post(client, saved, body, key), range(2)))
    assert [r.status_code for r in responses] == [201, 201]
    assert responses[0].json() == responses[1].json()
    data = read(client, saved)
    refund = intent(
        data["summary"],
        kind="refund",
        amount_minor=15000,
        related_transaction_id=data["items"][0]["id"],
        reason="Return",
    )
    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(lambda _: post(client, saved, refund), range(2)))
    assert sorted(r.status_code for r in responses) == [201, 409]


def test_ota_funded_difference_never_clears_extras(api):
    client, _, body, _ = api
    request = setup(client, body)
    rich = financial_body(client, request)
    rich.update(
        adjustments=[],
        discounts=[],
        guest_obligation={
            "status": "known",
            "accommodation_minor": 90000,
            "evidence": "Explicit guest liability",
        },
        collections={
            "collector": "channel",
            "component": "accommodation",
            "amount_minor": 90000,
            "reference": "Verified OTA payment statement",
            "declaration": "confirmed",
        },
    )
    response = client.post(
        "/api/v1/reservations", json=rich, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 201, response.text
    saved = response.json()
    summary = read(client, saved)["summary"]
    assert summary["accommodation_residual_minor"] == 0
    assert summary["hotel_charges_residual_minor"] == 25000
    assert summary["guest_balance_minor"] == 25000
    assert summary["net_hotel_minor"] == 0
    assert saved["pricing"]["snapshot"]["channel"]["figures"]["hotel_received_minor"] == 0


def test_cross_reservation_duplicate_race(api):
    client = api[0]
    first = create(api)
    second = create(api, scheduled_start="2026-12-12T14:00:00+08:00")

    def submit(saved):
        return post(
            client,
            saved,
            intent(
                read(client, saved)["summary"],
                payment_method="bank",
                reference="Shared Race Evidence",
            ),
        )

    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(submit, [first, second]))
    assert sorted(response.status_code for response in responses) == [201, 409]
    conflict = next(response.json() for response in responses if response.status_code == 409)
    assert conflict["code"] == "duplicate_evidence_review"


def test_cancelled_reason_and_post_finalization(api):
    client = api[0]
    saved = create(api)

    def header():
        return {"Idempotency-Key": str(uuid4())}

    draft = client.post(
        f"/api/v1/reservations/{saved['id']}/billing-documents",
        json={"expected_reservation_version": 1},
        headers=header(),
    ).json()
    final = client.post(
        f"/api/v1/billing-documents/{draft['id']}/finalize",
        json={"expected_version": 1},
        headers=header(),
    )
    assert final.status_code == 200, final.text
    assert post(client, saved, intent(read(client, saved)["summary"])).status_code == 201
    assert client.get(f"/api/v1/billing-documents/{draft['id']}").json() == final.json()
    current = read(client, saved)["summary"]
    cancelled = client.post(
        f"/api/v1/reservations/{saved['id']}/cancel",
        json={"expected_version": current["reservation_version"], "guest_has_vacated": True},
        headers=header(),
    )
    assert cancelled.status_code == 200, cancelled.text
    body = intent(read(client, saved)["summary"])
    assert post(client, saved, body).status_code == 422
    assert (
        post(
            client, saved, {**body, "reason": "Reviewed outstanding collection after cancellation"}
        ).status_code
        == 201
    )
