"""Add optimistic room state version, without rewriting existing business columns."""

import sqlalchemy as sa
from alembic import op

revision = "bc7a419f2d30"
down_revision = "82f79142cdbd"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "rooms",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        schema="hms",
    )
    op.create_check_constraint(
        op.f("ck_rooms_version_positive"), "rooms", "version > 0", schema="hms"
    )


def downgrade():
    op.drop_constraint(op.f("ck_rooms_version_positive"), "rooms", type_="check", schema="hms")
    op.drop_column("rooms", "version", schema="hms")
