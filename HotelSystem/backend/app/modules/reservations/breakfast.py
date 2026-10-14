"""Nonfinancial nightly selections, validated against hotel service dates and eligibility."""

from datetime import date, datetime, time

import sqlalchemy as sa

from app.errors import DomainError
from app.models import breakfast_eligibility, categories, products
from app.modules.reservations.pricing import HOTEL_ZONE


def valid_slot(item, start, end, kind, guests):
    service_date = date.fromisoformat(str(item["service_date"]))
    return (
        kind == "overnight"
        and 1 <= item["guest_number"] <= guests
        and start.astimezone(HOTEL_ZONE).date() < service_date
        and datetime.combine(service_date, time(), HOTEL_ZONE) < end
    )


def capture_breakfast(service, session, start, end, kind, guests, old=(), intents=None):
    retained = [item for item in old if valid_slot(item, start, end, kind, guests)]
    if intents is None:
        return retained
    old_slots = {(str(i["service_date"]), i["guest_number"]): i for i in retained}
    resolved = {}
    for product_id in sorted(
        {
            id
            for item in intents
            if item.status == "included"
            for id in (item.meal_id, item.beverage_id)
        },
        key=str,
    ):
        product = service.owned(session, products, product_id, lock=True)
        category = service.owned(session, categories, product["category_id"], lock=True)
        eligible = (
            session.execute(
                sa.select(breakfast_eligibility)
                .where(
                    breakfast_eligibility.c.product_id == product_id,
                    breakfast_eligibility.c.company_id == service.context.company_id,
                )
                .with_for_update(read=True)
            )
            .mappings()
            .one_or_none()
        )
        resolved[product_id] = (product, category, eligible)
    result = []
    for intent in intents:
        item = intent.model_dump(mode="json")
        if not valid_slot(item, start, end, kind, guests):
            raise DomainError(
                "invalid_breakfast_slot",
                "Breakfast requires a nightly service date and assigned guest",
                422,
            )
        previous = old_slots.get((str(intent.service_date), intent.guest_number))
        for role in ("meal", "beverage") if intent.status == "included" else ():
            id = getattr(intent, role + "_id")
            if previous and previous["status"] == "included" and previous[role + "_id"] == str(id):
                item[role + "_label"] = previous[role + "_label"]
                continue
            product, category, eligible = resolved[id]
            if (
                not eligible
                or eligible["kind"] != role
                or not eligible["enabled"]
                or not product["enabled"]
                or product["archived"]
                or not category["enabled"]
            ):
                raise DomainError(
                    "ineligible_breakfast", "Select an active eligible meal and beverage", 422
                )
            item[role + "_label"] = product["label"]
        result.append(dict(item, quantity=1, unit_amount_minor=0, amount_minor=0))
    return result
