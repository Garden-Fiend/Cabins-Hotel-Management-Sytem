from datetime import time
from typing import Literal
from uuid import UUID

import sqlalchemy as sa
from pydantic import Field, model_validator

from app.models import (
    agreements,
    booking_sources,
    categories,
    companies,
    discount_presets,
    durations,
    products,
    rates,
    room_types,
    rooms,
)
from app.modules.configuration.breakfast import read_eligibility
from app.modules.configuration.schemas import CategoryRead, DiscountPresetRead, ProductRead
from app.modules.configuration.sources import AgreementRead, SourceRead, source_read
from app.modules.reservations.inclusions import read_defaults
from app.modules.reservations.schemas import (
    DTO,
    BreakfastEligibility,
    DefaultInclusion,
    Minor,
    Positive,
)
from app.modules.reservations.services import ReservationService


class CompanyRead(DTO):
    breakfast_version: Positive = 1
    id: UUID
    name: str
    currency: Literal["PHP"]
    hotel_timezone: Literal["Asia/Manila"]
    default_check_in_time: time
    default_check_out_time: time


class RoomTypeRead(DTO):
    default_inclusions: tuple[DefaultInclusion, ...] = ()
    id: UUID
    version: Positive
    archived: bool
    amenities: list[str]
    source_id: str
    label: str
    enabled: bool
    default_capacity: Positive


class RoomRead(DTO):
    id: UUID
    version: Positive
    room_type_id: UUID
    number: str
    display_name: str
    enabled: bool
    archived: bool
    operational: bool
    operational_status: (
        Literal["operational", "housekeeping", "maintenance", "unavailable"] | None
    ) = None
    housekeeping: Literal["clean", "dirty", "cleaning"]
    capacity_override: Positive | None
    current_occupancy_allocation_id: UUID | None
    description: str = ""
    operational_notes: str = ""
    amenities_additions: list[str] = Field(default_factory=list)
    amenities_removals: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def legacy_status(self):
        if self.operational_status is None:
            self.operational_status = "operational" if self.operational else "unavailable"
        if self.operational != (self.operational_status == "operational"):
            raise ValueError("Room status and operational flag are inconsistent")
        return self


class DurationRead(DTO):
    id: UUID
    version: Positive
    label: str
    source_id: str
    kind: Literal["hourly", "overnight"]
    minutes: Positive | None
    nights: Positive | None
    enabled: bool


class RateRead(DTO):
    id: UUID
    version: Positive
    source_id: str
    room_type_id: UUID
    booking_kind: Literal["hourly", "overnight"]
    duration_id: UUID | None
    currency: Literal["PHP"]
    unit_amount_minor: Minor
    enabled: bool


class ReferenceRead(DTO):
    discount_presets: list[DiscountPresetRead] = Field(default_factory=list)
    breakfast_eligible_items: list[BreakfastEligibility] = Field(default_factory=list)
    capabilities: tuple[str, ...] = (
        "billing.collections.v1",
        "configuration.sources.v1",
        "reservation.multi-room.v1",
        "reservation.independent-stays.v1",
        "reservation.lifecycle.v1",
        "room.readiness.v1",
        "configuration.definitions.v1",
        "reservation.guest-edit.v1",
        "reservation.stay-edit.v1",
        "reservation.adjustments.v1",
        "reservation.manual-discounts.v1",
        "reservation.discount-presets.v1",
        "configuration.catalog.v1",
        "reservation.purchases.v1",
        "reservation.extra-charges.v1",
        "reservation.inclusions.v1",
        "reservation.breakfast.v1",
        "room.status.v1",
    )
    company: CompanyRead
    room_types: list[RoomTypeRead]
    rooms: list[RoomRead]
    durations: list[DurationRead]
    rates: list[RateRead]
    booking_sources: list[SourceRead]
    source_agreements: list[AgreementRead] = []
    inventory_categories: list[CategoryRead]
    catalog_products: list[ProductRead]


def read_references(service: ReservationService) -> ReferenceRead:
    # Capture related reference configuration in one consistent read-only DB snapshot.
    with service.transaction() as session:
        session.execute(sa.text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
        company = service.owned(session, companies, service.context.company_id)
        result = {"company": dict(company)}
        result["breakfast_eligible_items"] = read_eligibility(session, service.context.company_id)
        for table, model in (
            (room_types, RoomTypeRead),
            (rooms, RoomRead),
            (durations, DurationRead),
            (rates, RateRead),
            (booking_sources, SourceRead),
            (categories, CategoryRead),
            (products, ProductRead),
            (discount_presets, DiscountPresetRead),
        ):
            rows = session.execute(
                sa.select(table)
                .where(
                    table.c.company_id == service.context.company_id,
                )
                .order_by(table.c.id)
            ).mappings()
            result["rates" if table is rates else table.name] = [
                source_read(session, row)
                if table is booking_sources
                else model(
                    **{
                        field: read_defaults(session, service.context.company_id, row["id"])
                        if field == "default_inclusions"
                        else row[field]
                        for field in model.model_fields
                    }
                )
                for row in rows
            ]
        result["source_agreements"] = [
            AgreementRead.model_validate(row)
            for row in session.execute(
                sa.select(agreements)
                .where(agreements.c.company_id == service.context.company_id)
                .order_by(agreements.c.source_id, agreements.c.revision)
            ).mappings()
        ]
        return ReferenceRead(**result)
