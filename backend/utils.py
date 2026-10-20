"""
Shared helpers: response envelope, JSON-safe values, money and weight parsing.

Every endpoint answers with the same shape so the frontend never has to guess:

    success -> {"status": "success", "data": <...>, "message": "..."}
    failure -> {"status": "error",   "message": "..."}
"""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from flask import jsonify

CENTS = Decimal("0.01")

PRODUCT_CATEGORIES = ["Pork", "Beef", "Chicken", "Processed", "Offal"]
CUSTOMER_TYPES = ["Retail", "Wholesale"]
PAYMENT_METHODS = ["Cash", "GCash", "Credit"]
SETTLEMENT_METHODS = ["Cash", "GCash"]


class ApiError(Exception):
    """Raised anywhere in a route to return a clean message to the client."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------- serialising

def json_value(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def clean_row(row):
    if not row:
        return row
    return {key: json_value(value) for key, value in row.items()}


def clean_rows(rows):
    return [clean_row(row) for row in (rows or [])]


# ---------------------------------------------------------------- validation

def money(value, field="amount", allow_zero=True):
    """Parse a peso amount into a 2-decimal Decimal."""
    try:
        amount = Decimal(str(value if value not in (None, "") else 0))
    except (InvalidOperation, TypeError, ValueError):
        raise ApiError(f"{field} must be a number.")

    amount = amount.quantize(CENTS)

    if amount < 0:
        raise ApiError(f"{field} cannot be negative.")
    if not allow_zero and amount == 0:
        raise ApiError(f"{field} must be greater than zero.")

    return amount


def kilos(value, field="weight", allow_zero=False):
    """Parse a weight in kilograms into a 2-decimal Decimal."""
    try:
        weight = Decimal(str(value if value not in (None, "") else 0))
    except (InvalidOperation, TypeError, ValueError):
        raise ApiError(f"{field} must be a number.")

    weight = weight.quantize(CENTS)

    if weight < 0:
        raise ApiError(f"{field} cannot be negative.")
    if not allow_zero and weight <= 0:
        raise ApiError(f"{field} must be greater than zero.")

    return weight


def as_int(value, field="id", required=True):
    if value in (None, "", "null"):
        if required:
            raise ApiError(f"{field} is required.")
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError(f"{field} must be a whole number.")


def text(value, field="value", required=False, max_length=255):
    cleaned = (value or "").strip() if isinstance(value, str) else ""
    if required and not cleaned:
        raise ApiError(f"{field} is required.")
    if len(cleaned) > max_length:
        raise ApiError(f"{field} must be {max_length} characters or fewer.")
    return cleaned or None


def one_of(value, allowed, field, default=None):
    value = value or default
    if value not in allowed:
        raise ApiError(f"{field} must be one of: {', '.join(allowed)}.")
    return value


# ---------------------------------------------------------------- responses

def ok(data=None, message=None, status=200):
    payload = {"status": "success"}
    if data is not None:
        payload["data"] = data
    if message:
        payload["message"] = message
    return jsonify(payload), status


def fail(message, status=400):
    return jsonify({"status": "error", "message": message}), status


# ---------------------------------------------------------------- date range

def date_filter(alias="s", start=None, end=None, column="created_at"):
    """
    Build an inclusive `created_at` range clause plus its params.
    `end` is treated as the whole of that day.
    """
    clause = ""
    params = []

    if start:
        clause += f" AND {alias}.{column} >= %s "
        params.append(f"{start} 00:00:00")

    if end:
        clause += f" AND {alias}.{column} < DATE_ADD(%s, INTERVAL 1 DAY) "
        params.append(f"{end} 00:00:00")

    return clause, params


def percent(part, whole):
    part = Decimal(str(part or 0))
    whole = Decimal(str(whole or 0))
    if whole <= 0:
        return Decimal("0.00")
    return ((part / whole) * 100).quantize(CENTS)