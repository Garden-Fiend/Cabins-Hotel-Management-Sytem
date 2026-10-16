"""Versioned source identities and commercial agreements, without financial posting."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID, ExcludeConstraint

revision = "d48e53f9a043"
down_revision = "c37d42e8f932"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint(
        op.f("ck_booking_sources_direct_only"), "booking_sources", schema="hms", type_="check"
    )
    for column in (
        sa.Column("classification", sa.Text, nullable=False, server_default="direct"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("reference_required", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("notes", sa.Text, nullable=False, server_default=""),
        sa.Column("initial_label", sa.Text),
    ):
        op.add_column("booking_sources", column, schema="hms")
    op.create_check_constraint(
        op.f("ck_booking_sources_version_positive"), "booking_sources", "version > 0", schema="hms"
    )
    op.create_check_constraint(
        op.f("ck_booking_sources_classification"),
        "booking_sources",
        "classification IN ('direct','ota','corporate','agent','other')",
        schema="hms",
    )
    op.create_index(
        "uq_booking_source_label_casefold",
        "booking_sources",
        ["company_id", sa.text("lower(label)")],
        unique=True,
        schema="hms",
    )
    op.add_column("reservations", sa.Column("booking_source_label", sa.Text), schema="hms")
    op.create_table(
        "source_agreements",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "company_id", UUID(as_uuid=True), sa.ForeignKey("hms.companies.id"), nullable=False
        ),
        sa.Column("source_id", UUID(as_uuid=True), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["source_id", "company_id"],
            ["hms.booking_sources.id", "hms.booking_sources.company_id"],
            name="fk_agreement_source_company",
        ),
        sa.UniqueConstraint("source_id", "revision", name="uq_agreement_source_revision"),
        sa.CheckConstraint("revision > 0 AND version > 0", name="versions_positive"),
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
        schema="hms",
    )
    op.execute("""CREATE FUNCTION hms.guard_source_agreement() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'Agreement history cannot be deleted' USING ERRCODE='23514';
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF (NEW.id,NEW.company_id,NEW.source_id,NEW.revision,NEW.created_at,NEW.actor)
            IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.source_id,OLD.revision,
                              OLD.created_at,OLD.actor)
          OR NEW.version <> OLD.version + 1
          OR (OLD.status <> 'draft' AND (NEW.status = 'draft' OR (NEW.terms,NEW.currency)
              IS DISTINCT FROM (OLD.terms,OLD.currency))) THEN
          RAISE EXCEPTION 'Published agreement identity/rules are immutable' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER source_agreement_guard BEFORE UPDATE OR DELETE ON hms.source_agreements
      FOR EACH ROW EXECUTE FUNCTION hms.guard_source_agreement();
    CREATE TRIGGER source_agreement_truncate_guard BEFORE TRUNCATE ON hms.source_agreements
      FOR EACH STATEMENT EXECUTE FUNCTION hms.guard_source_agreement();""")


def downgrade():
    raise RuntimeError(
        "Agreement/source history requires an explicit reviewed data plan; downgrade refused"
    )
