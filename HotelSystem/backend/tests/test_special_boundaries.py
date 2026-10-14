"""Targeted post-checkpoint identity and historical inclusion boundaries."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from test_inclusions import create, defaults, edit, product, write
from test_reservation_patch import patch_api as reservation_fixture
from test_reservation_patch import raw_state

from app.models import categories

patch_api = reservation_fixture
pytestmark = pytest.mark.postgres


@pytest.mark.parametrize("kind", ["breakfast", "inclusion"])
def test_protected_rename_with_ordinary_name_collision(patch_api, kind):
    client, service, saved, ids, app = patch_api
    special = next(
        c
        for c in client.get("/api/v1/reference-data").json()["inventory_categories"]
        if c["type"] == kind
    )
    ordinary = write(client, "categories", dict(label="Shared operational label", type="ordinary"))
    assert ordinary.status_code == 201, ordinary.text
    renamed = write(
        client,
        "categories",
        dict(label="Shared operational label", type=kind, expected_version=special["version"]),
        special["id"],
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["id"] == special["id"]
    with service.engine.connect() as connection:
        assert (
            connection.scalar(
                sa.select(categories.c.source_id).where(categories.c.id == special["id"])
            )
            == f"special-{'inclusions' if kind == 'inclusion' else kind}"
        )
    assert renamed.json()["system_defined"] is True
    refs = client.get("/api/v1/reference-data").json()["inventory_categories"]
    assert len([c for c in refs if c["label"] == "Shared operational label"]) == 2


def test_captured_inclusion_label_survives_rename_retirement_and_edit(patch_api):
    client, service, saved, ids, app = patch_api
    definition = product(client, "Original towel")
    assert (
        defaults(client, ids["type"], [dict(product_id=definition["id"], quantity=2)]).status_code
        == 200
    )
    booked = create(client, saved, ids)
    changed = write(
        client,
        "products",
        {k: definition[k] for k in ("category_id", "unit_amount_minor", "available_for_sale")}
        | dict(label="Renamed towel", archived=True, expected_version=definition["version"]),
        definition["id"],
    )
    assert changed.status_code == 200, changed.text
    result = edit(client, booked, [dict(product_id=definition["id"], quantity=3)])
    assert result.status_code == 200, result.text
    canonical = result.json()
    assert canonical["allocation"]["inclusions"][0]["label"] == "Original towel"
    assert canonical["allocation"]["inclusions"][0]["quantity"] == 3
    assert canonical["pricing"] == booked["pricing"]
    assert client.get(f"/api/v1/reservations/{booked['id']}").json() == canonical


def test_competing_combined_stay_inclusion_and_financial_edits(patch_api):
    client, service, saved, ids, app = patch_api
    definition = product(client, "Combined entitlement")
    before = raw_state(service)
    barrier = Barrier(2)

    def send(quantity):
        barrier.wait()
        return client.post(
            f"/api/v1/reservations/{saved['id']}/edit-stay",
            json=dict(
                expected_version=saved["version"],
                guest_id=saved["guest"]["id"],
                room_id=saved["allocation"]["room_id"],
                duration_id=str(ids["hourly"]),
                scheduled_start="2026-11-11T14:00:00+08:00",
                inclusions=[dict(product_id=definition["id"], quantity=quantity)],
                adjustments=[
                    dict(id=str(uuid4()), amount_minor=1000, reason="Combined adjustment")
                ],
                discounts=[
                    dict(
                        id=str(uuid4()),
                        label="Combined reduction",
                        scope="reservation",
                        method="percentage",
                        value="10",
                        target_id="",
                        currency="PHP",
                    )
                ],
            ),
            headers={"Idempotency-Key": str(uuid4())},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(send, [2, 3]))
    assert sorted(r.status_code for r in results) == [200, 409], [r.text for r in results]
    winner = next(r.json() for r in results if r.status_code == 200)
    assert winner["version"] == saved["version"] + 1
    assert winner["pricing"]["snapshot"]["total_minor"] == 100000
    assert winner["allocation"]["inclusions"][0]["quantity"] in [2, 3]
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == winner
    assert all(
        row in raw_state(service)["pricing_revisions"] for row in before["pricing_revisions"]
    )
