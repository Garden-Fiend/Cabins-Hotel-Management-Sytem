"""Explicit migration of the isolated test database; never clears it."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from dotenv import dotenv_values

from app import settings

root = Path(__file__).resolve().parents[1]
url = dotenv_values(root / ".env").get("HMS_TEST_DATABASE_URL")
if not url:
    raise SystemExit("HMS_TEST_DATABASE_URL is required")
settings.require_isolated_local_database(url, test=True)
# A scoped settings instance avoids printing credentials or changing global environment settings.
test_settings = settings.Settings(database_url=url)
settings.get_settings = lambda: test_settings
command.upgrade(Config(str(root / "alembic.ini")), "head")
