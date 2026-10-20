"""
Janeth's Meat Shop — backend API and static file server.

ONE FILE. Everything the shop needs is defined right here: configuration,
input validation, the MySQL connection layer, every route (products,
customers, suppliers, sales, inventory, analytics, reports), and the error
handlers that turn a database problem into a message the shop can read.

This is deliberately a single file rather than split across modules. A
missing import or a route that never got registered is the single most
common way a Flask backend silently loses functionality — everything in
this file is registered the moment Python reads it, top to bottom, so
there is no separate "did I wire this up" step to forget.

RUN IT
    pip install -r requirements.txt
    python app.py

It serves the API at /api/... AND the frontend (the .html/.css/.js files)
from the same process, at http://127.0.0.1:5000 by default — one process,
one port, nothing else to start.

CONFIGURE IT
    Either edit the Config class below, or set environment variables
    before running (MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB,
    MYSQL_PORT, API_HOST, API_PORT, API_DEBUG). Environment variables,
    if set, always win.
"""

import os
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor
from flask import Flask, Blueprint, jsonify, request, send_from_directory
from flask_cors import CORS


# =============================================================
# 1. CONFIGURATION
#
# These defaults match a standard local install: MySQL on its default
# port 3306, the API on 127.0.0.1:5000. If you changed MySQL's port in
# XAMPP, set MYSQL_PORT to match it — a mismatch here is the single most
# common reason the shop shows "cannot reach the database" even though
# MySQL itself is running.
# =============================================================

class Config:
    MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
    MYSQL_USER = os.getenv("MYSQL_USER", "root")
    MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
    MYSQL_DB = os.getenv("MYSQL_DB", "janeth_meat_shop")
    MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))

    FRONTEND_DIR = os.getenv(
        "FRONTEND_DIR",
        os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "frontend"
        )
    )

    HOST = os.getenv("API_HOST", "127.0.0.1")
    PORT = int(os.getenv("API_PORT", "5000"))
    DEBUG = os.getenv("API_DEBUG", "1") == "1"


# =============================================================
# 2. UTILITIES & VALIDATION
# =============================================================

CENTS = Decimal("0.01")
PRODUCT_CATEGORIES = ["Pork", "Beef", "Chicken", "Processed", "Offal"]
CUSTOMER_TYPES = ["Retail", "Wholesale"]
PAYMENT_METHODS = ["Cash", "GCash", "Credit"]
SETTLEMENT_METHODS = ["Cash", "GCash"]


class ApiError(Exception):
    """Raised anywhere below for a problem the shop caused (bad input,
    a missing record). Always caught and turned into a clean JSON error —
    never a crash."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


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


def money(value, field="amount", allow_zero=True):
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


def ok(data=None, message=None, status=200):
    payload = {"status": "success"}
    if data is not None:
        payload["data"] = data
    if message:
        payload["message"] = message
    return jsonify(payload), status


def fail(message, status=400):
    return jsonify({"status": "error", "message": message}), status


def date_filter(alias="s", start=None, end=None, column="created_at"):
    """Build an inclusive `created_at` range clause plus its params.
    `end` is treated as the whole of that day."""
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


# =============================================================
# 3. DATABASE LAYER
# =============================================================

def get_connection():
    return pymysql.connect(
        host=Config.MYSQL_HOST,
        user=Config.MYSQL_USER,
        password=Config.MYSQL_PASSWORD,
        database=Config.MYSQL_DB,
        port=Config.MYSQL_PORT,
        cursorclass=DictCursor,
        autocommit=False,
        charset="utf8mb4",
    )


@contextmanager
def transaction():
    """A block of writes that either all succeed or all roll back —
    used for checkout, restocks, and anything that touches more than
    one table."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def query():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            yield cur
    finally:
        conn.close()


def fetch_all(sql, params=None):
    with query() as cur:
        cur.execute(sql, params or [])
        return cur.fetchall()


def fetch_one(sql, params=None):
    with query() as cur:
        cur.execute(sql, params or [])
        return cur.fetchone()


# =============================================================
# 4. ROUTES
#
# One Blueprint per part of the shop, each carrying its own URL prefix.
# Keeping them as Blueprints (rather than flattening into bare @app.route
# calls) costs nothing here, because step 5 below registers every single
# one of them automatically — there is no list to remember to update.
# =============================================================

# ----------------------------------------------------------------------
# HEALTH
# ----------------------------------------------------------------------

bp = Blueprint("health", __name__, url_prefix="/api")


@bp.get("/health")
def health():
    row = fetch_one(
        """
        SELECT DATABASE() AS database_name,
               VERSION() AS mysql_version,
               NOW() AS server_time
        """
    )
    counts = fetch_one(
        """
        SELECT
            (SELECT COUNT(*) FROM products WHERE is_active = TRUE) AS products,
            (SELECT COUNT(*) FROM customers) AS customers,
            (SELECT COUNT(*) FROM suppliers) AS suppliers,
            (SELECT COUNT(*) FROM sales) AS sales
        """
    )
    return ok({
        "database": row["database_name"],
        "mysql_version": row["mysql_version"],
        "server_time": row["server_time"].isoformat(),
        "counts": counts,
    })

health_bp = bp


# ----------------------------------------------------------------------
# PRODUCTS
# ----------------------------------------------------------------------

bp = Blueprint("products", __name__, url_prefix="/api/products")

SELECT_PRODUCT = """
    SELECT
        p.id,
        p.meat_cut,
        p.category,
        p.cost_per_kilo,
        p.price_per_kilo,
        p.stock_kilos,
        p.reorder_level_kilos,
        p.supplier_id,
        s.supplier_name,
        (p.price_per_kilo - p.cost_per_kilo) AS profit_per_kilo,
        CASE
            WHEN p.price_per_kilo > 0
            THEN ((p.price_per_kilo - p.cost_per_kilo) / p.price_per_kilo) * 100
            ELSE 0
        END AS margin_percent,
        (p.stock_kilos * p.cost_per_kilo) AS stock_value,
        CASE
            WHEN p.stock_kilos <= 0 THEN 'Out of Stock'
            WHEN p.stock_kilos <= p.reorder_level_kilos THEN 'Low Stock'
            ELSE 'In Stock'
        END AS stock_status,
        p.is_active,
        p.created_at
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
"""


@bp.get("")
def list_products():
    category = request.args.get("category", "All")
    search = (request.args.get("search") or "").strip()
    include_inactive = request.args.get("include_inactive") == "1"
    low_stock_only = request.args.get("low_stock") == "1"

    sql = SELECT_PRODUCT + " WHERE 1=1 "
    params = []

    if not include_inactive:
        sql += " AND p.is_active = TRUE "

    if category and category != "All":
        sql += " AND p.category = %s "
        params.append(category)

    if low_stock_only:
        sql += " AND p.stock_kilos <= p.reorder_level_kilos "

    if search:
        sql += " AND (p.meat_cut LIKE %s OR p.category LIKE %s OR s.supplier_name LIKE %s) "
        like = f"%{search}%"
        params.extend([like, like, like])

    sql += " ORDER BY p.category, p.meat_cut "

    return ok(clean_rows(fetch_all(sql, params)))


@bp.get("/<int:product_id>")
def get_product(product_id):
    row = fetch_one(SELECT_PRODUCT + " WHERE p.id = %s", [product_id])
    if not row:
        raise ApiError("Product not found.", 404)
    return ok(clean_row(row))


def _read_payload(data, require_stock):
    payload = {
        "meat_cut": text(data.get("meat_cut"), "Product name", required=True, max_length=100),
        "category": one_of(data.get("category"), PRODUCT_CATEGORIES, "Category"),
        "cost_per_kilo": money(data.get("cost_per_kilo"), "Cost per kilo"),
        "price_per_kilo": money(data.get("price_per_kilo"), "Selling price per kilo", allow_zero=False),
        "reorder_level_kilos": kilos(data.get("reorder_level_kilos", 5), "Reorder level", allow_zero=True),
        "supplier_id": as_int(data.get("supplier_id"), "Supplier", required=False),
    }

    if payload["price_per_kilo"] < payload["cost_per_kilo"]:
        raise ApiError("Selling price cannot be lower than supplier cost.")

    if require_stock:
        payload["stock_kilos"] = kilos(data.get("stock_kilos", 0), "Opening stock", allow_zero=True)

    return payload


@bp.post("")
def add_product():
    data = request.get_json(silent=True) or {}
    p = _read_payload(data, require_stock=True)

    with transaction() as cur:
        cur.execute(
            "SELECT id FROM products WHERE meat_cut = %s AND is_active = TRUE",
            (p["meat_cut"],),
        )
        if cur.fetchone():
            raise ApiError("A product with this name already exists.", 409)

        if p["supplier_id"]:
            cur.execute("SELECT id FROM suppliers WHERE id = %s", (p["supplier_id"],))
            if not cur.fetchone():
                raise ApiError("Supplier not found.", 404)

        cur.execute(
            """
            INSERT INTO products
                (meat_cut, category, cost_per_kilo, price_per_kilo,
                 stock_kilos, reorder_level_kilos, supplier_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                p["meat_cut"], p["category"], p["cost_per_kilo"],
                p["price_per_kilo"], p["stock_kilos"],
                p["reorder_level_kilos"], p["supplier_id"],
            ),
        )
        product_id = cur.lastrowid

        if p["stock_kilos"] > 0:
            cur.execute(
                """
                INSERT INTO inventory_logs
                    (product_id, supplier_id, added_kilos, cost_per_kilo, log_type, notes)
                VALUES (%s, %s, %s, %s, 'Initial Stock', %s)
                """,
                (
                    product_id, p["supplier_id"], p["stock_kilos"],
                    p["cost_per_kilo"], "Opening stock recorded on product creation",
                ),
            )

    return ok(
        {"product_id": product_id},
        f"{p['meat_cut']} saved to the catalogue.",
        201,
    )


@bp.put("/<int:product_id>")
def update_product(product_id):
    data = request.get_json(silent=True) or {}
    p = _read_payload(data, require_stock=False)

    with transaction() as cur:
        cur.execute("SELECT id FROM products WHERE id = %s", (product_id,))
        if not cur.fetchone():
            raise ApiError("Product not found.", 404)

        cur.execute(
            """
            SELECT id FROM products
            WHERE meat_cut = %s AND id <> %s AND is_active = TRUE
            """,
            (p["meat_cut"], product_id),
        )
        if cur.fetchone():
            raise ApiError("Another product already uses this name.", 409)

        cur.execute(
            """
            UPDATE products SET
                meat_cut = %s,
                category = %s,
                cost_per_kilo = %s,
                price_per_kilo = %s,
                reorder_level_kilos = %s,
                supplier_id = %s
            WHERE id = %s
            """,
            (
                p["meat_cut"], p["category"], p["cost_per_kilo"],
                p["price_per_kilo"], p["reorder_level_kilos"],
                p["supplier_id"], product_id,
            ),
        )

    return ok(message=f"{p['meat_cut']} updated.")


@bp.delete("/<int:product_id>")
def archive_product(product_id):
    """Soft delete. Sales history keeps pointing at the product."""
    with transaction() as cur:
        cur.execute("SELECT meat_cut FROM products WHERE id = %s", (product_id,))
        row = cur.fetchone()
        if not row:
            raise ApiError("Product not found.", 404)

        cur.execute("UPDATE products SET is_active = FALSE WHERE id = %s", (product_id,))

    return ok(message=f"{row['meat_cut']} archived. Past sales are unaffected.")


@bp.post("/<int:product_id>/restore")
def restore_product(product_id):
    with transaction() as cur:
        cur.execute("UPDATE products SET is_active = TRUE WHERE id = %s", (product_id,))
        if cur.rowcount == 0:
            raise ApiError("Product not found.", 404)
    return ok(message="Product restored to the catalogue.")

products_bp = bp


# ----------------------------------------------------------------------
# CUSTOMERS
# ----------------------------------------------------------------------

bp = Blueprint("customers", __name__, url_prefix="/api")

SELECT_CUSTOMER = """
    SELECT
        c.id,
        c.full_name,
        c.phone_number,
        c.customer_type,
        c.credit_balance,
        c.address,
        c.created_at,
        (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS sale_count,
        (SELECT COALESCE(SUM(s.total_amount), 0) FROM sales s WHERE s.customer_id = c.id)
            AS lifetime_value,
        (SELECT MAX(cp.paid_at) FROM credit_payments cp WHERE cp.customer_id = c.id)
            AS last_payment_at,
        CASE
            WHEN c.credit_balance <= 0 THEN 'Clear'
            WHEN c.credit_balance >= 3000 THEN 'Review'
            ELSE 'With Balance'
        END AS credit_status
    FROM customers c
"""


@bp.get("/customers")
def list_customers():
    search = (request.args.get("search") or "").strip()
    customer_type = request.args.get("type", "All")
    with_balance = request.args.get("with_balance") == "1"

    sql = SELECT_CUSTOMER + " WHERE 1=1 "
    params = []

    if search:
        sql += " AND (c.full_name LIKE %s OR c.phone_number LIKE %s) "
        like = f"%{search}%"
        params.extend([like, like])

    if customer_type and customer_type != "All":
        sql += " AND c.customer_type = %s "
        params.append(customer_type)

    if with_balance:
        sql += " AND c.credit_balance > 0 "

    sql += " ORDER BY c.full_name "

    return ok(clean_rows(fetch_all(sql, params)))


@bp.get("/customers/<int:customer_id>")
def get_customer(customer_id):
    customer = fetch_one(SELECT_CUSTOMER + " WHERE c.id = %s", [customer_id])
    if not customer:
        raise ApiError("Customer not found.", 404)

    sales = fetch_all(
        """
        SELECT id, total_amount, amount_paid, payment_method,
               payment_status, created_at
        FROM sales
        WHERE customer_id = %s
        ORDER BY created_at DESC
        LIMIT 50
        """,
        [customer_id],
    )

    payments = fetch_all(
        """
        SELECT id, sale_id, amount_paid, payment_method, paid_at
        FROM credit_payments
        WHERE customer_id = %s
        ORDER BY paid_at DESC
        LIMIT 50
        """,
        [customer_id],
    )

    return ok({
        "customer": clean_row(customer),
        "sales": clean_rows(sales),
        "payments": clean_rows(payments),
    })


def _read_customer(data):
    return {
        "full_name": text(data.get("full_name"), "Customer name", required=True, max_length=100),
        "phone_number": text(data.get("phone_number"), "Phone number", max_length=20),
        "customer_type": one_of(data.get("customer_type"), CUSTOMER_TYPES, "Customer type", "Retail"),
        "address": text(data.get("address"), "Address", max_length=500),
    }


@bp.post("/customers")
def add_customer():
    data = request.get_json(silent=True) or {}
    c = _read_customer(data)
    opening = money(data.get("credit_balance", 0), "Opening balance")

    with transaction() as cur:
        cur.execute("SELECT id FROM customers WHERE full_name = %s", (c["full_name"],))
        if cur.fetchone():
            raise ApiError("A customer with this name already exists.", 409)

        cur.execute(
            """
            INSERT INTO customers
                (full_name, phone_number, customer_type, credit_balance, address)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (c["full_name"], c["phone_number"], c["customer_type"], opening, c["address"]),
        )
        customer_id = cur.lastrowid

    return ok({"customer_id": customer_id}, f"{c['full_name']} saved.", 201)


@bp.put("/customers/<int:customer_id>")
def update_customer(customer_id):
    data = request.get_json(silent=True) or {}
    c = _read_customer(data)

    with transaction() as cur:
        cur.execute(
            "SELECT id FROM customers WHERE full_name = %s AND id <> %s",
            (c["full_name"], customer_id),
        )
        if cur.fetchone():
            raise ApiError("Another customer already uses this name.", 409)

        cur.execute(
            """
            UPDATE customers SET
                full_name = %s, phone_number = %s,
                customer_type = %s, address = %s
            WHERE id = %s
            """,
            (c["full_name"], c["phone_number"], c["customer_type"], c["address"], customer_id),
        )
        if cur.rowcount == 0:
            cur.execute("SELECT id FROM customers WHERE id = %s", (customer_id,))
            if not cur.fetchone():
                raise ApiError("Customer not found.", 404)

    return ok(message=f"{c['full_name']} updated.")


@bp.delete("/customers/<int:customer_id>")
def delete_customer(customer_id):
    with transaction() as cur:
        cur.execute(
            "SELECT full_name, credit_balance FROM customers WHERE id = %s",
            (customer_id,),
        )
        row = cur.fetchone()
        if not row:
            raise ApiError("Customer not found.", 404)

        if Decimal(str(row["credit_balance"])) > 0:
            raise ApiError("Settle the outstanding credit before removing this customer.")

        cur.execute("DELETE FROM customers WHERE id = %s", (customer_id,))

    return ok(message=f"{row['full_name']} removed.")


# ------------------------------------------------------------------ payments

@bp.get("/credit-payments")
def list_credit_payments():
    rows = fetch_all(
        """
        SELECT
            cp.id, cp.amount_paid, cp.payment_method, cp.paid_at,
            cp.sale_id, c.full_name AS customer_name, c.customer_type
        FROM credit_payments cp
        JOIN customers c ON c.id = cp.customer_id
        ORDER BY cp.paid_at DESC
        LIMIT 200
        """
    )
    return ok(clean_rows(rows))


@bp.post("/credit-payments")
def record_credit_payment():
    """
    Record a payment against a customer's utang. If a sale is named, that
    sale's paid amount and status are updated too.
    """
    data = request.get_json(silent=True) or {}

    customer_id = as_int(data.get("customer_id"), "Customer")
    sale_id = as_int(data.get("sale_id"), "Sale", required=False)
    amount = money(data.get("amount_paid"), "Payment amount", allow_zero=False)
    method = one_of(data.get("payment_method"), SETTLEMENT_METHODS, "Payment method", "Cash")

    with transaction() as cur:
        cur.execute(
            "SELECT id, full_name, credit_balance FROM customers WHERE id = %s FOR UPDATE",
            (customer_id,),
        )
        customer = cur.fetchone()
        if not customer:
            raise ApiError("Customer not found.", 404)

        balance = Decimal(str(customer["credit_balance"]))
        if amount > balance:
            raise ApiError(
                f"Payment exceeds the outstanding balance of {balance:.2f}."
            )

        if sale_id:
            cur.execute(
                """
                SELECT id, customer_id, total_amount, amount_paid
                FROM sales WHERE id = %s FOR UPDATE
                """,
                (sale_id,),
            )
            sale = cur.fetchone()
            if not sale:
                raise ApiError("Sale not found.", 404)
            if sale["customer_id"] != customer_id:
                raise ApiError("That sale belongs to a different customer.")

            new_paid = (Decimal(str(sale["amount_paid"])) + amount)
            total = Decimal(str(sale["total_amount"]))
            if new_paid > total:
                raise ApiError("Payment exceeds the remaining balance on that sale.")

            status = "Paid" if new_paid >= total else ("Partial" if new_paid > 0 else "Unpaid")
            cur.execute(
                "UPDATE sales SET amount_paid = %s, payment_status = %s WHERE id = %s",
                (new_paid, status, sale_id),
            )

        cur.execute(
            """
            INSERT INTO credit_payments
                (customer_id, sale_id, amount_paid, payment_method)
            VALUES (%s, %s, %s, %s)
            """,
            (customer_id, sale_id, amount, method),
        )
        payment_id = cur.lastrowid

        cur.execute(
            "UPDATE customers SET credit_balance = credit_balance - %s WHERE id = %s",
            (amount, customer_id),
        )

    return ok(
        {"payment_id": payment_id, "remaining_balance": float(balance - amount)},
        f"Payment of {amount:.2f} recorded for {customer['full_name']}.",
        201,
    )

customers_bp = bp


# ----------------------------------------------------------------------
# SUPPLIERS
# ----------------------------------------------------------------------

bp = Blueprint("suppliers", __name__, url_prefix="/api/suppliers")

SELECT_SUPPLIER = """
    SELECT
        s.id,
        s.supplier_name,
        s.contact_person,
        s.phone_number,
        s.address,
        s.created_at,
        (SELECT COUNT(*) FROM products p
            WHERE p.supplier_id = s.id AND p.is_active = TRUE) AS product_count,
        (SELECT COALESCE(SUM(il.added_kilos * il.cost_per_kilo), 0)
            FROM inventory_logs il
            WHERE il.supplier_id = s.id
              AND il.log_type IN ('Initial Stock', 'Restock')) AS total_purchased,
        (SELECT MAX(il.logged_at) FROM inventory_logs il
            WHERE il.supplier_id = s.id) AS last_delivery_at
    FROM suppliers s
"""


@bp.get("")
def list_suppliers():
    search = (request.args.get("search") or "").strip()

    sql = SELECT_SUPPLIER + " WHERE 1=1 "
    params = []

    if search:
        sql += " AND (s.supplier_name LIKE %s OR s.contact_person LIKE %s OR s.phone_number LIKE %s) "
        like = f"%{search}%"
        params.extend([like, like, like])

    sql += " ORDER BY s.supplier_name "
    return ok(clean_rows(fetch_all(sql, params)))


@bp.get("/<int:supplier_id>")
def get_supplier(supplier_id):
    supplier = fetch_one(SELECT_SUPPLIER + " WHERE s.id = %s", [supplier_id])
    if not supplier:
        raise ApiError("Supplier not found.", 404)

    deliveries = fetch_all(
        """
        SELECT il.id, il.added_kilos, il.cost_per_kilo, il.log_type,
               il.notes, il.logged_at, p.meat_cut,
               (il.added_kilos * il.cost_per_kilo) AS total_cost
        FROM inventory_logs il
        JOIN products p ON p.id = il.product_id
        WHERE il.supplier_id = %s
        ORDER BY il.logged_at DESC
        LIMIT 50
        """,
        [supplier_id],
    )

    products = fetch_all(
        """
        SELECT id, meat_cut, category, cost_per_kilo, price_per_kilo, stock_kilos
        FROM products
        WHERE supplier_id = %s AND is_active = TRUE
        ORDER BY meat_cut
        """,
        [supplier_id],
    )

    return ok({
        "supplier": clean_row(supplier),
        "deliveries": clean_rows(deliveries),
        "products": clean_rows(products),
    })


def _read_supplier(data):
    return (
        text(data.get("supplier_name"), "Supplier name", required=True, max_length=100),
        text(data.get("contact_person"), "Contact person", max_length=100),
        text(data.get("phone_number"), "Phone number", max_length=20),
        text(data.get("address"), "Address", max_length=500),
    )


@bp.post("")
def add_supplier():
    data = request.get_json(silent=True) or {}
    name, contact, phone, address = _read_supplier(data)

    with transaction() as cur:
        cur.execute("SELECT id FROM suppliers WHERE supplier_name = %s", (name,))
        if cur.fetchone():
            raise ApiError("A supplier with this name already exists.", 409)

        cur.execute(
            """
            INSERT INTO suppliers
                (supplier_name, contact_person, phone_number, address)
            VALUES (%s, %s, %s, %s)
            """,
            (name, contact, phone, address),
        )
        supplier_id = cur.lastrowid

    return ok({"supplier_id": supplier_id}, f"{name} saved.", 201)


@bp.put("/<int:supplier_id>")
def update_supplier(supplier_id):
    data = request.get_json(silent=True) or {}
    name, contact, phone, address = _read_supplier(data)

    with transaction() as cur:
        cur.execute(
            "SELECT id FROM suppliers WHERE supplier_name = %s AND id <> %s",
            (name, supplier_id),
        )
        if cur.fetchone():
            raise ApiError("Another supplier already uses this name.", 409)

        cur.execute(
            """
            UPDATE suppliers SET
                supplier_name = %s, contact_person = %s,
                phone_number = %s, address = %s
            WHERE id = %s
            """,
            (name, contact, phone, address, supplier_id),
        )
        if cur.rowcount == 0:
            cur.execute("SELECT id FROM suppliers WHERE id = %s", (supplier_id,))
            if not cur.fetchone():
                raise ApiError("Supplier not found.", 404)

    return ok(message=f"{name} updated.")


@bp.delete("/<int:supplier_id>")
def delete_supplier(supplier_id):
    """
    Products and logs keep their history; the foreign keys are ON DELETE SET
    NULL, so they simply lose the supplier link.
    """
    with transaction() as cur:
        cur.execute("SELECT supplier_name FROM suppliers WHERE id = %s", (supplier_id,))
        row = cur.fetchone()
        if not row:
            raise ApiError("Supplier not found.", 404)

        cur.execute("DELETE FROM suppliers WHERE id = %s", (supplier_id,))

    return ok(message=f"{row['supplier_name']} removed from the directory.")

suppliers_bp = bp


# ----------------------------------------------------------------------
# SALES
# ----------------------------------------------------------------------

bp = Blueprint("sales", __name__, url_prefix="/api/sales")


@bp.post("/checkout")
def checkout():
    data = request.get_json(silent=True) or {}

    items = data.get("items") or []
    if not items:
        raise ApiError("Add at least one item before completing the sale.")

    method = one_of(data.get("payment_method"), PAYMENT_METHODS, "Payment method", "Cash")
    customer_id = as_int(data.get("customer_id"), "Customer", required=False)
    amount_paid = money(data.get("amount_paid", 0), "Amount paid")

    total = Decimal("0.00")
    validated = []

    with transaction() as cur:
        for raw in items:
            product_id = as_int(raw.get("product_id"), "Product")
            weight = kilos(raw.get("weight_kilos"), "Weight")

            cur.execute(
                """
                SELECT id, meat_cut, price_per_kilo, cost_per_kilo, stock_kilos
                FROM products
                WHERE id = %s AND is_active = TRUE
                FOR UPDATE
                """,
                (product_id,),
            )
            product = cur.fetchone()

            if not product:
                raise ApiError(f"Product {product_id} is no longer available.", 404)

            available = Decimal(str(product["stock_kilos"]))
            if available < weight:
                raise ApiError(
                    f"Only {available:.2f} kg of {product['meat_cut']} is left in stock."
                )

            unit_price = Decimal(str(product["price_per_kilo"]))
            unit_cost = Decimal(str(product["cost_per_kilo"]))
            subtotal = (weight * unit_price).quantize(CENTS)
            total += subtotal

            validated.append({
                "product_id": product["id"],
                "meat_cut": product["meat_cut"],
                "weight": weight,
                "unit_price": unit_price,
                "unit_cost": unit_cost,
                "subtotal": subtotal,
            })

        total = total.quantize(CENTS)

        if customer_id:
            cur.execute(
                "SELECT id, full_name FROM customers WHERE id = %s FOR UPDATE",
                (customer_id,),
            )
            customer = cur.fetchone()
            if not customer:
                raise ApiError("Customer not found.", 404)

        if method in ("Cash", "GCash"):
            if amount_paid < total:
                raise ApiError(
                    f"Amount paid is short by {(total - amount_paid):.2f}."
                )
            status = "Paid"
            change = (amount_paid - total).quantize(CENTS)
            recorded_paid = total
        else:
            if not customer_id:
                raise ApiError("Pick a customer before recording a credit sale.")
            if amount_paid > total:
                raise ApiError("A partial payment cannot exceed the total.")
            status = "Paid" if amount_paid == total else ("Partial" if amount_paid > 0 else "Unpaid")
            change = Decimal("0.00")
            recorded_paid = amount_paid

        cur.execute(
            """
            INSERT INTO sales
                (customer_id, total_amount, amount_paid, change_given,
                 payment_method, payment_status)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (customer_id, total, recorded_paid, change, method, status),
        )
        sale_id = cur.lastrowid

        for item in validated:
            cur.execute(
                """
                INSERT INTO sales_items
                    (sale_id, product_id, weight_kilos, unit_price, unit_cost, subtotal)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    sale_id, item["product_id"], item["weight"],
                    item["unit_price"], item["unit_cost"], item["subtotal"],
                ),
            )

            cur.execute(
                """
                UPDATE products
                SET stock_kilos = stock_kilos - %s
                WHERE id = %s AND stock_kilos >= %s
                """,
                (item["weight"], item["product_id"], item["weight"]),
            )
            if cur.rowcount == 0:
                raise ApiError(
                    f"Stock for {item['meat_cut']} changed while the sale was being saved. "
                    "Nothing was charged; please try again."
                )

        outstanding = (total - recorded_paid).quantize(CENTS)
        if method == "Credit" and outstanding > 0:
            cur.execute(
                "UPDATE customers SET credit_balance = credit_balance + %s WHERE id = %s",
                (outstanding, customer_id),
            )

    return ok(
        {
            "sale_id": sale_id,
            "total": float(total),
            "amount_paid": float(recorded_paid),
            "change": float(change),
            "payment_status": status,
            "payment_method": method,
            "outstanding": float(outstanding),
            "items": [
                {
                    "meat_cut": i["meat_cut"],
                    "weight_kilos": float(i["weight"]),
                    "unit_price": float(i["unit_price"]),
                    "subtotal": float(i["subtotal"]),
                }
                for i in validated
            ],
        },
        "Sale completed.",
        201,
    )


@bp.get("")
def list_sales():
    start = request.args.get("start_date")
    end = request.args.get("end_date")
    status = request.args.get("status", "All")
    method = request.args.get("payment_method", "All")
    search = (request.args.get("search") or "").strip()
    limit = min(int(request.args.get("limit", 200)), 1000)

    clause, params = date_filter("s", start, end)

    sql = f"""
        SELECT
            s.id, s.total_amount, s.amount_paid, s.change_given,
            s.payment_method, s.payment_status, s.created_at,
            (s.total_amount - s.amount_paid) AS balance_due,
            COALESCE(c.full_name, 'Walk-in Customer') AS customer_name,
            c.customer_type,
            (SELECT COUNT(*) FROM sales_items si WHERE si.sale_id = s.id) AS item_count,
            (SELECT COALESCE(SUM(si.weight_kilos), 0) FROM sales_items si
                WHERE si.sale_id = s.id) AS total_kilos
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        WHERE 1=1 {clause}
    """

    if status and status != "All":
        sql += " AND s.payment_status = %s "
        params.append(status)

    if method and method != "All":
        sql += " AND s.payment_method = %s "
        params.append(method)

    if search:
        sql += " AND (c.full_name LIKE %s OR CAST(s.id AS CHAR) LIKE %s) "
        like = f"%{search}%"
        params.extend([like, like])

    sql += " ORDER BY s.created_at DESC, s.id DESC LIMIT %s "
    params.append(limit)

    return ok(clean_rows(fetch_all(sql, params)))


@bp.get("/<int:sale_id>")
def get_sale(sale_id):
    sale = fetch_one(
        """
        SELECT s.*, COALESCE(c.full_name, 'Walk-in Customer') AS customer_name,
               c.customer_type, c.phone_number
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.id = %s
        """,
        [sale_id],
    )
    if not sale:
        raise ApiError("Sale not found.", 404)

    items = fetch_all(
        """
        SELECT si.id, si.weight_kilos, si.unit_price, si.unit_cost, si.subtotal,
               (si.subtotal - (si.weight_kilos * si.unit_cost)) AS gross_profit,
               p.meat_cut, p.category
        FROM sales_items si
        JOIN products p ON p.id = si.product_id
        WHERE si.sale_id = %s
        ORDER BY si.id
        """,
        [sale_id],
    )

    payments = fetch_all(
        """
        SELECT id, amount_paid, payment_method, paid_at
        FROM credit_payments
        WHERE sale_id = %s
        ORDER BY paid_at
        """,
        [sale_id],
    )

    return ok({
        "sale": clean_row(sale),
        "items": clean_rows(items),
        "payments": clean_rows(payments),
    })

sales_bp = bp


# ----------------------------------------------------------------------
# INVENTORY
# ----------------------------------------------------------------------

bp = Blueprint("inventory", __name__, url_prefix="/api/inventory")


@bp.get("/summary")
def inventory_summary():
    stock = fetch_one(
        """
        SELECT
            COALESCE(SUM(stock_kilos), 0) AS stock_kilos,
            COALESCE(SUM(stock_kilos * cost_per_kilo), 0) AS inventory_value,
            COALESCE(SUM(stock_kilos * price_per_kilo), 0) AS retail_value,
            COUNT(*) AS product_count,
            SUM(CASE WHEN stock_kilos <= reorder_level_kilos THEN 1 ELSE 0 END)
                AS low_stock_count
        FROM products
        WHERE is_active = TRUE
        """
    )

    movement = fetch_one(
        """
        SELECT
            COALESCE(SUM(CASE WHEN log_type IN ('Initial Stock','Restock')
                THEN added_kilos ELSE 0 END), 0) AS restocked_kilos,
            COALESCE(SUM(CASE WHEN log_type IN ('Initial Stock','Restock')
                THEN added_kilos * cost_per_kilo ELSE 0 END), 0) AS inventory_purchases,
            COALESCE(SUM(CASE WHEN log_type IN ('Spoilage','Adjustment')
                THEN ABS(added_kilos) ELSE 0 END), 0) AS loss_kilos,
            COALESCE(SUM(CASE WHEN log_type IN ('Spoilage','Adjustment')
                THEN ABS(added_kilos) * cost_per_kilo ELSE 0 END), 0) AS loss_value
        FROM inventory_logs
        """
    )

    sold = fetch_one(
        "SELECT COALESCE(SUM(weight_kilos), 0) AS sold_kilos FROM sales_items"
    )

    low_stock = fetch_all(
        """
        SELECT id, meat_cut, category, stock_kilos, reorder_level_kilos
        FROM products
        WHERE is_active = TRUE AND stock_kilos <= reorder_level_kilos
        ORDER BY (stock_kilos - reorder_level_kilos), meat_cut
        """
    )

    data = clean_row({**stock, **movement, **sold})
    data["low_stock"] = clean_rows(low_stock)
    return ok(data)


@bp.get("/stock")
def stock_levels():
    rows = fetch_all(
        """
        SELECT
            p.id, p.meat_cut, p.category, p.stock_kilos, p.reorder_level_kilos,
            p.cost_per_kilo, p.price_per_kilo,
            (p.stock_kilos * p.cost_per_kilo) AS stock_value,
            s.supplier_name,
            CASE
                WHEN p.stock_kilos <= 0 THEN 'Out of Stock'
                WHEN p.stock_kilos <= p.reorder_level_kilos THEN 'Reorder'
                ELSE 'Normal'
            END AS stock_status
        FROM products p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.is_active = TRUE
        ORDER BY p.category, p.meat_cut
        """
    )
    return ok(clean_rows(rows))


@bp.get("/logs")
def inventory_logs():
    start = request.args.get("start_date")
    end = request.args.get("end_date")
    log_type = request.args.get("log_type", "All")
    product_id = request.args.get("product_id")
    limit = min(int(request.args.get("limit", 200)), 1000)

    clause, params = date_filter("il", start, end, column="logged_at")

    sql = f"""
        SELECT
            il.id, il.added_kilos, il.cost_per_kilo, il.log_type, il.notes,
            il.logged_at, p.meat_cut, p.category, s.supplier_name,
            (il.added_kilos * il.cost_per_kilo) AS total_cost
        FROM inventory_logs il
        JOIN products p ON p.id = il.product_id
        LEFT JOIN suppliers s ON s.id = il.supplier_id
        WHERE 1=1 {clause}
    """

    if log_type and log_type != "All":
        sql += " AND il.log_type = %s "
        params.append(log_type)

    if product_id:
        sql += " AND il.product_id = %s "
        params.append(as_int(product_id, "Product"))

    sql += " ORDER BY il.logged_at DESC, il.id DESC LIMIT %s "
    params.append(limit)

    return ok(clean_rows(fetch_all(sql, params)))


@bp.post("/purchase")
def record_purchase():
    """Receive a delivery: add kilos, refresh the cost basis, log the movement."""
    data = request.get_json(silent=True) or {}

    product_id = as_int(data.get("product_id"), "Product")
    supplier_id = as_int(data.get("supplier_id"), "Supplier", required=False)
    added = kilos(data.get("added_kilos"), "Delivered weight")
    cost = money(data.get("cost_per_kilo"), "Cost per kilo", allow_zero=False)
    notes = text(data.get("notes"), "Notes", max_length=255) or "Supplier delivery"

    with transaction() as cur:
        cur.execute(
            "SELECT id, meat_cut, price_per_kilo FROM products WHERE id = %s FOR UPDATE",
            (product_id,),
        )
        product = cur.fetchone()
        if not product:
            raise ApiError("Product not found.", 404)

        if supplier_id:
            cur.execute("SELECT id FROM suppliers WHERE id = %s", (supplier_id,))
            if not cur.fetchone():
                raise ApiError("Supplier not found.", 404)

        if cost > Decimal(str(product["price_per_kilo"])):
            raise ApiError(
                "This cost is higher than the current selling price. "
                "Update the selling price first so the margin stays correct."
            )

        cur.execute(
            """
            UPDATE products SET
                stock_kilos = stock_kilos + %s,
                cost_per_kilo = %s,
                supplier_id = COALESCE(%s, supplier_id)
            WHERE id = %s
            """,
            (added, cost, supplier_id, product_id),
        )

        cur.execute(
            """
            INSERT INTO inventory_logs
                (product_id, supplier_id, added_kilos, cost_per_kilo, log_type, notes)
            VALUES (%s, %s, %s, %s, 'Restock', %s)
            """,
            (product_id, supplier_id, added, cost, notes),
        )
        log_id = cur.lastrowid

    return ok(
        {"log_id": log_id, "total_cost": float(added * cost)},
        f"{added} kg of {product['meat_cut']} received.",
        201,
    )


@bp.post("/adjustment")
def record_adjustment():
    """Write off spoilage, trim loss or a stock-count correction."""
    data = request.get_json(silent=True) or {}

    product_id = as_int(data.get("product_id"), "Product")
    removed = kilos(data.get("removed_kilos"), "Weight removed")
    log_type = data.get("log_type") or "Spoilage"
    notes = text(data.get("notes"), "Reason", max_length=255) or log_type

    if log_type not in ("Spoilage", "Adjustment"):
        raise ApiError("Movement type must be Spoilage or Adjustment.")

    with transaction() as cur:
        cur.execute(
            """
            SELECT id, meat_cut, stock_kilos, cost_per_kilo
            FROM products WHERE id = %s FOR UPDATE
            """,
            (product_id,),
        )
        product = cur.fetchone()
        if not product:
            raise ApiError("Product not found.", 404)

        available = Decimal(str(product["stock_kilos"]))
        if removed > available:
            raise ApiError(
                f"Only {available:.2f} kg of {product['meat_cut']} is on hand."
            )

        cur.execute(
            "UPDATE products SET stock_kilos = stock_kilos - %s WHERE id = %s",
            (removed, product_id),
        )

        cur.execute(
            """
            INSERT INTO inventory_logs
                (product_id, supplier_id, added_kilos, cost_per_kilo, log_type, notes)
            VALUES (%s, NULL, %s, %s, %s, %s)
            """,
            (product_id, -removed, product["cost_per_kilo"], log_type, notes),
        )

    return ok(
        message=f"{removed} kg of {product['meat_cut']} written off as {log_type.lower()}."
    )

inventory_bp = bp


# ----------------------------------------------------------------------
# ANALYTICS
# ----------------------------------------------------------------------

bp = Blueprint("analytics", __name__, url_prefix="/api/analytics")


def _range():
    return request.args.get("start_date"), request.args.get("end_date")


def _sales_totals(start, end):
    clause, params = date_filter("s", start, end)
    return fetch_one(
        f"""
        SELECT
            COALESCE(SUM(si.subtotal), 0) AS revenue,
            COALESCE(SUM(si.weight_kilos * si.unit_cost), 0) AS cogs,
            COALESCE(SUM(si.subtotal - (si.weight_kilos * si.unit_cost)), 0)
                AS gross_profit,
            COALESCE(SUM(si.weight_kilos), 0) AS kilos_sold,
            COUNT(DISTINCT s.id) AS transaction_count
        FROM sales s
        JOIN sales_items si ON si.sale_id = s.id
        WHERE 1=1 {clause}
        """,
        params,
    )


@bp.get("/summary")
def summary():
    """Powers the dashboard and the sales & profit page."""
    start, end = _range()
    totals = _sales_totals(start, end)

    clause, params = date_filter("s", start, end)
    collected = fetch_one(
        f"""
        SELECT
            COALESCE(SUM(s.amount_paid), 0) AS cash_collected,
            COALESCE(SUM(s.total_amount - s.amount_paid), 0) AS credit_issued
        FROM sales s
        WHERE 1=1 {clause}
        """,
        params,
    )

    purchases = fetch_one(
        """
        SELECT COALESCE(SUM(added_kilos * cost_per_kilo), 0) AS inventory_purchases
        FROM inventory_logs
        WHERE log_type IN ('Initial Stock', 'Restock')
        """
    )

    inventory = fetch_one(
        """
        SELECT
            COALESCE(SUM(stock_kilos * cost_per_kilo), 0) AS inventory_value,
            COALESCE(SUM(stock_kilos * price_per_kilo), 0) AS inventory_retail_value,
            COALESCE(SUM(stock_kilos), 0) AS stock_kilos,
            SUM(CASE WHEN stock_kilos <= reorder_level_kilos THEN 1 ELSE 0 END)
                AS low_stock_count,
            COUNT(*) AS active_products
        FROM products
        WHERE is_active = TRUE
        """
    )

    credit = fetch_one(
        """
        SELECT
            COALESCE(SUM(credit_balance), 0) AS credit_outstanding,
            SUM(CASE WHEN credit_balance > 0 THEN 1 ELSE 0 END) AS accounts_with_balance,
            COUNT(*) AS customer_count
        FROM customers
        """
    )

    revenue = Decimal(str(totals["revenue"]))
    profit = Decimal(str(totals["gross_profit"]))

    data = clean_row({**totals, **collected, **purchases, **inventory, **credit})
    data["gross_margin_percent"] = float(percent(profit, revenue))
    data["average_sale_value"] = (
        float(revenue / totals["transaction_count"])
        if totals["transaction_count"] else 0.0
    )
    data["range"] = {"start_date": start, "end_date": end}
    return ok(data)


@bp.get("/daily")
def daily():
    start, end = _range()
    clause, params = date_filter("s", start, end)
    rows = fetch_all(
        f"""
        SELECT
            DATE(s.created_at) AS sale_date,
            COALESCE(SUM(si.subtotal), 0) AS revenue,
            COALESCE(SUM(si.weight_kilos * si.unit_cost), 0) AS cogs,
            COALESCE(SUM(si.subtotal - (si.weight_kilos * si.unit_cost)), 0)
                AS gross_profit,
            COALESCE(SUM(si.weight_kilos), 0) AS kilos_sold,
            COUNT(DISTINCT s.id) AS transaction_count
        FROM sales s
        JOIN sales_items si ON si.sale_id = s.id
        WHERE 1=1 {clause}
        GROUP BY DATE(s.created_at)
        ORDER BY sale_date
        """,
        params,
    )
    return ok(clean_rows(rows))


@bp.get("/products")
def product_profitability():
    start, end = _range()
    clause, params = date_filter("s", start, end)

    rows = fetch_all(
        f"""
        SELECT
            p.id, p.meat_cut, p.category, p.cost_per_kilo, p.price_per_kilo,
            p.stock_kilos,
            COALESCE(SUM(si.weight_kilos), 0) AS kilos_sold,
            COALESCE(SUM(si.subtotal), 0) AS revenue,
            COALESCE(SUM(si.weight_kilos * si.unit_cost), 0) AS cogs,
            COALESCE(SUM(si.subtotal - (si.weight_kilos * si.unit_cost)), 0)
                AS gross_profit
        FROM products p
        LEFT JOIN sales_items si ON si.product_id = p.id
        LEFT JOIN sales s ON s.id = si.sale_id {clause}
        WHERE p.is_active = TRUE
        GROUP BY p.id, p.meat_cut, p.category, p.cost_per_kilo,
                 p.price_per_kilo, p.stock_kilos
        ORDER BY gross_profit DESC, p.meat_cut
        """,
        params,
    )

    data = []
    for row in rows:
        row["margin_percent"] = float(percent(row["gross_profit"], row["revenue"]))
        data.append(clean_row(row))
    return ok(data)


@bp.get("/categories")
def category_profitability():
    start, end = _range()
    clause, params = date_filter("s", start, end)

    rows = fetch_all(
        f"""
        SELECT
            p.category,
            COALESCE(SUM(si.weight_kilos), 0) AS kilos_sold,
            COALESCE(SUM(si.subtotal), 0) AS revenue,
            COALESCE(SUM(si.weight_kilos * si.unit_cost), 0) AS cogs,
            COALESCE(SUM(si.subtotal - (si.weight_kilos * si.unit_cost)), 0)
                AS gross_profit
        FROM sales_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id
        WHERE 1=1 {clause}
        GROUP BY p.category
        ORDER BY revenue DESC
        """,
        params,
    )

    data = []
    for row in rows:
        row["margin_percent"] = float(percent(row["gross_profit"], row["revenue"]))
        data.append(clean_row(row))
    return ok(data)


@bp.get("/customers")
def customer_activity():
    start, end = _range()
    clause, params = date_filter("s", start, end)

    rows = fetch_all(
        f"""
        SELECT
            COALESCE(c.full_name, 'Walk-in Customer') AS customer_name,
            COALESCE(c.customer_type, 'Retail') AS customer_type,
            COUNT(DISTINCT s.id) AS transaction_count,
            COALESCE(SUM(s.total_amount), 0) AS total_spent,
            COALESCE(MAX(c.credit_balance), 0) AS credit_balance
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        WHERE 1=1 {clause}
        GROUP BY c.id, c.full_name, c.customer_type
        ORDER BY total_spent DESC
        LIMIT 25
        """,
        params,
    )
    return ok(clean_rows(rows))


@bp.get("/payment-mix")
def payment_mix():
    start, end = _range()
    clause, params = date_filter("s", start, end)

    rows = fetch_all(
        f"""
        SELECT
            s.payment_method,
            COUNT(*) AS transaction_count,
            COALESCE(SUM(s.total_amount), 0) AS total_amount
        FROM sales s
        WHERE 1=1 {clause}
        GROUP BY s.payment_method
        ORDER BY total_amount DESC
        """,
        params,
    )
    return ok(clean_rows(rows))

analytics_bp = bp


# ----------------------------------------------------------------------
# REPORTS
# ----------------------------------------------------------------------

bp = Blueprint("reports", __name__, url_prefix="/api/reports")

REPORTS = {
    "sales": "Sales summary",
    "profit": "Profit and loss",
    "products": "Product profitability",
    "inventory": "Inventory valuation",
    "purchases": "Purchases and restocking",
    "credit": "Customer credit",
}


def _peso(value):
    return f"P {Decimal(str(value or 0)):,.2f}"


def _kg(value):
    return f"{Decimal(str(value or 0)):,.2f} kg"


def _period(start, end):
    if start and end:
        return f"{start} to {end}"
    if start:
        return f"From {start}"
    if end:
        return f"Up to {end}"
    return "All recorded activity"


def _envelope(key, columns, rows, figures, totals=None, note=None, start=None, end=None):
    return {
        "key": key,
        "title": REPORTS[key],
        "period": _period(start, end),
        "generated_at": date.today().isoformat(),
        "figures": figures,
        "columns": columns,
        "rows": rows,
        "totals": totals or [],
        "note": note,
    }


@bp.get("/catalog")
def catalog():
    return ok([{"key": k, "title": v} for k, v in REPORTS.items()])


@bp.get("/<report_key>")
def build_report(report_key):
    if report_key not in REPORTS:
        raise ApiError("Unknown report.", 404)

    start = request.args.get("start_date")
    end = request.args.get("end_date")
    clause, params = date_filter("s", start, end)

    builder = {
        "sales": _sales_report,
        "profit": _profit_report,
        "products": _products_report,
        "inventory": _inventory_report,
        "purchases": _purchases_report,
        "credit": _credit_report,
    }[report_key]

    return ok(builder(start, end, clause, params))


# ------------------------------------------------------------------- reports

def _sales_report(start, end, clause, params):
    rows = fetch_all(
        f"""
        SELECT s.id, s.created_at, s.payment_method, s.payment_status,
               s.total_amount, s.amount_paid,
               (s.total_amount - s.amount_paid) AS balance_due,
               COALESCE(c.full_name, 'Walk-in Customer') AS customer_name
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        WHERE 1=1 {clause}
        ORDER BY s.created_at, s.id
        """,
        params,
    )

    totals = fetch_one(
        f"""
        SELECT COALESCE(SUM(s.total_amount), 0) AS total,
               COALESCE(SUM(s.amount_paid), 0) AS paid,
               COALESCE(SUM(s.total_amount - s.amount_paid), 0) AS due,
               COUNT(*) AS count
        FROM sales s WHERE 1=1 {clause}
        """,
        params,
    )

    return _envelope(
        "sales",
        ["Sale", "Date", "Customer", "Method", "Status", "Total", "Paid", "Balance"],
        [
            [
                f"#{r['id']}",
                r["created_at"].strftime("%b %d, %Y %I:%M %p"),
                r["customer_name"],
                r["payment_method"],
                r["payment_status"],
                _peso(r["total_amount"]),
                _peso(r["amount_paid"]),
                _peso(r["balance_due"]),
            ]
            for r in rows
        ],
        [
            {"label": "Transactions", "value": f"{totals['count']:,}"},
            {"label": "Gross sales", "value": _peso(totals["total"])},
            {"label": "Collected", "value": _peso(totals["paid"])},
            {"label": "Outstanding", "value": _peso(totals["due"])},
        ],
        totals=["", "", "", "", "Total",
                _peso(totals["total"]), _peso(totals["paid"]), _peso(totals["due"])],
        start=start, end=end,
    )


def _profit_report(start, end, clause, params):
    rows = fetch_all(
        f"""
        SELECT DATE(s.created_at) AS d,
               COALESCE(SUM(si.subtotal), 0) AS revenue,
               COALESCE(SUM(si.weight_kilos * si.unit_cost), 0) AS cogs,
               COALESCE(SUM(si.subtotal - (si.weight_kilos * si.unit_cost)), 0) AS profit,
               COALESCE(SUM(si.weight_kilos), 0) AS kilos,
               COUNT(DISTINCT s.id) AS txn
        FROM sales s
        JOIN sales_items si ON si.sale_id = s.id
        WHERE 1=1 {clause}
        GROUP BY DATE(s.created_at)
        ORDER BY d
        """,
        params,
    )

    revenue = sum(Decimal(str(r["revenue"])) for r in rows)
    cogs = sum(Decimal(str(r["cogs"])) for r in rows)
    profit = revenue - cogs
    kilos = sum(Decimal(str(r["kilos"])) for r in rows)

    return _envelope(
        "profit",
        ["Date", "Transactions", "Kilos sold", "Revenue", "Cost of goods", "Gross profit", "Margin"],
        [
            [
                r["d"].strftime("%b %d, %Y"),
                f"{r['txn']:,}",
                _kg(r["kilos"]),
                _peso(r["revenue"]),
                _peso(r["cogs"]),
                _peso(r["profit"]),
                f"{percent(r['profit'], r['revenue'])}%",
            ]
            for r in rows
        ],
        [
            {"label": "Revenue", "value": _peso(revenue)},
            {"label": "Cost of goods sold", "value": _peso(cogs)},
            {"label": "Gross profit", "value": _peso(profit)},
            {"label": "Gross margin", "value": f"{percent(profit, revenue)}%"},
        ],
        totals=["Total", "", _kg(kilos), _peso(revenue), _peso(cogs),
                _peso(profit), f"{percent(profit, revenue)}%"],
        start=start, end=end,
    )


def _products_report(start, end, clause, params):
    rows = fetch_all(
        f"""
        SELECT p.meat_cut, p.category, p.cost_per_kilo, p.price_per_kilo,
               COALESCE(SUM(si.weight_kilos), 0) AS kilos,
               COALESCE(SUM(si.subtotal), 0) AS revenue,
               COALESCE(SUM(si.weight_kilos * si.unit_cost), 0) AS cogs,
               COALESCE(SUM(si.subtotal - (si.weight_kilos * si.unit_cost)), 0) AS profit
        FROM products p
        LEFT JOIN sales_items si ON si.product_id = p.id
        LEFT JOIN sales s ON s.id = si.sale_id {clause}
        WHERE p.is_active = TRUE
        GROUP BY p.id, p.meat_cut, p.category, p.cost_per_kilo, p.price_per_kilo
        ORDER BY profit DESC, p.meat_cut
        """,
        params,
    )

    revenue = sum(Decimal(str(r["revenue"])) for r in rows)
    profit = sum(Decimal(str(r["profit"])) for r in rows)
    best = rows[0]["meat_cut"] if rows and Decimal(str(rows[0]["profit"])) > 0 else "No sales yet"

    return _envelope(
        "products",
        ["Product", "Category", "Cost/kg", "Price/kg", "Kilos sold", "Revenue", "Gross profit", "Margin"],
        [
            [
                r["meat_cut"], r["category"],
                _peso(r["cost_per_kilo"]), _peso(r["price_per_kilo"]),
                _kg(r["kilos"]), _peso(r["revenue"]), _peso(r["profit"]),
                f"{percent(r['profit'], r['revenue'])}%",
            ]
            for r in rows
        ],
        [
            {"label": "Products listed", "value": f"{len(rows):,}"},
            {"label": "Revenue", "value": _peso(revenue)},
            {"label": "Gross profit", "value": _peso(profit)},
            {"label": "Top earner", "value": best},
        ],
        totals=["Total", "", "", "", "", _peso(revenue), _peso(profit),
                f"{percent(profit, revenue)}%"],
        start=start, end=end,
    )


def _inventory_report(start, end, clause, params):
    rows = fetch_all(
        """
        SELECT p.meat_cut, p.category, p.stock_kilos, p.reorder_level_kilos,
               p.cost_per_kilo, p.price_per_kilo,
               (p.stock_kilos * p.cost_per_kilo) AS value,
               COALESCE(s.supplier_name, 'Unassigned') AS supplier_name
        FROM products p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.is_active = TRUE
        ORDER BY p.category, p.meat_cut
        """
    )

    value = sum(Decimal(str(r["value"])) for r in rows)
    kilos = sum(Decimal(str(r["stock_kilos"])) for r in rows)
    low = [r for r in rows if r["stock_kilos"] <= r["reorder_level_kilos"]]

    return _envelope(
        "inventory",
        ["Product", "Category", "Supplier", "On hand", "Reorder at", "Cost/kg", "Stock value", "Status"],
        [
            [
                r["meat_cut"], r["category"], r["supplier_name"],
                _kg(r["stock_kilos"]), _kg(r["reorder_level_kilos"]),
                _peso(r["cost_per_kilo"]), _peso(r["value"]),
                "Reorder" if r["stock_kilos"] <= r["reorder_level_kilos"] else "Normal",
            ]
            for r in rows
        ],
        [
            {"label": "Stock on hand", "value": _kg(kilos)},
            {"label": "Inventory value at cost", "value": _peso(value)},
            {"label": "Products", "value": f"{len(rows):,}"},
            {"label": "Needing reorder", "value": f"{len(low):,}"},
        ],
        totals=["Total", "", "", _kg(kilos), "", "", _peso(value), ""],
        note="Stock valuation uses the current supplier cost for each product.",
        start=start, end=end,
    )


def _purchases_report(start, end, clause, params):
    log_clause, log_params = date_filter("il", start, end, column="logged_at")

    rows = fetch_all(
        f"""
        SELECT il.logged_at, il.added_kilos, il.cost_per_kilo, il.log_type, il.notes,
               p.meat_cut, COALESCE(s.supplier_name, 'Unassigned') AS supplier_name,
               (il.added_kilos * il.cost_per_kilo) AS total_cost
        FROM inventory_logs il
        JOIN products p ON p.id = il.product_id
        LEFT JOIN suppliers s ON s.id = il.supplier_id
        WHERE il.log_type IN ('Initial Stock', 'Restock') {log_clause}
        ORDER BY il.logged_at DESC
        """,
        log_params,
    )

    spend = sum(Decimal(str(r["total_cost"])) for r in rows)
    kilos = sum(Decimal(str(r["added_kilos"])) for r in rows)

    return _envelope(
        "purchases",
        ["Date", "Supplier", "Product", "Type", "Quantity", "Cost/kg", "Total cost"],
        [
            [
                r["logged_at"].strftime("%b %d, %Y"),
                r["supplier_name"], r["meat_cut"], r["log_type"],
                _kg(r["added_kilos"]), _peso(r["cost_per_kilo"]), _peso(r["total_cost"]),
            ]
            for r in rows
        ],
        [
            {"label": "Deliveries recorded", "value": f"{len(rows):,}"},
            {"label": "Kilos received", "value": _kg(kilos)},
            {"label": "Capital spent on stock", "value": _peso(spend)},
            {"label": "Average cost", "value": _peso(spend / kilos if kilos else 0)},
        ],
        totals=["Total", "", "", "", _kg(kilos), "", _peso(spend)],
        start=start, end=end,
    )


def _credit_report(start, end, clause, params):
    rows = fetch_all(
        """
        SELECT c.full_name, c.customer_type, c.phone_number, c.credit_balance,
               (SELECT MAX(cp.paid_at) FROM credit_payments cp
                    WHERE cp.customer_id = c.id) AS last_payment,
               (SELECT COALESCE(SUM(cp.amount_paid), 0) FROM credit_payments cp
                    WHERE cp.customer_id = c.id) AS total_paid
        FROM customers c
        WHERE c.credit_balance > 0
        ORDER BY c.credit_balance DESC
        """
    )

    outstanding = sum(Decimal(str(r["credit_balance"])) for r in rows)
    collected = fetch_one(
        "SELECT COALESCE(SUM(amount_paid), 0) AS paid FROM credit_payments"
    )

    return _envelope(
        "credit",
        ["Customer", "Type", "Contact", "Outstanding", "Paid to date", "Last payment"],
        [
            [
                r["full_name"], r["customer_type"], r["phone_number"] or "-",
                _peso(r["credit_balance"]), _peso(r["total_paid"]),
                r["last_payment"].strftime("%b %d, %Y") if r["last_payment"] else "None",
            ]
            for r in rows
        ],
        [
            {"label": "Accounts with balance", "value": f"{len(rows):,}"},
            {"label": "Total outstanding", "value": _peso(outstanding)},
            {"label": "Collected to date", "value": _peso(collected["paid"])},
            {
                "label": "Largest balance",
                "value": _peso(rows[0]["credit_balance"]) if rows else _peso(0),
            },
        ],
        totals=["Total", "", "", _peso(outstanding), "", ""],
        note="Balances are live; they change as soon as a payment is recorded.",
        start=start, end=end,
    )

reports_bp = bp


# =============================================================
# 5. APP FACTORY, ERROR HANDLERS, FRONTEND SERVING
# =============================================================

# Every blueprint defined above, gathered here ONCE. Adding a new route
# file above only requires adding its `bp` to this tuple — there is no
# other registration step anywhere else to forget.
BLUEPRINTS = (
    health_bp,
    products_bp,
    customers_bp,
    suppliers_bp,
    sales_bp,
    inventory_bp,
    analytics_bp,
    reports_bp,
)


def create_app():
    app = Flask(__name__, static_folder=None)
    app.config.from_object(Config)
    app.json.sort_keys = False

    CORS(app, resources={r"/api/*": {"origins": "*"}})

    for bp in BLUEPRINTS:
        app.register_blueprint(bp)

    register_error_handlers(app)
    register_frontend(app)

    return app


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def handle_api_error(exc):
        return jsonify({"status": "error", "message": exc.message}), exc.status

    @app.errorhandler(pymysql.err.IntegrityError)
    def handle_integrity(exc):
        return jsonify({
            "status": "error",
            "message": "That record is linked to other data and cannot be saved "
                       "as requested.",
            "detail": str(exc),
        }), 409

    @app.errorhandler(pymysql.err.OperationalError)
    def handle_operational(exc):
        return jsonify({
            "status": "error",
            "message": "The database is not reachable. Check that MySQL is "
                       "running and that Config has the right host, port and "
                       "password.",
            "detail": str(exc),
        }), 503

    @app.errorhandler(404)
    def handle_404(_):
        return jsonify({"status": "error", "message": "Endpoint not found."}), 404

    @app.errorhandler(405)
    def handle_405(_):
        return jsonify({"status": "error", "message": "Method not allowed."}), 405

    @app.errorhandler(500)
    def handle_500(exc):
        app.logger.exception("Unhandled error")
        return jsonify({
            "status": "error",
            "message": "Something went wrong on the server.",
            "detail": str(exc),
        }), 500


def register_frontend(app):
    root = os.path.abspath(Config.FRONTEND_DIR)

    @app.get("/")
    def index():
        if not os.path.isdir(root):
            return jsonify({
                "status": "success",
                "message": "API is running. Frontend folder not found at "
                           f"{root}.",
            })
        return send_from_directory(root, "pos.html")

    @app.get("/<path:filename>")
    def assets(filename):
        return send_from_directory(root, filename)


app = create_app()

if __name__ == "__main__":
    print(f" * MySQL target : {Config.MYSQL_HOST}:{Config.MYSQL_PORT}/{Config.MYSQL_DB}")
    print(f" * Frontend dir : {os.path.abspath(Config.FRONTEND_DIR)}")
    print(f" * Serving at   : http://{Config.HOST}:{Config.PORT}")
    app.run(host=Config.HOST, port=Config.PORT, debug=Config.DEBUG)