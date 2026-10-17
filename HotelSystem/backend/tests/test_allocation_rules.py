from uuid import uuid4

import pytest

from app.modules.billing.collection_schemas import AllocationCommand
from app.modules.billing.payment_allocations import active_allocations, capacities


def test_refunds_change_available_money_not_discounts():
    payment = uuid4()
    history = [
        dict(id=payment, kind="collection", amount_minor=200000),
        dict(id=uuid4(), kind="refund", related_transaction_id=payment, amount_minor=50000),
    ]
    assert capacities(history) == {payment: 150000}


def test_release_preserves_original_and_partial_capacity():
    original = dict(id=uuid4(), kind="allocate", amount_minor=12000)
    assert (
        active_allocations(
            [original, dict(kind="release", release_of=original["id"], amount_minor=2000)]
        )[0]["active_minor"]
        == 10000
    )
    assert original["amount_minor"] == 12000


@pytest.mark.parametrize("amount", [0, -1, True, 1.2, 2**53])
def test_exact_allocation_amount(amount):
    with pytest.raises(ValueError):
        AllocationCommand(
            expected_version=1,
            expected_pricing_id=uuid4(),
            expected_obligation_id=None,
            kind="allocate",
            payment_id=uuid4(),
            component="hotel_charges",
            amount_minor=amount,
            reason="Reviewed allocation",
        )
