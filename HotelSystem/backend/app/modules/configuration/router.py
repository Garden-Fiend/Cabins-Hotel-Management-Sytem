from datetime import date
from uuid import UUID

import sqlalchemy as sa
from fastapi import APIRouter

from app.models import booking_sources
from app.modules.configuration.breakfast import save_breakfast
from app.modules.configuration.retirement import RetirementIntent, RetirementRead, retire_definition
from app.modules.configuration.schemas import (
    CategoryEdit,
    CategoryRead,
    CategoryWrite,
    DiscountPresetEdit,
    DiscountPresetRead,
    DiscountPresetWrite,
    DurationEdit,
    DurationWrite,
    ProductEdit,
    ProductRead,
    ProductWrite,
    RateEdit,
    RateWrite,
    RoomEdit,
    RoomTypeEdit,
    RoomTypeWrite,
    RoomWrite,
)
from app.modules.configuration.services import save_definition
from app.modules.configuration.sources import (
    AgreementEdit,
    AgreementRead,
    AgreementWrite,
    SourceEdit,
    SourceRead,
    SourceWrite,
    list_agreements,
    save_agreement,
    save_source,
    source_read,
)
from app.modules.reservations.references import DurationRead, RateRead, RoomRead, RoomTypeRead
from app.modules.reservations.router import Key, Service
from app.modules.reservations.schemas import BreakfastConfiguration, BreakfastConfigurationRead

router = APIRouter(prefix="/api/v1/configuration", tags=["local-development configuration"])


@router.post("/booking-sources", response_model=SourceRead, status_code=201)
def create_source(body: SourceWrite, key: Key, service: Service):
    return save_source(service, body, key)


@router.patch("/booking-sources/{id}", response_model=SourceRead)
def update_source(id: UUID, body: SourceEdit, key: Key, service: Service):
    return save_source(service, body, key, id)


@router.get("/booking-sources/{id}/agreements", response_model=list[AgreementRead])
def read_source_agreements(id: UUID, service: Service, effective_on: date | None = None):
    return list_agreements(service, id, effective_on)


@router.get("/booking-sources", response_model=list[SourceRead])
def list_sources(service: Service):
    with service.transaction() as session:
        return [
            source_read(session, row)
            for row in session.execute(
                sa.select(booking_sources)
                .where(booking_sources.c.company_id == service.context.company_id)
                .order_by(booking_sources.c.id)
            ).mappings()
        ]


@router.get("/booking-sources/{id}", response_model=SourceRead)
def read_source(id: UUID, service: Service):
    with service.transaction() as session:
        return source_read(session, service.owned(session, booking_sources, id, lock=True))


@router.post("/booking-sources/{id}/agreements", response_model=AgreementRead, status_code=201)
def create_source_agreement(id: UUID, body: AgreementWrite, key: Key, service: Service):
    return save_agreement(service, id, body, key)


@router.patch("/booking-sources/{id}/agreements/{agreement_id}", response_model=AgreementRead)
def update_source_agreement(
    id: UUID, agreement_id: UUID, body: AgreementEdit, key: Key, service: Service
):
    return save_agreement(service, id, body, key, agreement_id)


@router.post("/rooms/{id}/retirement", response_model=RetirementRead)
def retire_room(id: UUID, body: RetirementIntent, key: Key, service: Service):
    return retire_definition(service, "rooms", id, body, key)


@router.post("/room-types/{id}/retirement", response_model=RetirementRead)
def retire_room_type(id: UUID, body: RetirementIntent, key: Key, service: Service):
    return retire_definition(service, "room-types", id, body, key)


@router.post("/discount-presets", response_model=DiscountPresetRead, status_code=201)
def create_discount_preset(body: DiscountPresetWrite, key: Key, service: Service):
    return save_definition(service, "discount-presets", body, key)


@router.patch("/discount-presets/{id}", response_model=DiscountPresetRead)
def edit_discount_preset(id: UUID, body: DiscountPresetEdit, key: Key, service: Service):
    return save_definition(service, "discount-presets", body, key, id)


@router.post("/breakfast", response_model=BreakfastConfigurationRead)
def edit_breakfast_configuration(request: BreakfastConfiguration, key: Key, service: Service):
    return save_breakfast(service, request, key)


@router.post("/categories", response_model=CategoryRead, status_code=201)
def create_category(request: CategoryWrite, key: Key, service: Service):
    return save_definition(service, "categories", request, key)


@router.patch("/categories/{id}", response_model=CategoryRead)
def edit_category(id: UUID, request: CategoryEdit, key: Key, service: Service):
    return save_definition(service, "categories", request, key, id)


@router.post("/products", response_model=ProductRead, status_code=201)
def create_product(request: ProductWrite, key: Key, service: Service):
    return save_definition(service, "products", request, key)


@router.patch("/products/{id}", response_model=ProductRead)
def edit_product(id: UUID, request: ProductEdit, key: Key, service: Service):
    return save_definition(service, "products", request, key, id)


@router.post("/room-types", response_model=RoomTypeRead, status_code=201)
def create_room_type(request: RoomTypeWrite, key: Key, service: Service):
    return save_definition(service, "room-types", request, key)


@router.patch("/room-types/{id}", response_model=RoomTypeRead)
def edit_room_type(id: UUID, request: RoomTypeEdit, key: Key, service: Service):
    return save_definition(service, "room-types", request, key, id)


@router.post("/rooms", response_model=RoomRead, status_code=201)
def create_room(request: RoomWrite, key: Key, service: Service):
    return save_definition(service, "rooms", request, key)


@router.patch("/rooms/{id}", response_model=RoomRead)
def edit_room(id: UUID, request: RoomEdit, key: Key, service: Service):
    return save_definition(service, "rooms", request, key, id)


@router.post("/durations", response_model=DurationRead, status_code=201)
def create_duration(request: DurationWrite, key: Key, service: Service):
    return save_definition(service, "durations", request, key)


@router.patch("/durations/{id}", response_model=DurationRead)
def edit_duration(id: UUID, request: DurationEdit, key: Key, service: Service):
    return save_definition(service, "durations", request, key, id)


@router.post("/rates", response_model=RateRead, status_code=201)
def create_rate(request: RateWrite, key: Key, service: Service):
    return save_definition(service, "rates", request, key)


@router.patch("/rates/{id}", response_model=RateRead)
def edit_rate(id: UUID, request: RateEdit, key: Key, service: Service):
    return save_definition(service, "rates", request, key, id)
