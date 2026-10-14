"""Captured nonfinancial entitlements; mirror roomTypeInclusions.ts reconciliation."""

from uuid import UUID

import sqlalchemy as sa

from app.errors import DomainError
from app.models import categories, products, room_type_inclusions


def read_defaults(session, company_id, room_type_id):
    return [
        dict(product_id=row.product_id, quantity=row.quantity)
        for row in session.execute(
            sa.select(room_type_inclusions.c.product_id, room_type_inclusions.c.quantity)
            .where(
                room_type_inclusions.c.company_id == company_id,
                room_type_inclusions.c.room_type_id == room_type_id,
            )
            .order_by(room_type_inclusions.c.position)
        )
    ]


def inclusion_product(service, session, id):
    product = service.owned(session, products, UUID(str(id)), lock=True)
    category = service.owned(session, categories, product["category_id"], lock=True)
    if category["type"] != "inclusion" or not category["system_defined"]:
        raise DomainError("invalid_inclusion", "Select an existing inclusion", 422)
    return product


def save_defaults(service, session, room_type_id, intents, previous):
    old_ids = {str(item["product_id"]) for item in previous}
    for intent in sorted(intents, key=lambda item: str(item.product_id)):
        product = inclusion_product(service, session, intent.product_id)
        if (not product["enabled"] or product["archived"]) and str(
            intent.product_id
        ) not in old_ids:
            raise DomainError("inactive_inclusion", "New defaults require an active inclusion", 422)
    session.execute(
        room_type_inclusions.delete().where(
            room_type_inclusions.c.company_id == service.context.company_id,
            room_type_inclusions.c.room_type_id == room_type_id,
        )
    )
    if intents:
        session.execute(
            room_type_inclusions.insert(),
            [
                dict(
                    company_id=service.context.company_id,
                    room_type_id=room_type_id,
                    product_id=item.product_id,
                    quantity=item.quantity,
                    position=position,
                )
                for position, item in enumerate(intents)
            ],
        )


def reconcile(old, defaults):
    old_map = {item["product_id"]: item for item in old}
    result = [dict(item) for item in old if item["source"] == "manual"]
    manual = {item["product_id"] for item in result}
    for item in defaults:
        id = item["product_id"]
        if id in manual:
            continue
        previous = old_map.get(id)
        overridden = bool(previous and previous.get("overridden") and previous["quantity"] > 0)
        result.append(
            dict(
                item,
                quantity=previous["quantity"] if overridden else item["quantity"],
                source="default",
                overridden=overridden,
                label=previous["label"] if previous else item["label"],
            )
        )
    return result


def capture_inclusions(
    service, session, room_type_id, old=(), intents=None, *, switch=False, merge=False
):
    defaults = []
    if switch:
        for item in read_defaults(session, service.context.company_id, room_type_id):
            product = inclusion_product(service, session, item["product_id"])
            if product["enabled"] and not product["archived"]:
                defaults.append(
                    dict(
                        product_id=str(product["id"]),
                        quantity=item["quantity"],
                        label=product["label"],
                        source="default",
                        overridden=False,
                    )
                )
    base = reconcile(old, defaults) if switch else list(old)
    if intents is None:
        return base
    base_map = {item["product_id"]: item for item in base}
    result = []
    for intent in sorted(intents, key=lambda item: str(item.product_id)):
        # Validate once in UUID order, avoiding shared-product lock inversions.
        if str(intent.product_id) not in base_map:
            product = inclusion_product(service, session, intent.product_id)
            if not product["enabled"] or product["archived"]:
                raise DomainError(
                    "inactive_inclusion", "New selections require active inclusions", 422
                )
            base_map[str(intent.product_id)] = dict(
                product_id=str(product["id"]),
                label=product["label"],
                quantity=0,
                source="manual",
                overridden=False,
            )
    for intent in intents:
        item = base_map[str(intent.product_id)]
        if intent.overridden and item["source"] != "default":
            raise DomainError(
                "invalid_inclusion_override", "Only room-type defaults have overrides", 422
            )
        result.append(
            dict(
                item,
                quantity=intent.quantity,
                overridden=(
                    item["source"] == "default"
                    and (
                        item["overridden"]
                        or intent.overridden
                        or intent.quantity != item["quantity"]
                    )
                ),
            )
        )
    if merge:
        selected = {item["product_id"]: item for item in base}
        selected.update({item["product_id"]: item for item in result})
        return list(selected.values())
    return result
