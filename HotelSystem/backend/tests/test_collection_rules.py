from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.modules.billing.collection_schemas import (
    CollectionIntent,
    ObligationIntent,
    correction_capacity,
    reference_key,
)


def intent(**changes):
    return CollectionIntent.model_validate(
        {
            "collector": "hotel",
            "component": "accommodation",
            "amount_minor": 200000,
            "payment_method": "cash",
            "declaration": "confirmed",
            **changes,
        }
    )


@pytest.mark.parametrize("amount", [0, -1, 2**53, True, 1.5])
def test_strict_positive_money(amount):
    with pytest.raises(ValidationError):
        CollectionIntent.model_validate({**intent().model_dump(), "amount_minor": amount})


def test_cash_and_electronic_evidence():
    assert reference_key(intent()) is None
    with pytest.raises(ValidationError):
        intent(payment_method="card")
    value = intent(reference="  Batch-A  ")
    assert value.reference == "  Batch-A  "
    assert reference_key(value) == ("hotel", "cash", "batch-a")


def test_channel_only_accommodation():
    for component in ("hotel_charges", "accommodation"):
        values = {**intent().model_dump(), "collector": "channel", "component": component}
        with pytest.raises(ValidationError):
            CollectionIntent.model_validate(values)


def test_unknown_obligation_is_not_zero():
    assert (
        ObligationIntent(status="unknown", evidence="Awaiting statement").accommodation_minor
        is None
    )
    with pytest.raises(ValidationError):
        ObligationIntent(status="known", evidence="Reviewed")


def test_correction_rules():
    original = dict(intent().model_dump(), id=uuid4())
    refund = CollectionIntent.model_validate(
        {
            **intent().model_dump(),
            "kind": "refund",
            "amount_minor": 50000,
            "related_transaction_id": original["id"],
            "reason": "Actual return",
        }
    )
    correction_capacity(original, [], refund)
    with pytest.raises(ValueError):
        correction_capacity(original, [{"kind": "refund", "amount_minor": 180000}], refund)
    reversal = refund.model_copy(update={"kind": "reversal", "amount_minor": 200000})
    correction_capacity(original, [], reversal)
    for corrections in (
        [{"kind": "refund", "amount_minor": 1}],
        [{"kind": "reversal", "amount_minor": 200000}],
    ):
        with pytest.raises(ValueError):
            correction_capacity(original, corrections, reversal)
    with pytest.raises(ValueError):
        correction_capacity({**original, "kind": "refund"}, [], reversal)
