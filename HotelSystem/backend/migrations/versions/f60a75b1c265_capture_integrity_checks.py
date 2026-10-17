"""Validate append-only commercial capture identity and monetary precision."""

from alembic import op

revision = "f60a75b1c265"
down_revision = "e59f64a0b154"
branch_labels = depends_on = None


def upgrade():
    op.create_check_constraint(
        "snapshot_identity",
        "booking_financial_captures",
        "coalesce(snapshot->>'id'=id::text AND snapshot->>'source_id'=source_id::text "
        "AND (snapshot->>'reservation_version')::integer=reservation_version "
        "AND (snapshot->'input'->>'confirmation_date')::date=confirmation_date, false)",
        schema="hms",
    )
    op.create_check_constraint(
        "snapshot_precision",
        "booking_financial_captures",
        " AND ".join(
            f"coalesce(jsonb_typeof(snapshot->'figures'->'{field}')='number' AND "
            f"(snapshot->'figures'->>'{field}')::numeric BETWEEN 0 AND 9007199254740991 AND "
            f"(snapshot->'figures'->>'{field}')::numeric="
            f"trunc((snapshot->'figures'->>'{field}')::numeric),false)"
            for field in (
                "standard_accommodation_minor",
                "discounted_accommodation_minor",
                "contractual_accommodation_minor",
                "additional_charges_minor",
                "total_minor",
                "commission_minor",
            )
        )
        + " AND coalesce((snapshot->'figures'->>'hotel_received_minor')::numeric=0,false)",
        schema="hms",
    )
    op.execute("""CREATE FUNCTION hms.validate_booking_financial_capture() RETURNS trigger
    LANGUAGE plpgsql AS $$ DECLARE a hms.source_agreements%ROWTYPE; BEGIN
      IF NOT EXISTS (SELECT 1 FROM hms.reservations r WHERE r.id=NEW.reservation_id
        AND r.company_id=NEW.company_id AND r.version=NEW.reservation_version
        AND r.booking_source_id=NEW.source_id) THEN
        RAISE EXCEPTION 'Capture must match its owned reservation version/source'
          USING ERRCODE='23514';
      END IF;
      IF NEW.agreement_id IS NOT NULL THEN
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
    END $$;
    CREATE TRIGGER booking_financial_capture_validation BEFORE INSERT
      ON hms.booking_financial_captures FOR EACH ROW
      EXECUTE FUNCTION hms.validate_booking_financial_capture();""")


def downgrade():
    raise RuntimeError("Capture integrity requires an explicit reviewed downgrade plan")
