import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core_models import identity, ownership
from app.db import Base

# Operational captured charges only: not invoices, journals, payments or posting.
pricing_revisions = sa.Table(
    "pricing_revisions",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column(
        "reservation_id", UUID(as_uuid=True), sa.ForeignKey("hms.reservations.id"), nullable=False
    ),
    sa.Column("revision", sa.Integer, nullable=False),
    sa.Column("reservation_version", sa.Integer, nullable=False, server_default="1"),
    sa.CheckConstraint("reservation_version > 0", name="reservation_version_positive"),
    sa.Column("currency", sa.String(3), nullable=False),
    sa.Column("total_minor", sa.BigInteger, nullable=False),
    sa.Column("calculation_version", sa.Text, nullable=False),
    sa.Column("snapshot", JSONB, nullable=False),
    sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    ),
    sa.CheckConstraint("total_minor >= 0 AND currency = 'PHP'", name="valid_money"),
    sa.CheckConstraint("revision > 0", name="revision_positive"),
    sa.UniqueConstraint("reservation_id", "revision"),
    sa.UniqueConstraint("id", "reservation_id", "company_id", name="uq_pricing_document_source"),
)

# One immutable JSON aggregate holds its lines and original pricing; there are no orphan line rows.
billing_documents = sa.Table(
    "billing_documents",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("reservation_id", UUID(as_uuid=True), nullable=False),
    sa.Column("source_pricing_id", UUID(as_uuid=True), nullable=False),
    sa.Column("source_reservation_version", sa.Integer, nullable=False),
    sa.Column("document_type", sa.Text, nullable=False, server_default="operational_bill"),
    sa.Column("status", sa.Text, nullable=False, server_default="draft"),
    sa.Column("number", sa.Text),
    sa.Column("currency", sa.String(3), nullable=False),
    sa.Column("total_minor", sa.BigInteger, nullable=False),
    sa.Column("capture", JSONB, nullable=False),
    sa.Column("capture_hash", sa.String(64), nullable=False),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.clock_timestamp(),
    ),
    sa.Column("finalized_at", sa.DateTime(timezone=True)),
    sa.Column("created_by", sa.Text, nullable=False),
    sa.Column("finalized_by", sa.Text),
    sa.Column("attribution", sa.Text, nullable=False),
    sa.Column("created_request_key", UUID(as_uuid=True), nullable=False),
    sa.Column("finalized_request_key", UUID(as_uuid=True)),
    sa.ForeignKeyConstraint(
        ["reservation_id", "company_id"],
        ["hms.reservations.id", "hms.reservations.company_id"],
        name="fk_document_reservation_company",
    ),
    sa.ForeignKeyConstraint(
        ["source_pricing_id", "reservation_id", "company_id"],
        [
            "hms.pricing_revisions.id",
            "hms.pricing_revisions.reservation_id",
            "hms.pricing_revisions.company_id",
        ],
        name="fk_document_pricing_source",
    ),
    sa.UniqueConstraint("company_id", "number", name="uq_document_number"),
    sa.UniqueConstraint("company_id", "created_request_key", name="uq_document_create_key"),
    sa.UniqueConstraint("company_id", "finalized_request_key", name="uq_document_finalize_key"),
    sa.CheckConstraint(
        "document_type = 'operational_bill' AND attribution = 'local_development'",
        name="supported_document",
    ),
    sa.CheckConstraint(
        "source_reservation_version > 0 AND version > 0 AND currency = 'PHP' "
        "AND total_minor BETWEEN 0 AND 9007199254740991",
        name="valid_document_money_version",
    ),
    sa.CheckConstraint(
        "jsonb_typeof(capture) = 'object' AND length(capture_hash) = 64 "
        "AND length(trim(created_by)) > 0",
        name="valid_document_capture",
    ),
    sa.CheckConstraint(
        "(status = 'draft' AND version = 1 AND number IS NULL AND finalized_at IS NULL "
        "AND finalized_by IS NULL AND finalized_request_key IS NULL) OR "
        "(status = 'finalized' AND version = 2 AND number IS NOT NULL "
        "AND length(trim(number)) > 0 AND finalized_at >= created_at "
        "AND finalized_by IS NOT NULL AND length(trim(finalized_by)) > 0 "
        "AND finalized_request_key IS NOT NULL)",
        name="valid_document_state",
    ),
)
sa.Index(
    "uq_final_bill_reservation",
    billing_documents.c.company_id,
    billing_documents.c.reservation_id,
    unique=True,
    postgresql_where=sa.text("status = 'finalized'"),
)

document_counters = sa.Table(
    "billing_document_counters",
    Base.metadata,
    sa.Column(
        "company_id", UUID(as_uuid=True), sa.ForeignKey("hms.companies.id"), primary_key=True
    ),
    sa.Column("next_number", sa.BigInteger, nullable=False, server_default="1"),
    sa.CheckConstraint("next_number BETWEEN 1 AND 9007199254740991", name="document_counter_range"),
)
