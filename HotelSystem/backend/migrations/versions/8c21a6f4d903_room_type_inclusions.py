"""Owned inclusion defaults and nonfinancial allocation captures."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "8c21a6f4d903"
down_revision = "7b90f132ae64"
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
        "'special-extras' AND source_id <> 'special-inclusions') OR (system_defined AND enabled "
        "AND ((type = 'extra' AND source_id = 'special-extras') OR "
        "(type = 'inclusion' AND source_id = 'special-inclusions')))",
        schema="hms",
    )
    op.create_unique_constraint(
        "uq_catalog_products_company_identity",
        "catalog_products",
        ["id", "company_id"],
        schema="hms",
    )
    op.create_table(
        "room_type_inclusions",
        sa.Column("company_id", UUID(as_uuid=True), nullable=False),
        sa.Column("room_type_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("product_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("position", sa.Integer, nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["hms.companies.id"]),
        sa.ForeignKeyConstraint(
            ["room_type_id", "company_id"],
            ["hms.room_types.id", "hms.room_types.company_id"],
            name="fk_inclusion_room_type_company",
        ),
        sa.ForeignKeyConstraint(
            ["product_id", "company_id"],
            ["hms.catalog_products.id", "hms.catalog_products.company_id"],
            name="fk_inclusion_product_company",
        ),
        sa.CheckConstraint(
            "quantity > 0 AND position >= 0",
            name=op.f("ck_room_type_inclusions_valid_quantity_position"),
        ),
        schema="hms",
    )
    op.add_column(
        "room_allocations",
        sa.Column("inclusions", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        schema="hms",
    )
    op.create_check_constraint(
        op.f("ck_room_allocations_inclusions_array"),
        "room_allocations",
        "jsonb_typeof(inclusions) = 'array'",
        schema="hms",
    )
    op.execute(
        "INSERT INTO hms.inventory_categories (id,company_id,source_id,label,type,system_defined) "
        "SELECT md5(id::text || chr(58) || 'special-inclusions')::uuid,id,'special-inclusions',"
        "'Inclusions','inclusion',true FROM hms.companies"
    )
    op.execute("""CREATE OR REPLACE FUNCTION hms.initialize_extra_category() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO hms.inventory_categories (id,company_id,source_id,label,type,system_defined)
        VALUES (md5(NEW.id::text || chr(58) || 'special-extras')::uuid,
                NEW.id,'special-extras','Extra Charges','extra',true),
               (md5(NEW.id::text || chr(58) || 'special-inclusions')::uuid,
                NEW.id,'special-inclusions','Inclusions','inclusion',true);
        RETURN NEW; END $$""")


def downgrade():
    raise RuntimeError("Reviewed entitlement/data migration required before removing inclusions")
