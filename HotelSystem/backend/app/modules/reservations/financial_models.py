"""Append-only contractual captures, distinct from operational payments."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core_models import identity, ownership
from app.db import Base

booking_financial_captures = sa.Table(
    "booking_financial_captures",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("reservation_id", UUID(as_uuid=True), nullable=False),
    sa.Column("source_id", UUID(as_uuid=True), nullable=False),
    sa.Column("agreement_id", UUID(as_uuid=True)),
    sa.Column("reservation_version", sa.Integer, nullable=False),
    sa.Column("confirmation_date", sa.Date, nullable=False),
    sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("snapshot", JSONB, nullable=False),
    sa.CheckConstraint("reservation_version > 0", name="version_positive"),
    sa.CheckConstraint("jsonb_typeof(snapshot) = 'object'", name="snapshot_object"),
    sa.CheckConstraint(
        "coalesce(snapshot->>'id'=id::text AND snapshot->>'source_id'=source_id::text "
        "AND (snapshot->>'reservation_version')::integer=reservation_version "
        "AND (snapshot->'input'->>'confirmation_date')::date=confirmation_date, false)",
        name="snapshot_identity",
    ),
    sa.CheckConstraint(
        " AND ".join(
            f"coalesce(jsonb_typeof(snapshot->'figures'->'{field}')='number' AND "
            f"(snapshot->'figures'->>'{field}')::numeric BETWEEN 0 AND 9007199254740991 AND "
            f"(snapshot->'figures'->>'{field}')::numeric="
            f"trunc((snapshot->'figures'->>'{field}')::numeric),false)"
            for field in (
                "standard_accommodation_minor",
                "discounted_accommodation_minor",
                "contractual_accommodation_minor",
                "additional_charges_minor",
                "total_minor",
                "commission_minor",
            )
        )
        + " AND coalesce((snapshot->'figures'->>'hotel_received_minor')::numeric=0,false)",
        name="snapshot_precision",
    ),
    sa.UniqueConstraint("reservation_id", "reservation_version"),
    sa.UniqueConstraint("id", "company_id", "reservation_id", name="uq_capture_collection_owner"),
    sa.ForeignKeyConstraint(
        ["reservation_id", "company_id"], ["hms.reservations.id", "hms.reservations.company_id"]
    ),
    sa.ForeignKeyConstraint(
        ["source_id", "company_id"], ["hms.booking_sources.id", "hms.booking_sources.company_id"]
    ),
    sa.ForeignKeyConstraint(
        ["agreement_id", "company_id", "source_id"],
        [
            "hms.source_agreements.id",
            "hms.source_agreements.company_id",
            "hms.source_agreements.source_id",
        ],
    ),
)
