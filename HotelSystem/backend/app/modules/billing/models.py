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
)
