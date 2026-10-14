"""Transport contracts for the deliberately small direct, single-room API."""

import re
from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StrictStr,
    field_validator,
    model_validator,
)

MAX_MINOR = 2**53 - 1  # Exact in the existing JavaScript frontend as well as PostgreSQL.
Minor = Annotated[StrictInt, Field(ge=0, le=MAX_MINOR)]
Positive = Annotated[StrictInt, Field(ge=1, le=2**31 - 1)]
Count = Annotated[StrictInt, Field(ge=0, le=2**31 - 1)]


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class GuestCreate(DTO):
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(default="", max_length=100)
    email: str = Field(default="", max_length=254)


class DefaultInclusion(DTO):
    product_id: UUID
    quantity: Positive


class InclusionIntent(DTO):
    product_id: UUID
    quantity: Count
    overridden: StrictBool = False


class InclusionCapture(InclusionIntent):
    label: str = Field(min_length=1, max_length=200)
    source: Literal["default", "manual"]


def distinct_inclusions(value):
    if value is None:
        raise ValueError("Inclusions cannot be null")
    if len({item.product_id for item in value}) != len(value):
        raise ValueError("Each inclusion can appear only once")
    return value


class BreakfastEligibility(DTO):
    product_id: UUID
    kind: Literal["meal", "beverage"]
    enabled: StrictBool = True


class BreakfastConfiguration(DTO):
    expected_version: Positive
    items: tuple[BreakfastEligibility, ...] = Field(max_length=500)
    _distinct = field_validator("items")(distinct_inclusions)


class BreakfastConfigurationRead(DTO):
    id: UUID
    version: Positive
    items: tuple[BreakfastEligibility, ...]


class BreakfastIntent(DTO):
    service_date: date
    guest_number: Positive
    status: Literal["included", "skipped"]
    meal_id: UUID | None = None
    beverage_id: UUID | None = None

    @field_validator("service_date", mode="before")
    @classmethod
    def date_only(cls, value):
        if not isinstance(value, date) and (
            not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)
        ):
            raise ValueError("Use a hotel service date YYYY-MM-DD")
        if isinstance(value, datetime):
            raise ValueError("Use a date, not an instant")
        return value

    @model_validator(mode="after")
    def selection(self):
        if self.status == "included" and (self.meal_id is None or self.beverage_id is None):
            raise ValueError("An included breakfast requires a meal and beverage")
        if self.status == "skipped" and (self.meal_id is not None or self.beverage_id is not None):
            raise ValueError("Skipped breakfast has no meal or beverage")
        return self


class BreakfastCapture(BreakfastIntent):
    meal_label: str | None = None
    beverage_label: str | None = None
    quantity: Literal[1] = 1
    unit_amount_minor: Literal[0] = 0
    amount_minor: Literal[0] = 0


def distinct_breakfast(value):
    if value is None or len({(item.service_date, item.guest_number) for item in value}) != len(
        value
    ):
        raise ValueError("Breakfast selections must be non-null and unique per date/guest")
    return value


class GuestRead(GuestCreate):
    id: UUID
    company_id: UUID


class ManualDiscountIntent(DTO):
    preset_id: UUID | None = None
    id: UUID
    label: str = Field(min_length=1, max_length=200)
    scope: Literal["reservation", "room", "item"]
    method: Literal["fixed", "percentage"]
    value: StrictStr = Field(min_length=1, max_length=40)
    target_id: StrictStr = ""
    currency: Literal["PHP"] = "PHP"

    @field_validator("value")
    @classmethod
    def decimal_value(cls, value):
        from decimal import Decimal

        if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", value):
            raise ValueError("Use a positive decimal string")
        if Decimal(value) <= 0 or Decimal(value) > Decimal(MAX_MINOR) / 100:
            raise ValueError("Discount exceeds supported positive monetary range")
        return value

    @model_validator(mode="after")
    def valid_percentage(self):
        from decimal import Decimal

        if self.method == "percentage" and Decimal(self.value) > 100:
            raise ValueError("Percentage must be at most 100")
        return self


def validate_manual_discounts(value):
    if value is None:
        raise ValueError("Discounts cannot be null")
    if len({item.id for item in value}) != len(value):
        raise ValueError("Discount identities must be unique")
    return value


class ReservationCreate(DTO):
    breakfast: tuple[BreakfastIntent, ...] = Field(default=(), max_length=500)
    _breakfast_valid = field_validator("breakfast")(distinct_breakfast)
    inclusions: tuple[InclusionIntent, ...] = Field(default=(), max_length=100)
    _inclusions_valid = field_validator("inclusions")(distinct_inclusions)
    charges: tuple["ChargeIntent", ...] = Field(default=(), max_length=100)

    @field_validator("charges")
    @classmethod
    def initial_extras(cls, value):
        unique_charges(value)
        if any(item.usage != "extra_charge" for item in value):
            raise ValueError("Initial bill lines currently support special extra charges only")
        return value

    discounts: tuple[ManualDiscountIntent, ...] = Field(default=(), max_length=100)

    _discounts_valid = field_validator("discounts")(validate_manual_discounts)
    guest_id: UUID
    booking_source_id: UUID
    room_id: UUID
    duration_id: UUID
    scheduled_start: AwareDatetime
    adults: Positive
    children: Count = 0
    note: str = Field(default="", max_length=4000)

    @field_validator("scheduled_start", mode="before")
    @classmethod
    def iso_instant_only(cls, value):
        if not isinstance(value, (str, datetime)):
            raise ValueError("Use an offset-aware ISO timestamp, not an epoch number")
        if isinstance(value, str) and not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})",
            value,
        ):
            raise ValueError("Use an offset-aware ISO timestamp with at most six fractional digits")
        return value

    @field_validator("scheduled_start")
    @classmethod
    def utc_instant(cls, value):
        # Preserve seconds/microseconds; never round the occupied interval.
        try:
            return value.astimezone(UTC)
        except (OverflowError, ValueError):
            raise ValueError("Timestamp exceeds supported UTC date range") from None


class ReservationEdit(DTO):
    """Allowlisted note/count patch; absent preserves, blank note clears, null rejects."""

    expected_version: Positive
    note: str | None = Field(default=None, max_length=4000)
    adults: Positive | None = None
    children: Count | None = None

    @model_validator(mode="after")
    def explicit_change_required(self):
        fields = self.model_fields_set - {"expected_version"}
        if not fields or any(getattr(self, field) is None for field in fields):
            raise ValueError("Supply at least one editable field; explicit null is not a clear")
        return self


class LifecycleCommand(DTO):
    expected_version: Positive


class ReservationDetailsEdit(ReservationEdit):
    """Explicit primary-guest correction, optionally with note/counts in one command."""

    guest_id: UUID


class AdjustmentCapture(DTO):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)
    id: UUID
    amount_minor: Annotated[StrictInt, Field(ge=-MAX_MINOR, le=MAX_MINOR)]
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("amount_minor")
    @classmethod
    def nonzero(cls, value):
        if value == 0:
            raise ValueError("Adjustments must be nonzero")
        return value


def unique_adjustments(items):
    if len({item.id for item in items}) != len(items):
        raise ValueError("Adjustment identities must be unique")
    return items


class ReservationBillingEdit(ReservationDetailsEdit):
    discounts: tuple[ManualDiscountIntent, ...] | None = Field(default=None, max_length=100)
    _discounts_valid = field_validator("discounts")(validate_manual_discounts)

    adjustments: tuple[AdjustmentCapture, ...] = Field(max_length=100)

    @field_validator("adjustments")
    @classmethod
    def distinct(cls, value):
        return unique_adjustments(value)


class ChargeIntent(DTO):
    id: UUID
    product_id: UUID
    quantity: Positive
    usage: Literal["purchase", "extra_charge"] = "purchase"


class ChargeCapture(ChargeIntent):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)
    label: str = Field(min_length=1, max_length=200)
    unit_amount_minor: Minor
    amount_minor: Minor
    currency: Literal["PHP"] = "PHP"

    @model_validator(mode="after")
    def exact_amount(self):
        if self.amount_minor != self.unit_amount_minor * self.quantity:
            raise ValueError("Captured charge must equal unit amount times quantity")
        return self


def unique_charges(items):
    if len({item.id for item in items}) != len(items):
        raise ValueError("Charge identities must be unique")
    return items


class ReservationChargesEdit(ReservationDetailsEdit):
    discounts: tuple[ManualDiscountIntent, ...] | None = Field(default=None, max_length=100)
    _discounts_valid = field_validator("discounts")(validate_manual_discounts)

    charges: tuple[ChargeIntent, ...] = Field(max_length=100)
    adjustments: tuple[AdjustmentCapture, ...] | None = Field(default=None, max_length=100)

    @field_validator("charges")
    @classmethod
    def distinct_charges(cls, value):
        return unique_charges(value)

    @field_validator("adjustments")
    @classmethod
    def distinct_adjustments(cls, value):
        return unique_adjustments(value) if value is not None else value


class ReservationDiscountsEdit(ReservationDetailsEdit):
    discounts: tuple[ManualDiscountIntent, ...] = Field(max_length=100)
    adjustments: tuple[AdjustmentCapture, ...] | None = Field(default=None, max_length=100)
    charges: tuple[ChargeIntent, ...] | None = Field(default=None, max_length=100)
    _discounts_valid = field_validator("discounts")(validate_manual_discounts)

    @field_validator("charges")
    @classmethod
    def valid_charges(cls, value):
        if value is None:
            raise ValueError("Charges cannot be null")
        return unique_charges(value)

    @field_validator("adjustments")
    @classmethod
    def valid_adjustments(cls, value):
        if value is None:
            raise ValueError("Adjustments cannot be null")
        return unique_adjustments(value)


class ReservationInclusionsEdit(ReservationDiscountsEdit):
    discounts: tuple[ManualDiscountIntent, ...] | None = Field(default=None, max_length=100)
    inclusions: tuple[InclusionIntent, ...] = Field(max_length=100)
    _inclusions_valid = field_validator("inclusions")(distinct_inclusions)


class ReservationBreakfastEdit(ReservationInclusionsEdit):
    inclusions: tuple[InclusionIntent, ...] | None = Field(default=None, max_length=100)
    breakfast: tuple[BreakfastIntent, ...] = Field(max_length=500)
    _breakfast_valid = field_validator("breakfast")(distinct_breakfast)


class ReservationStayEdit(ReservationDetailsEdit):
    breakfast: tuple[BreakfastIntent, ...] | None = Field(default=None, max_length=500)
    _breakfast_valid = field_validator("breakfast")(distinct_breakfast)
    inclusions: tuple[InclusionIntent, ...] | None = Field(default=None, max_length=100)

    @field_validator("inclusions")
    @classmethod
    def valid_inclusions(cls, value):
        if value is None:
            raise ValueError("Inclusions cannot be null")
        return distinct_inclusions(value)

    discounts: tuple[ManualDiscountIntent, ...] | None = Field(default=None, max_length=100)
    _discounts_valid = field_validator("discounts")(validate_manual_discounts)

    """Single-room pre-arrival assignment/stay change; no arbitrary end or client price."""

    room_id: UUID
    duration_id: UUID
    scheduled_start: AwareDatetime
    adjustments: tuple[AdjustmentCapture, ...] | None = Field(default=None, max_length=100)

    @field_validator("adjustments")
    @classmethod
    def distinct(cls, value):
        return unique_adjustments(value) if value is not None else value

    @field_validator("scheduled_start", mode="before")
    @classmethod
    def iso_instant_only(cls, value):
        return ReservationCreate.iso_instant_only(value)

    @field_validator("scheduled_start")
    @classmethod
    def utc_instant(cls, value):
        return ReservationCreate.utc_instant(value)


class ReservationStayChargesEdit(ReservationStayEdit):
    charges: tuple[ChargeIntent, ...] = Field(max_length=100)

    @field_validator("charges")
    @classmethod
    def distinct_charges(cls, value):
        return unique_charges(value)


class CancellationCommand(LifecycleCommand):
    guest_has_vacated: StrictBool


class RoomReadinessCommand(LifecycleCommand):
    housekeeping: Literal["clean", "cleaning"]


class CapturedLine(DTO):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: Literal["accommodation"] = "accommodation"
    room_id: UUID
    room_number: str
    room_type_id: UUID
    room_type_label: str
    duration_id: UUID
    duration_source_id: str
    rate_id: UUID
    rate_source_id: str
    booking_kind: Literal["hourly", "overnight"]
    unit_amount_minor: Minor
    quantity: Positive
    amount_minor: Minor
    currency: Literal["PHP"] = "PHP"

    @model_validator(mode="after")
    def exact_line_arithmetic(self):
        if self.amount_minor != self.unit_amount_minor * self.quantity:
            raise ValueError("Captured amount must equal unit amount times quantity")
        return self


class PricingSnapshot(DTO):
    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal[1] = 1
    calculation_version: Literal["direct-accommodation-v1"] = "direct-accommodation-v1"
    currency: Literal["PHP"] = "PHP"
    hotel_timezone: Literal["Asia/Manila"] = "Asia/Manila"
    tax_status: Literal["not_configured"] = "not_configured"
    tax_minor: Literal[0] = 0
    lines: tuple[CapturedLine, ...] = Field(min_length=1, max_length=1)
    total_minor: Minor

    @model_validator(mode="after")
    def exact_total(self):
        if self.total_minor != sum(line.amount_minor for line in self.lines):
            raise ValueError("Captured total must equal the saved accommodation lines")
        return self


class AdjustedPricingSnapshot(PricingSnapshot):
    schema_version: Literal[2] = 2
    calculation_version: Literal["direct-adjustments-v1"] = "direct-adjustments-v1"
    adjustments: tuple[AdjustmentCapture, ...] = Field(max_length=100)

    @model_validator(mode="after")
    def exact_total(self):
        unique_adjustments(self.adjustments)
        subtotal = sum(line.amount_minor for line in self.lines)
        adjustment_total = sum(item.amount_minor for item in self.adjustments)
        if abs(adjustment_total) > MAX_MINOR or abs(subtotal + adjustment_total) > MAX_MINOR:
            raise ValueError("Adjusted amount exceeds supported exact monetary range")
        if self.total_minor != max(0, subtotal + adjustment_total):
            raise ValueError("Total must equal clamped accommodation plus signed adjustments")
        return self


class ChargedPricingSnapshot(AdjustedPricingSnapshot):
    schema_version: Literal[3] = 3
    calculation_version: Literal["direct-charges-v1"] = "direct-charges-v1"
    charges: tuple[ChargeCapture, ...] = Field(max_length=100)

    @model_validator(mode="after")
    def exact_total(self):
        unique_adjustments(self.adjustments)
        unique_charges(self.charges)
        subtotal = sum(line.amount_minor for line in self.lines) + sum(
            item.amount_minor for item in self.charges
        )
        adjustment_total = sum(item.amount_minor for item in self.adjustments)
        if (
            subtotal > MAX_MINOR
            or abs(adjustment_total) > MAX_MINOR
            or abs(subtotal + adjustment_total) > MAX_MINOR
        ):
            raise ValueError("Amount exceeds supported exact monetary range")
        if self.total_minor != max(0, subtotal + adjustment_total):
            raise ValueError(
                "Total must equal clamped accommodation, purchases and signed adjustments"
            )
        return self


class DiscountAllocation(DTO):
    line_id: str
    amount_minor: Minor


class ManualDiscountCapture(ManualDiscountIntent):
    provenance: Literal["manual", "preset"] = "manual"
    preset_version: Positive | None = None
    preset_target_id: str | None = None
    preset_rate_id: str | None = None
    applied_at: AwareDatetime
    amount_minor: Minor
    order: Count
    allocations: tuple[DiscountAllocation, ...]


class DiscountedPricingSnapshot(ChargedPricingSnapshot):
    schema_version: Literal[4] = 4
    calculation_version: Literal["direct-manual-discounts-v1"] = "direct-manual-discounts-v1"
    charges: tuple[ChargeCapture, ...] = ()
    adjustments: tuple[AdjustmentCapture, ...] = ()
    discounts: tuple[ManualDiscountCapture, ...] = Field(max_length=100)
    discount_total_minor: Minor
    pipeline_version: Literal[2] = 2

    @model_validator(mode="after")
    def exact_total(self):
        from app.modules.billing.discounts import calculate_discounts

        unique_adjustments(self.adjustments)
        unique_charges(self.charges)
        raw = self.model_dump(mode="json")
        intents = [
            {k: v for k, v in d.items() if k not in ("amount_minor", "order", "allocations")}
            for d in raw["discounts"]
        ]
        calculated, reduction, total = calculate_discounts(raw, intents)
        if (
            calculated != raw["discounts"]
            or reduction != self.discount_total_minor
            or total != self.total_minor
        ):
            raise ValueError("Discount capture must match the deterministic server calculation")
        return self


class PricingRead(DTO):
    id: UUID
    revision: Positive
    reservation_version: Positive
    captured_at: AwareDatetime
    snapshot: (
        PricingSnapshot
        | AdjustedPricingSnapshot
        | ChargedPricingSnapshot
        | DiscountedPricingSnapshot
    )


class AllocationRead(DTO):
    breakfast: tuple[BreakfastCapture, ...] = ()
    inclusions: tuple[InclusionCapture, ...] = ()
    id: UUID
    room_id: UUID
    duration_id: UUID
    scheduled_start: AwareDatetime
    scheduled_end: AwareDatetime
    actual_check_in: AwareDatetime | None
    actual_check_out: AwareDatetime | None
    adults: Positive
    children: Count
    blocks_availability: bool


class AuditRead(DTO):
    id: UUID
    event_type: str
    actor: str
    attribution: Literal["local_development"]
    reservation_version: Positive
    occurred_at: AwareDatetime


class ReservationRead(DTO):
    id: UUID
    company_id: UUID
    business_number: Positive
    reference: str
    version: Positive
    status: Literal["confirmed", "reserved", "checked_in", "checked_out", "cancelled", "no_show"]
    guest: GuestRead
    booking_source_id: UUID
    note: str
    created_at: AwareDatetime
    updated_at: AwareDatetime
    allocation: AllocationRead
    pricing: PricingRead
    audit: list[AuditRead]


ReservationCreate.model_rebuild()
