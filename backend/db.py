"""
Database access layer.

Everything in the app goes through `transaction()` or `query()`. Both hand
back a DictCursor and guarantee the connection is closed, so no route can
leak a MySQL connection even when it raises.
"""

from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor

from config import Config



def get_db_connection():
    return pymysql.connect(
        host=Config.MYSQL_HOST,        # 127.0.0.1
        user=Config.MYSQL_USER,        # root
        password=Config.MYSQL_PASSWORD,# (empty)
        database=Config.MYSQL_DB,      # janeth_meat_shop
        port=Config.MYSQL_PORT,        # 3307
        cursorclass=pymysql.cursors.DictCursor
    )


@contextmanager
def transaction():
    """
    Write operations. Commits on success, rolls back on any exception.

        with transaction() as cur:
            cur.execute("INSERT ...")
    """
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
    """Read-only operations. No commit, always closes."""
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