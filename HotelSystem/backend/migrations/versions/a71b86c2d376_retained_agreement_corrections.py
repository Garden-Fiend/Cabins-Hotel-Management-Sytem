"""Preserve agreement retirement and corrections under proven historical terms."""

from alembic import op

revision = "a71b86c2d376"
down_revision = "f60a75b1c265"
branch_labels = depends_on = None


def upgrade():
    op.execute("""CREATE OR REPLACE FUNCTION hms.guard_captured_agreement_period() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS (SELECT 1 FROM hms.booking_financial_captures c
        WHERE c.agreement_id=OLD.id AND
          (c.confirmation_date < NEW.effective_from OR
           (NEW.effective_to IS NOT NULL AND c.confirmation_date > NEW.effective_to))) THEN
        RAISE EXCEPTION 'Agreement period excludes captured booking uses' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION hms.validate_booking_financial_capture() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE a hms.source_agreements%ROWTYPE; prior hms.booking_financial_captures%ROWTYPE;
            retained boolean := false;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM hms.reservations r WHERE r.id=NEW.reservation_id
        AND r.company_id=NEW.company_id AND r.version=NEW.reservation_version
        AND r.booking_source_id=NEW.source_id) THEN
        RAISE EXCEPTION 'Capture must match its owned reservation version/source'
          USING ERRCODE='23514';
      END IF;
      SELECT * INTO prior FROM hms.booking_financial_captures c
        WHERE c.reservation_id=NEW.reservation_id AND c.company_id=NEW.company_id
          AND c.reservation_version<NEW.reservation_version
        ORDER BY c.reservation_version DESC LIMIT 1;
      IF FOUND THEN
        retained := prior.source_id=NEW.source_id
          AND prior.confirmation_date=NEW.confirmation_date
          AND prior.agreement_id IS NOT DISTINCT FROM NEW.agreement_id
          AND prior.snapshot->'terms' IS NOT DISTINCT FROM NEW.snapshot->'terms'
          AND prior.snapshot->'agreement_version'
            IS NOT DISTINCT FROM NEW.snapshot->'agreement_version'
          AND prior.snapshot->'agreement_revision'
            IS NOT DISTINCT FROM NEW.snapshot->'agreement_revision';
      END IF;
      IF NEW.agreement_id IS NOT NULL AND NOT retained THEN
        SELECT * INTO a FROM hms.source_agreements WHERE id=NEW.agreement_id FOR SHARE;
        IF NOT FOUND OR a.source_id<>NEW.source_id OR a.company_id<>NEW.company_id
          OR a.status<>'active' OR NEW.confirmation_date<a.effective_from
          OR (a.effective_to IS NOT NULL AND NEW.confirmation_date>a.effective_to)
          OR (NEW.snapshot->>'agreement_version')::integer IS DISTINCT FROM a.version
          OR (NEW.snapshot->>'agreement_revision')::integer IS DISTINCT FROM a.revision
          OR NEW.snapshot->'terms' IS DISTINCT FROM a.terms THEN
          RAISE EXCEPTION 'Capture must retain applicable owned published terms'
            USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END $$;""")


def downgrade():
    raise RuntimeError("Retained agreement uses require a reviewed downgrade plan")
