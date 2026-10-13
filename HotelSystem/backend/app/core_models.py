import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db import Base


def identity():
    return sa.Column("id", UUID(as_uuid=True), primary_key=True)


def ownership():
    return sa.Column(
        "company_id", UUID(as_uuid=True), sa.ForeignKey("hms.companies.id"), nullable=False
    )


companies = sa.Table(
    "companies",
    Base.metadata,
    identity(),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("currency", sa.String(3), nullable=False),
    sa.Column("hotel_timezone", sa.Text, nullable=False),
    # Local hotel wall-clock times, matching the existing demo policy.
    sa.Column("default_check_in_time", sa.Time(), nullable=False, server_default="14:00:00"),
    sa.Column("default_check_out_time", sa.Time(), nullable=False, server_default="12:00:00"),
    sa.CheckConstraint("currency = 'PHP'", name="php_only"),
    sa.CheckConstraint("hotel_timezone = 'Asia/Manila'", name="hotel_timezone_supported"),
    sa.CheckConstraint(
        "default_check_in_time < TIME '24:00' AND default_check_out_time < TIME '24:00'",
        name="hotel_times_valid",
    ),
)
audit_events = sa.Table(
    "operational_audit",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("reservation_id", UUID(as_uuid=True), sa.ForeignKey("hms.reservations.id")),
    sa.Column("event_type", sa.Text, nullable=False),
    sa.Column("reservation_version", sa.Integer),
    sa.CheckConstraint(
        "reservation_version IS NULL OR reservation_version > 0",
        name="reservation_version_positive",
    ),
    sa.Column("actor", sa.Text, nullable=False),
    sa.Column("attribution", sa.Text, nullable=False),
    sa.Column(
        "occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    ),
    sa.Column("before", JSONB),
    sa.Column("after", JSONB),
    sa.CheckConstraint("length(trim(actor)) > 0", name="actor_required"),
    sa.CheckConstraint("attribution = 'local_development'", name="local_attribution"),
)
mutation_receipts = sa.Table(
    "mutation_receipts",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("operation", sa.Text, nullable=False),
    sa.Column("request_key", UUID(as_uuid=True), nullable=False),
    sa.Column("request_hash", sa.String(64), nullable=False),
    sa.Column("reservation_id", UUID(as_uuid=True), sa.ForeignKey("hms.reservations.id")),
    sa.Column("response", JSONB, nullable=False),
    sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    ),
    sa.UniqueConstraint("company_id", "operation", "request_key", name="uq_mutation_operation_key"),
)
