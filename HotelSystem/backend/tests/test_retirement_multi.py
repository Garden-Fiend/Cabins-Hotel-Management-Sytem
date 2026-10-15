from datetime import UTC, datetime, timedelta

import pytest
from test_multi_room import action, edit_body, headers, write
from test_multi_room import api as api
from test_multi_room import multi_api as multi_api
from test_retirement import retire

pytestmark = pytest.mark.postgres


@pytest.mark.parametrize("custom", [False, True])
def test_tombstoned_room_history_blocks_delete_and_type_retirement_preserves_bill(
    multi_api, custom
):
    client, service, body, ids, extra = multi_api
    if custom:
        body["allocations"][1]["stay"] = dict(
            scheduled_start="2026-11-12T14:00:00+08:00", duration_id=str(ids["overnight"])
        )
    saved = write(client, "multi-room-reservations", body)
    draft = write(
        client,
        f"reservations/{saved['id']}/billing-documents",
        dict(expected_reservation_version=1),
    )
    document = write(client, f"billing-documents/{draft['id']}/finalize", dict(expected_version=1))
    edit = edit_body(body, saved)
    removed = edit["allocations"].pop()
    changed = write(client, f"reservations/{saved['id']}/edit-allocations", edit)
    assert retire(client, "rooms", removed["room_id"], "archive").status_code == 200
    assert retire(client, "rooms", removed["room_id"], "delete", 2).status_code == 409
    assert retire(client, "room-types", ids["type"], "archive").status_code == 200
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == changed
    assert client.get(f"/api/v1/billing-documents/{document['id']}").json() == document
    # Adding even an individually active room through the retired type rejects atomically.
    intent = dict(edit, expected_version=changed["version"])
    intent["allocations"].append(dict(room_id=extra[1]["id"], adults=1))
    assert (
        client.post(
            f"/api/v1/reservations/{saved['id']}/edit-allocations", json=intent, headers=headers()
        ).status_code
        == 422
    )
    assert client.get(f"/api/v1/reservations/{saved['id']}").json() == changed


def test_occupied_room_cannot_archive_and_type_archive_does_not_prevent_checkout(multi_api):
    client, service, body, ids, extra = multi_api
    body["scheduled_start"] = (datetime.now(UTC) - timedelta(minutes=30)).isoformat()
    saved = write(client, "multi-room-reservations", body)
    arrived = action(client, saved, "check_in").json()
    assert arrived["aggregate_status"] == "checked_in"
    assert retire(client, "rooms", ids["room"], "archive").status_code == 409
    assert retire(client, "room-types", ids["type"], "archive").status_code == 200
    out = action(client, arrived, "check_out")
    assert out.status_code == 200, out.text
    assert out.json()["aggregate_status"] == "checked_out"
    current = next(
        r
        for r in client.get("/api/v1/reference-data").json()["rooms"]
        if r["id"] == str(ids["room"])
    )
    assert retire(client, "rooms", ids["room"], "archive", current["version"]).status_code == 200
