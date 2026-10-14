"""Operational catalog definitions, without stock movement or accounting records."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from app.core_models import identity, ownership
from app.db import Base

discount_presets = sa.Table(
    "discount_presets",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("source_id", sa.Text, nullable=False),
    sa.Column("label", sa.Text, nullable=False),
    sa.Column("scope", sa.Text, nullable=False),
    sa.Column("method", sa.Text, nullable=False),
    sa.Column("value", sa.Numeric(), nullable=False),
    sa.Column("currency", sa.String(3), nullable=False, server_default="PHP"),
    sa.Column("target_room_type_id", UUID(as_uuid=True)),
    sa.Column("target_product_id", UUID(as_uuid=True)),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.ForeignKeyConstraint(
        ["target_room_type_id", "company_id"],
        ["hms.room_types.id", "hms.room_types.company_id"],
        name="fk_preset_room_type_company",
    ),
    sa.ForeignKeyConstraint(
        ["target_product_id", "company_id"],
        ["hms.catalog_products.id", "hms.catalog_products.company_id"],
        name="fk_preset_product_company",
    ),
    sa.CheckConstraint("length(trim(label)) > 0 AND version > 0", name="valid_label_version"),
    sa.CheckConstraint(
        "method IN ('fixed', 'percentage') AND value > 0 AND value <= 90071992547409.91 "
        "AND (method <> 'percentage' OR value <= 100) AND currency = 'PHP'",
        name="valid_reduction",
    ),
    sa.CheckConstraint(
        "(scope = 'reservation' AND target_room_type_id IS NULL AND target_product_id IS NULL) "
        "OR (scope = 'room' AND target_room_type_id IS NOT NULL AND target_product_id IS NULL) "
        "OR (scope = 'item' AND target_room_type_id IS NULL AND target_product_id IS NOT NULL)",
        name="valid_scope_target",
    ),
)

sa.Index(
    "uq_discount_preset_label_casefold",
    discount_presets.c.company_id,
    sa.func.lower(discount_presets.c.label),
    unique=True,
)

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
        "(type IN ('ordinary', 'amenities') AND NOT system_defined AND source_id <> "
        "'special-extras' AND source_id <> 'special-inclusions' AND source_id <> "
        "'special-breakfast') OR (system_defined AND enabled "
        "AND ((type = 'extra' AND source_id = 'special-extras') OR "
        "(type = 'inclusion' AND source_id = 'special-inclusions') OR "
        "(type = 'breakfast' AND source_id = 'special-breakfast')))",
        name="supported_type",
    ),
    sa.CheckConstraint("version > 0", name="version_positive"),
    sa.UniqueConstraint("id", "company_id", name="uq_inventory_categories_company_identity"),
)
sa.Index(
    "uq_inventory_category_label_casefold",
    categories.c.company_id,
    sa.func.lower(categories.c.label),
    unique=True,
    postgresql_where=~categories.c.system_defined,
)
sa.Index(
    "uq_inventory_special_identity",
    categories.c.company_id,
    categories.c.source_id,
    unique=True,
    postgresql_where=categories.c.system_defined,
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
    sa.UniqueConstraint("id", "company_id", name="uq_catalog_products_company_identity"),
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

room_type_inclusions = sa.Table(
    "room_type_inclusions",
    Base.metadata,
    ownership(),
    sa.Column("room_type_id", UUID(as_uuid=True), primary_key=True),
    sa.Column("product_id", UUID(as_uuid=True), primary_key=True),
    sa.Column("quantity", sa.Integer, nullable=False),
    sa.Column("position", sa.Integer, nullable=False),
    sa.CheckConstraint("quantity > 0 AND position >= 0", name="valid_quantity_position"),
    sa.ForeignKeyConstraint(
        ["room_type_id", "company_id"],
        ["hms.room_types.id", "hms.room_types.company_id"],
        name="fk_inclusion_room_type_company",
    ),
    sa.ForeignKeyConstraint(
        ["product_id", "company_id"],
        [products.c.id, products.c.company_id],
        name="fk_inclusion_product_company",
    ),
)

breakfast_eligibility = sa.Table(
    "breakfast_eligibility",
    Base.metadata,
    ownership(),
    sa.Column("product_id", UUID(as_uuid=True), primary_key=True),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.CheckConstraint("kind IN ('meal', 'beverage')", name="kind_supported"),
    sa.ForeignKeyConstraint(
        ["product_id", "company_id"],
        [products.c.id, products.c.company_id],
        name="fk_breakfast_product_company",
    ),
)
