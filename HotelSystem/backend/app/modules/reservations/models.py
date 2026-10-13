import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TSTZRANGE, UUID, ExcludeConstraint

from app.core_models import identity, ownership
from app.db import Base

guests = sa.Table(
    "guests",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("phone", sa.Text, nullable=False, server_default=""),
    sa.Column("email", sa.Text, nullable=False, server_default=""),
    sa.CheckConstraint("length(trim(name)) > 0", name="name_required"),
)
room_types = sa.Table(
    "room_types",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("source_id", sa.Text, nullable=False),
    sa.Column("label", sa.Text, nullable=False),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("default_capacity", sa.Integer, nullable=False, server_default="2"),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("amenities", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    sa.CheckConstraint("version > 0", name="version_positive"),
    sa.CheckConstraint("default_capacity > 0", name="capacity_positive"),
    sa.UniqueConstraint("company_id", "source_id"),
)
sa.Index(
    "uq_room_type_label_casefold",
    room_types.c.company_id,
    sa.func.lower(room_types.c.label),
    unique=True,
)
rooms = sa.Table(
    "rooms",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column(
        "room_type_id", UUID(as_uuid=True), sa.ForeignKey("hms.room_types.id"), nullable=False
    ),
    sa.Column("number", sa.Text, nullable=False),
    sa.Column("display_name", sa.Text, nullable=False, server_default=""),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("housekeeping", sa.Text, nullable=False, server_default="clean"),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.CheckConstraint("version > 0", name="version_positive"),
    sa.Column("operational", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("operational_status", sa.Text, nullable=False, server_default="operational"),
    sa.CheckConstraint(
        "operational_status IN ('operational', 'housekeeping', 'maintenance', 'unavailable')",
        name="operational_status_values",
    ),
    sa.CheckConstraint(
        "operational = (operational_status = 'operational')", name="operational_status_consistent"
    ),
    sa.Column("capacity_override", sa.Integer),
    sa.Column("description", sa.Text, nullable=False, server_default=""),
    sa.Column("operational_notes", sa.Text, nullable=False, server_default=""),
    sa.Column("amenities_additions", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    sa.Column("amenities_removals", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    sa.Column("current_occupancy_allocation_id", UUID(as_uuid=True)),
    sa.CheckConstraint("length(trim(number)) > 0", name="number_required"),
    sa.CheckConstraint(
        "housekeeping IN ('clean', 'dirty', 'cleaning')", name="housekeeping_values"
    ),
    sa.CheckConstraint(
        "capacity_override IS NULL OR capacity_override > 0", name="capacity_positive"
    ),
    sa.UniqueConstraint("id", "company_id", name="uq_room_company_identity"),
)
sa.Index("uq_room_number_casefold", rooms.c.company_id, sa.func.lower(rooms.c.number), unique=True)
durations = sa.Table(
    "durations",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("source_id", sa.Text, nullable=False),
    sa.Column("label", sa.Text, nullable=False, server_default=""),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.CheckConstraint("version > 0", name="version_positive"),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("minutes", sa.Integer),
    sa.Column("nights", sa.Integer),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.UniqueConstraint("id", "company_id", "kind", name="uq_duration_company_kind"),
    sa.CheckConstraint(
        "(kind = 'hourly' AND minutes IS NOT NULL AND minutes > 0 AND nights IS NULL) OR "
        "(kind = 'overnight' AND nights IS NOT NULL AND nights > 0 AND minutes IS NULL)",
        name="duration_definition",
    ),
    sa.UniqueConstraint("company_id", "source_id"),
)
sa.Index(
    "uq_duration_label_casefold",
    durations.c.company_id,
    sa.func.lower(sa.func.coalesce(sa.func.nullif(durations.c.label, ""), durations.c.source_id)),
    unique=True,
)
rates = sa.Table(
    "reference_rates",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column(
        "room_type_id", UUID(as_uuid=True), sa.ForeignKey("hms.room_types.id"), nullable=False
    ),
    sa.Column("source_id", sa.Text, nullable=False),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.CheckConstraint("version > 0", name="version_positive"),
    sa.Column("booking_kind", sa.Text, nullable=False),
    sa.Column("duration_id", UUID(as_uuid=True), sa.ForeignKey("hms.durations.id")),
    sa.Column("unit_amount_minor", sa.BigInteger, nullable=False),
    sa.Column("currency", sa.String(3), nullable=False),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.CheckConstraint("unit_amount_minor >= 0 AND currency = 'PHP'", name="valid_money"),
    sa.CheckConstraint(
        "(booking_kind = 'hourly' AND duration_id IS NOT NULL) OR "
        "(booking_kind = 'overnight' AND duration_id IS NULL)",
        name="rate_basis",
    ),
    sa.UniqueConstraint("company_id", "source_id"),
)
booking_sources = sa.Table(
    "booking_sources",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("source_id", sa.Text, nullable=False),
    sa.Column("label", sa.Text, nullable=False),
    sa.CheckConstraint("source_id = 'direct'", name="direct_only"),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.UniqueConstraint("company_id", "source_id"),
)
reservations = sa.Table(
    "reservations",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("business_number", sa.BigInteger, sa.Identity(), nullable=False, unique=True),
    sa.Column("guest_id", UUID(as_uuid=True), sa.ForeignKey("hms.guests.id"), nullable=False),
    sa.Column(
        "booking_source_id",
        UUID(as_uuid=True),
        sa.ForeignKey("hms.booking_sources.id"),
        nullable=False,
    ),
    sa.Column("status", sa.Text, nullable=False, server_default="confirmed"),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.Column("note", sa.Text, nullable=False, server_default=""),
    sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    ),
    sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    ),
    sa.CheckConstraint("version > 0", name="version_positive"),
    sa.CheckConstraint(
        "status IN ('confirmed','reserved','checked_in','checked_out','cancelled','no_show')",
        name="status_values",
    ),
)
allocations = sa.Table(
    "room_allocations",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column(
        "reservation_id",
        UUID(as_uuid=True),
        sa.ForeignKey("hms.reservations.id"),
        nullable=False,
        unique=True,
    ),
    sa.Column("room_id", UUID(as_uuid=True), nullable=False),
    sa.Column("duration_id", UUID(as_uuid=True), sa.ForeignKey("hms.durations.id"), nullable=False),
    sa.Column("scheduled_start", sa.DateTime(timezone=True), nullable=False),
    sa.Column("scheduled_end", sa.DateTime(timezone=True), nullable=False),
    sa.Column("adults", sa.Integer, nullable=False, server_default="1"),
    sa.Column("children", sa.Integer, nullable=False, server_default="0"),
    sa.CheckConstraint("adults >= 1 AND children >= 0", name="occupancy_counts"),
    sa.CheckConstraint(
        "isfinite(scheduled_start) AND isfinite(scheduled_end)", name="finite_interval"
    ),
    sa.Column("actual_check_in", sa.DateTime(timezone=True)),
    sa.Column("actual_check_out", sa.DateTime(timezone=True)),
    sa.Column("blocks_availability", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("period", TSTZRANGE, sa.Computed("tstzrange(scheduled_start, scheduled_end, '[)')")),
    sa.ForeignKeyConstraint(["room_id", "company_id"], ["hms.rooms.id", "hms.rooms.company_id"]),
    sa.CheckConstraint("scheduled_end > scheduled_start", name="positive_interval"),
    sa.UniqueConstraint("room_id", "company_id", "id", name="uq_allocation_room_owner"),
    ExcludeConstraint(
        ("room_id", "="),
        ("period", "&&"),
        where=sa.text("blocks_availability"),
        using="gist",
        name="excl_active_room_overlap",
    ),
)
rooms.append_constraint(
    sa.ForeignKeyConstraint(
        ["id", "company_id", "current_occupancy_allocation_id"],
        [
            "hms.room_allocations.room_id",
            "hms.room_allocations.company_id",
            "hms.room_allocations.id",
        ],
        use_alter=True,
        name="fk_room_current_occupancy_owner",
    )
)
