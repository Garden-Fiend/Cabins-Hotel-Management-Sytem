"""B6 arithmetic is independently testable without creating bookings or payments."""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.modules.reservations.booking_financials import (
    BookingFinancialIntent,
    calculate_financials,
)

TERMS = {
    "pricing": {"allowOverride": True, "reasonRequired": True},
    "commission": {
        "method": "percentage",
        "basis": "confirmed_accommodation",
        "rateBasisPoints": 1500,
        "fixedMinor": 0,
        "allowOverride": False,
    },
    "payment": {"collection": "channel"},
    "settlement": {"method": "deducted"},
}


def data(**changes):
    return BookingFinancialIntent.model_validate(
        {
            "confirmation_date": "2026-10-16",
            "external_reference": " AGD-123 ",
            "expected_source_version": 1,
            "expected_agreement_id": None,
            "expected_agreement_version": None,
            "collection": "channel",
            "difference_classification": "none",
            **changes,
        }
    )


def price():
    return {
        "lines": [
            {"room_id": "a", "amount_minor": 100000},
            {"room_id": "b", "amount_minor": 200000},
        ],
        "charges": [{"id": "extra", "amount_minor": 50000}],
        "adjustments": [{"amount_minor": -1000}, {"amount_minor": 1000}],
    }


def test_accommodation_override_applies_once_to_multi_room_not_extras():
    original = price()
    result = calculate_financials(
        original,
        data(contractual_accommodation_minor=270000, override_reason="Channel confirmation"),
        TERMS,
    )
    assert result["total_minor"] == 320000
    assert result["commission_minor"] == 40500
    assert result["expected_settlement_minor"] == 229500
    assert result["hotel_received_minor"] == 0
    assert original == price()


def test_channel_funded_promotion_does_not_reduce_contract_or_create_receipt():
    result = calculate_financials(
        price(),
        data(
            guest_paid_minor=270000,
            guest_paid_status="reported_paid",
            difference_classification="channel_funded",
        ),
        TERMS,
    )
    assert result["contractual_accommodation_minor"] == 300000
    assert result["commission_minor"] == 45000
    assert result["expected_settlement_minor"] == 255000
    assert result["total_minor"] == 350000
    assert result["hotel_received_minor"] == 0


@pytest.mark.parametrize(
    "mode,expected",
    [("deducted", 255000), ("separate_invoice", 300000), ("offset", None), ("manual", None)],
)
def test_settlement_modes_are_distinct(mode, expected):
    terms = deepcopy(TERMS)
    terms["settlement"]["method"] = mode
    assert calculate_financials(price(), data(), terms)["expected_settlement_minor"] == expected


def test_hotel_collection_has_no_expected_channel_remittance():
    terms = deepcopy(TERMS)
    terms["payment"]["collection"] = "per_reservation"
    result = calculate_financials(price(), data(collection="hotel"), terms)
    assert result["expected_settlement_minor"] is None
    assert result["hotel_received_minor"] == 0


@pytest.mark.parametrize(
    "basis,amount",
    [("confirmed_accommodation", 45000), ("reference_value", 2), ("explicit_amount", 185)],
)
def test_configured_percentage_basis_and_half_up_rounding(basis, amount):
    terms = deepcopy(TERMS)
    terms["commission"]["basis"] = basis
    result = calculate_financials(
        price(), data(reference_value_minor=10, explicit_commission_basis_minor=1234), terms
    )
    assert result["commission_minor"] == amount


@pytest.mark.parametrize("method,expected", [("none", 0), ("fixed", 1234), ("manual", 2345)])
def test_commission_models(method, expected):
    terms = deepcopy(TERMS)
    terms["commission"].update(method=method, fixedMinor=1234)
    intent = data(
        **(
            {"manual_commission_minor": 2345, "override_reason": "Document"}
            if method == "manual"
            else {}
        )
    )
    assert calculate_financials(price(), intent, terms)["commission_minor"] == expected


def test_discounts_not_reapplied_to_contract_and_signed_adjustments_zero_clamp():
    snapshot = price()
    snapshot["discounts"] = [
        {
            "allocations": [
                {"line_id": "room:a", "amount_minor": 10000},
                {"line_id": "extra", "amount_minor": 5000},
            ]
        }
    ]
    snapshot["price_overrides"] = [{"line_id": "room:b", "effect_minor": 50000}]
    result = calculate_financials(
        snapshot, data(contractual_accommodation_minor=200000, override_reason="Agreed"), TERMS
    )
    assert result["discounted_accommodation_minor"] == 240000
    assert result["total_minor"] == 245000
    snapshot["adjustments"] = [{"amount_minor": -300000}]
    assert calculate_financials(snapshot, data(), TERMS)["total_minor"] == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"guest_paid_minor": True},
        {"guest_paid_minor": 1.01},
        {"guest_paid_minor": -1},
        {"guest_paid_minor": 2**53},
        {"confirmation_date": 1792108800},
        {"confirmation_date": "2026-10-16T00:00:00Z"},
        {"external_reference": "ABC\nDEF"},
        {"commission_minor": 1},
        {"hotel_received_minor": 1},
        {"terms": TERMS},
        {"guest_paid_minor": 100},
        {"expected_agreement_version": 1},
    ],
)
def test_invalid_and_forged_inputs_reject(changes):
    with pytest.raises(ValidationError):
        data(**changes)


def test_required_basis_commission_permissions_and_missing_manual_amount():
    terms = deepcopy(TERMS)
    terms["commission"]["basis"] = "reference_value"
    with pytest.raises(ValueError, match="basis"):
        calculate_financials(price(), data(), terms)
    with pytest.raises(ValueError, match="not permitted"):
        calculate_financials(price(), data(manual_commission_minor=10), TERMS)
    terms["commission"]["method"] = "manual"
    with pytest.raises(ValueError, match="manual commission"):
        calculate_financials(price(), data(), terms)


def test_unresolved_funding_never_implies_remittance():
    result = calculate_financials(
        price(),
        data(
            guest_paid_minor=270000,
            guest_paid_status="expected",
            difference_classification="unresolved",
        ),
        TERMS,
    )
    assert result["expected_settlement_minor"] is None


def test_reference_normalization_preserves_case_and_internal_spaces():
    assert data(external_reference="  Agd /  123  ").external_reference == "Agd /  123"
