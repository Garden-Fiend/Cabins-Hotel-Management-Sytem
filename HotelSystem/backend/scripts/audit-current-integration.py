"""Read-only current environment/schema inventory; no guest data or connection secrets."""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory
from dotenv import dotenv_values

from app.db import make_engine
from app.settings import require_isolated_local_database

root = Path(__file__).resolve().parents[1]
assert Path(sys.prefix).resolve() == (root / ".venv").resolve(), (
    "Use the owned backend virtual environment"
)
values = dotenv_values(root / ".env")
alembic_config = Config(str(root / "alembic.ini"))
alembic_config.set_main_option("script_location", str(root / "migrations"))
current_head = ScriptDirectory.from_config(alembic_config).get_current_head()
evidence = {"python": sys.executable, "prefix": sys.prefix, "databases": {}}
for name, variable, test in (
    ("hms_dev", "HMS_DATABASE_URL", False),
    ("hms_test", "HMS_TEST_DATABASE_URL", True),
):
    require_isolated_local_database(values[variable], test=test)
    engine = make_engine(values[variable])
    with engine.connect() as c:
        assert c.scalar(sa.text("SELECT current_database()")) == name
        assert c.scalar(sa.text("SHOW TimeZone")) == "UTC"
        assert c.scalar(sa.text("SELECT version_num FROM public.alembic_version")) == current_head
        metadata = sa.MetaData(schema="hms")
        metadata.reflect(bind=c)
        evidence["databases"][name] = {
            "migration": current_head,
            "timezone": "UTC",
            "tables": {
                table.name: c.scalar(sa.select(sa.func.count()).select_from(table))
                for table in metadata.tables.values()
            },
        }
    engine.dispose()
path = (
    root
    / "verification"
    / ("current-integration-audit-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + ".json")
)
path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
print("PASS: owned Python, separate owned databases, UTC and current migrations verified")
print(f"Evidence: {path.name}")
