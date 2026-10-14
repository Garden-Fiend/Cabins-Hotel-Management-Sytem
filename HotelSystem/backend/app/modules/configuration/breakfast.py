"""Versioned eligibility configuration; ordinary selling prices are never changed."""

from uuid import uuid4

import sqlalchemy as sa

from app.errors import DomainError
from app.models import audit_events, breakfast_eligibility, categories, companies, products
from app.modules.reservations.schemas import BreakfastConfigurationRead
from app.mutations import replay_or_lock, request_hash, save_receipt


def read_eligibility(session, company_id):
    return [
        dict(product_id=row.product_id, kind=row.kind, enabled=row.enabled)
        for row in session.execute(
            sa.select(breakfast_eligibility)
            .where(breakfast_eligibility.c.company_id == company_id)
            .order_by(breakfast_eligibility.c.product_id)
        )
    ]


def save_breakfast(service, request, key):
    operation, digest = "configuration.breakfast.update", request_hash(request)
    with service.transaction() as session:
        replay = replay_or_lock(session, service.context, operation, key, digest)
        if replay is not None:
            return BreakfastConfigurationRead.model_validate(replay)
        company = service.owned(
            session, companies, service.context.company_id, lock=True, exclusive=True
        )
        if company["breakfast_version"] != request.expected_version:
            raise DomainError(
                "version_conflict", "Breakfast configuration changed; reload and review"
            )
        if company["breakfast_version"] >= 2**31 - 1:
            raise DomainError("version_exhausted", "Breakfast configuration version cannot advance")
        old = read_eligibility(session, service.context.company_id)
        old_ids = {str(item["product_id"]) for item in old}
        for item in sorted(request.items, key=lambda item: str(item.product_id)):
            product = service.owned(session, products, item.product_id, lock=True)
            category = service.owned(session, categories, product["category_id"], lock=True)
            if str(item.product_id) not in old_ids and category["type"] != "ordinary":
                raise DomainError(
                    "invalid_breakfast_product", "New eligibility requires an ordinary product", 422
                )
            if item.enabled and (
                not product["enabled"] or product["archived"] or not category["enabled"]
            ):
                if not any(
                    str(p["product_id"]) == str(item.product_id) and p["enabled"] for p in old
                ):
                    raise DomainError(
                        "inactive_breakfast_product",
                        "New eligibility requires an active product",
                        422,
                    )
        session.execute(
            breakfast_eligibility.delete().where(
                breakfast_eligibility.c.company_id == service.context.company_id
            )
        )
        if request.items:
            session.execute(
                breakfast_eligibility.insert(),
                [
                    dict(company_id=service.context.company_id, **item.model_dump())
                    for item in request.items
                ],
            )
        session.execute(
            companies.update()
            .where(companies.c.id == company["id"])
            .values(breakfast_version=companies.c.breakfast_version + 1)
        )
        result = BreakfastConfigurationRead(
            id=company["id"], version=company["breakfast_version"] + 1, items=request.items
        )
        session.execute(
            audit_events.insert().values(
                id=uuid4(),
                company_id=company["id"],
                event_type=operation,
                actor=service.context.actor,
                attribution=service.context.attribution,
                occurred_at=sa.func.clock_timestamp(),
                before=dict(
                    version=company["breakfast_version"],
                    items=[
                        dict(product_id=str(i["product_id"]), kind=i["kind"], enabled=i["enabled"])
                        for i in old
                    ],
                ),
                after=result.model_dump(mode="json"),
            )
        )
        save_receipt(session, service.context, operation, key, digest, result)
        return result
