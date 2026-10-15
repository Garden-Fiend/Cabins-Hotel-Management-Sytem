"""Add plural allocation integrity without changing existing business values."""
# ruff: noqa: E501 -- Keep the applied SQL text frozen.

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "a15b20c6d710"
down_revision = "68f75a14d5a4"
branch_labels = depends_on = None


def upgrade():
    op.add_column(
        "reservations",
        sa.Column("multi_room", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="hms",
    )
    for name in ("shared_start", "shared_end"):
        op.add_column("reservations", sa.Column(name, sa.DateTime(timezone=True)), schema="hms")
    op.add_column("reservations", sa.Column("shared_duration_id", UUID()), schema="hms")
    op.create_foreign_key(
        "fk_shared_duration_company",
        "reservations",
        "durations",
        ["shared_duration_id", "company_id"],
        ["id", "company_id"],
        source_schema="hms",
        referent_schema="hms",
    )
    op.create_check_constraint(
        "multi_shared_stay",
        "reservations",
        "NOT multi_room OR (shared_start IS NOT NULL AND shared_end IS NOT NULL AND shared_end > shared_start AND shared_duration_id IS NOT NULL)",
        schema="hms",
    )
    op.add_column("room_allocations", sa.Column("state", sa.Text()), schema="hms")
    op.add_column(
        "room_allocations", sa.Column("removed_at", sa.DateTime(timezone=True)), schema="hms"
    )
    op.create_check_constraint(
        "allocation_state",
        "room_allocations",
        "state IS NULL OR state IN ('reserved','checked_in','checked_out','cancelled','no_show','removed')",
        schema="hms",
    )
    op.create_check_constraint(
        "removed_allocation",
        "room_allocations",
        "removed_at IS NULL OR (state = 'removed' AND NOT blocks_availability AND actual_check_in IS NULL AND actual_check_out IS NULL)",
        schema="hms",
    )
    op.drop_constraint(
        "uq_room_allocations_reservation_id", "room_allocations", schema="hms", type_="unique"
    )
    op.create_index(
        "uq_active_reservation_room",
        "room_allocations",
        ["reservation_id", "room_id"],
        unique=True,
        schema="hms",
        postgresql_where=sa.text("removed_at IS NULL"),
    )
    op.execute("""
    CREATE FUNCTION hms.check_shared_allocations() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE owner_id uuid; r hms.reservations; n integer;
    BEGIN
      IF TG_TABLE_NAME = 'reservations' THEN owner_id := NEW.id;
      ELSE owner_id := COALESCE(NEW.reservation_id, OLD.reservation_id); END IF;
      SELECT * INTO r FROM hms.reservations WHERE id=owner_id FOR UPDATE;
      IF NOT FOUND THEN RETURN NULL; END IF;
      SELECT count(*) INTO n FROM hms.room_allocations WHERE reservation_id=owner_id AND removed_at IS NULL;
      IF n < 1 OR (NOT r.multi_room AND n <> 1) THEN
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
    CREATE CONSTRAINT TRIGGER shared_allocations_guard AFTER INSERT OR UPDATE OR DELETE ON hms.room_allocations
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hms.check_shared_allocations();
    CREATE CONSTRAINT TRIGGER shared_reservation_guard AFTER INSERT OR UPDATE ON hms.reservations
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hms.check_shared_allocations();
    CREATE FUNCTION hms.retain_multi_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS(SELECT 1 FROM hms.reservations WHERE id=OLD.reservation_id AND multi_room) THEN
        RAISE EXCEPTION 'Retain allocation history using removal state' USING ERRCODE='23514';
      END IF; RETURN OLD;
    END $$;
    CREATE TRIGGER retain_multi_allocation BEFORE DELETE ON hms.room_allocations
      FOR EACH ROW EXECUTE FUNCTION hms.retain_multi_allocation();
    """)


def downgrade():
    raise RuntimeError(
        "B2 downgrade requires a reviewed preservation plan; no automatic allocation deletion"
    )
