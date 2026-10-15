"""Explicit plural contract; singular commands and historical fingerprints remain intact."""

from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, StrictBool, field_validator, model_validator

from app.modules.reservations.schemas import (
    DTO,
    AdjustmentCapture,
    AllocationRead,
    AuditRead,
    BreakfastIntent,
    ChargeIntent,
    Count,
    InclusionIntent,
    ManualDiscountIntent,
    Positive,
    ReservationCreate,
    ReservationRead,
    distinct_breakfast,
    distinct_inclusions,
    unique_adjustments,
    unique_charges,
    validate_manual_discounts,
)


class AllocationStay(DTO):
    scheduled_start: AwareDatetime
    duration_id: UUID
    scheduled_end: AwareDatetime | None = None

    @field_validator("scheduled_start", "scheduled_end", mode="before")
    @classmethod
    def iso_only(cls, value):
        return ReservationCreate.iso_instant_only(value) if value is not None else value

    @field_validator("scheduled_start", "scheduled_end")
    @classmethod
    def utc_only(cls, value):
        return ReservationCreate.utc_instant(value) if value is not None else value

    @model_validator(mode="after")
    def positive(self):
        if self.scheduled_end is not None and self.scheduled_end <= self.scheduled_start:
            raise ValueError("Checkout must follow arrival")
        return self


class AllocationIntent(DTO):
    id: UUID | None = None
    room_id: UUID
    adults: Positive
    children: Count = 0
    stay: AllocationStay | None = None
    charges: tuple[ChargeIntent, ...] = Field(default=(), max_length=100)
    inclusions: tuple[InclusionIntent, ...] | None = Field(default=None, max_length=100)
    breakfast: tuple[BreakfastIntent, ...] = Field(default=(), max_length=500)
    _charges = field_validator("charges")(unique_charges)
    _inclusions = field_validator("inclusions")(
        lambda value: distinct_inclusions(value) if value is not None else value
    )
    _breakfast = field_validator("breakfast")(distinct_breakfast)


class MultiCreate(DTO):
    guest_id: UUID
    booking_source_id: UUID
    duration_id: UUID
    scheduled_start: AwareDatetime
    note: str = Field(default="", max_length=10000)
    allocations: tuple[AllocationIntent, ...] = Field(min_length=1, max_length=50)
    discounts: tuple[ManualDiscountIntent, ...] = Field(default=(), max_length=100)
    adjustments: tuple[AdjustmentCapture, ...] = Field(default=(), max_length=100)
    _discounts = field_validator("discounts")(validate_manual_discounts)
    _adjustments = field_validator("adjustments")(unique_adjustments)

    @field_validator("scheduled_start", mode="before")
    @classmethod
    def iso_only(cls, value):
        return ReservationCreate.iso_instant_only(value)

    @field_validator("scheduled_start")
    @classmethod
    def utc_only(cls, value):
        return ReservationCreate.utc_instant(value)

    @model_validator(mode="after")
    def distinct_rooms(self):
        if len({item.room_id for item in self.allocations}) != len(self.allocations):
            raise ValueError("Select each physical room once")
        ids = [item.id for item in self.allocations if item.id]
        if len(set(ids)) != len(ids):
            raise ValueError("Allocation identities must be unique")
        unique_charges([charge for allocation in self.allocations for charge in allocation.charges])
        return self


class MultiEdit(MultiCreate):
    expected_version: Positive


class MultiAllocationRead(AllocationRead):
    state: Literal["reserved", "checked_in", "checked_out", "cancelled", "no_show", "removed"]
    removed_at: AwareDatetime | None
    room_number: str
    room_type_label: str


class MultiAuditRead(AuditRead):
    description: str


class MultiRead(ReservationRead):
    allocation: None = None  # There is deliberately no invented primary room.
    allocations: tuple[MultiAllocationRead, ...]
    audit: list[MultiAuditRead]
    aggregate_status: Literal[
        "reserved",
        "partially_checked_in",
        "checked_in",
        "partially_checked_out",
        "checked_out",
        "cancelled",
        "no_show",
    ]
    shared_start: AwareDatetime
    shared_end: AwareDatetime
    shared_duration_id: UUID


class MultiLifecycle(DTO):
    expected_version: Positive
    allocation_id: UUID | None = None  # absent targets every active allocation, without skipping
    guest_has_vacated: StrictBool = False


class IndependentAllocationRead(MultiAllocationRead):
    uses_reservation_stay: bool


class StayDefaults(DTO):
    scheduled_start: AwareDatetime
    scheduled_end: AwareDatetime
    duration_id: UUID


class IndependentRead(MultiRead):
    stay_mode: Literal["independent"] = "independent"
    stay_defaults: StayDefaults
    shared_duration_id: UUID | None
    allocations: tuple[IndependentAllocationRead, ...]
