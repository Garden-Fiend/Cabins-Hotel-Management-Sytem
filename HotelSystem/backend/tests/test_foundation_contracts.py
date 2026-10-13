from datetime import UTC, datetime, time
from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.modules.reservations.pricing import php_minor, stay_end
from app.modules.reservations.schemas import (
    CapturedLine,
    PricingSnapshot,
    ReservationCreate,
    ReservationEdit,
)


def request_values():
    return dict(
        guest_id=uuid4(),
        booking_source_id=uuid4(),
        room_id=uuid4(),
        duration_id=uuid4(),
        scheduled_start="2026-11-10T14:07:12.123456+08:00",
        adults=2,
        children=0,
    )


@pytest.mark.parametrize(
    "extra",
    [
        "price",
        "total_minor",
        "status",
        "company_id",
        "audit",
        "actual_check_in",
        "commission",
        "discounts",
        "rooms",
    ],
)
def test_create_rejects_client_authority_and_unsupported_features(extra):
    with pytest.raises(ValidationError):
        ReservationCreate(**request_values(), **{extra: 1})


@pytest.mark.parametrize(
    "field,value",
    [
        ("adults", 0),
        ("adults", True),
        ("adults", 1.5),
        ("children", -1),
        ("children", "1"),
        ("scheduled_start", "2026-11-10T14:07:00"),
        ("scheduled_start", 1794294000),
        ("scheduled_start", "1794294000"),
        ("scheduled_start", "2026-11-10T14:07:12.1234567+08:00"),
        ("scheduled_start", "0001-01-01T00:00:00+14:00"),
    ],
)
def test_create_requires_integer_counts_and_aware_iso_time(field, value):
    values = request_values()
    values[field] = value
    with pytest.raises(ValidationError):
        ReservationCreate(**values)


def test_utc_normalization_preserves_precision():
    value = ReservationCreate(**request_values())
    assert value.scheduled_start == datetime(2026, 11, 10, 6, 7, 12, 123456, tzinfo=UTC)
    assert value.scheduled_start.tzinfo == UTC


@pytest.mark.parametrize(
    "amount,expected", [("1.005", 101), ("-1.005", -101), ("0", 0), ("2200.00", 220000)]
)
def test_php_minor_half_away_from_zero(amount, expected):
    assert php_minor(amount) == expected


@pytest.mark.parametrize("amount", [True, 1.005, "NaN", "Infinity", "invalid", Decimal("1e50")])
def test_php_minor_rejects_binary_or_invalid_money(amount):
    with pytest.raises(ValueError):
        php_minor(amount)


def test_hourly_and_overnight_use_distinct_time_policies():
    company = dict(hotel_timezone="Asia/Manila", default_check_out_time=time(12))
    start = datetime(2026, 12, 31, 15, 7, 1, 123456, tzinfo=UTC)  # 23:07 hotel time
    assert stay_end(start, dict(kind="hourly", minutes=360), company) == datetime(
        2026, 12, 31, 21, 7, 1, 123456, tzinfo=UTC
    )
    assert stay_end(start, dict(kind="overnight", nights=2), company) == datetime(
        2027, 1, 2, 4, tzinfo=UTC
    )


def test_captured_snapshot_is_exact_and_frozen():
    values = dict(
        room_id=uuid4(),
        room_number="101",
        room_type_id=uuid4(),
        room_type_label="Standard",
        duration_id=uuid4(),
        duration_source_id="2-nights",
        rate_id=uuid4(),
        rate_source_id="nightly",
        booking_kind="overnight",
        unit_amount_minor=220000,
        quantity=2,
        amount_minor=440000,
    )
    line = CapturedLine(**values)
    snapshot = PricingSnapshot(lines=(line,), total_minor=440000)
    with pytest.raises(ValidationError):
        snapshot.total_minor = 1
    with pytest.raises(ValidationError):
        CapturedLine(**dict(values, amount_minor=220000))
    with pytest.raises(ValidationError):
        PricingSnapshot(lines=(line,), total_minor=1)


def test_edit_contract_requires_version_and_explicit_non_null_change():
    assert ReservationEdit(expected_version=1, note=" ").note == ""
    for values in (
        {"note": "hello"},
        {"expected_version": 1},
        {"expected_version": 1, "note": None},
        {"expected_version": 0, "note": "hello"},
    ):
        with pytest.raises(ValidationError):
            ReservationEdit(**values)
