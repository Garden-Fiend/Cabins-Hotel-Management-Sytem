from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import sqlalchemy as sa
from test_booking_financial_capture import setup
from test_collections import api as api
from test_collections import create, intent, post, read
from test_initial_financials import financial_body

from app.models import reservations
from app.modules.billing import collections as module

pytestmark = pytest.mark.postgres


def test_historical_capture_correction_counts_once_and_requires_new_obligation_review(api):
    client, _, body, _ = api
    request = setup(client, body)
    request["guest_obligation"] = {
        "status": "known",
        "accommodation_minor": 90000,
        "evidence": "Guest voucher review",
    }
    request["collections"] = {
        "collector": "channel",
        "component": "accommodation",
        "amount_minor": 90000,
        "reference": "PAY-A",
        "declaration": "confirmed",
    }
    saved = client.post(
        "/api/v1/reservations", json=request, headers={"Idempotency-Key": str(uuid4())}
    ).json()
    before = read(client, saved)
    correction = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-booking-financials",
        json={
            "expected_version": 1,
            "booking_source_id": request["booking_source_id"],
            "booking_financials": request["booking_financials"],
            "reason": "Reviewed commercial correction",
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert correction.status_code == 200, correction.text
    summary = read(client, saved)["summary"]
    assert summary["guest_balance_minor"] is None
    original = before["items"][0]
    refund = intent(
        summary,
        collector="channel",
        payment_method=None,
        component="accommodation",
        kind="refund",
        amount_minor=10000,
        reference="REF-A",
        reason="Channel returned guest funds",
        related_transaction_id=original["id"],
        source_id=original["source_id"],
        capture_id=original["capture_id"],
    )
    assert (
        post(client, saved, {**refund, "collector": "hotel", "payment_method": "cash"}).status_code
        == 409
    )
    response = post(client, saved, refund)
    assert response.status_code == 201, response.text
    after = read(client, saved)
    assert after["summary"]["net_channel_minor"] == 80000
    assert after["summary"]["net_hotel_minor"] == 0
    assert after["items"][0] == original
    assert after["items"][1]["capture_id"] == original["capture_id"]


def test_post_checkout_collection(api):
    client = api[0]
    saved = create(api, scheduled_start=(datetime.now(UTC) - timedelta(hours=1)).isoformat())
    for action, version in [("check-in", 1), ("check-out", 2)]:
        result = client.post(
            f"/api/v1/reservations/{saved['id']}/{action}",
            json={"expected_version": version},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert result.status_code == 200, result.text
    assert post(client, saved, intent(read(client, saved)["summary"])).status_code == 201


def test_accommodation_credit_cannot_silently_settle_hotel_extras(api):
    client, _, body, _ = api
    request = financial_body(client, body)
    request.update(
        adjustments=[],
        discounts=[],
        collections={
            "collector": "hotel",
            "component": "accommodation",
            "amount_minor": 135000,
            "payment_method": "cash",
            "declaration": "confirmed",
        },
    )
    saved = client.post(
        "/api/v1/reservations", json=request, headers={"Idempotency-Key": str(uuid4())}
    )
    assert saved.status_code == 201, saved.text
    summary = read(client, saved.json())["summary"]
    assert summary["accommodation_residual_minor"] == 0
    assert summary["hotel_charges_residual_minor"] == 25000
    assert summary["guest_balance_minor"] == 0
    assert summary["unapplied_hotel_minor"] == 25000
    assert summary["coverage_status"] == "allocation_required"


@pytest.mark.parametrize("point", ["version", "obligation", "audit", "receipt", "before_commit"])
def test_obligation_atomic_rollback_retry(api, monkeypatch, point):
    client = api[0]
    saved = create(api)
    before = read(client, saved)
    summary = before["summary"]
    body = {
        "expected_version": 1,
        "expected_capture_id": None,
        "expected_pricing_id": summary["pricing_id"],
        "status": "known",
        "accommodation_minor": 110000,
        "evidence": "Reviewed direct canonical amount",
    }
    key = {"Idempotency-Key": str(uuid4())}

    def fail(name):
        if name == point:
            raise RuntimeError("Obligation failure injection")

    monkeypatch.setattr(module, "stage", fail)
    with pytest.raises(RuntimeError):
        client.post(f"/api/v1/reservations/{saved['id']}/guest-obligation", json=body, headers=key)
    assert read(client, saved) == before
    monkeypatch.setattr(module, "stage", lambda name: None)
    result = client.post(
        f"/api/v1/reservations/{saved['id']}/guest-obligation", json=body, headers=key
    )
    assert result.status_code == 200, result.text


def test_plural_initial_collection_is_atomic(api, monkeypatch):
    client, service, body, ids = api
    request = {
        "guest_id": body["guest_id"],
        "booking_source_id": body["booking_source_id"],
        "duration_id": body["duration_id"],
        "scheduled_start": body["scheduled_start"],
        "allocations": [{"room_id": str(ids["room"]), "adults": 2, "children": 0}],
        "collections": {
            "collector": "hotel",
            "component": "accommodation",
            "amount_minor": 110000,
            "payment_method": "cash",
            "declaration": "confirmed",
        },
    }
    key = {"Idempotency-Key": str(uuid4())}

    def fail(name):
        if name == "transaction":
            raise RuntimeError("Initial collection failure")

    monkeypatch.setattr(module, "stage", fail)
    with pytest.raises(RuntimeError):
        client.post("/api/v1/multi-room-reservations", json=request, headers=key)
    with service.engine.connect() as connection:
        assert (
            connection.scalar(
                sa.select(sa.func.count())
                .select_from(reservations)
                .where(reservations.c.company_id == service.context.company_id)
            )
            == 0
        )
    monkeypatch.setattr(module, "stage", lambda name: None)
    response = client.post("/api/v1/multi-room-reservations", json=request, headers=key)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["version"] == 1
    assert read(client, saved)["summary"]["guest_balance_minor"] == 0
    assert client.post("/api/v1/multi-room-reservations", json=request, headers=key).json() == saved


def test_validation_ownership_and_full_history_summary(api):
    client = api[0]
    saved = create(api)
    body = intent(read(client, saved)["summary"])
    assert post(client, {"id": str(uuid4())}, body).status_code == 404
    for extra in (
        {"actor": "Forged staff"},
        {"recorded_at": "2026-10-01"},
        {"guest_balance_minor": 0},
        {"currency": "USD"},
        {"amount_minor": True},
    ):
        assert post(client, saved, {**body, **extra}).status_code == 422
    assert post(client, saved, body).status_code == 201
    body = intent(read(client, saved)["summary"])
    assert post(client, saved, body).status_code == 201
    page = client.get(f"/api/v1/reservations/{saved['id']}/collections?limit=1&offset=1").json()
    assert len(page["items"]) == 1 and page["total"] == 2
    assert page["summary"]["net_hotel_minor"] == 40000


def test_unallocated_adjustments_are_explicit_review_not_guessed_debt(api):
    client = api[0]
    saved = create(
        api,
        adjustments=[
            {"id": str(uuid4()), "amount_minor": -1000, "reason": "Unclassified courtesy"}
        ],
    )
    summary = read(client, saved)["summary"]
    assert summary["guest_balance_minor"] is None
    assert "unallocated_signed_adjustments" in summary["unresolved_components"]
