"""Commercial configuration only: no calculation, collection or settlement records."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID, ExcludeConstraint

from app.core_models import identity, ownership
from app.db import Base

agreements = sa.Table(
    "source_agreements",
    Base.metadata,
    identity(),
    ownership(),
    sa.Column("source_id", UUID(as_uuid=True), nullable=False),
    sa.UniqueConstraint("id", "company_id", "source_id", name="uq_agreement_owned_source"),
    sa.Column("revision", sa.Integer, nullable=False),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.Column("effective_from", sa.Date, nullable=False),
    sa.Column("effective_to", sa.Date),
    sa.Column("status", sa.Text, nullable=False),
    sa.Column("currency", sa.Text, nullable=False),
    sa.Column("terms", JSONB, nullable=False),
    sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    ),
    sa.Column("actor", sa.Text, nullable=False),
    sa.CheckConstraint(
        "(jsonb_typeof(terms->'pricing'->'allowOverride')='boolean' AND js"
        "onb_typeof(terms->'pricing'->'reasonRequired')='boolean' AND json"
        "b_typeof(terms->'commission'->'allowOverride')='boolean' AND json"
        "b_typeof(terms->'commission'->'method')='string' AND jsonb_typeof"
        "(terms->'commission'->'basis')='string' AND jsonb_typeof(terms->'"
        "payment'->'collection')='string' AND jsonb_typeof(terms->'settlem"
        "ent'->'method')='string' AND jsonb_typeof(terms->'commission'->'r"
        "ateBasisPoints')='number' AND jsonb_typeof(terms->'commission'->'"
        "fixedMinor')='number') IS TRUE",
        name="required_terms",
    ),
    sa.ForeignKeyConstraint(
        ["source_id", "company_id"],
        ["hms.booking_sources.id", "hms.booking_sources.company_id"],
        name="fk_agreement_source_company",
    ),
    sa.UniqueConstraint("source_id", "revision", name="uq_agreement_source_revision"),
    sa.CheckConstraint("revision > 0 AND version > 0", name="versions_positive"),
    sa.CheckConstraint(
        "effective_to IS NULL OR effective_to >= effective_from", name="effective_dates"
    ),
    sa.CheckConstraint(
        "status IN ('draft','active','retired') AND currency = 'PHP'", name="state_currency"
    ),
    sa.CheckConstraint(
        "terms->'commission'->>'method' IN ('none','percentage','fixed','m"
        "anual') AND terms->'commission'->>'basis' IN ('confirmed_accommod"
        "ation','reference_value','explicit_amount') AND terms->'payment'-"
        ">>'collection' IN ('hotel','channel','per_reservation') AND terms"
        "->'settlement'->>'method' IN ('deducted','separate_invoice','offs"
        "et','manual')",
        name="commercial_enums",
    ),
    sa.CheckConstraint(
        "jsonb_typeof(terms->'commission'->'rateBasisPoints') = 'number' A"
        "ND (terms->'commission'->>'rateBasisPoints')::numeric BETWEEN 0 A"
        "ND 10000 AND (terms->'commission'->>'rateBasisPoints')::numeric ="
        " trunc((terms->'commission'->>'rateBasisPoints')::numeric) AND js"
        "onb_typeof(terms->'commission'->'fixedMinor') = 'number' AND (ter"
        "ms->'commission'->>'fixedMinor')::numeric BETWEEN 0 AND 900719925"
        "4740991 AND (terms->'commission'->>'fixedMinor')::numeric = trunc"
        "((terms->'commission'->>'fixedMinor')::numeric)",
        name="commission_precision",
    ),
    ExcludeConstraint(
        ("source_id", "="),
        (sa.func.daterange(sa.column("effective_from"), sa.column("effective_to"), "[]"), "&&"),
        where=sa.text("status = 'active'"),
        using="gist",
        name="ex_source_agreement_period",
    ),
)
