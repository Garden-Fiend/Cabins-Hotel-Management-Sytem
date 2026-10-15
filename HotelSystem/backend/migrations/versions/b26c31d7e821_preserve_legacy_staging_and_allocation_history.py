"""Preserve legacy staging; require complete plural aggregates and retained identities."""

# ruff: noqa: E501 -- Keep the applied SQL text frozen.
from alembic import op

revision = "b26c31d7e821"
down_revision = "a15b20c6d710"
branch_labels = depends_on = None


def upgrade():
    op.execute("""
    CREATE OR REPLACE FUNCTION hms.check_shared_allocations() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE owner_id uuid; r hms.reservations; n integer;
    BEGIN
      IF TG_TABLE_NAME = 'reservations' THEN owner_id := NEW.id;
      ELSE owner_id := COALESCE(NEW.reservation_id, OLD.reservation_id); END IF;
      SELECT * INTO r FROM hms.reservations WHERE id=owner_id FOR UPDATE;
      IF NOT FOUND THEN RETURN NULL; END IF;
      SELECT count(*) INTO n FROM hms.room_allocations WHERE reservation_id=owner_id AND removed_at IS NULL;
      -- Legacy database clients could stage a parent before an allocation. Keep that boundary;
      -- plural aggregates must always be complete, including during a concurrent last-room removal.
      IF (r.multi_room AND n < 1) OR (NOT r.multi_room AND n > 1) THEN
        RAISE EXCEPTION 'Reservation requires its canonical allocation set' USING ERRCODE='23514';
      END IF;
      IF r.multi_room AND EXISTS(SELECT 1 FROM hms.room_allocations a WHERE a.reservation_id=owner_id AND a.removed_at IS NULL AND
        (a.state IS NULL OR a.scheduled_start<>r.shared_start OR a.scheduled_end<>r.shared_end OR a.duration_id<>r.shared_duration_id
         OR (a.state='checked_in' AND (a.actual_check_in IS NULL OR a.actual_check_out IS NOT NULL))
         OR (a.state='checked_out' AND (a.actual_check_in IS NULL OR a.actual_check_out IS NULL)))) THEN
        RAISE EXCEPTION 'Allocations must share the reservation stay and valid lifecycle' USING ERRCODE='23514';
      END IF;
      RETURN NULL;
    END $$;
    CREATE OR REPLACE FUNCTION hms.retain_multi_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS(SELECT 1 FROM hms.reservations WHERE id=OLD.reservation_id AND multi_room) THEN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Retain allocation history using removal state' USING ERRCODE='23514';
        END IF;
        IF NEW.id<>OLD.id OR NEW.room_id<>OLD.room_id OR NEW.reservation_id<>OLD.reservation_id
           OR NEW.company_id<>OLD.company_id OR (OLD.removed_at IS NOT NULL AND to_jsonb(NEW)<>to_jsonb(OLD)) THEN
          RAISE EXCEPTION 'Allocation identity and removed history cannot change' USING ERRCODE='23514';
        END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
    END $$;
    CREATE TRIGGER retain_multi_allocation_update BEFORE UPDATE ON hms.room_allocations
      FOR EACH ROW EXECUTE FUNCTION hms.retain_multi_allocation();
    """)


def downgrade():
    raise RuntimeError(
        "A reviewed legacy compatibility and allocation preservation plan is required"
    )
