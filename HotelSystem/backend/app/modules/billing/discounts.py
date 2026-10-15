"""One deterministic manual-discount pipeline over captured PHP minor-unit lines."""

from decimal import ROUND_HALF_UP, Decimal, localcontext

MAX_MINOR = 2**53 - 1


def calculate_discounts(captured, intents, overrides=()):
    accommodation = captured["lines"]
    lines = [(f"room:{line['room_id']}", line["amount_minor"], "room") for line in accommodation]
    allocation_rooms = {
        str(line.get("allocation_id")): str(line["room_id"]) for line in accommodation
    }
    charge_rooms = {
        str(item["id"]): allocation_rooms.get(
            str(item.get("allocation_id")), str(accommodation[0]["room_id"])
        )
        for item in captured.get("charges", [])
    }
    lines += [
        (str(item["id"]), item["amount_minor"], "charge") for item in captured.get("charges", [])
    ]
    remaining = {id: amount for id, amount, _kind in lines}
    if len(remaining) != len(lines):
        raise ValueError("Price line identities must be unique")
    subtotal = sum(remaining.values())
    if subtotal > MAX_MINOR:
        raise ValueError("Subtotal exceeds supported exact monetary range")
    # Unit replacements are a distinct first stage, never ordinary discount reductions.
    overridden = set()
    override_total = 0
    price_lines = {f"room:{line['room_id']}": line for line in accommodation}
    price_lines.update({str(item["id"]): item for item in captured.get("charges", [])})
    for override in overrides:
        identity = override["line_id"]
        if identity in overridden or identity not in price_lines:
            raise ValueError("Only one unit replacement is allowed on an existing price line")
        overridden.add(identity)
        original = price_lines[identity]
        unit = original["unit_amount_minor"]
        quantity = original["quantity"]
        replacement = override["replacement_unit_amount_minor"]
        if (
            type(replacement) is not int
            or replacement < 0
            or replacement > unit
            or override["original_unit_amount_minor"] != unit
            or override["quantity"] != quantity
            or original["amount_minor"] != unit * quantity
            or override["effect_minor"] != (unit - replacement) * quantity
        ):
            raise ValueError(
                "Unit replacement must match captured prices, quantity and exact effect"
            )
        remaining[identity] = replacement * quantity
        override_total += override["effect_minor"]
    # Version 2: manual room/item entries first, reservation entries last; stable insertion order.
    ordered = [d for d in intents if d["scope"] != "reservation"] + [
        d for d in intents if d["scope"] == "reservation"
    ]
    if len({str(d["id"]) for d in ordered}) != len(ordered):
        raise ValueError("Discount identities must be unique")
    result = []
    for order, d in enumerate(ordered):
        target = d["target_id"]
        if d["scope"] == "room" and target not in {str(line["room_id"]) for line in accommodation}:
            raise ValueError("Select the assigned room for a room discount")
        if d["scope"] == "item" and not any(
            id == target and kind == "charge" for id, _, kind in lines
        ):
            raise ValueError("Select an existing purchased line for an item discount")
        if d["scope"] == "reservation" and target != "":
            raise ValueError("Reservation discounts must not have a target")
        eligible = [
            id
            for id, _, kind in lines
            if (d["scope"] != "item" or id == target)
            and (
                d["scope"] != "room"
                or (
                    id == f"room:{target}"
                    if kind == "room"
                    else d.get("provenance") != "preset" and charge_rooms[id] == target
                )
            )
        ]
        balance = sum(remaining[id] for id in eligible)
        with localcontext() as context:
            context.prec = 60
            value = Decimal(d["value"])
            reduction = int(
                (
                    Decimal(balance) * value / 100 if d["method"] == "percentage" else value * 100
                ).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            )
        reduction = min(balance, reduction)
        pending, allocations = reduction, []
        for id in eligible:
            amount = min(remaining[id], pending)
            remaining[id] -= amount
            pending -= amount
            allocations.append({"line_id": id, "amount_minor": amount})
        result.append({**d, "amount_minor": reduction, "order": order, "allocations": allocations})
    total_discount = sum(d["amount_minor"] for d in result)
    adjustment_total = sum(item["amount_minor"] for item in captured.get("adjustments", []))
    total = subtotal - override_total - total_discount + adjustment_total
    if abs(adjustment_total) > MAX_MINOR or abs(total) > MAX_MINOR:
        raise ValueError("Total exceeds supported exact monetary range")
    by_id = {str(d["id"]): d for d in result}
    return [by_id[str(d["id"])] for d in intents], total_discount, max(0, total)
