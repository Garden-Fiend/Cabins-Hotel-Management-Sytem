from uuid import UUID

from fastapi import APIRouter

from app.modules.configuration.schemas import (
    CategoryEdit,
    CategoryRead,
    CategoryWrite,
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
from app.modules.reservations.references import DurationRead, RateRead, RoomRead, RoomTypeRead
from app.modules.reservations.router import Key, Service

router = APIRouter(prefix="/api/v1/configuration", tags=["local-development configuration"])


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
