"""B7 intents: positive exact PHP amounts, explicit evidence and coverage component."""

import unicodedata
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
    model_validator,
)

MAX_MINOR = 2**53 - 1
Money = Annotated[StrictInt, Field(ge=0, le=MAX_MINOR)]
Version = Annotated[StrictInt, Field(ge=1, le=2**31 - 1)]


class CollectionDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ObligationIntent(CollectionDTO):
    status: Literal["known", "unknown"]
    accommodation_minor: Money | None = None
    evidence: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def valid(self):
        if (self.status == "known") != (self.accommodation_minor is not None):
            raise ValueError("Known obligation requires an amount; unknown must omit it")
        if not self.evidence.strip():
            raise ValueError("Review evidence is required")
        return self


class CollectionIntent(CollectionDTO):
    kind: Literal["collection", "refund", "reversal"] = "collection"
    collector: Literal["hotel", "channel"]
    component: Literal["accommodation", "hotel_charges"]
    amount_minor: Annotated[StrictInt, Field(gt=0, le=MAX_MINOR)]
    currency: Literal["PHP"] = "PHP"
    payment_method: str | None = Field(default=None, min_length=1, max_length=50)
    reference: str = Field(default="", max_length=200)
    declaration: Literal["partial", "confirmed"]
    source_id: UUID | None = None
    capture_id: UUID | None = None
    related_transaction_id: UUID | None = None
    reason: str = Field(default="", max_length=1000)
    duplicate_token: str | None = Field(default=None, max_length=64)
    duplicate_acknowledged: StrictBool = False
    duplicate_justification: str = Field(default="", max_length=1000)

    @field_validator("reference", "payment_method")
    @classmethod
    def clean_evidence(cls, value):
        if value is not None and any(unicodedata.category(c).startswith("C") for c in value):
            raise ValueError("Evidence cannot contain control characters")
        if value is not None and value and not value.strip():
            raise ValueError("Use a nonblank value or omit it")
        return value

    @field_validator("payment_method")
    @classmethod
    def normalized_method(cls, value):
        return value.strip().casefold() if value is not None else None

    @model_validator(mode="after")
    def valid(self):
        if self.collector == "hotel":
            if not self.payment_method or not self.payment_method.strip():
                raise ValueError("Hotel collection requires a payment method")
            if self.payment_method.strip().casefold() != "cash" and not self.reference.strip():
                raise ValueError("Electronic hotel payments require a reference")
        elif not self.reference.strip() or self.component != "accommodation":
            raise ValueError("Channel evidence is required and covers accommodation only")
        if self.kind == "collection" and self.related_transaction_id is not None:
            raise ValueError("A collection cannot correct another record")
        if self.kind != "collection" and (
            self.related_transaction_id is None or not self.reason.strip()
        ):
            raise ValueError("Correction requires original collection and reason")
        if self.duplicate_acknowledged and not self.duplicate_justification.strip():
            raise ValueError("Duplicate acknowledgment requires a justification")
        return self


class CollectionCommand(CollectionIntent):
    expected_version: Version


InitialCollections = (
    CollectionIntent | Annotated[tuple[CollectionIntent, ...], Field(min_length=1, max_length=100)]
)


class ObligationCommand(ObligationIntent):
    expected_version: Version
    expected_capture_id: UUID | None
    expected_pricing_id: UUID


class AllocationCommand(CollectionDTO):
    expected_version: Version
    expected_pricing_id: UUID
    expected_obligation_id: UUID | None
    kind: Literal["allocate", "release"]
    payment_id: UUID
    component: Literal["accommodation", "hotel_charges"]
    amount_minor: Annotated[StrictInt, Field(gt=0, le=MAX_MINOR)]
    release_of: UUID | None = None
    reason: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def release_target(self):
        if not self.reason.strip() or (self.kind == "release") != (self.release_of is not None):
            raise ValueError("Reason and matching release target are required")
        return self


def correction_capacity(original, corrections, intent):
    if original["kind"] != "collection":
        raise ValueError("Corrections of corrections are not supported")
    for field in ("collector", "component", "currency", "source_id", "capture_id"):
        if getattr(intent, field) != original[field]:
            raise ValueError(
                "Correction must retain original collector, component and source/capture"
            )
    if any(row["kind"] == "reversal" for row in corrections):
        raise ValueError("Original collection was reversed")
    if intent.kind == "reversal":
        if corrections or intent.amount_minor != original["amount_minor"]:
            raise ValueError("Reversal must be full and original must have no refunds")
    elif (
        sum(row["amount_minor"] for row in corrections) + intent.amount_minor
        > original["amount_minor"]
    ):
        raise ValueError("Refund exceeds original collection remaining capacity")


def reference_key(intent):
    """Trim + Unicode casefold comparison; retain original evidence string in storage."""
    reference = intent.reference.strip().casefold()
    method = (intent.payment_method or "").strip().casefold() if intent.collector == "hotel" else ""
    return (intent.collector, method, reference) if reference else None
