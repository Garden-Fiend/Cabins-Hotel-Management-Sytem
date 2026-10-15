"""Operational billing documents, not tax invoices or accounting postings."""

import hashlib
import json
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, ConfigDict, computed_field, model_validator

from app.modules.reservations.multi_schemas import IndependentAllocationRead, MultiAllocationRead
from app.modules.reservations.schemas import DTO, GuestRead, Minor, Positive, PricingRead


class DraftCreate(DTO):
    expected_reservation_version: Positive


class DocumentFinalize(DTO):
    expected_version: Positive


class BillCapture(DTO):
    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal[1] = 1
    reservation_reference: str
    reservation_status: str
    guest: GuestRead
    allocation_id: UUID
    scheduled_start: AwareDatetime
    scheduled_end: AwareDatetime
    pricing: PricingRead


class MultiBillCapture(BillCapture):
    schema_version: Literal[2] = 2
    allocation_id: None = None
    allocations: tuple[MultiAllocationRead, ...]


class IndependentBillCapture(MultiBillCapture):
    schema_version: Literal[3] = 3
    allocations: tuple[IndependentAllocationRead, ...]


class DocumentLine(DTO):
    source_line_id: str
    source_kind: Literal["accommodation", "purchase", "extra_charge"]
    source_id: UUID
    label: str
    quantity: Positive
    original_unit_amount_minor: Minor
    effective_unit_amount_minor: Minor
    original_amount_minor: Minor
    effective_amount_minor: Minor
    discount_minor: Minor
    final_amount_minor: Minor


def capture_digest(capture: BillCapture):
    encoded = json.dumps(capture.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


class DocumentRead(DTO):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: UUID
    company_id: UUID
    reservation_id: UUID
    source_pricing_id: UUID
    source_reservation_version: Positive
    document_type: Literal["operational_bill"]
    status: Literal["draft", "finalized"]
    number: str | None
    currency: Literal["PHP"]
    total_minor: Minor
    capture: BillCapture | MultiBillCapture | IndependentBillCapture
    capture_hash: str
    version: Positive
    created_at: AwareDatetime
    finalized_at: AwareDatetime | None
    created_by: str
    finalized_by: str | None
    attribution: Literal["local_development"]
    created_request_key: UUID
    finalized_request_key: UUID | None

    @model_validator(mode="after")
    def consistent_capture(self):
        if (
            self.capture_hash != capture_digest(self.capture)
            or self.total_minor != self.capture.pricing.snapshot.total_minor
            or self.source_pricing_id != self.capture.pricing.id
            or self.capture.guest.company_id != self.company_id
            or self.capture.pricing.reservation_version > self.source_reservation_version
        ):
            raise ValueError("Billing capture provenance and totals must match")
        return self

    @computed_field
    @property
    def lines(self) -> list[DocumentLine]:
        """Stable projection of saved results only; never price from current configuration."""
        snapshot = self.capture.pricing.snapshot.model_dump(mode="json")
        overrides = {o["line_id"]: o for o in snapshot.get("price_overrides", [])}
        reductions = {}
        for discount in snapshot.get("discounts", []):
            for allocation in discount["allocations"]:
                identity = allocation["line_id"]
                reductions[identity] = reductions.get(identity, 0) + allocation["amount_minor"]
        result = []
        for original in [*snapshot["lines"], *snapshot.get("charges", [])]:
            accommodation = original.get("kind") == "accommodation"
            identity = f"room:{original['room_id']}" if accommodation else original["id"]
            unit = overrides.get(identity, {}).get(
                "replacement_unit_amount_minor", original["unit_amount_minor"]
            )
            result.append(
                DocumentLine(
                    source_line_id=identity,
                    source_kind="accommodation" if accommodation else original["usage"],
                    source_id=original["rate_id"] if accommodation else original["product_id"],
                    label=f"Room {original['room_number']} - {original['room_type_label']}"
                    if accommodation
                    else original["label"],
                    quantity=original["quantity"],
                    original_unit_amount_minor=original["unit_amount_minor"],
                    effective_unit_amount_minor=unit,
                    original_amount_minor=original["amount_minor"],
                    effective_amount_minor=unit * original["quantity"],
                    discount_minor=reductions.get(identity, 0),
                    final_amount_minor=unit * original["quantity"] - reductions.get(identity, 0),
                )
            )
        return result


def document_from_saved(value):
    # Computed read projections are included in durable receipts, not authoritative inputs.
    return DocumentRead.model_validate({k: v for k, v in value.items() if k != "lines"})
