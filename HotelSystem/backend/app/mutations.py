"""Request replay infrastructure shared by concrete local-development commands."""

import hashlib
import json
from uuid import UUID, uuid4

import sqlalchemy as sa

from app.context import CommandContext
from app.errors import DomainError
from app.models import mutation_receipts


def request_hash(body, *, resource_id: UUID | None = None, exclude_fields=frozenset()) -> str:
    # New optional discount input must not alter previously committed command hashes.
    if "discounts" in type(body).model_fields and "discounts" not in body.model_fields_set:
        exclude_fields = set(exclude_fields) | {"discounts"}
    if type(body).__name__ == "ReservationCreate":
        for optional in ("charges", "adjustments"):
            if optional not in body.model_fields_set:
                exclude_fields = set(exclude_fields) | {optional}
    for optional in (
        "inclusions",
        "default_inclusions",
        "breakfast",
        "booking_financials",
        "collections",
        "guest_obligation",
    ):
        if optional in type(body).model_fields and optional not in body.model_fields_set:
            exclude_fields = set(exclude_fields) | {optional}
    if type(body).__name__.startswith("DiscountPreset"):
        for optional in ("rate_prices", "replacement_unit_amount_minor"):
            if optional not in body.model_fields_set:
                exclude_fields = set(exclude_fields) | {optional}
    payload = body.model_dump(mode="json", exclude=exclude_fields)
    if type(body).__name__ in ("MultiCreate", "MultiEdit"):
        for intent, value in zip(body.allocations, payload["allocations"], strict=True):
            if "stay" not in intent.model_fields_set:
                value.pop("stay", None)
    # Adding preset support must preserve hashes of existing manual-discount requests.
    for discount in payload.get("discounts", []):
        if discount.get("preset_id") is None:
            discount.pop("preset_id", None)
    if resource_id is not None:
        payload = {"resource_id": str(resource_id), "body": payload}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def replay_or_lock(session, context: CommandContext, operation: str, key: UUID, digest: str):
    # Transaction-scoped, stable across processes/restarts. A hash collision only serializes
    # unrelated requests; it never makes their full UUID receipt keys equal.
    identity = f"{context.company_id}:{operation}:{key}".encode()
    lock_id = int.from_bytes(hashlib.blake2b(identity, digest_size=8).digest(), "big", signed=True)
    session.execute(sa.select(sa.func.pg_advisory_xact_lock(lock_id)))
    receipt = (
        session.execute(
            sa.select(mutation_receipts).where(
                mutation_receipts.c.company_id == context.company_id,
                mutation_receipts.c.operation == operation,
                mutation_receipts.c.request_key == key,
            )
        )
        .mappings()
        .one_or_none()
    )
    if receipt is not None:
        if receipt["request_hash"] != digest:
            raise DomainError("idempotency_conflict", "This key was used for a different request")
        return receipt["response"]
    return None


def save_receipt(session, context, operation, key, digest, result, reservation_id=None):
    # Concrete billing invariant: pricing/basis changes compensate obsolete payment allocations
    # before receipt commit. Existing reservation/document locks remain authoritative.
    if reservation_id is not None:
        from app.modules.billing.payment_allocations import events, synchronize

        before = session.scalar(
            sa.select(sa.func.count())
            .select_from(events)
            .where(
                events.c.reservation_id == reservation_id, events.c.company_id == context.company_id
            )
        )
        synchronize(session, context, reservation_id)
        after = session.scalar(
            sa.select(sa.func.count())
            .select_from(events)
            .where(
                events.c.reservation_id == reservation_id, events.c.company_id == context.company_id
            )
        )
        if (
            after != before
            and getattr(result, "id", None) == reservation_id
            and hasattr(result, "audit")
        ):
            from app.models import reservations
            from app.modules.reservations.services import ReservationService

            service = ReservationService(session.bind, context)
            parent = service.owned(session, reservations, reservation_id)
            result.audit = service.read_in_transaction(session, parent).audit
    session.execute(
        mutation_receipts.insert().values(
            id=uuid4(),
            company_id=context.company_id,
            operation=operation,
            request_key=key,
            request_hash=digest,
            response=result.model_dump(mode="json"),
            reservation_id=reservation_id,
        )
    )
