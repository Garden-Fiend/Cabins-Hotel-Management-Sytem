"""Server-owned unit replacement captures, separate from ordinary discounts."""

from app.errors import DomainError
from app.models import discount_presets, durations, products, rates, room_types
from app.modules.billing.presets import capture_preset_intent
from app.modules.reservations.schemas import PriceOverrideCapture


def capture_override(service, session, captured, item, old, now):
    if old:
        if (
            str(item.preset_id) != old["preset_id"]
            or item.label != old["label"]
            or item.scope != old["scope"]
            or (f"room:{item.target_id}" if item.scope == "room" else item.target_id)
            != old["line_id"]
        ):
            raise DomainError(
                "invalid_override",
                "Remove or replace a captured unit price to change its terms",
                422,
            )
        metadata = old
        replacement = old["replacement_unit_amount_minor"]
        expected_line = old["line_id"]
    else:
        # Resolve new references in the existing pricing lock order before the preset.
        if item.scope == "room":
            base = next(
                (line for line in captured["lines"] if str(line["room_id"]) == item.target_id),
                captured["lines"][0],
            )
            rate = service.owned(session, rates, base["rate_id"])
            if rate["duration_id"]:
                duration = service.owned(session, durations, rate["duration_id"], lock=True)
                if not duration["enabled"]:
                    raise DomainError(
                        "inactive_override_duration", "Select an active hourly package", 422
                    )
            service.owned(session, room_types, base["room_type_id"], lock=True)
            service.owned(session, rates, base["rate_id"], lock=True)
        else:
            base = next(
                (c for c in captured.get("charges", []) if str(c["id"]) == item.target_id), None
            )
            if base is None:
                raise DomainError("orphaned_override", "Select an existing purchased line", 422)
            service.owned(session, products, base["product_id"], lock=True)
        metadata = capture_preset_intent(service, session, captured, item, None, now)
        definition = service.owned(session, discount_presets, item.preset_id, lock=True)
        expected_line = f"room:{item.target_id}" if item.scope == "room" else item.target_id
        if item.scope == "room":
            rate_id = str(
                next(
                    (line for line in captured["lines"] if str(line["room_id"]) == item.target_id),
                    captured["lines"][0],
                )["rate_id"]
            )
            covered = next((p for p in definition["rate_prices"] if p["rate_id"] == rate_id), None)
            if covered is None:
                raise DomainError(
                    "uncovered_rate", "This final price does not cover the selected rate", 422
                )
            replacement = covered["unit_amount_minor"]
            current = service.owned(
                session,
                rates,
                next(
                    (line for line in captured["lines"] if str(line["room_id"]) == item.target_id),
                    captured["lines"][0],
                )["rate_id"],
                lock=True,
            )
        else:
            replacement = definition["replacement_unit_amount_minor"]
            current = service.owned(session, products, definition["target_product_id"], lock=True)
        if not current["enabled"] or replacement > current["unit_amount_minor"]:
            raise DomainError(
                "invalid_override",
                "Select a final price compatible with the current active rate/product",
                422,
            )
    if item.scope == "room":
        line = next(
            (line for line in captured["lines"] if str(line["room_id"]) == item.target_id),
            captured["lines"][0],
        )
        identity, target, rate = (
            f"room:{line['room_id']}",
            str(line["room_type_id"]),
            str(line["rate_id"]),
        )
    else:
        line = next(
            (c for c in captured.get("charges", []) if str(c["id"]) == item.target_id), None
        )
        if line is None:
            raise DomainError(
                "orphaned_override", "Remove the dependent final price when removing its item", 422
            )
        identity, target, rate = str(line["id"]), str(line["product_id"]), None
    expected_target = metadata.get("target_id") if old else metadata["preset_target_id"]
    expected_rate = metadata.get("rate_id") if old else metadata.get("preset_rate_id")
    if identity != expected_line or target != expected_target or rate != expected_rate:
        raise DomainError(
            "incompatible_override",
            "Remove or replace the final price after changing its rate or product",
            422,
        )
    if replacement > line["unit_amount_minor"]:
        raise DomainError(
            "invalid_override", "Replacement cannot exceed the captured base unit price", 422
        )
    return PriceOverrideCapture(
        id=item.id,
        preset_id=item.preset_id,
        preset_version=metadata["preset_version"],
        label=metadata["label"],
        scope=item.scope,
        line_id=identity,
        target_id=target,
        rate_id=rate,
        original_unit_amount_minor=line["unit_amount_minor"],
        replacement_unit_amount_minor=replacement,
        quantity=line["quantity"],
        effect_minor=(line["unit_amount_minor"] - replacement) * line["quantity"],
        applied_at=metadata.get("applied_at", now),
    ).model_dump(mode="json")
