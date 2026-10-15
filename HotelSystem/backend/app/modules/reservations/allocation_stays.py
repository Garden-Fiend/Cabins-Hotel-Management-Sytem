"""Resolve each allocation using existing hotel/package rules, retaining captured stay policy."""

from app.errors import DomainError
from app.models import durations
from app.modules.reservations.pricing import HOTEL_ZONE, stay_end


def resolve_stays(service, session, request, old_rows, old, company):
    old_by_id = {row["id"]: row for row in old_rows}
    resolved = {}
    for intent in request.allocations:
        original = old_by_id.get(intent.id)
        kept_custom = (
            original
            and not original["uses_reservation_stay"]
            and "stay" not in intent.model_fields_set
        )
        custom = intent.stay is not None or kept_custom
        start = (
            intent.stay.scheduled_start
            if intent.stay
            else original["scheduled_start"]
            if kept_custom
            else request.scheduled_start
        )
        duration_id = (
            intent.stay.duration_id
            if intent.stay
            else original["duration_id"]
            if kept_custom
            else request.duration_id
        )
        duration = service.owned(session, durations, duration_id, lock=True)
        same_duration = bool(original and original["duration_id"] == duration_id)
        if not duration["enabled"] and not same_duration:
            raise DomainError("inactive_reference", "Select an enabled room duration", 422)
        line = (
            next(
                (line for line in old.get("lines", []) if line["room_id"] == str(intent.room_id)),
                None,
            )
            if original
            else None
        )
        capture_duration = duration
        resetting = bool(original and not original["uses_reservation_stay"] and not custom)
        if original and same_duration and line and not resetting:
            capture_duration = dict(duration, nights=line["quantity"])
            if start == original["scheduled_start"]:
                end = original["scheduled_end"]
            elif duration["kind"] == "hourly":
                end = start + (original["scheduled_end"] - original["scheduled_start"])
            else:
                end = stay_end(
                    start,
                    capture_duration,
                    dict(
                        company,
                        default_check_out_time=original["scheduled_end"]
                        .astimezone(HOTEL_ZONE)
                        .time(),
                    ),
                )
        else:
            # A room newly inheriting an unchanged shared stay uses its captured package basis.
            inherited = (
                next(
                    (
                        row
                        for row in old_rows
                        if row["removed_at"] is None
                        and row["uses_reservation_stay"]
                        and row["duration_id"] == duration_id
                        and row["scheduled_start"] == start
                    ),
                    None,
                )
                if not custom
                else None
            )
            inherited_line = next(
                (
                    line
                    for line in old.get("lines", [])
                    if inherited and line["room_id"] == str(inherited["room_id"])
                ),
                None,
            )
            if inherited and inherited_line:
                end = inherited["scheduled_end"]
                capture_duration = dict(duration, nights=inherited_line["quantity"])
            else:
                end = stay_end(start, duration, company)
        if end <= start:
            raise DomainError("invalid_time", "Checkout must follow arrival", 422)
        if (
            intent.stay
            and intent.stay.scheduled_end is not None
            and intent.stay.scheduled_end != end
        ):
            raise DomainError(
                "inconsistent_stay",
                "Checkout must match the selected duration and hotel policy",
                422,
            )
        resolved[intent.room_id] = (start, end, duration, capture_duration, not custom)
    return resolved
