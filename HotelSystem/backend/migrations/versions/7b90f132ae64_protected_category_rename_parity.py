"""Preserve the original special-category rename control without changing identity."""

from alembic import op

revision = "7b90f132ae64"
down_revision = "6a4e29c18f03"
branch_labels = depends_on = None


def upgrade():
    op.drop_constraint(
        op.f("ck_inventory_categories_supported_type"),
        "inventory_categories",
        schema="hms",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_inventory_categories_supported_type"),
        "inventory_categories",
        "(type IN ('ordinary', 'amenities') AND NOT system_defined AND source_id <> "
        "'special-extras') OR (type = 'extra' AND system_defined AND source_id = "
        "'special-extras' AND enabled)",
        schema="hms",
    )


def downgrade():
    raise RuntimeError("Reviewed category labels required before restoring the earlier constraint")
