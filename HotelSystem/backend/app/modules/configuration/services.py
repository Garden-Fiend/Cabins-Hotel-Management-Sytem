"""Allowlisted, versioned definition commands; never reprice saved reservations."""

from decimal import ROUND_HALF_UP, Decimal
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.errors import DomainError
from app.models import (
    allocations,
    audit_events,
    categories,
    discount_presets,
    durations,
    products,
    rates,
    room_type_inclusions,
    room_types,
    rooms,
)
from app.modules.configuration.schemas import CategoryRead, DiscountPresetRead, ProductRead
from app.modules.reservations.inclusions import read_defaults, save_defaults
from app.modules.reservations.references import DurationRead, RateRead, RoomRead, RoomTypeRead
from app.mutations import replay_or_lock, request_hash, save_receipt

DEFINITIONS = {
    "discount-presets": (discount_presets, DiscountPresetRead),
    "room-types": (room_types, RoomTypeRead),
    "rooms": (rooms, RoomRead),
    "durations": (durations, DurationRead),
    "rates": (rates, RateRead),
    "categories": (categories, CategoryRead),
    "products": (products, ProductRead),
}


def has_active_assignment(session, service, room_id):
    return (
        session.scalar(
            sa.select(allocations.c.id)
            .where(
                allocations.c.company_id == service.context.company_id,
                allocations.c.room_id == room_id,
                sa.or_(
                    allocations.c.blocks_availability,
                    sa.and_(
                        allocations.c.actual_check_in.is_not(None),
                        allocations.c.actual_check_out.is_(None),
                    ),
                ),
            )
            .limit(1)
        )
        is not None
    )


def save_definition(service, kind, request, key, id=None):
    table, read = DEFINITIONS[kind]
    operation = f"configuration.{kind}.{'update' if id else 'create'}"
    # Preserve historical room-command hashes when the new optional status was omitted.
    omitted_status = kind == "rooms" and "operational_status" not in request.model_fields_set
    digest = request_hash(
        request,
        resource_id=id,
        exclude_fields={"operational_status"} if omitted_status else frozenset(),
    )
    try:
        with service.transaction() as session:
            replay = replay_or_lock(session, service.context, operation, key, digest)
            if replay is not None:
                return read.model_validate(replay)
            if kind == "discount-presets" and request.method == "final_price":
                # Match reservation pricing order before exclusively locking a definition.
                # Re-read/validate the owned rates below while these shared locks remain held.
                covered_rates = [
                    service.owned(session, rates, p.rate_id) for p in request.rate_prices
                ]
                for duration_id in sorted(
                    {r["duration_id"] for r in covered_rates if r["duration_id"]}, key=str
                ):
                    service.owned(session, durations, duration_id, lock=True)
                if request.target_room_type_id:
                    service.owned(session, room_types, request.target_room_type_id, lock=True)
                for covered in sorted(request.rate_prices, key=lambda p: str(p.rate_id)):
                    service.owned(session, rates, covered.rate_id, lock=True)
                if request.target_product_id:
                    service.owned(session, products, request.target_product_id, lock=True)
            if kind == "rates":
                # Match booking pricing locks: duration -> type -> rate. Holding an
                # edited rate first could deadlock a booking resolving that same rate.
                if request.duration_id is not None:
                    service.owned(session, durations, request.duration_id, lock=True)
                service.owned(session, room_types, request.room_type_id, lock=True)
            previous = service.owned(session, table, id, lock=True, exclusive=True) if id else None
            if previous is not None:
                if previous["version"] != request.expected_version:
                    raise DomainError(
                        "version_conflict", "Definition changed; reload and review before retrying"
                    )
                if previous["version"] >= 2**31 - 1:
                    raise DomainError("version_exhausted", "Definition version cannot be advanced")
            values = request.model_dump(exclude={"expected_version", "default_inclusions"})
            if kind == "discount-presets":
                values["rate_prices"] = [p.model_dump(mode="json") for p in request.rate_prices]
                # Omission on an ordinary definition update retains backward-compatible clears.
                if request.method == "fixed":
                    # Hash the original validated intent; normalize stored PHP values separately.
                    values["value"] = Decimal(request.value).quantize(
                        Decimal("0.01"), rounding=ROUND_HALF_UP
                    )
                if request.method == "final_price":
                    retiring_unchanged = (
                        previous is not None
                        and not request.enabled
                        and previous["method"] == "final_price"
                        and previous["target_room_type_id"] == request.target_room_type_id
                        and previous["target_product_id"] == request.target_product_id
                        and previous["rate_prices"] == values["rate_prices"]
                        and previous["replacement_unit_amount_minor"]
                        == request.replacement_unit_amount_minor
                    )
                    for covered in request.rate_prices:
                        rate = service.owned(session, rates, covered.rate_id, lock=True)
                        duration_active = (
                            rate["duration_id"] is None
                            or service.owned(session, durations, rate["duration_id"], lock=True)[
                                "enabled"
                            ]
                        )
                        if rate["room_type_id"] != request.target_room_type_id or (
                            not retiring_unchanged
                            and (
                                not rate["enabled"]
                                or not duration_active
                                or covered.unit_amount_minor > rate["unit_amount_minor"]
                            )
                        ):
                            raise DomainError(
                                "invalid_override_rate",
                                "Replacement must cover an active owned room rate "
                                "and not exceed its base unit price",
                                422,
                            )
                    if request.target_product_id:
                        product = service.owned(
                            session, products, request.target_product_id, lock=True
                        )
                        if (
                            not retiring_unchanged
                            and request.replacement_unit_amount_minor > product["unit_amount_minor"]
                        ):
                            raise DomainError(
                                "invalid_override_price",
                                "Replacement cannot exceed the product unit price",
                                422,
                            )
                if request.target_room_type_id:
                    target = service.owned(
                        session, room_types, request.target_room_type_id, lock=True
                    )
                    if (
                        request.enabled
                        or previous is None
                        or previous["target_room_type_id"] != request.target_room_type_id
                    ) and (not target["enabled"] or target["archived"]):
                        raise DomainError("inactive_reference", "Select an active room type", 422)
                if request.target_product_id:
                    target = service.owned(session, products, request.target_product_id, lock=True)
                    category = service.owned(session, categories, target["category_id"], lock=True)
                    if (
                        request.enabled
                        or previous is None
                        or previous["target_product_id"] != request.target_product_id
                    ) and (
                        category["type"] in ("breakfast", "inclusion", "amenities")
                        or not category["enabled"]
                        or not target["enabled"]
                        or target["archived"]
                    ):
                        raise DomainError(
                            "invalid_preset_target", "Select an active chargeable product", 422
                        )
            old_defaults = (
                read_defaults(session, service.context.company_id, id)
                if kind == "room-types" and id
                else []
            )
            if kind == "products":
                category = service.owned(session, categories, values["category_id"], lock=True)
                if category["type"] == "breakfast":
                    raise DomainError(
                        "virtual_category",
                        "Breakfast eligibility uses existing products",
                        422,
                    )
                if (
                    previous
                    and previous["category_id"] != values["category_id"]
                    and session.scalar(
                        sa.select(room_type_inclusions.c.product_id)
                        .where(room_type_inclusions.c.product_id == id)
                        .limit(1)
                    )
                    is not None
                ):
                    raise DomainError(
                        "inclusion_in_use",
                        "Remove room-type defaults before reclassifying this inclusion",
                    )
                if not category["enabled"] and (
                    previous is None or previous["category_id"] != category["id"]
                ):
                    raise DomainError(
                        "inactive_reference", "New products require an active category", 422
                    )
                if category["type"] == "amenities" and (
                    values["unit_amount_minor"] != 0 or values["available_for_sale"]
                ):
                    raise DomainError(
                        "invalid_product",
                        "Amenities must be zero-priced and not available for sale",
                        422,
                    )
                if category["type"] in ("extra", "inclusion") and values["available_for_sale"]:
                    raise DomainError(
                        "invalid_product",
                        "Special charges and inclusions are not ordinary sale items",
                        422,
                    )
                if values["archived"]:
                    values["enabled"] = False
            elif kind == "categories":
                if (
                    previous
                    and previous["system_defined"]
                    and (values["type"] != previous["type"] or not values["enabled"])
                ):
                    raise DomainError(
                        "protected_category",
                        "System-defined categories cannot be archived or reclassified",
                    )
                if (
                    previous
                    and previous["type"] != values["type"]
                    and session.scalar(
                        sa.select(products.c.id).where(products.c.category_id == id).limit(1)
                    )
                    is not None
                ):
                    raise DomainError(
                        "category_in_use", "Categories with products cannot change their type"
                    )
            elif kind == "rooms":
                status = values["operational_status"]
                if status is None:
                    status = (
                        previous["operational_status"]
                        if previous and previous["operational"] == values["operational"]
                        else ("operational" if values["operational"] else "unavailable")
                    )
                values["operational_status"] = status
                values["operational"] = status == "operational"
                room_type = service.owned(session, room_types, values["room_type_id"], lock=True)
                if not room_type["enabled"] or room_type["archived"]:
                    if previous is None or previous["room_type_id"] != room_type["id"]:
                        raise DomainError(
                            "inactive_reference", "New assignments require an active room type", 422
                        )
                if previous is not None:
                    assigned = has_active_assignment(session, service, id)
                    if (
                        previous["number"] != values["number"]
                        and session.scalar(
                            sa.select(allocations.c.id).where(allocations.c.room_id == id).limit(1)
                        )
                        is not None
                    ):
                        raise DomainError(
                            "assigned_room_number",
                            "Room numbers referenced by reservations cannot change",
                        )
                    if assigned and (
                        values["room_type_id"] != previous["room_type_id"]
                        or not values["enabled"]
                        or values["archived"]
                        or not values["operational"]
                    ):
                        raise DomainError(
                            "active_assignment",
                            "Active assigned rooms cannot change type or become unavailable",
                        )
                values["display_name"] = values["display_name"] or room_type["label"]
            elif kind == "room-types":
                if values["archived"]:
                    values["enabled"] = False
                if (
                    not values["enabled"]
                    and session.scalar(
                        sa.select(rooms.c.id)
                        .where(
                            rooms.c.company_id == service.context.company_id,
                            rooms.c.room_type_id == id,
                            rooms.c.enabled,
                            ~rooms.c.archived,
                        )
                        .limit(1)
                    )
                    is not None
                ):
                    raise DomainError(
                        "active_rooms", "Reassign or archive rooms before disabling their type"
                    )
                duplicate = session.scalar(
                    sa.select(room_types.c.id)
                    .where(
                        room_types.c.company_id == service.context.company_id,
                        sa.func.lower(room_types.c.label) == values["label"].lower(),
                        room_types.c.id != id if id else sa.true(),
                    )
                    .limit(1)
                )
                if duplicate:
                    raise DomainError(
                        "duplicate_definition", "A room type with this name already exists"
                    )
            elif kind == "rates":
                service.owned(session, room_types, values["room_type_id"], lock=True)
                if values["duration_id"] is not None:
                    duration = service.owned(session, durations, values["duration_id"], lock=True)
                    if duration["kind"] != "hourly":
                        raise DomainError(
                            "invalid_rate_basis", "Hourly rates require an hourly duration", 422
                        )
            elif kind == "durations":
                duplicate = session.scalar(
                    sa.select(durations.c.id)
                    .where(
                        durations.c.company_id == service.context.company_id,
                        sa.func.lower(
                            sa.func.coalesce(
                                sa.func.nullif(durations.c.label, ""), durations.c.source_id
                            )
                        )
                        == values["label"].lower(),
                        durations.c.id != id if id else sa.true(),
                    )
                    .limit(1)
                )
                if duplicate:
                    raise DomainError(
                        "duplicate_definition", "A duration with this name already exists"
                    )
            if previous is None:
                identity = uuid4()
                if kind != "rooms":
                    values["source_id"] = f"local-{identity}"
                statement = table.insert().values(
                    id=identity, company_id=service.context.company_id, **values
                )
            else:
                statement = (
                    table.update()
                    .where(
                        table.c.id == id,
                        table.c.company_id == service.context.company_id,
                        table.c.version == request.expected_version,
                    )
                    .values(**values, version=table.c.version + 1)
                )
            saved = session.execute(statement.returning(table)).mappings().one_or_none()
            if saved is None:
                raise DomainError(
                    "version_conflict", "Definition changed; reload and review before retrying"
                )
            if kind == "room-types" and "default_inclusions" in request.model_fields_set:
                save_defaults(
                    service, session, saved["id"], request.default_inclusions, old_defaults
                )
            result_values = {
                name: saved[name] for name in read.model_fields if name != "default_inclusions"
            }
            if kind == "room-types":
                result_values["default_inclusions"] = read_defaults(
                    session, service.context.company_id, saved["id"]
                )
            result = read(**result_values)
            # DTO captures supported public fields; generated identities/versions are server-owned.
            before = (
                read(
                    **{
                        name: old_defaults if name == "default_inclusions" else previous[name]
                        for name in read.model_fields
                    }
                ).model_dump(mode="json")
                if previous
                else None
            )
            session.execute(
                audit_events.insert().values(
                    id=uuid4(),
                    company_id=service.context.company_id,
                    event_type=operation,
                    actor=service.context.actor,
                    attribution=service.context.attribution,
                    occurred_at=sa.func.clock_timestamp(),
                    before=before,
                    after=result.model_dump(mode="json"),
                )
            )
            save_receipt(session, service.context, operation, key, digest, result)
            return result
    except IntegrityError as error:
        state = getattr(error.orig, "sqlstate", None)
        if state == "23505":
            raise DomainError(
                "duplicate_definition", "A conflicting definition already exists"
            ) from error
        if state == "23503":
            raise DomainError(
                "reference_in_use", "Referenced definitions cannot change to an incompatible kind"
            ) from error
        raise
