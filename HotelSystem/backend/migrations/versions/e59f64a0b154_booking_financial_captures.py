"""Owned append-only contractual captures; no payments or historical backfill."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "e59f64a0b154"
down_revision = "d48e53f9a043"
branch_labels = depends_on = None


def upgrade():
    op.add_column("reservations", sa.Column("external_booking_reference", sa.Text), schema="hms")
    op.create_index(
        "uq_booking_external_reference",
        "reservations",
        ["company_id", "booking_source_id", "external_booking_reference"],
        unique=True,
        schema="hms",
        postgresql_where=sa.text("external_booking_reference IS NOT NULL"),
    )
    op.create_unique_constraint(
        "uq_agreement_owned_source",
        "source_agreements",
        ["id", "company_id", "source_id"],
        schema="hms",
    )
    op.create_table(
        "booking_financial_captures",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "company_id", UUID(as_uuid=True), sa.ForeignKey("hms.companies.id"), nullable=False
        ),
        sa.Column("reservation_id", UUID(as_uuid=True), nullable=False),
        sa.Column("source_id", UUID(as_uuid=True), nullable=False),
        sa.Column("agreement_id", UUID(as_uuid=True)),
        sa.Column("reservation_version", sa.Integer, nullable=False),
        sa.Column("confirmation_date", sa.Date, nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("snapshot", JSONB, nullable=False),
        sa.CheckConstraint("reservation_version > 0", name="version_positive"),
        sa.CheckConstraint("jsonb_typeof(snapshot) = 'object'", name="snapshot_object"),
        sa.UniqueConstraint("reservation_id", "reservation_version"),
        sa.ForeignKeyConstraint(
            ["reservation_id", "company_id"], ["hms.reservations.id", "hms.reservations.company_id"]
        ),
        sa.ForeignKeyConstraint(
            ["source_id", "company_id"],
            ["hms.booking_sources.id", "hms.booking_sources.company_id"],
        ),
        sa.ForeignKeyConstraint(
            ["agreement_id", "company_id", "source_id"],
            [
                "hms.source_agreements.id",
                "hms.source_agreements.company_id",
                "hms.source_agreements.source_id",
            ],
        ),
        schema="hms",
    )
    op.execute("""CREATE FUNCTION hms.guard_booking_financial_capture() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'Contractual capture history is immutable' USING ERRCODE='23514';
    END $$;
    CREATE TRIGGER booking_financial_capture_guard BEFORE UPDATE OR DELETE
      ON hms.booking_financial_captures FOR EACH ROW
      EXECUTE FUNCTION hms.guard_booking_financial_capture();
    CREATE TRIGGER booking_financial_capture_truncate_guard BEFORE TRUNCATE
      ON hms.booking_financial_captures FOR EACH STATEMENT
      EXECUTE FUNCTION hms.guard_booking_financial_capture();
    CREATE FUNCTION hms.guard_captured_agreement_period() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM hms.booking_financial_captures c
        WHERE c.agreement_id=OLD.id AND
          (NEW.status <> 'active' OR c.confirmation_date < NEW.effective_from OR
           (NEW.effective_to IS NOT NULL AND c.confirmation_date > NEW.effective_to))) THEN
        RAISE EXCEPTION 'Agreement period/status conflicts with captured booking uses'
          USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER captured_agreement_period_guard BEFORE UPDATE ON hms.source_agreements
      FOR EACH ROW EXECUTE FUNCTION hms.guard_captured_agreement_period();""")


def downgrade():
    raise RuntimeError(
        "Captured commercial history requires a reviewed data plan; downgrade refused"
    )
