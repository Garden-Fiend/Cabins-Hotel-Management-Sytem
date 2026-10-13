"""Versioned definitions and descriptive room metadata; no historical repricing."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e921a6830fc4"
down_revision = "bc7a419f2d30"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("room_types", "durations", "reference_rates"):
        op.add_column(
            table,
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            schema="hms",
        )
        op.create_check_constraint(
            op.f(f"ck_{table}_version_positive"), table, "version > 0", schema="hms"
        )
    op.add_column(
        "room_types",
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="hms",
    )
    for table, column in (
        ("room_types", "amenities"),
        ("rooms", "amenities_additions"),
        ("rooms", "amenities_removals"),
    ):
        op.add_column(
            table,
            sa.Column(
                column, postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
            ),
            schema="hms",
        )
    for table, column in (
        ("rooms", "description"),
        ("rooms", "operational_notes"),
        ("durations", "label"),
    ):
        op.add_column(
            table, sa.Column(column, sa.Text(), nullable=False, server_default=""), schema="hms"
        )
    op.create_index(
        "uq_room_type_label_casefold",
        "room_types",
        ["company_id", sa.text("lower(label)")],
        unique=True,
        schema="hms",
    )
    op.create_index(
        "uq_duration_label_casefold",
        "durations",
        ["company_id", sa.text("lower(coalesce(nullif(label, ''), source_id))")],
        unique=True,
        schema="hms",
    )


def downgrade():
    op.drop_index("uq_duration_label_casefold", table_name="durations", schema="hms")
    op.drop_index("uq_room_type_label_casefold", table_name="room_types", schema="hms")
    for table, column in (
        ("rooms", "description"),
        ("rooms", "operational_notes"),
        ("durations", "label"),
        ("room_types", "amenities"),
        ("rooms", "amenities_additions"),
        ("rooms", "amenities_removals"),
        ("room_types", "archived"),
    ):
        op.drop_column(table, column, schema="hms")
    for table in ("room_types", "durations", "reference_rates"):
        op.drop_constraint(op.f(f"ck_{table}_version_positive"), table, type_="check", schema="hms")
        op.drop_column(table, "version", schema="hms")
