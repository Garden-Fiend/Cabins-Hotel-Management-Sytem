import sqlalchemy as sa

from app.core_models import audit_events, companies, mutation_receipts
from app.modules.billing.models import pricing_revisions
from app.modules.configuration.models import categories, products
from app.modules.reservations.models import (
    allocations,
    booking_sources,
    durations,
    guests,
    rates,
    reservations,
    room_types,
    rooms,
)

# Ownership invariants apply to every reference, including optional audit/receipt links.
# Keep the original ID foreign keys; these additional keys enforce company consistency.
for table in (guests, room_types, durations, booking_sources, reservations):
    table.append_constraint(
        sa.UniqueConstraint("id", "company_id", name=f"uq_{table.name}_company_identity")
    )

for child, column, parent in (
    (rooms, "room_type_id", room_types),
    (rates, "room_type_id", room_types),
    (rates, "duration_id", durations),
    (reservations, "guest_id", guests),
    (reservations, "booking_source_id", booking_sources),
    (allocations, "reservation_id", reservations),
    (allocations, "duration_id", durations),
    (pricing_revisions, "reservation_id", reservations),
    (audit_events, "reservation_id", reservations),
    (mutation_receipts, "reservation_id", reservations),
):
    child.append_constraint(
        sa.ForeignKeyConstraint(
            [column, "company_id"],
            [parent.c.id, parent.c.company_id],
            name=f"fk_{child.name}_{column}_company",
        )
    )

sa.Index(
    "uq_active_hourly_rate",
    rates.c.company_id,
    rates.c.room_type_id,
    rates.c.duration_id,
    unique=True,
    postgresql_where=sa.text("enabled AND booking_kind = 'hourly'"),
)
rates.append_constraint(
    sa.ForeignKeyConstraint(
        ["duration_id", "company_id", "booking_kind"],
        [durations.c.id, durations.c.company_id, durations.c.kind],
        name="fk_rate_duration_company_kind",
    )
)
sa.Index(
    "uq_active_nightly_rate",
    rates.c.company_id,
    rates.c.room_type_id,
    unique=True,
    postgresql_where=sa.text("enabled AND booking_kind = 'overnight'"),
)

__all__ = [
    "categories",
    "products",
    "companies",
    "audit_events",
    "mutation_receipts",
    "pricing_revisions",
    "allocations",
    "booking_sources",
    "durations",
    "guests",
    "rates",
    "reservations",
    "room_types",
    "rooms",
]
