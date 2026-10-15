"""Reject null or mixed final-price configuration at the database boundary."""

from alembic import op

revision = "f19b362d47a0"
down_revision = "e0f7f1c9a625"
branch_labels = None
depends_on = None


def upgrade():
    op.create_check_constraint(
        op.f("ck_discount_presets_valid_override_configuration"),
        "discount_presets",
        "json_typeof(rate_prices) = 'array' AND CASE WHEN method = 'final_price' THEN "
        "CASE WHEN scope = 'item' THEN replacement_unit_amount_minor IS NOT NULL "
        "AND json_array_length(rate_prices) = 0 ELSE replacement_unit_amount_minor IS NULL "
        "AND json_array_length(rate_prices) > 0 END ELSE "
        "replacement_unit_amount_minor IS NULL AND json_array_length(rate_prices) = 0 END",
        schema="hms",
    )


def downgrade():
    raise RuntimeError("Removing financial safeguards requires a reviewed preservation plan")
