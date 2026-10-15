"""Atomic draft capture and finalization; reservation writes stay in reservations."""

from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert

from app.errors import DomainError
from app.models import audit_events, billing_documents, document_counters, reservations
from app.modules.billing.documents_schemas import (
    BillCapture,
    DocumentRead,
    IndependentBillCapture,
    MultiBillCapture,
    capture_digest,
    document_from_saved,
)
from app.modules.reservations.services import ReservationService
from app.mutations import replay_or_lock, request_hash, save_receipt


class BillingDocumentService:
    def __init__(self, engine, context):
        self.engine, self.context = engine, context
        self.source = ReservationService(engine, context)

    def read_row(self, row):
        return DocumentRead.model_validate(dict(row))

    def get(self, id):
        with self.source.transaction() as session:
            return self.read_row(self.source.owned(session, billing_documents, id))

    def list(self, reservation_id, *, limit=100, offset=0):
        with self.source.transaction() as session:
            self.source.owned(session, reservations, reservation_id)
            rows = session.execute(
                sa.select(billing_documents)
                .where(
                    billing_documents.c.company_id == self.context.company_id,
                    billing_documents.c.reservation_id == reservation_id,
                )
                .order_by(billing_documents.c.created_at, billing_documents.c.id)
                .limit(limit)
                .offset(offset)
            ).mappings()
            return [self.read_row(row) for row in rows]

    def ensure_eligible(self, reservation):
        if reservation["status"] not in {"confirmed", "reserved", "checked_in", "checked_out"}:
            raise DomainError(
                "ineligible_billing_source",
                "Reservation state is not eligible for this billing slice",
                409,
            )

    def ensure_not_finalized(self, session, reservation_id):
        existing = session.scalar(
            sa.select(billing_documents.c.id)
            .where(
                billing_documents.c.company_id == self.context.company_id,
                billing_documents.c.reservation_id == reservation_id,
                billing_documents.c.status == "finalized",
            )
            .limit(1)
        )
        if existing:
            raise DomainError(
                "bill_already_finalized",
                "A finalized bill already exists; correction workflow is not implemented",
                409,
            )

    def audit(self, session, event, result, before=None):
        after = result.model_dump(mode="json")
        session.execute(
            audit_events.insert().values(
                id=uuid4(),
                company_id=self.context.company_id,
                reservation_id=result.reservation_id,
                event_type=event,
                reservation_version=result.source_reservation_version,
                actor=self.context.actor,
                attribution=self.context.attribution,
                occurred_at=sa.func.clock_timestamp(),
                before=before,
                after=after,
            )
        )

    def create(self, reservation_id, request, key):
        operation = "billing_document.create"
        digest = request_hash(request, resource_id=reservation_id)
        with self.source.transaction() as session:
            replay = replay_or_lock(session, self.context, operation, key, digest)
            if replay is not None:
                return document_from_saved(replay)
            reservation = self.source.owned(session, reservations, reservation_id, lock=True)
            if reservation["version"] != request.expected_reservation_version:
                raise DomainError(
                    "version_conflict", "Reservation changed; review before capturing a draft", 409
                )
            self.ensure_eligible(reservation)
            self.ensure_not_finalized(session, reservation_id)
            source = self.source.read_in_transaction(session, reservation)
            capture_type = (
                IndependentBillCapture
                if getattr(source, "stay_mode", None) == "independent"
                else MultiBillCapture
                if source.allocation is None
                else BillCapture
            )
            capture = capture_type(
                reservation_reference=source.reference,
                reservation_status=source.status,
                guest=source.guest,
                allocation_id=source.allocation.id if source.allocation else None,
                scheduled_start=source.allocation.scheduled_start
                if source.allocation
                else source.shared_start,
                scheduled_end=source.allocation.scheduled_end
                if source.allocation
                else source.shared_end,
                **(
                    {"allocations": tuple(a for a in source.allocations if a.removed_at is None)}
                    if source.allocation is None
                    else {}
                ),
                pricing=source.pricing,
            )
            row = (
                session.execute(
                    billing_documents.insert()
                    .values(
                        id=uuid4(),
                        company_id=self.context.company_id,
                        reservation_id=reservation_id,
                        source_pricing_id=source.pricing.id,
                        source_reservation_version=source.version,
                        currency="PHP",
                        total_minor=source.pricing.snapshot.total_minor,
                        capture=capture.model_dump(mode="json"),
                        capture_hash=capture_digest(capture),
                        created_by=self.context.actor,
                        attribution=self.context.attribution,
                        created_request_key=key,
                    )
                    .returning(billing_documents)
                )
                .mappings()
                .one()
            )
            result = self.read_row(row)
            self.audit(session, "billing_document.draft_created", result)
            save_receipt(
                session, self.context, operation, key, digest, result, reservation_id=reservation_id
            )
            return result  # Context manager must commit before returning to router.

    def finalize(self, id, request, key):
        operation = "billing_document.finalize"
        digest = request_hash(request, resource_id=id)
        with self.source.transaction() as session:
            replay = replay_or_lock(session, self.context, operation, key, digest)
            if replay is not None:
                return document_from_saved(replay)
            document = self.source.owned(session, billing_documents, id, lock=True, exclusive=True)
            if document["version"] != request.expected_version:
                raise DomainError("version_conflict", "Billing document version changed", 409)
            if document["status"] != "draft":
                raise DomainError(
                    "document_finalized", "Finalized documents cannot be changed or reopened", 409
                )
            # Exclusive source lock serializes separate drafts and all reservation mutations.
            reservation = self.source.owned(
                session, reservations, document["reservation_id"], lock=True, exclusive=True
            )
            self.ensure_eligible(reservation)
            self.ensure_not_finalized(session, reservation["id"])
            current = self.source.read_in_transaction(session, reservation)
            if (
                current.version != document["source_reservation_version"]
                or current.pricing.id != document["source_pricing_id"]
            ):
                raise DomainError(
                    "stale_billing_source",
                    "Reservation changed after draft capture; review and create a new draft",
                    409,
                )
            before = self.read_row(document)
            if current.pricing != before.capture.pricing:
                raise DomainError(
                    "stale_billing_source", "Captured source pricing requires review", 409
                )
            # Transactional counter, not nextval(): failures roll back numbering with the document.
            session.execute(
                insert(document_counters)
                .values(company_id=self.context.company_id)
                .on_conflict_do_nothing()
            )
            number = session.scalar(
                document_counters.update()
                .where(
                    document_counters.c.company_id == self.context.company_id,
                    document_counters.c.next_number < 9007199254740991,
                )
                .values(next_number=document_counters.c.next_number + 1)
                .returning(document_counters.c.next_number)
            )
            if number is None:
                raise DomainError(
                    "document_number_exhausted", "Document numbering requires review", 409
                )
            row = (
                session.execute(
                    billing_documents.update()
                    .where(
                        billing_documents.c.id == id,
                        billing_documents.c.company_id == self.context.company_id,
                        billing_documents.c.version == request.expected_version,
                        billing_documents.c.status == "draft",
                    )
                    .values(
                        status="finalized",
                        version=2,
                        number=f"HMS-BILL-{number - 1:08d}",
                        finalized_at=sa.func.clock_timestamp(),
                        finalized_by=self.context.actor,
                        finalized_request_key=key,
                    )
                    .returning(billing_documents)
                )
                .mappings()
                .one()
            )
            result = self.read_row(row)
            self.audit(
                session, "billing_document.finalized", result, before.model_dump(mode="json")
            )
            save_receipt(
                session,
                self.context,
                operation,
                key,
                digest,
                result,
                reservation_id=result.reservation_id,
            )
            return result
