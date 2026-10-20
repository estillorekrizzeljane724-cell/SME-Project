"""
Configuration for the Janeth Meat Shop API.

Every value can be overridden with an environment variable, so you never have
to edit this file to move the app to another machine.
"""

import os


class Config:
    MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
    MYSQL_USER = os.getenv("MYSQL_USER", "root")
    MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
    MYSQL_DB = os.getenv("MYSQL_DB", "janeth_meat_shop")
    MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3307"))

    # Where the browser app lives. app.py serves it so you can simply open
    # http://127.0.0.1:50 and everything works with no extra web server.
    FRONTEND_DIR = os.getenv(
        "FRONTEND_DIR",
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "frontend"
        )
    )

    HOST = os.getenv("API_HOST", "127.0.0.1")
    PORT = int(os.getenv("API_PORT", "5001"))
    DEBUG = os.getenv("API_DEBUG", "1") == "1"