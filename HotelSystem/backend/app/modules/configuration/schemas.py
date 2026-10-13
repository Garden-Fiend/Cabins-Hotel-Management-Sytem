from typing import Literal
from uuid import UUID

from pydantic import Field, StrictBool, StrictStr, field_validator, model_validator

from app.modules.reservations.schemas import DTO, Minor, Positive


class RoomTypeWrite(DTO):
    label: str = Field(min_length=1, max_length=200)
    enabled: StrictBool = True
    archived: StrictBool = False
    default_capacity: Positive = 2
    amenities: list[StrictStr] = Field(default_factory=list, max_length=100)

    @field_validator("amenities")
    @classmethod
    def unique_amenities(cls, value):
        if any(not item.strip() or len(item) > 200 for item in value) or len(set(value)) != len(
            value
        ):
            raise ValueError("Amenities must be nonblank, unique strings")
        return value


class RoomTypeEdit(RoomTypeWrite):
    expected_version: Positive


class RoomWrite(DTO):
    number: str = Field(min_length=1, max_length=30)
    room_type_id: UUID
    display_name: str = Field(default="", max_length=200)
    enabled: StrictBool = True
    archived: StrictBool = False
    operational: StrictBool = True
    operational_status: (
        Literal["operational", "housekeeping", "maintenance", "unavailable"] | None
    ) = None
    capacity_override: Positive | None = None
    description: str = Field(default="", max_length=4000)
    operational_notes: str = Field(default="", max_length=4000)
    amenities_additions: list[StrictStr] = Field(default_factory=list, max_length=100)
    amenities_removals: list[StrictStr] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def consistent_status(self):
        if "operational_status" in self.model_fields_set:
            if self.operational_status is None:
                raise ValueError("Operational status cannot be null")
            if "operational" in self.model_fields_set and self.operational != (
                self.operational_status == "operational"
            ):
                raise ValueError("Operational flag and status must agree")
        return self

    @field_validator("amenities_additions", "amenities_removals")
    @classmethod
    def unique_amenities(cls, value):
        return RoomTypeWrite.unique_amenities(value)


class RoomEdit(RoomWrite):
    expected_version: Positive


class DurationWrite(DTO):
    label: str = Field(min_length=1, max_length=200)
    kind: Literal["hourly", "overnight"]
    minutes: Positive | None = None
    nights: Positive | None = None
    enabled: StrictBool = True

    @model_validator(mode="after")
    def valid_definition(self):
        if self.kind == "hourly" and (self.minutes is None or self.nights is not None):
            raise ValueError("Hourly durations require minutes only")
        if self.kind == "overnight" and (self.nights is None or self.minutes is not None):
            raise ValueError("Overnight durations require nights only")
        return self


class DurationEdit(DurationWrite):
    expected_version: Positive


class RateWrite(DTO):
    room_type_id: UUID
    booking_kind: Literal["hourly", "overnight"]
    duration_id: UUID | None = None
    unit_amount_minor: Minor
    currency: Literal["PHP"] = "PHP"
    enabled: StrictBool = True

    @model_validator(mode="after")
    def valid_basis(self):
        if (self.booking_kind == "hourly") != (self.duration_id is not None):
            raise ValueError("Hourly rates require duration; nightly rates must omit duration")
        return self


class RateEdit(RateWrite):
    expected_version: Positive


class CategoryWrite(DTO):
    label: str = Field(min_length=1, max_length=200)
    type: Literal["ordinary", "amenities"] = "ordinary"
    enabled: StrictBool = True


class CategoryEdit(CategoryWrite):
    expected_version: Positive


class CategoryRead(CategoryWrite):
    id: UUID
    version: Positive
    system_defined: Literal[False]


class ProductWrite(DTO):
    label: str = Field(min_length=1, max_length=200)
    category_id: UUID
    unit_amount_minor: Minor
    currency: Literal["PHP"] = "PHP"
    available_for_sale: StrictBool = True
    enabled: StrictBool = True
    archived: StrictBool = False


class ProductEdit(ProductWrite):
    expected_version: Positive


class ProductRead(ProductWrite):
    id: UUID
    version: Positive
