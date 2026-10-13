"""Operational catalog definitions, without stock movement or accounting records."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from app.core_models import identity, ownership
from app.db import Base

categories = sa.Table(
    "inventory_categories",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("source_id", sa.Text, nullable=False),
    sa.Column("label", sa.Text, nullable=False),
    sa.Column("type", sa.Text, nullable=False),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("system_defined", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.CheckConstraint("length(trim(label)) > 0", name="label_required"),
    sa.CheckConstraint(
        "type IN ('ordinary', 'amenities') AND NOT system_defined", name="supported_type"
    ),
    sa.CheckConstraint("version > 0", name="version_positive"),
    sa.UniqueConstraint("id", "company_id", name="uq_inventory_categories_company_identity"),
)
sa.Index(
    "uq_inventory_category_label_casefold",
    categories.c.company_id,
    sa.func.lower(categories.c.label),
    unique=True,
)

products = sa.Table(
    "catalog_products",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("source_id", sa.Text, nullable=False),
    sa.Column("category_id", UUID(as_uuid=True), nullable=False),
    sa.ForeignKeyConstraint(
        ["category_id", "company_id"],
        [categories.c.id, categories.c.company_id],
        name="fk_catalog_product_category_company",
    ),
    sa.Column("label", sa.Text, nullable=False),
    sa.Column("unit_amount_minor", sa.BigInteger, nullable=False),
    sa.Column("currency", sa.String(3), nullable=False, server_default="PHP"),
    sa.Column("available_for_sale", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.CheckConstraint("length(trim(label)) > 0", name="label_required"),
    sa.CheckConstraint("version > 0", name="version_positive"),
    sa.CheckConstraint(
        "unit_amount_minor >= 0 AND unit_amount_minor <= 9007199254740991 AND currency = 'PHP'",
        name="valid_money",
    ),
)
sa.Index(
    "uq_catalog_product_label_casefold",
    products.c.company_id,
    products.c.category_id,
    sa.func.lower(products.c.label),
    unique=True,
)
