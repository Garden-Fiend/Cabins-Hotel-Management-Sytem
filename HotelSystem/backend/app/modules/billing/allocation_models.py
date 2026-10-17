"""Small component allocation event log; not an invoice/payment ledger."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from app.core_models import identity, ownership
from app.db import Base

payment_allocations = sa.Table(
    "payment_allocation_events",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("reservation_id", UUID(as_uuid=True), nullable=False),
    sa.Column("reservation_version", sa.Integer, nullable=False),
    sa.Column("sequence", sa.BigInteger, sa.Identity(), nullable=False, unique=True),
    sa.Column("payment_id", UUID(as_uuid=True), nullable=False),
    sa.Column("component", sa.Text, nullable=False),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("amount_minor", sa.BigInteger, nullable=False),
    sa.Column("pricing_id", UUID(as_uuid=True), nullable=False),
    sa.Column("obligation_id", UUID(as_uuid=True)),
    sa.Column("release_of", UUID(as_uuid=True)),
    sa.Column("provenance", sa.Text, nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("actor", sa.Text, nullable=False),
    sa.Column(
        "recorded_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.clock_timestamp(),
    ),
    sa.UniqueConstraint("id", "company_id", "reservation_id"),
    sa.ForeignKeyConstraint(
        ["reservation_id", "company_id"], ["hms.reservations.id", "hms.reservations.company_id"]
    ),
    sa.ForeignKeyConstraint(
        ["payment_id", "company_id", "reservation_id"],
        [
            "hms.billing_collection_transactions.id",
            "hms.billing_collection_transactions.company_id",
            "hms.billing_collection_transactions.reservation_id",
        ],
    ),
    sa.ForeignKeyConstraint(
        ["pricing_id", "reservation_id", "company_id"],
        [
            "hms.pricing_revisions.id",
            "hms.pricing_revisions.reservation_id",
            "hms.pricing_revisions.company_id",
        ],
    ),
    sa.ForeignKeyConstraint(
        ["obligation_id", "company_id", "reservation_id"],
        [
            "hms.guest_obligation_bases.id",
            "hms.guest_obligation_bases.company_id",
            "hms.guest_obligation_bases.reservation_id",
        ],
    ),
    sa.ForeignKeyConstraint(
        ["release_of", "company_id", "reservation_id"],
        [
            "hms.payment_allocation_events.id",
            "hms.payment_allocation_events.company_id",
            "hms.payment_allocation_events.reservation_id",
        ],
    ),
    sa.CheckConstraint(
        "amount_minor BETWEEN 1 AND 9007199254740991 AND reservation_version>0", name="money_valid"
    ),
    sa.CheckConstraint(
        "component IN ('accommodation','hotel_charges') AND kind IN ('allocate','release')",
        name="choices_valid",
    ),
    sa.CheckConstraint(
        "(kind='allocate' AND release_of IS NULL) OR (kind='release' AND release_of IS NOT NULL)",
        name="release_valid",
    ),
    sa.CheckConstraint(
        "length(trim(reason))>0 AND length(trim(actor))>0 "
        "AND provenance IN ('automatic','manual','compensation')",
        name="provenance_valid",
    ),
)
