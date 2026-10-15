"""Add explicit independent stays without changing existing dates or financial history."""
# ruff: noqa: E501 -- Applied SQL is retained verbatim.

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "c37d42e8f932"
down_revision = "b26c31d7e821"
branch_labels = depends_on = None


def upgrade():
    op.add_column(
        "reservations",
        sa.Column("independent_stays", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="hms",
    )
    op.add_column(
        "reservations", sa.Column("default_stay_start", sa.DateTime(timezone=True)), schema="hms"
    )
    op.add_column("reservations", sa.Column("default_duration_id", UUID()), schema="hms")
    op.add_column(
        "room_allocations",
        sa.Column("uses_reservation_stay", sa.Boolean(), nullable=False, server_default=sa.true()),
        schema="hms",
    )
    op.create_foreign_key(
        "fk_default_duration_company",
        "reservations",
        "durations",
        ["default_duration_id", "company_id"],
        ["id", "company_id"],
        source_schema="hms",
        referent_schema="hms",
    )
    op.create_check_constraint(
        "independent_stay_defaults",
        "reservations",
        "NOT independent_stays OR (multi_room AND default_stay_start IS NOT NULL "
        "AND default_duration_id IS NOT NULL)",
        schema="hms",
    )
    op.drop_constraint(
        op.f("ck_reservations_multi_shared_stay"), "reservations", schema="hms", type_="check"
    )
    op.create_check_constraint(
        "multi_shared_stay",
        "reservations",
        "NOT multi_room OR (shared_start IS NOT NULL AND shared_end IS NOT NULL "
        "AND shared_end > shared_start AND (independent_stays OR shared_duration_id IS NOT NULL))",
        schema="hms",
    )
    op.execute("""
    CREATE OR REPLACE FUNCTION hms.check_shared_allocations() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE owner_id uuid; r hms.reservations; n integer; first_start timestamptz;
            last_end timestamptz; duration_count integer; common_duration uuid;
    BEGIN
      IF TG_TABLE_NAME = 'reservations' THEN owner_id := NEW.id;
      ELSE owner_id := COALESCE(NEW.reservation_id, OLD.reservation_id); END IF;
      SELECT * INTO r FROM hms.reservations WHERE id=owner_id FOR UPDATE;
      IF NOT FOUND THEN RETURN NULL; END IF;
      SELECT count(*), min(scheduled_start), max(scheduled_end), count(DISTINCT duration_id)
        INTO n, first_start, last_end, duration_count
        FROM hms.room_allocations WHERE reservation_id=owner_id AND removed_at IS NULL;
      IF (r.multi_room AND n < 1) OR (NOT r.multi_room AND n > 1) THEN
        RAISE EXCEPTION 'Reservation requires its canonical allocation set' USING ERRCODE='23514';
      END IF;
      IF r.multi_room AND EXISTS(
        SELECT 1 FROM hms.room_allocations a
        WHERE a.reservation_id=owner_id AND a.removed_at IS NULL AND
          (a.state IS NULL OR
           (a.state='checked_in' AND (a.actual_check_in IS NULL OR a.actual_check_out IS NOT NULL)) OR
           (a.state='checked_out' AND (a.actual_check_in IS NULL OR a.actual_check_out IS NULL)))) THEN
        RAISE EXCEPTION 'Allocations require valid lifecycle instants' USING ERRCODE='23514';
      END IF;
      IF r.multi_room AND NOT r.independent_stays AND EXISTS(
        SELECT 1 FROM hms.room_allocations a WHERE a.reservation_id=owner_id
        AND a.removed_at IS NULL AND
          (a.scheduled_start<>r.shared_start OR a.scheduled_end<>r.shared_end
           OR a.duration_id<>r.shared_duration_id OR NOT a.uses_reservation_stay)) THEN
        RAISE EXCEPTION 'Shared allocations must retain their common stay' USING ERRCODE='23514';
      END IF;
      IF r.independent_stays THEN
        SELECT duration_id INTO common_duration FROM hms.room_allocations
          WHERE reservation_id=owner_id AND removed_at IS NULL LIMIT 1;
        IF r.shared_start IS DISTINCT FROM first_start OR r.shared_end IS DISTINCT FROM last_end
           OR (duration_count=1 AND r.shared_duration_id IS DISTINCT FROM common_duration)
           OR (duration_count<>1 AND r.shared_duration_id IS NOT NULL) THEN
          RAISE EXCEPTION 'Parent dates/duration must reflect the active allocation range'
            USING ERRCODE='23514';
        END IF;
        IF EXISTS(SELECT 1 FROM hms.room_allocations a WHERE a.reservation_id=owner_id
          AND a.removed_at IS NULL AND a.uses_reservation_stay AND
          (a.scheduled_start<>r.default_stay_start OR a.duration_id<>r.default_duration_id)) THEN
          RAISE EXCEPTION 'Inherited allocations must follow the reservation stay template'
            USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NULL;
    END $$;
    """)


def downgrade():
    raise RuntimeError("Independent stays require a reviewed preservation plan before downgrade")
