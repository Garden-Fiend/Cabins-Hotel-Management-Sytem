"""Versioned source identities and demo-compatible commercial agreement commands."""

import hashlib
import re
from datetime import date, datetime
from typing import Literal
from uuid import UUID, uuid4

import sqlalchemy as sa
from pydantic import Field, StrictBool, field_validator, model_validator
from sqlalchemy.exc import IntegrityError

from app.errors import DomainError
from app.models import agreements, audit_events, booking_sources
from app.modules.reservations.schemas import DTO, Minor, Positive
from app.mutations import replay_or_lock, request_hash, save_receipt


class SourceWrite(DTO):
    label: str = Field(min_length=1, max_length=200)
    classification: Literal["direct", "ota", "corporate", "agent", "other"] = "other"
    enabled: StrictBool = True
    reference_required: StrictBool = False
    notes: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def trim_label(self):
        self.label = self.label.strip()
        if not self.label:
            raise ValueError("Source name is required")
        return self


class SourceEdit(SourceWrite):
    expected_version: Positive


class SourceRead(SourceWrite):
    initial_label: str | None = None
    id: UUID
    source_id: str
    version: Positive
    agreement_version: int = 0


class PricingTerms(DTO):
    allowOverride: StrictBool = False
    reasonRequired: StrictBool = True


class CommissionTerms(DTO):
    method: Literal["none", "percentage", "fixed", "manual"] = "none"
    basis: Literal["confirmed_accommodation", "reference_value", "explicit_amount"] = (
        "confirmed_accommodation"
    )
    rateBasisPoints: int = Field(default=0, strict=True, ge=0, le=10000)
    fixedMinor: Minor = 0
    allowOverride: StrictBool = False


class PaymentTerms(DTO):
    collection: Literal["hotel", "channel", "per_reservation"] = "hotel"


class SettlementTerms(DTO):
    method: Literal["deducted", "separate_invoice", "offset", "manual"] = "manual"


class CommercialTerms(DTO):
    pricing: PricingTerms
    commission: CommissionTerms
    payment: PaymentTerms
    settlement: SettlementTerms


class AgreementWrite(DTO):
    expected_source_version: Positive
    expected_agreement_version: int = Field(strict=True, ge=0)
    effective_from: date
    effective_to: date | None = None
    status: Literal["draft", "active", "retired"] = "draft"
    currency: Literal["PHP"] = "PHP"
    terms: CommercialTerms

    @field_validator("effective_from", "effective_to", mode="before")
    @classmethod
    def hotel_dates(cls, value):
        if value is None or type(value) is date:
            return value
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("Use a hotel calendar date in YYYY-MM-DD format")
        return value

    @model_validator(mode="after")
    def dates(self):
        if self.effective_to is not None and self.effective_to < self.effective_from:
            raise ValueError("End date must be on or after start date")
        return self


class AgreementEdit(AgreementWrite):
    expected_version: Positive


class AgreementRead(DTO):
    company_id: UUID
    id: UUID
    source_id: UUID
    revision: Positive
    version: Positive
    effective_from: date
    effective_to: date | None
    status: Literal["draft", "active", "retired"]
    currency: Literal["PHP"]
    terms: CommercialTerms
    created_at: datetime
    actor: str


def agreement_version(session, identity):
    # Shared source row locks for reads; exclusive source lock serializes all agreement writers.
    return session.scalar(
        sa.select(sa.func.coalesce(sa.func.sum(agreements.c.version), 0)).where(
            agreements.c.source_id == identity
        )
    )


def source_read(session, row):
    return SourceRead(
        **{k: row[k] for k in SourceRead.model_fields if k != "agreement_version"},
        agreement_version=agreement_version(session, row["id"]),
    )


def list_agreements(service, identity, effective_on=None):
    with service.transaction() as session:
        service.owned(session, booking_sources, identity, lock=True)
        query = sa.select(agreements).where(
            agreements.c.source_id == identity,
            agreements.c.company_id == service.context.company_id,
        )
        if effective_on is not None:
            query = query.where(
                agreements.c.status == "active",
                agreements.c.effective_from <= effective_on,
                sa.or_(
                    agreements.c.effective_to.is_(None), agreements.c.effective_to >= effective_on
                ),
            )
        return [
            AgreementRead.model_validate(r)
            for r in session.execute(query.order_by(agreements.c.revision)).mappings()
        ]


def audit(session, service, operation, before, after):
    session.execute(
        audit_events.insert().values(
            id=uuid4(),
            company_id=service.context.company_id,
            event_type=operation,
            actor=service.context.actor,
            attribution=service.context.attribution,
            occurred_at=sa.func.clock_timestamp(),
            before=before,
            after=after,
        )
    )


def save_source(service, request, key, identity=None):
    operation = "configuration.sources." + ("update" if identity else "create")
    digest = request_hash(request, resource_id=identity)
    try:
        with service.transaction() as session:
            replay = replay_or_lock(session, service.context, operation, key, digest)
            if replay is not None:
                return SourceRead.model_validate(replay)
            previous = (
                service.owned(session, booking_sources, identity, lock=True, exclusive=True)
                if identity
                else None
            )
            if previous and previous["version"] != request.expected_version:
                raise DomainError(
                    "version_conflict", "Source changed; reload and review your draft"
                )
            if previous and previous["classification"] != request.classification:
                from app.models import reservations

                if session.scalar(
                    sa.select(reservations.c.id)
                    .where(reservations.c.booking_source_id == identity)
                    .limit(1)
                ):
                    raise DomainError(
                        "source_in_use",
                        "A source used by reservations cannot change classification",
                    )
            values = request.model_dump(exclude={"expected_version"})
            if previous:
                if previous["version"] >= 2**31 - 1:
                    raise DomainError("version_exhausted", "Source version exhausted")
                values.update(
                    version=previous["version"] + 1,
                    initial_label=previous["initial_label"] or previous["label"],
                )
                statement = (
                    booking_sources.update()
                    .where(booking_sources.c.id == identity)
                    .values(**values)
                )
            else:
                identity = uuid4()
                statement = booking_sources.insert().values(
                    id=identity,
                    company_id=service.context.company_id,
                    source_id=f"local-{identity}",
                    initial_label=values["label"],
                    **values,
                )
            row = session.execute(statement.returning(booking_sources)).mappings().one()
            result = source_read(session, row)
            audit(
                session,
                service,
                operation,
                source_read(session, previous).model_dump(mode="json") if previous else None,
                result.model_dump(mode="json"),
            )
            save_receipt(session, service.context, operation, key, digest, result)
            return result
    except IntegrityError as error:
        raise DomainError(
            "duplicate_definition", "A source with this name already exists"
        ) from error


def save_agreement(service, source_id, request, key, identity=None):
    operation = "configuration.agreements." + ("update" if identity else "create")
    digest = hashlib.sha256(
        f"{source_id}:{request_hash(request, resource_id=identity or source_id)}".encode()
    ).hexdigest()
    try:
        with service.transaction() as session:
            replay = replay_or_lock(session, service.context, operation, key, digest)
            if replay is not None:
                return AgreementRead.model_validate(replay)
            source = service.owned(session, booking_sources, source_id, lock=True, exclusive=True)
            if (
                source["version"] != request.expected_source_version
                or agreement_version(session, source_id) != request.expected_agreement_version
            ):
                raise DomainError(
                    "version_conflict",
                    "Source or agreement history changed; reload and review your draft",
                )
            previous = (
                service.owned(session, agreements, identity, lock=True, exclusive=True)
                if identity
                else None
            )
            if previous and previous["source_id"] != source_id:
                raise DomainError("not_found", "Agreement not found", 404)
            if previous and previous["version"] != request.expected_version:
                raise DomainError(
                    "version_conflict", "Agreement changed; reload and review your draft"
                )
            terms = request.terms.model_dump(mode="json")
            if (
                previous
                and previous["status"] != "draft"
                and (
                    previous["terms"] != terms
                    or previous["currency"] != request.currency
                    or request.status == "draft"
                )
            ):
                raise DomainError(
                    "published_agreement",
                    "Published rules are immutable; create a new agreement version",
                )
            if request.status == "active":
                overlap = session.scalar(
                    sa.select(agreements.c.id)
                    .where(
                        agreements.c.source_id == source_id,
                        agreements.c.status == "active",
                        agreements.c.id != identity if identity else sa.true(),
                        sa.func.daterange(
                            agreements.c.effective_from, agreements.c.effective_to, "[]"
                        ).op("&&")(
                            sa.func.daterange(request.effective_from, request.effective_to, "[]")
                        ),
                    )
                    .limit(1)
                )
                if overlap:
                    raise DomainError(
                        "agreement_overlap",
                        "Active agreement dates overlap; end the previous inclusive range first",
                    )
            values = dict(
                effective_from=request.effective_from,
                effective_to=request.effective_to,
                status=request.status,
                currency=request.currency,
                terms=terms,
            )
            if previous:
                if previous["version"] >= 2**31 - 1:
                    raise DomainError("version_exhausted", "Agreement version exhausted")
                statement = (
                    agreements.update()
                    .where(agreements.c.id == identity)
                    .values(**values, version=previous["version"] + 1)
                )
            else:
                revision = session.scalar(
                    sa.select(sa.func.coalesce(sa.func.max(agreements.c.revision), 0) + 1).where(
                        agreements.c.source_id == source_id
                    )
                )
                statement = agreements.insert().values(
                    id=uuid4(),
                    company_id=service.context.company_id,
                    source_id=source_id,
                    revision=revision,
                    actor=service.context.actor,
                    **values,
                )
            row = session.execute(statement.returning(agreements)).mappings().one()
            result = AgreementRead.model_validate(row)
            audit(
                session,
                service,
                operation,
                AgreementRead.model_validate(previous).model_dump(mode="json")
                if previous
                else None,
                result.model_dump(mode="json"),
            )
            save_receipt(session, service.context, operation, key, digest, result)
            return result
    except IntegrityError as error:
        raise DomainError(
            "agreement_conflict",
            "Agreement violates an ownership, history or effective-period constraint",
        ) from error
