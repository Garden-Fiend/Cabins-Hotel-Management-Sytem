"""Server pricing for supported accommodation only; no discounts, extras or tax posting."""

from datetime import UTC, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation, localcontext
from zoneinfo import ZoneInfo

from app.errors import DomainError
from app.modules.reservations.schemas import MAX_MINOR, CapturedLine, PricingSnapshot

HOTEL_ZONE = ZoneInfo("Asia/Manila")


def php_minor(value: str | Decimal) -> int:
    """Boundary conversion, never binary floats; half away from zero as documented."""
    if not isinstance(value, (str, Decimal)):
        raise ValueError("Money must be a decimal string or Decimal")
    try:
        amount = Decimal(value)
    except InvalidOperation:
        raise ValueError("Money must be a valid decimal") from None
    if not amount.is_finite() or abs(amount) > Decimal(MAX_MINOR) / 100:
        raise ValueError("Money must be finite and within supported precision")
    with localcontext() as context:
        context.prec = 50
        minor = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if abs(minor) > MAX_MINOR:
        raise ValueError("Money exceeds supported precision")
    return minor


def stay_end(start: datetime, duration, company) -> datetime:
    if start.tzinfo is None or start.utcoffset() is None:
        raise DomainError("invalid_time", "Start must include a UTC offset", 422)
    if company["hotel_timezone"] != "Asia/Manila":
        raise DomainError("unsupported_timezone", "Only Asia/Manila is supported", 422)
    start = start.astimezone(UTC)
    try:
        if duration["kind"] == "hourly":
            end = start + timedelta(minutes=duration["minutes"])
        else:
            date = start.astimezone(HOTEL_ZONE).date() + timedelta(days=duration["nights"])
            checkout = company["default_check_out_time"]
            if not isinstance(checkout, time) or checkout.tzinfo is not None:
                raise ValueError("Invalid hotel checkout policy")
            end = datetime.combine(date, checkout, HOTEL_ZONE).astimezone(UTC)
    except (OverflowError, TypeError, ValueError):
        raise DomainError("invalid_time", "Stay exceeds supported date range", 422) from None
    if end <= start:
        raise DomainError("invalid_time", "Checkout must follow arrival", 422)
    return end


def capture_price(room, room_type, duration, rate) -> PricingSnapshot:
    if rate["currency"] != "PHP" or rate["booking_kind"] != duration["kind"]:
        raise DomainError("invalid_rate", "Rate is incompatible with this duration", 422)
    quantity = duration["nights"] if duration["kind"] == "overnight" else 1
    amount = rate["unit_amount_minor"] * quantity
    if amount > MAX_MINOR:
        raise DomainError("price_out_of_range", "Price exceeds supported monetary precision", 422)
    line = CapturedLine(
        room_id=room["id"],
        room_number=room["number"],
        room_type_id=room_type["id"],
        room_type_label=room_type["label"],
        duration_id=duration["id"],
        duration_source_id=duration["source_id"],
        rate_id=rate["id"],
        rate_source_id=rate["source_id"],
        booking_kind=duration["kind"],
        unit_amount_minor=rate["unit_amount_minor"],
        quantity=quantity,
        amount_minor=amount,
    )
    return PricingSnapshot(lines=(line,), total_minor=amount)
