"""Protected extras with non-destructive ordinary-name collision handling."""

import sqlalchemy as sa
from alembic import op

revision = "6a4e29c18f03"
down_revision = "54e8c2a17d90"
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
        "'special-extras' AND label = 'Extra Charges' AND enabled)",
        schema="hms",
    )
    op.drop_index(
        "uq_inventory_category_label_casefold", table_name="inventory_categories", schema="hms"
    )
    op.create_index(
        "uq_inventory_category_label_casefold",
        "inventory_categories",
        ["company_id", sa.text("lower(label)")],
        unique=True,
        schema="hms",
        postgresql_where=sa.text("NOT system_defined"),
    )
    op.create_index(
        "uq_inventory_special_identity",
        "inventory_categories",
        ["company_id", "source_id"],
        unique=True,
        schema="hms",
        postgresql_where=sa.text("system_defined"),
    )
    # Existing ordinary categories/products retain names and IDs. The new protected row coexists.
    op.execute(
        "INSERT INTO hms.inventory_categories (id, company_id, source_id, label, type, "
        "system_defined) SELECT md5(id::text || chr(58) || 'special-extras')::uuid, id, "
        "'special-extras', 'Extra Charges', 'extra', true FROM hms.companies"
    )
    op.execute(
        """CREATE FUNCTION hms.initialize_extra_category() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO hms.inventory_categories
            (id,company_id,source_id,label,type,system_defined)
        VALUES (md5(NEW.id::text || chr(58) || 'special-extras')::uuid,
            NEW.id,'special-extras','Extra Charges','extra',true);
        RETURN NEW;
        END $$"""
    )
    op.execute(
        "CREATE TRIGGER initialize_extra_category AFTER INSERT ON hms.companies FOR "
        "EACH ROW EXECUTE FUNCTION hms.initialize_extra_category()"
    )


def downgrade():
    # Never erase operational definitions/history or merge colliding names on downgrade.
    raise RuntimeError("Explicit reviewed data migration required before removing protected extras")
