"""Transport contracts for the deliberately small direct, single-room API."""

import re
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
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


class GuestRead(GuestCreate):
    id: UUID
    company_id: UUID


class ReservationCreate(DTO):
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
    adjustments: tuple[AdjustmentCapture, ...] = Field(max_length=100)

    @field_validator("adjustments")
    @classmethod
    def distinct(cls, value):
        return unique_adjustments(value)


class ChargeIntent(DTO):
    id: UUID
    product_id: UUID
    quantity: Positive
    usage: Literal["purchase"] = "purchase"


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


class ReservationStayEdit(ReservationDetailsEdit):
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


class PricingRead(DTO):
    id: UUID
    revision: Positive
    reservation_version: Positive
    captured_at: AwareDatetime
    snapshot: PricingSnapshot | AdjustedPricingSnapshot | ChargedPricingSnapshot


class AllocationRead(DTO):
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
