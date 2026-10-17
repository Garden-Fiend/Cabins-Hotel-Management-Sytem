"""Resolve owned definitions and persist exact commercial provenance inside existing commands."""

from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa

from app.errors import DomainError
from app.models import agreements, booking_financial_captures, reservations
from app.modules.reservations.booking_financials import (
    BookingFinancialIntent,
    CapturedBookingTerms,
    calculate_financials,
)
from app.modules.reservations.booking_financials import apply_capture as apply_capture


def prepare_capture(
    service,
    session,
    source,
    intent,
    snapshot,
    *,
    version=1,
    reason="Initial capture",
    previous=None,
):
    if intent is None:
        if source["classification"] != "direct" or source["reference_required"]:
            raise DomainError(
                "booking_financials_required", "Capture this source's booking facts", 422
            )
        return None
    if source["version"] != intent.expected_source_version:
        raise DomainError("source_version_conflict", "Source changed; reload and review its terms")
    if source["reference_required"] and not intent.external_reference:
        raise DomainError(
            "external_reference_required", "Enter the external booking reference", 422
        )
    retained = previous and (
        previous["source_id"] == str(source["id"])
        and previous["input"]["confirmation_date"] == intent.confirmation_date.isoformat()
        and previous["agreement_id"]
        == (str(intent.expected_agreement_id) if intent.expected_agreement_id else None)
        and previous["agreement_version"] == intent.expected_agreement_version
    )
    if retained:
        # A correction of booked facts does not silently replace the original contract, even
        # after its definition retires or another agreement is published for future selection.
        terms = (
            previous["terms"]
            if previous["agreement_id"]
            else intent.manual_terms or previous["terms"]
        )
        if previous["agreement_id"] is None and not intent.manual_reason:
            raise DomainError(
                "manual_arrangement_required", "Retain a reason for manually specified terms", 422
            )
        try:
            figures = calculate_financials(
                snapshot.model_dump(mode="json"),
                intent,
                terms,
                historical=intent.contractual_accommodation_minor
                == previous["figures"]["contractual_accommodation_minor"],
            )
        except ValueError as error:
            raise DomainError("invalid_booking_financials", str(error), 422) from None
        inputs = intent.model_copy(
            update={
                "contractual_accommodation_minor": figures["contractual_accommodation_minor"],
                "manual_terms": None if previous["agreement_id"] else terms,
            }
        )
        return CapturedBookingTerms.model_validate(
            {
                **previous,
                "id": uuid4(),
                "source_label": source["label"],
                "classification": source["classification"],
                "captured_at": datetime.now(UTC),
                "actor": service.context.actor,
                "reservation_version": version,
                "reason": reason,
                "input": inputs,
                "terms": terms,
                "figures": figures,
            }
        ).model_dump(mode="json")
    candidates = list(
        session.execute(
            sa.select(agreements).where(
                agreements.c.source_id == source["id"],
                agreements.c.company_id == service.context.company_id,
                agreements.c.status == "active",
                agreements.c.effective_from <= intent.confirmation_date,
                sa.or_(
                    agreements.c.effective_to.is_(None),
                    agreements.c.effective_to >= intent.confirmation_date,
                ),
            )
        ).mappings()
    )
    if len(candidates) > 1:
        raise DomainError(
            "agreement_integrity", "Applicable agreements overlap; review configuration"
        )
    selected = candidates[0] if candidates else None
    if selected:
        if (selected["id"], selected["version"]) != (
            intent.expected_agreement_id,
            intent.expected_agreement_version,
        ):
            raise DomainError(
                "agreement_version_conflict", "Applicable agreement changed; review before saving"
            )
        if intent.manual_terms is not None:
            raise DomainError("invalid_arrangement", "Use the applicable published agreement", 422)
        terms = selected["terms"]
    else:
        if intent.expected_agreement_id is not None:
            raise DomainError(
                "agreement_not_applicable", "No published agreement covers the confirmation date"
            )
        if intent.manual_terms is None or not intent.manual_reason:
            raise DomainError(
                "manual_arrangement_required",
                "No agreement applies; specify terms and a reason",
                422,
            )
        terms = intent.manual_terms
    raw = snapshot.model_dump(mode="json")
    try:
        figures = calculate_financials(raw, intent, terms)
    except ValueError as error:
        raise DomainError("invalid_booking_financials", str(error), 422) from None
    # Freeze the resolved contractual amount, including when the user kept standard hotel pricing.
    inputs = intent.model_copy(
        update={"contractual_accommodation_minor": figures["contractual_accommodation_minor"]}
    )
    return CapturedBookingTerms(
        id=uuid4(),
        source_id=source["id"],
        source_label=source["label"],
        classification=source["classification"],
        agreement_id=selected["id"] if selected else None,
        agreement_revision=selected["revision"] if selected else None,
        agreement_version=selected["version"] if selected else None,
        agreement_effective_from=selected["effective_from"] if selected else None,
        agreement_effective_to=selected["effective_to"] if selected else None,
        provenance="published_agreement" if selected else "manual_arrangement",
        captured_at=datetime.now(UTC),
        actor=service.context.actor,
        reservation_version=version,
        reason=reason,
        input=inputs,
        terms=terms,
        figures=figures,
    ).model_dump(mode="json")


def persist_capture(service, session, reservation_id, capture):
    if capture is None:
        return
    session.execute(
        booking_financial_captures.insert().values(
            id=capture["id"],
            company_id=service.context.company_id,
            reservation_id=reservation_id,
            source_id=capture["source_id"],
            agreement_id=capture["agreement_id"],
            reservation_version=capture["reservation_version"],
            confirmation_date=BookingFinancialIntent.model_validate(
                capture["input"]
            ).confirmation_date,
            captured_at=datetime.fromisoformat(capture["captured_at"]),
            snapshot=capture,
        )
    )


def check_reference(service, session, source_id, reference, reservation_id=None):
    if (
        reference
        and session.scalar(
            sa.select(reservations.c.id)
            .where(
                reservations.c.company_id == service.context.company_id,
                reservations.c.booking_source_id == source_id,
                reservations.c.external_booking_reference == reference,
                reservations.c.id != reservation_id if reservation_id else sa.true(),
            )
            .limit(1)
        )
        is not None
    ):
        raise DomainError(
            "duplicate_external_reference", "This source already has that booking reference"
        )
