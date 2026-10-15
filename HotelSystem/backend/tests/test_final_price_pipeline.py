"""Exact replacement stage: effects stay separate from ordinary reductions."""

import pytest

from app.modules.billing.discounts import calculate_discounts


def capture(unit=250000, quantity=1):
    return dict(
        lines=[
            dict(
                room_id="room",
                amount_minor=unit * quantity,
                unit_amount_minor=unit,
                quantity=quantity,
            )
        ],
        adjustments=[],
        charges=[],
    )


def override(line="room:room", unit=250000, replacement=210000, quantity=1):
    return dict(
        line_id=line,
        original_unit_amount_minor=unit,
        replacement_unit_amount_minor=replacement,
        quantity=quantity,
        effect_minor=(unit - replacement) * quantity,
    )


def percentage(scope="room", target="room", value="10"):
    return dict(id="discount", scope=scope, target_id=target, method="percentage", value=value)


@pytest.mark.parametrize("quantity", [1, 3])
def test_nightly_replacement_precedes_percentage_without_becoming_discount(quantity):
    result, discount, total = calculate_discounts(
        capture(quantity=quantity), [percentage()], [override(quantity=quantity)]
    )
    assert total == 189000 * quantity
    assert discount == 21000 * quantity
    assert len(result) == 1 and result[0]["method"] == "percentage"


def test_purchased_unit_replacement_is_multiplied_once():
    raw = capture(unit=0)
    raw["charges"] = [dict(id="item", amount_minor=45000, unit_amount_minor=15000, quantity=3)]
    result, discount, total = calculate_discounts(
        raw, [percentage("item", "item")], [override("item", 15000, 12000, 3)]
    )
    assert discount == 3600 and total == 32400
    assert result[0]["allocations"] == [dict(line_id="item", amount_minor=3600)]


@pytest.mark.parametrize(
    "change",
    [
        dict(replacement_unit_amount_minor=250001),
        dict(replacement_unit_amount_minor=-1),
        dict(replacement_unit_amount_minor=True),
        dict(effect_minor=1),
        dict(quantity=2),
        dict(original_unit_amount_minor=1),
        dict(line_id="missing"),
    ],
)
def test_forged_or_incompatible_capture_rejects(change):
    with pytest.raises(ValueError):
        calculate_discounts(capture(), [], [override() | change])


def test_duplicate_replacements_reject_and_zero_price_is_valid():
    with pytest.raises(ValueError):
        calculate_discounts(capture(), [], [override(), override()])
    _, discount, total = calculate_discounts(capture(), [percentage()], [override(replacement=0)])
    assert discount == 0 and total == 0


def test_adjustments_are_added_after_replacement_and_discount_then_clamped():
    raw = capture()
    raw["adjustments"] = [dict(amount_minor=-200000)]
    _, discount, total = calculate_discounts(raw, [percentage()], [override()])
    assert discount == 21000 and total == 0
