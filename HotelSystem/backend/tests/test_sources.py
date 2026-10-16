from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from test_configuration_api import config_api as config_api

from app.models import agreements, audit_events
from app.modules.reservations.schemas import GuestCreate, ReservationCreate

pytestmark = pytest.mark.postgres
TERMS = dict(
    pricing=dict(allowOverride=False, reasonRequired=True),
    commission=dict(
        method="percentage",
        basis="confirmed_accommodation",
        rateBasisPoints=1250,
        fixedMinor=0,
        allowOverride=False,
    ),
    payment=dict(collection="channel"),
    settlement=dict(method="deducted"),
)


def post(client, path, body, key=None, method="post"):
    return getattr(client, method)(
        "/api/v1/configuration/" + path, json=body, headers={"Idempotency-Key": str(key or uuid4())}
    )


def source(client, classification="ota"):
    result = post(
        client, "booking-sources", dict(label="Test channel", classification=classification)
    )
    assert result.status_code == 201, result.text
    return result.json()


def intent(**changes):
    return dict(
        expected_source_version=1,
        expected_agreement_version=0,
        effective_from="2026-10-16",
        effective_to=None,
        status="active",
        terms=TERMS,
        **changes,
    )


def path(s):
    return "booking-sources/" + s["id"] + "/agreements"


@pytest.mark.parametrize("classification", ["direct", "ota", "corporate", "agent", "other"])
def test_source_create_edit_disable_replay(config_api, classification):
    client, service, ids = config_api
    s = source(client, classification)
    key = uuid4()
    body = dict(
        label=" Renamed ",
        classification=classification,
        enabled=False,
        notes="configured",
        reference_required=True,
        expected_version=1,
    )
    saved = post(client, "booking-sources/" + s["id"], body, key, "patch")
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] == 2 and saved.json()["label"] == "Renamed"
    assert post(client, "booking-sources/" + s["id"], body, key, "patch").json() == saved.json()
    assert (
        post(
            client, "booking-sources/" + s["id"], dict(body, notes="other"), key, "patch"
        ).status_code
        == 409
    )
    assert post(client, "booking-sources/" + s["id"], body, method="patch").status_code == 409
    assert post(client, "booking-sources", dict(label="renamed")).status_code == 409
    with service.engine.connect() as c:
        assert (
            c.scalar(
                sa.select(sa.func.count())
                .select_from(audit_events)
                .where(audit_events.c.company_id == service.context.company_id)
            )
            == 2
        )


def test_legacy_source_has_no_fabricated_agreement(config_api):
    client, service, ids = config_api
    refs = client.get("/api/v1/reference-data").json()
    assert refs["source_agreements"] == [] and refs["booking_sources"][0]["agreement_version"] == 0
    assert (
        client.get(f"/api/v1/configuration/booking-sources/{uuid4()}/agreements").status_code == 404
    )


def test_agreement_history_dates_revision_immutability_and_replay(config_api):
    client, service, ids = config_api
    s = source(client)
    key = uuid4()
    first = post(client, path(s), intent(), key)
    assert first.status_code == 201, first.text
    first = first.json()
    assert first["revision"] == 1
    assert post(client, path(s), intent(), key).json() == first
    # End is inclusive, matching demo. Different active periods must begin the next day.
    closed = post(
        client,
        path(s) + "/" + first["id"],
        dict(intent(), expected_version=1, effective_to="2026-10-31", expected_agreement_version=1),
        method="patch",
    )
    assert closed.status_code == 200, closed.text
    future = dict(intent(), expected_agreement_version=2, effective_from="2026-11-01")
    second = post(client, path(s), future)
    assert second.status_code == 201, second.text
    assert second.json()["revision"] == 2
    assert (
        post(
            client, path(s), dict(future, expected_agreement_version=3, effective_from="2026-10-31")
        ).status_code
        == 409
    )
    bad = dict(
        intent(),
        expected_agreement_version=3,
        expected_version=2,
        effective_to="2026-10-31",
        terms={**TERMS, "payment": {"collection": "hotel"}},
    )
    assert post(client, path(s) + "/" + first["id"], bad, method="patch").status_code == 409
    history = client.get("/api/v1/configuration/" + path(s)).json()
    assert len(history) == 2 and history[0]["terms"] == TERMS and history[0]["version"] == 2
    assert post(client, path(s), dict(future, effective_from="2026-12-01"), key).status_code == 409


@pytest.mark.parametrize("collection", ["hotel", "channel", "per_reservation"])
@pytest.mark.parametrize("method", ["none", "percentage", "fixed", "manual"])
def test_terms_variants_and_exact_fixed_cents(config_api, collection, method):
    client, service, ids = config_api
    s = source(client)
    terms = {
        **TERMS,
        "payment": {"collection": collection},
        "commission": {**TERMS["commission"], "method": method, "fixedMinor": 12345},
    }
    response = post(client, path(s), dict(intent(), terms=terms, status="draft"))
    assert response.status_code == 201, response.text
    assert response.json()["terms"]["commission"]["fixedMinor"] == 12345


@pytest.mark.parametrize(
    "changes",
    [
        {"rateBasisPoints": 10001},
        {"rateBasisPoints": True},
        {"rateBasisPoints": 1.5},
        {"fixedMinor": -1},
        {"fixedMinor": 1.01},
        {"basis": "guest_paid_total"},
        {"method": "guessed"},
    ],
)
def test_invalid_commission_rejected(config_api, changes):
    client, service, ids = config_api
    s = source(client)
    body = dict(intent(), terms={**TERMS, "commission": {**TERMS["commission"], **changes}})
    assert post(client, path(s), body).status_code == 422
    assert client.get("/api/v1/configuration/" + path(s)).json() == []


def test_concurrent_agreement_create_accepts_one_writer(config_api):
    client, service, ids = config_api
    s = source(client)
    barrier = Barrier(2)

    def send():
        barrier.wait()
        return post(client, path(s), intent()).status_code

    with ThreadPoolExecutor(2) as pool:
        f, g = pool.submit(send), pool.submit(send)
        assert sorted([f.result(), g.result()]) == [201, 409]


@pytest.mark.parametrize("stage", ["agreement", "audit", "receipt", "commit"])
def test_rollback_and_same_key_retry(config_api, monkeypatch, stage):
    client, service, ids = config_api
    s = source(client)
    key = uuid4()
    execute = Session.execute

    def fail(self, statement, *args, **kwargs):
        result = execute(self, statement, *args, **kwargs)
        if getattr(statement, "is_insert", False) and statement.table.name == {
            "agreement": "source_agreements",
            "audit": "operational_audit",
            "receipt": "mutation_receipts",
        }.get(stage):
            raise RuntimeError("forced B5 failure")
        return result

    def before_commit(self):
        raise RuntimeError("forced B5 commit failure")

    try:
        with monkeypatch.context() as patch:
            if stage == "commit":
                sa.event.listen(Session, "before_commit", before_commit)
            else:
                patch.setattr(Session, "execute", fail)
            assert post(client, path(s), intent(), key).status_code == 500
    finally:
        if stage == "commit":
            sa.event.remove(Session, "before_commit", before_commit)
    assert client.get("/api/v1/configuration/" + path(s)).json() == []
    assert post(client, path(s), intent(), key).status_code == 201


def test_database_ownership_overlap_and_history_guards(config_api):
    client, service, ids = config_api
    s = source(client)
    saved = post(client, path(s), intent()).json()
    with service.engine.connect() as c:
        original = dict(
            c.execute(sa.select(agreements).where(agreements.c.id == saved["id"])).mappings().one()
        )
    for values in (dict(company_id=uuid4()), dict(terms={}), dict(version=0), dict(status="draft")):
        with pytest.raises(IntegrityError), service.engine.begin() as c:
            c.execute(agreements.update().where(agreements.c.id == saved["id"]).values(**values))
    with pytest.raises(IntegrityError), service.engine.begin() as c:
        c.execute(agreements.delete().where(agreements.c.id == saved["id"]))
    with pytest.raises(IntegrityError), service.engine.begin() as c:
        c.execute(agreements.insert().values(**{**original, "id": uuid4(), "revision": 2}))


def test_historical_labels_disable_and_direct_source_eligibility(config_api):
    client, service, ids = config_api
    guest = service.create_guest(GuestCreate(name="Source history"), uuid4())
    body = dict(
        guest_id=str(guest.id),
        booking_source_id=str(ids["source"]),
        room_id=str(ids["room"]),
        duration_id=str(ids["hourly"]),
        scheduled_start="2026-11-12T14:00:00+08:00",
        adults=1,
    )
    before = service.create(ReservationCreate(**body), uuid4()).model_dump(mode="json")
    result = post(
        client,
        "booking-sources/" + str(ids["source"]),
        dict(label="Renamed direct", classification="direct", enabled=False, expected_version=1),
        method="patch",
    )
    assert result.status_code == 200, result.text
    assert client.get("/api/v1/reservations/" + before["id"]).json() == before
    assert (
        client.post(
            "/api/v1/reservations",
            json=dict(body, scheduled_start="2026-12-12T14:00:00+08:00"),
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 422
    )
    direct = source(client, "direct")
    assert (
        client.post(
            "/api/v1/reservations",
            json=dict(
                body, booking_source_id=direct["id"], scheduled_start="2026-12-12T14:00:00+08:00"
            ),
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 201
    )


def test_draft_edit_publish_and_effective_lookup(config_api):
    client, service, ids = config_api
    s = source(client)
    saved = post(client, path(s), dict(intent(), status="draft")).json()
    terms = {**TERMS, "commission": {**TERMS["commission"], "fixedMinor": 123}}
    edited = post(
        client,
        path(s) + "/" + saved["id"],
        dict(
            intent(),
            status="active",
            expected_agreement_version=1,
            expected_version=1,
            effective_to="2026-10-31",
            terms=terms,
        ),
        method="patch",
    )
    assert edited.status_code == 200, edited.text
    assert (
        len(client.get("/api/v1/configuration/" + path(s) + "?effective_on=2026-10-31").json()) == 1
    )
    assert client.get("/api/v1/configuration/" + path(s) + "?effective_on=2026-11-01").json() == []
    assert client.get("/api/v1/configuration/" + path(s) + "?effective_on=2026-10-15").json() == []


def test_concurrent_identical_key_and_competing_interval_edits(config_api):
    client, service, ids = config_api
    s = source(client)
    key = uuid4()
    barrier = Barrier(2)

    def create():
        barrier.wait()
        return post(client, path(s), intent(), key)

    with ThreadPoolExecutor(2) as pool:
        f, g = pool.submit(create), pool.submit(create)
        first, second = f.result(), g.result()
    assert first.status_code == second.status_code == 201 and first.json() == second.json()
    with service.engine.connect() as c:
        assert (
            c.scalar(
                sa.select(sa.func.count())
                .select_from(audit_events)
                .where(
                    audit_events.c.company_id == service.context.company_id,
                    audit_events.c.event_type == "configuration.agreements.create",
                )
            )
            == 1
        )
    barrier = Barrier(2)

    def edit(end):
        barrier.wait()
        return post(
            client,
            path(s) + "/" + first.json()["id"],
            dict(intent(), expected_version=1, expected_agreement_version=1, effective_to=end),
            method="patch",
        ).status_code

    with ThreadPoolExecutor(2) as pool:
        f, g = pool.submit(edit, "2026-10-30"), pool.submit(edit, "2026-10-31")
        assert sorted([f.result(), g.result()]) == [200, 409]


@pytest.mark.parametrize("stage", ["agreement", "audit", "receipt", "commit"])
def test_interval_update_rollback_does_not_partially_close_range(config_api, monkeypatch, stage):
    client, service, ids = config_api
    s = source(client)
    first = post(client, path(s), intent()).json()
    key = uuid4()
    execute = Session.execute
    body = dict(
        intent(), expected_agreement_version=1, expected_version=1, effective_to="2026-10-31"
    )

    def fail(self, statement, *args, **kwargs):
        result = execute(self, statement, *args, **kwargs)
        if (
            getattr(statement, "is_insert", False) or getattr(statement, "is_update", False)
        ) and statement.table.name == {
            "agreement": "source_agreements",
            "audit": "operational_audit",
            "receipt": "mutation_receipts",
        }.get(stage):
            raise RuntimeError("forced interval rollback")
        return result

    def before_commit(self):
        raise RuntimeError("forced interval rollback")

    try:
        with monkeypatch.context() as patch:
            if stage == "commit":
                sa.event.listen(Session, "before_commit", before_commit)
            else:
                patch.setattr(Session, "execute", fail)
            assert post(client, path(s) + "/" + first["id"], body, key, "patch").status_code == 500
    finally:
        if stage == "commit":
            sa.event.remove(Session, "before_commit", before_commit)
    assert client.get("/api/v1/configuration/" + path(s)).json() == [first]
    assert post(client, path(s) + "/" + first["id"], body, key, "patch").status_code == 200


@pytest.mark.parametrize(
    "changes",
    [
        {"currency": "USD"},
        {"effective_from": "not-a-date"},
        {"effective_from": 0},
        {"effective_to": "2026-10-15"},
        {"expected_source_version": True},
        {"expected_agreement_version": True},
        {"computed_commission": 100},
    ],
)
def test_invalid_agreement_contract_writes_nothing(config_api, changes):
    client, service, ids = config_api
    s = source(client)
    assert post(client, path(s), dict(intent(), **changes)).status_code == 422
    assert client.get("/api/v1/configuration/" + path(s)).json() == []


def test_foreign_sources_and_agreements_return_404(config_api):
    from app.context import CommandContext, get_command_context

    client, service, ids = config_api
    s = source(client)
    assert post(client, path(s), intent()).status_code == 201
    client.app.dependency_overrides[get_command_context] = lambda: CommandContext(uuid4())
    assert client.get("/api/v1/configuration/booking-sources/" + s["id"]).status_code == 404
    assert client.get("/api/v1/configuration/" + path(s)).status_code == 404
    assert post(client, path(s), dict(intent(), expected_agreement_version=1)).status_code == 404
