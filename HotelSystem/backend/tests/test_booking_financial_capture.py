from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from test_booking_financial_calculation import TERMS
from test_reservation_api import api as api

from app.models import agreements, booking_financial_captures
from app.modules.reservations.schemas import ReservationCreate

pytestmark = pytest.mark.postgres


def setup(client, body, terms=TERMS):
    def headers():
        return {"Idempotency-Key": str(uuid4())}

    source = client.post(
        "/api/v1/configuration/booking-sources",
        headers=headers(),
        json={
            "label": "B6 channel",
            "classification": "ota",
            "reference_required": True,
        },
    )
    assert source.status_code == 201, source.text
    source = source.json()
    agreement = client.post(
        f"/api/v1/configuration/booking-sources/{source['id']}/agreements",
        headers=headers(),
        json={
            "expected_source_version": 1,
            "expected_agreement_version": 0,
            "effective_from": "2026-10-01",
            "effective_to": "2026-10-31",
            "status": "active",
            "terms": terms,
        },
    )
    assert agreement.status_code == 201, agreement.text
    agreement = agreement.json()
    return dict(
        body,
        booking_source_id=source["id"],
        booking_financials={
            "confirmation_date": "2026-10-16",
            "external_reference": " AGD-123 ",
            "expected_source_version": 1,
            "expected_agreement_id": agreement["id"],
            "expected_agreement_version": 1,
            "contractual_accommodation_minor": 100000,
            "guest_paid_minor": 90000,
            "guest_paid_status": "reported_paid",
            "difference_classification": "channel_funded",
            "collection": "channel",
            "override_reason": "Booking confirmation",
        },
    )


def create(client, body, key=None):
    return client.post(
        "/api/v1/reservations", json=body, headers={"Idempotency-Key": str(key or uuid4())}
    )


def test_capture_read_replay_history_and_agreement_use_guard(api):
    client, service, body, ids = api
    request = setup(client, body)
    key = uuid4()
    saved = create(client, request, key)
    assert saved.status_code == 201, saved.text
    value = saved.json()
    snapshot = value["pricing"]["snapshot"]
    assert snapshot["schema_version"] == 7 and snapshot["total_minor"] == 100000
    assert snapshot["channel"]["figures"]["commission_minor"] == 15000
    assert snapshot["channel"]["figures"]["expected_settlement_minor"] == 85000
    assert snapshot["channel"]["figures"]["hotel_received_minor"] == 0
    assert create(client, request, key).json() == value
    assert client.get(f"/api/v1/reservations/{value['id']}").json() == value
    with service.engine.connect() as connection:
        assert (
            connection.scalar(
                sa.select(sa.func.count())
                .select_from(booking_financial_captures)
                .where(booking_financial_captures.c.reservation_id == value["id"])
            )
            == 1
        )
    agreement_id = snapshot["channel"]["agreement_id"]
    with pytest.raises(sa.exc.IntegrityError), service.engine.begin() as connection:
        connection.execute(
            agreements.update()
            .where(agreements.c.id == agreement_id)
            .values(version=2, effective_to="2026-10-15")
        )


def test_duplicate_reference_and_required_reference(api):
    client, _, body, _ = api
    request = setup(client, body)
    blank = deepcopy(request)
    blank["booking_financials"]["external_reference"] = ""
    assert create(client, blank).status_code == 422
    assert create(client, request).status_code == 201
    request["scheduled_start"] = "2026-12-10T14:00:00+08:00"
    result = create(client, request)
    assert result.status_code == 409 and "reference" in result.text, result.text


@pytest.mark.parametrize(
    "changes,status",
    [
        ({"expected_source_version": 2}, 409),
        ({"expected_agreement_version": 2}, 409),
        ({"confirmation_date": "2026-11-01"}, 409),
        ({"commission_minor": 1}, 422),
        ({"collection": "hotel"}, 422),
    ],
)
def test_reject_stale_inapplicable_and_forged_inputs(api, changes, status):
    client, service, body, _ = api
    request = setup(client, body)
    request["booking_financials"].update(changes)
    assert create(client, request).status_code == status
    with service.engine.connect() as connection:
        assert (
            connection.scalar(
                sa.select(sa.func.count())
                .select_from(booking_financial_captures)
                .where(booking_financial_captures.c.company_id == service.context.company_id)
            )
            == 0
        )


@pytest.mark.parametrize(
    "stage",
    [
        "reservations",
        "room_allocations",
        "booking_financial_captures",
        "pricing_revisions",
        "operational_audit",
        "mutation_receipts",
        "commit",
    ],
)
def test_capture_insert_rollback_and_same_key_retry(api, monkeypatch, stage):
    from sqlalchemy.orm import Session

    client, service, body, _ = api
    request = setup(client, body)
    key = uuid4()
    original = Session.execute

    def fail(session, statement, *args, **kwargs):
        result = original(session, statement, *args, **kwargs)
        if (
            getattr(statement, "is_insert", False)
            and getattr(getattr(statement, "table", None), "name", None) == stage
        ):
            raise RuntimeError("B6 injected failure")
        return result

    def fail_commit(session):
        raise RuntimeError("B6 injected failure")

    with monkeypatch.context() as patch:
        patch.setattr(Session, "execute", fail)
        if stage == "commit":
            sa.event.listen(Session, "before_commit", fail_commit)
        try:
            with pytest.raises(RuntimeError, match="B6 injected"):
                create(client, request, key)
        finally:
            if stage == "commit":
                sa.event.remove(Session, "before_commit", fail_commit)
    with service.engine.connect() as connection:
        assert (
            connection.scalar(
                sa.select(sa.func.count())
                .select_from(booking_financial_captures)
                .where(booking_financial_captures.c.company_id == service.context.company_id)
            )
            == 0
        )
    assert create(client, request, key).status_code == 201


def test_external_reference_lookup_and_database_capture_guards(api):
    client, service, body, _ = api
    request = setup(client, body)
    saved = create(client, request).json()
    found = client.get(
        "/api/v1/reservations",
        params={"external_reference": "AGD-123", "booking_source_id": request["booking_source_id"]},
    )
    assert [row["id"] for row in found.json()] == [saved["id"]]
    with service.engine.connect() as connection:
        row = dict(
            connection.execute(
                sa.select(booking_financial_captures).where(
                    booking_financial_captures.c.reservation_id == saved["id"]
                )
            )
            .mappings()
            .one()
        )
    for value in (-1, 0.5, 2**53):
        forged = deepcopy(row)
        forged["id"] = uuid4()
        forged["snapshot"]["id"] = str(forged["id"])
        forged["snapshot"]["figures"]["commission_minor"] = value
        with pytest.raises(sa.exc.IntegrityError) as error, service.engine.begin() as connection:
            connection.execute(booking_financial_captures.insert().values(**forged))
        assert error.value.orig.diag.constraint_name.endswith("snapshot_precision")
    with pytest.raises(sa.exc.IntegrityError), service.engine.begin() as connection:
        connection.execute(
            booking_financial_captures.delete().where(booking_financial_captures.c.id == row["id"])
        )


@pytest.mark.parametrize(
    "stage",
    [
        "reservations",
        "booking_financial_captures",
        "pricing_revisions",
        "operational_audit",
        "mutation_receipts",
        "commit",
    ],
)
def test_correction_rollback_and_retry_preserves_old_capture(api, monkeypatch, stage):
    from sqlalchemy.orm import Session

    client, _, body, _ = api
    request = setup(client, body)
    saved = create(client, request).json()
    correction = dict(
        expected_version=1,
        booking_source_id=request["booking_source_id"],
        booking_financials=request["booking_financials"],
        reason="Reviewed correction",
    )
    path = f"/api/v1/reservations/{saved['id']}/edit-booking-financials"
    history_path = f"/api/v1/reservations/{saved['id']}/booking-financials"
    old_history = client.get(history_path).json()
    key = {"Idempotency-Key": str(uuid4())}
    execute = Session.execute

    def fail(session, statement, *args, **kwargs):
        result = execute(session, statement, *args, **kwargs)
        if (
            getattr(statement, "is_insert", False) or getattr(statement, "is_update", False)
        ) and getattr(getattr(statement, "table", None), "name", None) == stage:
            raise RuntimeError("B6 correction rollback")
        return result

    def commit_fail(session):
        raise RuntimeError("B6 correction rollback")

    with monkeypatch.context() as patch:
        patch.setattr(Session, "execute", fail)
        if stage == "commit":
            sa.event.listen(Session, "before_commit", commit_fail)
        try:
            with pytest.raises(RuntimeError, match="B6 correction rollback"):
                client.post(path, json=correction, headers=key)
        finally:
            if stage == "commit":
                sa.event.remove(Session, "before_commit", commit_fail)
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == saved
    assert client.get(history_path).json() == old_history
    assert client.post(path, json=correction, headers=key).status_code == 200
    assert len(client.get(history_path).json()) == 2


def test_competing_corrections_only_one_version_wins(api):
    from uuid import UUID

    from app.errors import DomainError
    from app.modules.reservations.financial_corrections import (
        BookingFinancialCorrection,
        correct_financials,
    )

    client, service, body, _ = api
    request = setup(client, body)
    saved = create(client, request).json()
    barrier = Barrier(2)

    def run(amount):
        correction = BookingFinancialCorrection.model_validate(
            dict(
                expected_version=1,
                booking_source_id=request["booking_source_id"],
                booking_financials={
                    **request["booking_financials"],
                    "contractual_accommodation_minor": amount,
                },
                reason="Reviewed competing correction",
            )
        )
        barrier.wait()
        try:
            return correct_financials(service, UUID(saved["id"]), correction, uuid4()).version
        except DomainError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, [100000, 105000]))
    assert sorted(map(str, results)) == ["2", "version_conflict"]
    assert len(client.get(f"/api/v1/reservations/{saved['id']}/booking-financials").json()) == 2


def test_operational_adjustment_does_not_rewrite_the_commercial_capture_identity(api):
    client, _, body, _ = api
    saved = create(client, setup(client, body)).json()
    original = saved["pricing"]["snapshot"]["channel"]
    updated = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-billing",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "expected_version": 1,
            "guest_id": body["guest_id"],
            "adjustments": [
                {"id": str(uuid4()), "amount_minor": 1000, "reason": "Operational charge"}
            ],
        },
    )
    assert updated.status_code == 200, updated.text
    snapshot = updated.json()["pricing"]["snapshot"]
    assert snapshot["total_minor"] == 101000
    assert snapshot["channel"] == original
    assert snapshot["channel_figures"]["total_minor"] == 101000
    assert client.get(f"/api/v1/reservations/{saved['id']}/booking-financials").json() == [original]


def test_retired_published_agreement_keeps_captured_terms_for_reviewed_corrections(api):
    client, _, body, _ = api
    request = setup(client, body)
    saved = create(client, request).json()
    capture = saved["pricing"]["snapshot"]["channel"]
    retired = client.patch(
        f"/api/v1/configuration/booking-sources/{request['booking_source_id']}/agreements/{capture['agreement_id']}",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "expected_source_version": 1,
            "expected_agreement_version": 1,
            "expected_version": 1,
            "effective_from": "2026-10-01",
            "effective_to": "2026-10-31",
            "status": "retired",
            "terms": TERMS,
        },
    )
    assert retired.status_code == 200, retired.text
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == saved
    corrected = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-booking-financials",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "expected_version": 1,
            "booking_source_id": request["booking_source_id"],
            "booking_financials": {**request["booking_financials"], "guest_paid_minor": 85000},
            "reason": "Reviewed guest document; original contract remains applicable",
        },
    )
    assert corrected.status_code == 200, corrected.text
    new_capture = corrected.json()["pricing"]["snapshot"]["channel"]
    assert new_capture["terms"] == capture["terms"]
    assert new_capture["agreement_version"] == capture["agreement_version"] == 1
    assert new_capture["figures"]["guest_paid_minor"] == 85000
    request["scheduled_start"] = "2026-12-01T14:00:00+08:00"
    request["booking_financials"]["external_reference"] = "NEW-RETIRED"
    assert create(client, request).status_code == 409


def test_stay_repricing_keeps_booked_contract_without_inventing_an_override_reason(api):
    client, _, body, ids = api
    terms = {**TERMS, "pricing": {"allowOverride": False, "reasonRequired": True}}
    request = setup(client, body, terms)
    request["booking_financials"].update(contractual_accommodation_minor=None, override_reason="")
    saved = create(client, request).json()
    assert saved["pricing"]["snapshot"]["total_minor"] == 110000
    updated = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-stay",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "expected_version": 1,
            "guest_id": body["guest_id"],
            "room_id": body["room_id"],
            "duration_id": str(ids["overnight"]),
            "scheduled_start": body["scheduled_start"],
        },
    )
    assert updated.status_code == 200, updated.text
    snapshot = updated.json()["pricing"]["snapshot"]
    assert snapshot["channel"] == saved["pricing"]["snapshot"]["channel"]
    assert snapshot["channel_figures"]["standard_accommodation_minor"] == 220000
    assert snapshot["total_minor"] == 110000


def test_reviewed_correction_retains_history_replay_and_stale_version(api):
    client, _, body, _ = api
    request = setup(client, body)
    saved = create(client, request).json()
    correction = dict(
        expected_version=1,
        booking_source_id=request["booking_source_id"],
        booking_financials={
            **request["booking_financials"],
            "contractual_accommodation_minor": 105000,
        },
        reason="Reviewed corrected confirmation",
    )
    path = f"/api/v1/reservations/{saved['id']}/edit-booking-financials"
    key = {"Idempotency-Key": str(uuid4())}
    result = client.post(path, json=correction, headers=key)
    assert result.status_code == 200, result.text
    assert result.json()["version"] == 2
    assert result.json()["pricing"]["snapshot"]["total_minor"] == 105000
    assert client.post(path, json=correction, headers=key).json() == result.json()
    assert (
        client.post(path, json=correction, headers={"Idempotency-Key": str(uuid4())}).status_code
        == 409
    )
    history = client.get(f"/api/v1/reservations/{saved['id']}/booking-financials").json()
    assert [row["figures"]["total_minor"] for row in history] == [105000, 100000]


def test_finalized_bill_rejects_commercial_corrections(api):
    client, _, body, _ = api
    request = setup(client, body)
    saved = create(client, request).json()

    def headers():
        return {"Idempotency-Key": str(uuid4())}

    draft = client.post(
        f"/api/v1/reservations/{saved['id']}/billing-documents",
        json={"expected_reservation_version": 1},
        headers=headers(),
    )
    assert draft.status_code == 201, draft.text
    final = client.post(
        f"/api/v1/billing-documents/{draft.json()['id']}/finalize",
        json={"expected_version": 1},
        headers=headers(),
    )
    assert final.status_code == 200, final.text
    result = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-booking-financials",
        headers=headers(),
        json=dict(
            expected_version=1,
            booking_source_id=request["booking_source_id"],
            booking_financials=request["booking_financials"],
            reason="Correction",
        ),
    )
    assert result.status_code == 409 and "finalized_bill" in result.text
    assert client.get(f"/api/v1/billing-documents/{draft.json()['id']}").json() == final.json()


def test_concurrent_identical_creates_capture_once(api):
    client, service, body, _ = api
    request = ReservationCreate.model_validate(setup(client, body))
    key = uuid4()
    barrier = Barrier(2)

    def run():
        barrier.wait()
        return service.create(request, key).model_dump(mode="json")

    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = list(pool.map(lambda _: run(), range(2)))
    assert a == b
    assert len(client.get(f"/api/v1/reservations/{a['id']}/booking-financials").json()) == 1


def test_manual_no_agreement_and_inclusive_effective_boundary(api):
    client, _, body, _ = api
    request = setup(client, body)
    request["booking_financials"]["confirmation_date"] = "2026-10-31"
    assert create(client, request).status_code == 201
    manual = deepcopy(request)
    manual["scheduled_start"] = "2026-12-01T14:00:00+08:00"
    manual["booking_financials"].update(
        confirmation_date="2026-11-01",
        external_reference="MANUAL-1",
        expected_agreement_id=None,
        expected_agreement_version=None,
        manual_terms=TERMS,
        manual_reason="Reviewed agency document",
    )
    response = create(client, manual)
    assert response.status_code == 201, response.text
    capture = response.json()["pricing"]["snapshot"]["channel"]
    assert capture["agreement_id"] is None and capture["provenance"] == "manual_arrangement"


def test_plural_booking_contract_not_multiplied_and_operational_edit_preserves_capture(api):
    client, _, body, ids = api
    request = setup(client, body)
    payload = {
        k: request[k]
        for k in (
            "guest_id",
            "booking_source_id",
            "duration_id",
            "scheduled_start",
            "booking_financials",
        )
    }
    payload["allocations"] = [
        {"room_id": str(ids["room"]), "adults": 2},
        {
            "room_id": client.post(
                "/api/v1/configuration/rooms",
                json={"number": "102", "room_type_id": str(ids["type"])},
                headers={"Idempotency-Key": str(uuid4())},
            ).json()["id"],
            "adults": 1,
        },
    ]
    response = client.post(
        "/api/v1/multi-room-reservations", json=payload, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["pricing"]["snapshot"]["total_minor"] == 100000
    assert len(saved["pricing"]["snapshot"]["lines"]) == 2
    edit = {k: v for k, v in payload.items() if k != "booking_financials"}
    edit.update(expected_version=1, note="Operational note")
    for intent, allocation in zip(edit["allocations"], saved["allocations"], strict=True):
        # Reads sort allocations by captured line order, so match by physical room identity.
        intent["id"] = next(
            a["id"] for a in saved["allocations"] if a["room_id"] == intent["room_id"]
        )
    updated = client.post(
        f"/api/v1/reservations/{saved['id']}/edit-allocations",
        json=edit,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert updated.status_code == 200, updated.text
    assert (
        updated.json()["pricing"]["snapshot"]["channel"] == saved["pricing"]["snapshot"]["channel"]
    )
