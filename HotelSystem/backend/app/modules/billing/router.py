from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query

from app.context import get_command_context
from app.db import get_engine
from app.modules.billing.documents import BillingDocumentService
from app.modules.billing.documents_schemas import DocumentFinalize, DocumentRead, DraftCreate

router = APIRouter(prefix="/api/v1", tags=["operational billing documents"])
Key = Annotated[UUID, Header(alias="Idempotency-Key")]


def get_service(engine=Depends(get_engine), context=Depends(get_command_context)):
    return BillingDocumentService(engine, context)


Service = Annotated[BillingDocumentService, Depends(get_service)]


@router.post(
    "/reservations/{reservation_id}/billing-documents", response_model=DocumentRead, status_code=201
)
def create(reservation_id: UUID, request: DraftCreate, key: Key, service: Service):
    return service.create(reservation_id, request, key)


@router.get("/reservations/{reservation_id}/billing-documents", response_model=list[DocumentRead])
def list_documents(
    reservation_id: UUID,
    service: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return service.list(reservation_id, limit=limit, offset=offset)


@router.get("/billing-documents/{id}", response_model=DocumentRead)
def get(id: UUID, service: Service):
    return service.get(id)


@router.post("/billing-documents/{id}/finalize", response_model=DocumentRead)
def finalize(id: UUID, request: DocumentFinalize, key: Key, service: Service):
    return service.finalize(id, request, key)
