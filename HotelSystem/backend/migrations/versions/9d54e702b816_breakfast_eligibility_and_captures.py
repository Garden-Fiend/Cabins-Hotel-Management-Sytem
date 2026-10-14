"""Protected breakfast view, owned eligibility and nonfinancial selection captures."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "9d54e702b816"
down_revision = "8c21a6f4d903"
branch_labels = depends_on = None


def upgrade():
    op.add_column(
        "companies",
        sa.Column("breakfast_version", sa.Integer, nullable=False, server_default="1"),
        schema="hms",
    )
    op.create_check_constraint(
        op.f("ck_companies_breakfast_version_positive"),
        "companies",
        "breakfast_version > 0",
        schema="hms",
    )
    op.add_column(
        "room_allocations",
        sa.Column("breakfast", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        schema="hms",
    )
    op.create_check_constraint(
        op.f("ck_room_allocations_breakfast_array"),
        "room_allocations",
        "jsonb_typeof(breakfast) = 'array'",
        schema="hms",
    )
    op.create_table(
        "breakfast_eligibility",
        sa.Column("company_id", UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.ForeignKeyConstraint(["company_id"], ["hms.companies.id"]),
        sa.ForeignKeyConstraint(
            ["product_id", "company_id"],
            ["hms.catalog_products.id", "hms.catalog_products.company_id"],
            name="fk_breakfast_product_company",
        ),
        sa.CheckConstraint(
            "kind IN ('meal', 'beverage')", name=op.f("ck_breakfast_eligibility_kind_supported")
        ),
        schema="hms",
    )
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
        "'special-extras' AND source_id <> 'special-inclusions' AND source_id <> "
        "'special-breakfast') OR (system_defined AND enabled "
        "AND ((type = 'extra' AND source_id = 'special-extras') OR "
        "(type = 'inclusion' AND source_id = 'special-inclusions') OR "
        "(type = 'breakfast' AND source_id = 'special-breakfast')))",
        schema="hms",
    )
    op.execute(
        "INSERT INTO hms.inventory_categories (id,company_id,source_id,label,type,system_defined) "
        "SELECT md5(id::text || chr(58) || 'special-breakfast')::uuid,id,'special-breakfast',"
        "'Breakfast Items','breakfast',true FROM hms.companies"
    )
    op.execute("""CREATE OR REPLACE FUNCTION hms.initialize_extra_category() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO hms.inventory_categories (id,company_id,source_id,label,type,system_defined)
        VALUES (md5(NEW.id::text || chr(58) || 'special-extras')::uuid,
                NEW.id,'special-extras','Extra Charges','extra',true),
          (md5(NEW.id::text || chr(58) || 'special-inclusions')::uuid,
                NEW.id,'special-inclusions','Inclusions','inclusion',true),
          (md5(NEW.id::text || chr(58) || 'special-breakfast')::uuid,
                NEW.id,'special-breakfast','Breakfast Items','breakfast',true);
        RETURN NEW; END $$""")


def downgrade():
    raise RuntimeError("Reviewed breakfast data migration required before removing captures")
