"""Resolve new purchases from owned active catalog; retain existing captured unit prices."""

import sqlalchemy as sa

from app.errors import DomainError
from app.models import categories, pricing_revisions, products
from app.modules.reservations.schemas import MAX_MINOR, ChargeCapture


def capture_charges(service, session, captured, intents, *, reservation_id):
    old = {item["id"]: item for item in captured.get("charges", [])}
    new_ids = [str(item.id) for item in intents if str(item.id) not in old]
    if (
        new_ids
        and session.scalar(
            sa.select(pricing_revisions.c.id)
            .where(
                pricing_revisions.c.company_id == service.context.company_id,
                pricing_revisions.c.reservation_id == reservation_id,
                sa.or_(
                    *(
                        pricing_revisions.c.snapshot.contains({"charges": [{"id": item}]})
                        for item in new_ids
                    )
                ),
            )
            .limit(1)
        )
        is not None
    ):
        raise DomainError(
            "charge_identity_conflict",
            "Removed charge identities cannot be reused; add a new purchase",
            422,
        )
    new_products = {}
    # Stable ordering for shared catalog locks. No inventory decrement is implied.
    for product_id in sorted(
        {item.product_id for item in intents if str(item.id) not in old}, key=str
    ):
        product = service.owned(session, products, product_id, lock=True)
        category = service.owned(session, categories, product["category_id"], lock=True)
        if (
            not product["enabled"]
            or product["archived"]
            or not product["available_for_sale"]
            or not category["enabled"]
            or category["type"] != "ordinary"
        ):
            raise DomainError(
                "product_unavailable",
                "New purchases require an active sellable ordinary product",
                422,
            )
        new_products[product_id] = product
    result = []
    for intent in intents:
        previous = old.get(str(intent.id))
        if previous:
            if (
                previous["product_id"] != str(intent.product_id)
                or previous["usage"] != intent.usage
            ):
                raise DomainError(
                    "charge_identity_conflict",
                    "A captured charge identity cannot be reused for another product",
                    422,
                )
            label, unit = previous["label"], previous["unit_amount_minor"]
        else:
            product = new_products[intent.product_id]
            label, unit = product["label"], product["unit_amount_minor"]
        amount = unit * intent.quantity
        if amount > MAX_MINOR:
            raise DomainError(
                "price_out_of_range", "Purchase amount exceeds supported monetary precision", 422
            )
        result.append(
            ChargeCapture(
                **intent.model_dump(), label=label, unit_amount_minor=unit, amount_minor=amount
            )
        )
    return result
