"""owned operational product and category catalog"""

import sqlalchemy as sa
from alembic import op

revision = "3b36715627c4"
down_revision = "e921a6830fc4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "inventory_categories",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("source_id", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("system_defined", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.CheckConstraint(
            "type IN ('ordinary', 'amenities') AND NOT system_defined",
            name=op.f("ck_inventory_categories_supported_type"),
        ),
        sa.CheckConstraint(
            "length(trim(label)) > 0", name=op.f("ck_inventory_categories_label_required")
        ),
        sa.CheckConstraint("version > 0", name=op.f("ck_inventory_categories_version_positive")),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["hms.companies.id"],
            name=op.f("fk_inventory_categories_company_id_companies"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_inventory_categories")),
        sa.UniqueConstraint("id", "company_id", name="uq_inventory_categories_company_identity"),
        schema="hms",
    )
    op.create_index(
        "uq_inventory_category_label_casefold",
        "inventory_categories",
        ["company_id", sa.literal_column("lower(label)")],
        unique=True,
        schema="hms",
    )
    op.create_table(
        "catalog_products",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("source_id", sa.Text(), nullable=False),
        sa.Column("category_id", sa.UUID(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("unit_amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), server_default="PHP", nullable=False),
        sa.Column(
            "available_for_sale", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.CheckConstraint(
            "unit_amount_minor >= 0 AND unit_amount_minor <= 9007199254740991 AND currency = 'PHP'",
            name=op.f("ck_catalog_products_valid_money"),
        ),
        sa.CheckConstraint(
            "length(trim(label)) > 0", name=op.f("ck_catalog_products_label_required")
        ),
        sa.CheckConstraint("version > 0", name=op.f("ck_catalog_products_version_positive")),
        sa.ForeignKeyConstraint(
            ["category_id", "company_id"],
            ["hms.inventory_categories.id", "hms.inventory_categories.company_id"],
            name="fk_catalog_product_category_company",
        ),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["hms.companies.id"],
            name=op.f("fk_catalog_products_company_id_companies"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_catalog_products")),
        schema="hms",
    )
    op.create_index(
        "uq_catalog_product_label_casefold",
        "catalog_products",
        ["company_id", "category_id", sa.literal_column("lower(label)")],
        unique=True,
        schema="hms",
    )


def downgrade():
    op.drop_index("uq_catalog_product_label_casefold", table_name="catalog_products", schema="hms")
    op.drop_table("catalog_products", schema="hms")
    op.drop_index(
        "uq_inventory_category_label_casefold", table_name="inventory_categories", schema="hms"
    )
    op.drop_table("inventory_categories", schema="hms")
