from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query

from app.context import get_command_context
from app.db import get_engine
from app.modules.billing.adjustments import save_adjustments
from app.modules.reservations.lifecycle import transition
from app.modules.reservations.multi import save_multi
from app.modules.reservations.multi_lifecycle import transition_multi
from app.modules.reservations.multi_schemas import (
    IndependentRead,
    MultiCreate,
    MultiEdit,
    MultiLifecycle,
    MultiRead,
)
from app.modules.reservations.readiness import set_readiness
from app.modules.reservations.references import ReferenceRead, RoomRead, read_references
from app.modules.reservations.schemas import (
    CancellationCommand,
    GuestCreate,
    GuestRead,
    LifecycleCommand,
    ReservationBillingEdit,
    ReservationBreakfastEdit,
    ReservationChargesEdit,
    ReservationCreate,
    ReservationDetailsEdit,
    ReservationDiscountsEdit,
    ReservationEdit,
    ReservationInclusionsEdit,
    ReservationRead,
    ReservationStayChargesEdit,
    ReservationStayEdit,
    RoomReadinessCommand,
)
from app.modules.reservations.services import ReservationService
from app.modules.reservations.stay_edit import edit_stay

router = APIRouter(prefix="/api/v1", tags=["local-development reservations"])
Key = Annotated[UUID, Header(alias="Idempotency-Key")]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


def get_service(engine=Depends(get_engine), context=Depends(get_command_context)):
    return ReservationService(engine, context)


Service = Annotated[ReservationService, Depends(get_service)]


@router.get("/reference-data", response_model=ReferenceRead)
def reference_data(service: Service):
    return read_references(service)


@router.post("/guests", response_model=GuestRead, status_code=201)
def create_guest(request: GuestCreate, key: Key, service: Service):
    return service.create_guest(request, key)


@router.get("/guests", response_model=list[GuestRead])
def guests(
    service: Service,
    limit: Limit = 100,
    offset: Offset = 0,
    search: Annotated[str, Query(max_length=200)] = "",
):
    return service.list_guests(limit=limit, offset=offset, search=search)


@router.post("/reservations", response_model=ReservationRead, status_code=201)
def create_reservation(request: ReservationCreate, key: Key, service: Service):
    return service.create(request, key)


@router.get("/reservations", response_model=list[ReservationRead | MultiRead | IndependentRead])
def reservations(service: Service, limit: Limit = 100, offset: Offset = 0):
    return service.list(limit=limit, offset=offset)


@router.get("/reservations/{id}", response_model=ReservationRead | MultiRead | IndependentRead)
def reservation(id: UUID, service: Service):
    return service.get(id)


@router.patch("/reservations/{id}", response_model=ReservationRead)
def patch_reservation(id: UUID, request: ReservationEdit, key: Key, service: Service):
    return service.patch(id, request, key)


@router.post("/reservations/{id}/edit-details", response_model=ReservationRead)
def edit_details(id: UUID, request: ReservationDetailsEdit, key: Key, service: Service):
    return service.patch(id, request, key, details=True)


@router.post("/reservations/{id}/edit-charges", response_model=ReservationRead)
def change_purchases(id: UUID, request: ReservationChargesEdit, key: Key, service: Service):
    return save_adjustments(service, id, request, key, purchases=True)


@router.post("/reservations/{id}/edit-stay-charges", response_model=ReservationRead)
def change_stay_purchases(
    id: UUID, request: ReservationStayChargesEdit, key: Key, service: Service
):
    return edit_stay(service, id, request, key)


@router.post("/reservations/{id}/edit-discounts", response_model=ReservationRead)
def change_discounts(id: UUID, request: ReservationDiscountsEdit, key: Key, service: Service):
    return save_adjustments(service, id, request, key, discounts=True)


@router.post("/reservations/{id}/edit-inclusions", response_model=ReservationRead)
def change_inclusions(id: UUID, request: ReservationInclusionsEdit, key: Key, service: Service):
    return save_adjustments(service, id, request, key, inclusions=True)


@router.post("/reservations/{id}/edit-breakfast", response_model=ReservationRead)
def change_breakfast(id: UUID, request: ReservationBreakfastEdit, key: Key, service: Service):
    return save_adjustments(service, id, request, key, breakfast=True)


@router.post("/reservations/{id}/edit-billing", response_model=ReservationRead)
def change_billing(id: UUID, request: ReservationBillingEdit, key: Key, service: Service):
    return save_adjustments(service, id, request, key)


@router.post("/reservations/{id}/edit-stay", response_model=ReservationRead)
def change_stay(id: UUID, request: ReservationStayEdit, key: Key, service: Service):
    return edit_stay(service, id, request, key)


@router.post("/reservations/{id}/check-in", response_model=ReservationRead)
def check_in(id: UUID, request: LifecycleCommand, key: Key, service: Service):
    return transition(service, id, "check_in", request, key)


@router.post("/reservations/{id}/check-out", response_model=ReservationRead)
def check_out(id: UUID, request: LifecycleCommand, key: Key, service: Service):
    return transition(service, id, "check_out", request, key)


@router.post("/reservations/{id}/cancel", response_model=ReservationRead)
def cancel(id: UUID, request: CancellationCommand, key: Key, service: Service):
    return transition(service, id, "cancel", request, key)


@router.post("/reservations/{id}/no-show", response_model=ReservationRead)
def no_show(id: UUID, request: LifecycleCommand, key: Key, service: Service):
    return transition(service, id, "no_show", request, key)


@router.post("/reservations/{id}/record-departure", response_model=ReservationRead)
def record_departure(id: UUID, request: LifecycleCommand, key: Key, service: Service):
    return transition(service, id, "record_departure", request, key)


@router.post("/rooms/{id}/readiness", response_model=RoomRead)
def room_readiness(id: UUID, request: RoomReadinessCommand, key: Key, service: Service):
    return set_readiness(service, id, request, key)


@router.post(
    "/multi-room-reservations", response_model=MultiRead | IndependentRead, status_code=201
)
def create_multi(request: MultiCreate, key: Key, service: Service):
    return save_multi(service, request, key)


@router.post("/reservations/{id}/edit-allocations", response_model=MultiRead | IndependentRead)
def edit_allocations(id: UUID, request: MultiEdit, key: Key, service: Service):
    return save_multi(service, request, key, id)


@router.post(
    "/reservations/{id}/room-lifecycle/{action}", response_model=MultiRead | IndependentRead
)
def room_lifecycle(id: UUID, action: str, request: MultiLifecycle, key: Key, service: Service):
    return transition_multi(service, id, action.replace("-", "_"), request, key)
