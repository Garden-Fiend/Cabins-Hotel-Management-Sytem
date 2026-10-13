"""Explicit room operational status without changing existing boolean facts."""

import sqlalchemy as sa
from alembic import op

revision = "54e8c2a17d90"
down_revision = "3b36715627c4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "rooms",
        sa.Column("operational_status", sa.Text(), nullable=False, server_default="operational"),
        schema="hms",
    )
    # False did not capture a reason. Preserve it as legacy unavailable, not maintenance.
    op.execute("UPDATE hms.rooms SET operational_status = 'unavailable' WHERE NOT operational")
    op.create_check_constraint(
        op.f("ck_rooms_operational_status_values"),
        "rooms",
        "operational_status IN ('operational', 'housekeeping', 'maintenance', 'unavailable')",
        schema="hms",
    )
    op.create_check_constraint(
        op.f("ck_rooms_operational_status_consistent"),
        "rooms",
        "operational = (operational_status = 'operational')",
        schema="hms",
    )


def downgrade():
    op.drop_constraint(
        op.f("ck_rooms_operational_status_consistent"), "rooms", schema="hms", type_="check"
    )
    op.drop_constraint(
        op.f("ck_rooms_operational_status_values"), "rooms", schema="hms", type_="check"
    )
    op.drop_column("rooms", "operational_status", schema="hms")
