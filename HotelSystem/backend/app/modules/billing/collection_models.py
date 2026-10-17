"""Append-only collection facts and independently reviewed accommodation obligations."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core_models import identity, ownership
from app.db import Base


def provenance_columns():
    return [
        identity(),
        ownership(),
        sa.Column("reservation_id", UUID(as_uuid=True), nullable=False),
        sa.Column("reservation_version", sa.Integer, nullable=False),
        sa.Column("source_id", UUID(as_uuid=True), nullable=False),
        sa.Column("capture_id", UUID(as_uuid=True)),
        sa.Column("source_label", sa.Text, nullable=False),
        sa.Column("external_reference", sa.Text, nullable=False),
        sa.Column("actor", sa.Text, nullable=False),
        sa.Column("attribution", sa.Text, nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.clock_timestamp(),
        ),
        sa.CheckConstraint("reservation_version > 0", name="version_positive"),
        sa.CheckConstraint(
            "length(trim(actor)) > 0 AND attribution = 'local_development'", name="actor_valid"
        ),
        sa.UniqueConstraint("id", "company_id", "reservation_id"),
        sa.ForeignKeyConstraint(
            ["reservation_id", "company_id"], ["hms.reservations.id", "hms.reservations.company_id"]
        ),
        sa.ForeignKeyConstraint(
            ["source_id", "company_id"],
            ["hms.booking_sources.id", "hms.booking_sources.company_id"],
        ),
        sa.ForeignKeyConstraint(
            ["capture_id", "company_id", "reservation_id"],
            [
                "hms.booking_financial_captures.id",
                "hms.booking_financial_captures.company_id",
                "hms.booking_financial_captures.reservation_id",
            ],
        ),
    ]


collection_transactions = sa.Table(
    "billing_collection_transactions",
    Base.metadata,
    *provenance_columns(),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("collector", sa.Text, nullable=False),
    sa.Column("component", sa.Text, nullable=False),
    sa.Column("amount_minor", sa.BigInteger, nullable=False),
    sa.Column("currency", sa.String(3), nullable=False),
    sa.Column("payment_method", sa.Text),
    sa.Column("reference", sa.Text, nullable=False),
    sa.Column("normalized_reference", sa.Text, nullable=False),
    sa.Column("normalized_method", sa.Text, nullable=False),
    sa.Column("declaration", sa.Text, nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("related_transaction_id", UUID(as_uuid=True)),
    sa.Column("duplicate_review", JSONB, nullable=False),
    sa.Column("ordinal", sa.Integer, nullable=False, server_default="0"),
    sa.UniqueConstraint(
        "reservation_id", "reservation_version", "ordinal", name="uq_collection_record_order"
    ),
    sa.CheckConstraint("ordinal>=0", name="ordinal_valid"),
    sa.ForeignKeyConstraint(
        ["related_transaction_id", "company_id", "reservation_id"],
        [
            "hms.billing_collection_transactions.id",
            "hms.billing_collection_transactions.company_id",
            "hms.billing_collection_transactions.reservation_id",
        ],
    ),
    sa.CheckConstraint(
        "amount_minor BETWEEN 1 AND 9007199254740991 AND currency='PHP'", name="money_valid"
    ),
    sa.CheckConstraint(
        "kind IN ('collection','refund','reversal') AND collector IN ('hotel','channel') "
        "AND component IN ('accommodation','hotel_charges') "
        "AND declaration IN ('partial','confirmed')",
        name="choices_valid",
    ),
    sa.CheckConstraint(
        "(kind='collection' AND related_transaction_id IS NULL) OR (kind<>'collection' "
        "AND related_transaction_id IS NOT NULL AND length(trim(reason))>0)",
        name="correction_valid",
    ),
    sa.CheckConstraint(
        "coalesce((collector='hotel' AND length(trim(payment_method))>0 AND "
        "(lower(trim(payment_method))='cash' OR length(trim(reference))>0)) OR "
        "(collector='channel' AND component='accommodation' AND capture_id IS NOT NULL "
        "AND length(trim(reference))>0),false)",
        name="evidence_valid",
    ),
)
sa.Index(
    "ix_collection_evidence",
    collection_transactions.c.company_id,
    collection_transactions.c.collector,
    collection_transactions.c.normalized_method,
    collection_transactions.c.normalized_reference,
)

guest_obligations = sa.Table(
    "guest_obligation_bases",
    Base.metadata,
    *provenance_columns(),
    sa.Column("pricing_id", UUID(as_uuid=True), nullable=False),
    sa.Column("status", sa.Text, nullable=False),
    sa.Column("accommodation_minor", sa.BigInteger),
    sa.Column("evidence", sa.Text, nullable=False),
    sa.UniqueConstraint("reservation_id", "reservation_version"),
    sa.ForeignKeyConstraint(
        ["pricing_id", "reservation_id", "company_id"],
        [
            "hms.pricing_revisions.id",
            "hms.pricing_revisions.reservation_id",
            "hms.pricing_revisions.company_id",
        ],
    ),
    sa.CheckConstraint(
        "coalesce((status='known' AND accommodation_minor BETWEEN 0 AND 9007199254740991) "
        "OR (status='unknown' AND accommodation_minor IS NULL),false)",
        name="basis_valid",
    ),
    sa.CheckConstraint("length(trim(evidence))>0", name="evidence_required"),
)
