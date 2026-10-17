"""Contractual booking facts. Expectations never represent received money."""

import re
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)

MAX_MINOR = 2**53 - 1
Money = Annotated[StrictInt, Field(ge=0, le=MAX_MINOR)]


class FinancialDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class BookingFinancialIntent(FinancialDTO):
    """Only factual inputs; definitions/calculated fields are never client authority."""

    confirmation_date: date
    external_reference: str = Field(default="", max_length=200)
    expected_source_version: Annotated[StrictInt, Field(gt=0)]
    expected_agreement_id: UUID | None
    expected_agreement_version: Annotated[StrictInt, Field(gt=0)] | None
    contractual_accommodation_minor: Money | None = None
    guest_paid_minor: Money | None = None
    guest_paid_status: Literal["reported_paid", "expected", "unknown"] = "unknown"
    difference_classification: Literal["channel_funded", "hotel_funded", "unresolved", "none"]
    collection: Literal["hotel", "channel"]
    reference_value_minor: Money | None = None
    explicit_commission_basis_minor: Money | None = None
    manual_commission_minor: Money | None = None
    override_reason: str = Field(default="", max_length=1000)
    manual_reason: str = Field(default="", max_length=1000)
    manual_terms: dict | None = None

    @field_validator("confirmation_date", mode="before")
    @classmethod
    def hotel_date(cls, value):
        if type(value) is date:
            return value
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("Enter the external confirmation date as YYYY-MM-DD")
        return value

    @field_validator("external_reference")
    @classmethod
    def printable_reference(cls, value):
        # Case-sensitive, trim boundary whitespace only; preserve internal spaces/punctuation.
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("External references cannot contain control characters")
        return value

    @field_validator("manual_terms")
    @classmethod
    def typed_terms(cls, value):
        if value is not None:
            from app.modules.configuration.sources import CommercialTerms

            return CommercialTerms.model_validate(value).model_dump(mode="json")
        return value

    @model_validator(mode="after")
    def provenance(self):
        if (self.expected_agreement_id is None) != (self.expected_agreement_version is None):
            raise ValueError("Agreement identity and edit version must be supplied together")
        if self.expected_agreement_id is not None and self.manual_terms is not None:
            raise ValueError("Published and manually specified terms cannot be combined")
        if self.manual_terms is not None and not self.manual_reason:
            raise ValueError("Manually specified terms require a reason")
        if (self.guest_paid_minor is None) != (self.guest_paid_status == "unknown"):
            raise ValueError("Identify whether the guest amount is reported paid or expected")
        return self


class CapturedBookingTerms(FinancialDTO):
    id: UUID
    source_id: UUID
    source_label: str
    classification: Literal["direct", "ota", "corporate", "agent", "other"]
    agreement_id: UUID | None
    agreement_revision: int | None
    agreement_version: int | None
    agreement_effective_from: date | None = None
    agreement_effective_to: date | None = None
    provenance: Literal["published_agreement", "manual_arrangement"]
    captured_at: AwareDatetime
    actor: str
    reservation_version: Annotated[StrictInt, Field(gt=0)]
    reason: str
    input: BookingFinancialIntent
    terms: dict
    figures: dict

    @model_validator(mode="after")
    def valid_history(self):
        from app.modules.configuration.sources import CommercialTerms

        CommercialTerms.model_validate(self.terms)
        if (self.provenance == "published_agreement") != (self.agreement_id is not None):
            raise ValueError("Captured agreement provenance is inconsistent")
        if self.agreement_id != self.input.expected_agreement_id:
            raise ValueError("Captured agreement identity must match reviewed intent")
        return self


def money(value):
    if type(value) is not int or not 0 <= value <= MAX_MINOR:
        raise ValueError("Amount exceeds supported exact nonnegative PHP range")
    return value


def hotel_amounts(snapshot):
    """Use saved allocations of reductions; never rerun discounts on a contract amount."""
    room_ids = {f"room:{line['room_id']}" for line in snapshot["lines"]}
    standard = sum(line["amount_minor"] for line in snapshot["lines"])
    discounted = (
        standard
        - sum(
            o["effect_minor"]
            for o in snapshot.get("price_overrides", [])
            if o["line_id"] in room_ids
        )
        - sum(
            allocation["amount_minor"]
            for d in snapshot.get("discounts", [])
            for allocation in d["allocations"]
            if allocation["line_id"] in room_ids
        )
    )
    additions = (
        sum(c["amount_minor"] for c in snapshot.get("charges", []))
        - sum(
            o["effect_minor"]
            for o in snapshot.get("price_overrides", [])
            if o["line_id"] not in room_ids
        )
        - sum(
            allocation["amount_minor"]
            for d in snapshot.get("discounts", [])
            for allocation in d["allocations"]
            if allocation["line_id"] not in room_ids
        )
    )
    return money(standard), money(discounted), money(additions)


def calculate_financials(snapshot, intent: BookingFinancialIntent, terms, *, historical=False):
    """Pure exact calculation over validated server-resolved agreement terms.

    Contractual accommodation replaces discounted accommodation once. Additional charges and
    signed adjustments remain separate. Funding is provenance, not an extra discount/payment.
    """
    from app.modules.configuration.sources import CommercialTerms

    terms = CommercialTerms.model_validate(terms)
    standard, discounted, additions = hotel_amounts(snapshot)
    contract = intent.contractual_accommodation_minor
    if contract is None:
        contract = discounted
    if contract != discounted:
        if not historical and not terms.pricing.allowOverride:
            raise ValueError("This agreement does not permit an accommodation override")
        if not historical and terms.pricing.reasonRequired and not intent.override_reason:
            raise ValueError("An accommodation override reason is required")
    if (
        terms.payment.collection != "per_reservation"
        and intent.collection != terms.payment.collection
    ):
        raise ValueError("Collection responsibility must match the captured agreement")
    # The guest figure is explicitly accommodation-related, avoiding comparisons with paid extras.
    difference = None if intent.guest_paid_minor is None else contract - intent.guest_paid_minor
    if difference in (None, 0) and intent.difference_classification != "none":
        raise ValueError("No guest/contract difference exists to classify")
    if difference not in (None, 0) and intent.difference_classification == "none":
        raise ValueError("Classify the guest/contract difference or leave it unresolved")
    if (
        difference is not None
        and difference < 0
        and intent.difference_classification in ("channel_funded", "hotel_funded")
    ):
        raise ValueError("A guest amount above the contract cannot be a funded discount")
    rule = terms.commission
    basis = (
        contract
        if rule.basis == "confirmed_accommodation"
        else intent.reference_value_minor
        if rule.basis == "reference_value"
        else intent.explicit_commission_basis_minor
    )
    if rule.method == "percentage" and basis is None:
        raise ValueError("Enter the commission basis required by this agreement")
    if (
        intent.manual_commission_minor is not None
        and rule.method != "manual"
        and not rule.allowOverride
    ):
        raise ValueError("Booking-specific commission overrides are not permitted")
    if rule.method == "manual" and intent.manual_commission_minor is None:
        raise ValueError("Enter the manual commission amount")
    commission = (
        intent.manual_commission_minor
        if intent.manual_commission_minor is not None
        else (basis * rule.rateBasisPoints + 5000) // 10000
        if rule.method == "percentage"
        else rule.fixedMinor
        if rule.method == "fixed"
        else 0
    )
    money(commission)
    if intent.manual_commission_minor is not None and not intent.override_reason:
        raise ValueError("A manual commission or commission override requires a reason")
    # Deducted and separately invoiced are different obligations. Manual/offset remain unresolved.
    # Unresolved guest funding also prevents inferring an amount due from the channel.
    settlement = None
    if intent.collection == "channel" and intent.difference_classification not in (
        "unresolved",
        "hotel_funded",
    ):
        if terms.settlement.method == "deducted":
            if commission > contract:
                raise ValueError("Deducted commission exceeds contractual accommodation")
            settlement = contract - commission
        elif terms.settlement.method == "separate_invoice":
            settlement = contract
    adjustments = sum(a["amount_minor"] for a in snapshot.get("adjustments", []))
    before_clamp = contract + additions + adjustments
    if abs(before_clamp) > MAX_MINOR:
        raise ValueError("Contractual bill exceeds supported exact PHP range")
    return dict(
        standard_accommodation_minor=standard,
        discounted_accommodation_minor=discounted,
        contractual_accommodation_minor=contract,
        accommodation_adjustment_minor=contract - discounted,
        additional_charges_minor=additions,
        total_minor=max(0, before_clamp),
        guest_paid_minor=intent.guest_paid_minor,
        guest_paid_status=intent.guest_paid_status,
        difference_minor=difference,
        difference_classification=intent.difference_classification,
        commission_basis_minor=basis,
        commission_minor=commission,
        collection=intent.collection,
        settlement_method=terms.settlement.method,
        expected_settlement_minor=settlement,
        hotel_received_minor=0,
    )


def apply_capture(snapshot, capture):
    """Reapply captured contractual terms to a new hotel pricing revision, without re-resolution."""
    from app.modules.reservations.schemas import ChannelPricingSnapshot

    raw = snapshot.model_dump(mode="json") if isinstance(snapshot, BaseModel) else dict(snapshot)
    raw.pop("channel", None)
    raw.pop("channel_figures", None)
    inputs = BookingFinancialIntent.model_validate(capture["input"])
    figures = calculate_financials(raw, inputs, capture["terms"], historical=True)
    return ChannelPricingSnapshot.model_validate(
        {
            **raw,
            "schema_version": 7,
            "calculation_version": "channel-capture-v1",
            "charges": raw.get("charges", []),
            "adjustments": raw.get("adjustments", []),
            "discounts": raw.get("discounts", []),
            "discount_total_minor": raw.get("discount_total_minor", 0),
            "price_overrides": raw.get("price_overrides", []),
            "price_override_total_minor": raw.get("price_override_total_minor", 0),
            "pipeline_version": 2,
            "channel": capture,
            "channel_figures": figures,
            "total_minor": figures["total_minor"],
        }
    )
