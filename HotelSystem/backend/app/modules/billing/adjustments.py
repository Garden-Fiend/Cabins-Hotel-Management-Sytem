"""Saved operational adjustment command. No invoice, payment or ledger posting."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import sqlalchemy as sa

from app.errors import DomainError
from app.models import allocations, audit_events, guests, pricing_revisions, reservations
from app.modules.billing.charges import capture_charges
from app.modules.reservations.breakfast import capture_breakfast
from app.modules.reservations.inclusions import capture_inclusions
from app.modules.reservations.schemas import (
    MAX_MINOR,
    AdjustedPricingSnapshot,
    AdjustmentCapture,
    ChargedPricingSnapshot,
    DiscountedPricingSnapshot,
    ManualDiscountIntent,
    MultiPricingSnapshot,
    OverridePricingSnapshot,
    ReservationRead,
)
from app.mutations import replay_or_lock, request_hash, save_receipt


def adjusted_snapshot(captured, adjustments, discounts=None, *, service=None, session=None):
    if "channel" in captured:
        from app.modules.reservations.booking_financials import apply_capture

        raw = dict(captured)
        commercial = raw.pop("channel")
        raw.pop("channel_figures", None)
        raw["schema_version"] = 6 if all("allocation_id" in line for line in raw["lines"]) else 5
        base = adjusted_snapshot(raw, adjustments, discounts, service=service, session=session)
        return apply_capture(base, commercial)
    if discounts is not None or "discounts" in captured:
        from app.modules.billing.discounts import calculate_discounts

        old = {item["id"]: item for item in captured.get("discounts", [])}
        old_overrides = {o["id"]: o for o in captured.get("price_overrides", [])}
        for identity, override in old_overrides.items():
            old[identity] = {
                **override,
                "method": "final_price",
                "value": "0",
                "target_id": override["line_id"].removeprefix("room:")
                if override["scope"] == "room"
                else override["line_id"],
            }
        selected = (
            discounts
            if discounts is not None
            else tuple(
                ManualDiscountIntent.model_validate(
                    {name: item[name] for name in ManualDiscountIntent.model_fields if name in item}
                )
                for item in old.values()
            )
        )
        now = datetime.now(UTC).isoformat()
        if any(
            (str(item.id) in old_overrides and item.method != "final_price")
            or (
                str(item.id) in old
                and str(item.id) not in old_overrides
                and item.method == "final_price"
            )
            for item in selected
        ):
            raise DomainError(
                "invalid_discount_identity",
                "Remove the old selection before adding a different discount classification",
                422,
            )
        from app.modules.billing.overrides import capture_override
        from app.modules.billing.presets import capture_preset_intent

        intents = [
            capture_preset_intent(service, session, captured, item, old.get(str(item.id)), now)
            for item in selected
            if item.method != "final_price"
        ]
        overrides = [
            capture_override(service, session, captured, item, old_overrides.get(str(item.id)), now)
            for item in selected
            if item.method == "final_price"
        ]
        targets = [o["line_id"] for o in overrides]
        if len(set(targets)) != len(targets):
            raise DomainError(
                "duplicate_override", "Select at most one final unit price per charge line", 422
            )
        if any(
            (f"room:{d['target_id']}" if d["scope"] == "room" else d["target_id"]) in targets
            for d in intents
            if d.get("provenance") == "preset"
        ):
            raise DomainError(
                "duplicate_preset", "Replace the existing line preset explicitly", 422
            )
        preset_targets = [
            (d["scope"], d["preset_id"] if d["scope"] == "reservation" else d["target_id"])
            for d in intents
            if d["provenance"] == "preset"
        ]
        if len(set(preset_targets)) != len(preset_targets):
            raise DomainError(
                "duplicate_preset",
                "Select one preset per room/item and apply a reservation preset only once",
                422,
            )
        raw = {
            **captured,
            "adjustments": [item.model_dump(mode="json") for item in adjustments],
            "charges": captured.get("charges", []),
        }
        try:
            result, reduction, total = calculate_discounts(raw, intents, overrides)
        except ValueError as error:
            raise DomainError("invalid_discount", str(error), 422) from None
        with_overrides = bool(overrides) or "price_overrides" in captured
        multi = captured.get("schema_version") == 6
        return (
            MultiPricingSnapshot
            if multi
            else OverridePricingSnapshot
            if with_overrides
            else DiscountedPricingSnapshot
        )(
            **{
                **raw,
                "schema_version": 6 if multi else 5 if with_overrides else 4,
                "calculation_version": "direct-multi-room-v1"
                if multi
                else "direct-unit-overrides-v1"
                if with_overrides
                else "direct-manual-discounts-v1",
                **(
                    {
                        "price_overrides": overrides,
                        "price_override_total_minor": sum(o["effect_minor"] for o in overrides),
                    }
                    if with_overrides
                    else {}
                ),
                "pipeline_version": 2,
                "discounts": result,
                "discount_total_minor": reduction,
                "total_minor": total,
            }
        )

    subtotal = sum(line["amount_minor"] for line in captured["lines"]) + sum(
        item["amount_minor"] for item in captured.get("charges", [])
    )
    total = subtotal + sum(item.amount_minor for item in adjustments)
    if (
        subtotal > MAX_MINOR
        or abs(total) > MAX_MINOR
        or abs(sum(item.amount_minor for item in adjustments)) > MAX_MINOR
    ):
        raise DomainError(
            "price_out_of_range", "Adjusted amount exceeds supported exact monetary range", 422
        )
    model = ChargedPricingSnapshot if "charges" in captured else AdjustedPricingSnapshot
    return model(
        **{
            **captured,
            "schema_version": 3 if "charges" in captured else 2,
            "calculation_version": "direct-charges-v1"
            if "charges" in captured
            else "direct-adjustments-v1",
            "adjustments": adjustments,
            "total_minor": max(0, total),
        }
    )


def save_adjustments(
    service,
    id,
    request,
    key,
    *,
    purchases=False,
    discounts=False,
    inclusions=False,
    breakfast=False,
):
    operation = (
        "reservation.breakfast_edit"
        if breakfast
        else "reservation.inclusions_edit"
        if inclusions
        else "reservation.discounts_edit"
        if discounts
        else "reservation.charges_edit"
        if purchases
        else "reservation.billing_edit"
    )
    digest = request_hash(request, resource_id=id)
    with service.transaction() as session:
        replay = replay_or_lock(session, service.context, operation, key, digest)
        if replay is not None:
            return ReservationRead.model_validate(replay)
        reservation = service.owned(session, reservations, id, lock=True, exclusive=True)
        if reservation["multi_room"]:
            raise DomainError("plural_command_required", "Use the explicit multi-room command", 409)
        if reservation["version"] != request.expected_version:
            raise DomainError("version_conflict", "Reservation changed; reload before editing")
        if reservation["version"] >= 2**31 - 1:
            raise DomainError("version_exhausted", "Reservation version cannot be advanced")
        if reservation["status"] not in ("confirmed", "reserved", "checked_in"):
            raise DomainError(
                "invalid_transition",
                "This reservation lifecycle no longer permits operational bill editing",
            )
        service.owned(session, guests, request.guest_id, lock=True)
        allocation = (
            session.execute(
                sa.select(allocations)
                .where(
                    allocations.c.company_id == service.context.company_id,
                    allocations.c.reservation_id == id,
                )
                .with_for_update()
            )
            .mappings()
            .one_or_none()
        )
        if allocation is None:
            raise DomainError("incomplete_reservation", "Reservation requires integrity review")
        previous = service.read_in_transaction(session, reservation).model_dump(mode="json")
        captured = previous["pricing"]["snapshot"]
        if purchases or (
            (discounts or inclusions or breakfast) and "charges" in request.model_fields_set
        ):
            captured = {
                **captured,
                "charges": [
                    item.model_dump(mode="json")
                    for item in capture_charges(
                        service, session, captured, request.charges, reservation_id=id
                    )
                ],
            }
        adjustments = (
            request.adjustments
            if "adjustments" in request.model_fields_set
            else tuple(AdjustmentCapture(**item) for item in captured.get("adjustments", []))
        )
        snapshot = adjusted_snapshot(
            captured,
            adjustments,
            request.discounts if "discounts" in request.model_fields_set else None,
            service=service,
            session=session,
        )
        counts = request.model_dump(exclude_unset=True, include={"adults", "children"})
        if (inclusions or breakfast) and "inclusions" in request.model_fields_set:
            counts["inclusions"] = capture_inclusions(
                service,
                session,
                UUID(previous["pricing"]["snapshot"]["lines"][0]["room_type_id"]),
                allocation["inclusions"],
                request.inclusions,
            )
        if breakfast or allocation["breakfast"]:
            counts["breakfast"] = capture_breakfast(
                service,
                session,
                allocation["scheduled_start"],
                allocation["scheduled_end"],
                previous["pricing"]["snapshot"]["lines"][0]["booking_kind"],
                counts.get("adults", allocation["adults"])
                + counts.get("children", allocation["children"]),
                allocation["breakfast"],
                request.breakfast if "breakfast" in request.model_fields_set else None,
            )
        if counts:
            session.execute(
                allocations.update().where(allocations.c.id == allocation["id"]).values(**counts)
            )
        updated = (
            session.execute(
                reservations.update()
                .where(
                    reservations.c.id == id,
                    reservations.c.company_id == service.context.company_id,
                    reservations.c.version == request.expected_version,
                )
                .values(
                    guest_id=request.guest_id,
                    note=request.note
                    if "note" in request.model_fields_set
                    else reservation["note"],
                    version=reservations.c.version + 1,
                    updated_at=sa.func.clock_timestamp(),
                )
                .returning(reservations)
            )
            .mappings()
            .one_or_none()
        )
        if updated is None:
            raise DomainError("version_conflict", "Reservation changed; reload before editing")
        financial = not (inclusions or breakfast) or bool(
            request.model_fields_set & {"charges", "discounts", "adjustments"}
        )
        if financial and previous["pricing"]["revision"] >= 2**31 - 1:
            raise DomainError("pricing_version_exhausted", "Pricing revision cannot be advanced")
        if financial:
            session.execute(
                pricing_revisions.insert().values(
                    id=uuid4(),
                    company_id=service.context.company_id,
                    reservation_id=id,
                    revision=previous["pricing"]["revision"] + 1,
                    reservation_version=updated["version"],
                    currency=snapshot.currency,
                    total_minor=snapshot.total_minor,
                    calculation_version=snapshot.calculation_version,
                    snapshot=snapshot.model_dump(mode="json"),
                    created_at=sa.func.clock_timestamp(),
                )
            )
        current = service.read_in_transaction(session, updated).model_dump(mode="json")
        session.execute(
            audit_events.insert().values(
                id=uuid4(),
                company_id=service.context.company_id,
                reservation_id=id,
                event_type="reservation.breakfast_updated"
                if breakfast
                else "reservation.inclusions_updated"
                if inclusions
                else "reservation.billing_updated",
                reservation_version=updated["version"],
                actor=service.context.actor,
                attribution=service.context.attribution,
                occurred_at=sa.func.clock_timestamp(),
                before={
                    field: previous[field]
                    for field in ("version", "note", "guest", "allocation", "pricing")
                },
                after={
                    field: current[field]
                    for field in ("version", "note", "guest", "allocation", "pricing")
                },
            )
        )
        result = service.read_in_transaction(session, updated)
        save_receipt(session, service.context, operation, key, digest, result, reservation_id=id)
        return result
