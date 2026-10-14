"""Resolve new selections from owned definitions; retain old captured preset terms."""

from app.errors import DomainError
from app.models import categories, discount_presets, products, room_types


def capture_preset_intent(service, session, captured, item, old, now):
    intent = item.model_dump(mode="json")
    if item.preset_id is None:
        if old and old.get("provenance") == "preset":
            raise DomainError(
                "invalid_preset", "Remove a preset selection before replacing it", 422
            )
        return {**intent, "provenance": "manual", "applied_at": (old or {}).get("applied_at", now)}
    if old:
        if str(item.preset_id) != old.get("preset_id"):
            raise DomainError(
                "invalid_preset", "Preset identity cannot change on an existing discount", 422
            )
        if any(
            intent[name] != old[name]
            for name in ("label", "scope", "method", "value", "target_id", "currency")
        ):
            raise DomainError("invalid_preset", "Captured preset terms cannot be edited", 422)
        result = {
            **intent,
            "provenance": "preset",
            "applied_at": old["applied_at"],
            "preset_version": old["preset_version"],
            "preset_target_id": old["preset_target_id"],
            "preset_rate_id": old.get("preset_rate_id"),
        }
    else:
        if service is None or session is None:
            raise DomainError(
                "invalid_preset", "Preset resolution requires the command transaction", 422
            )
        definition = service.owned(session, discount_presets, item.preset_id, lock=True)
        if not definition["enabled"]:
            raise DomainError("inactive_preset", "Select an enabled preset", 422)
        if definition["scope"] != "reservation":
            target = service.owned(
                session,
                room_types if definition["scope"] == "room" else products,
                definition["target_room_type_id"] or definition["target_product_id"],
                lock=True,
            )
            if not target["enabled"] or target["archived"]:
                raise DomainError(
                    "inactive_preset_target", "Select a preset with an active target", 422
                )
            if definition["scope"] == "item":
                category = service.owned(session, categories, target["category_id"], lock=True)
                if not category["enabled"] or category["type"] not in ("ordinary", "extra"):
                    raise DomainError(
                        "invalid_preset_target", "Select a chargeable preset target", 422
                    )
        result = {
            **intent,
            "label": definition["label"],
            "scope": definition["scope"],
            "method": definition["method"],
            "value": format(definition["value"], "f"),
            "currency": definition["currency"],
            "provenance": "preset",
            "preset_version": definition["version"],
            "preset_target_id": str(
                definition["target_room_type_id"] or definition["target_product_id"] or ""
            ),
            "applied_at": now,
            "preset_rate_id": str(captured["lines"][0]["rate_id"])
            if definition["scope"] == "room"
            else None,
        }
    line = captured["lines"][0]
    if result["scope"] == "room" and result.get("preset_rate_id") != str(line["rate_id"]):
        raise DomainError(
            "invalid_preset_target",
            "Remove or replace the preset after changing the room rate",
            422,
        )
    if result["scope"] == "room" and (
        result["target_id"] != str(line["room_id"])
        or result["preset_target_id"] != str(line["room_type_id"])
    ):
        raise DomainError("invalid_preset_target", "Preset no longer matches this room type", 422)
    if result["scope"] == "item" and not any(
        str(c["id"]) == result["target_id"] and str(c["product_id"]) == result["preset_target_id"]
        for c in captured.get("charges", [])
    ):
        raise DomainError(
            "invalid_preset_target", "Preset no longer matches this purchased line", 422
        )
    return result
