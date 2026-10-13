"""Read-only local foundation inventory; no credentials or guest/contact data in output."""

import hashlib
import json
import sys
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

import sqlalchemy as sa
from dotenv import dotenv_values
from sqlalchemy.engine import make_url

from app.db import make_engine
from app.settings import require_isolated_local_database

root = Path(__file__).resolve().parents[1]
values = dotenv_values(root / ".env")
evidence = dict(
    recorded_at=datetime.now(UTC).isoformat(),
    python=sys.version.split()[0],
    python_prefix=sys.prefix,
    python_base_prefix=sys.base_prefix,
    packages={
        name: version(name)
        for name in (
            "fastapi",
            "SQLAlchemy",
            "alembic",
            "psycopg",
            "pydantic",
            "tzdata",
            "pytest",
        )
    },
    databases={},
)
assert "zkbiotime" not in sys.base_prefix.lower()
for name, key in (("hms_dev", "HMS_DATABASE_URL"), ("hms_test", "HMS_TEST_DATABASE_URL")):
    url = values[key]
    require_isolated_local_database(url, test=name == "hms_test")
    target = make_url(url)
    engine = make_engine(url)
    try:
        inspector = sa.inspect(engine)
        with engine.connect() as c:
            current = c.execute(
                sa.text(
                    "SELECT current_database(), current_user, "
                    "current_setting('TimeZone'), version()"
                )
            ).one()
            assert current[0] == name and current[1] == "hms_dev" and current[2] == "UTC"
            metadata = sa.MetaData(schema="hms")
            metadata.reflect(c)
            tables = {
                table.name: c.scalar(sa.select(sa.func.count()).select_from(table))
                for table in metadata.tables.values()
            }
            assert len(tables) == 12
            assert sum(tables.values()) == 8, "Unexpected business/fixture rows remain"
            head = c.scalar(sa.text("SELECT version_num FROM alembic_version"))
            checks = {
                table: [item["name"] for item in inspector.get_check_constraints(table, "hms")]
                for table in ("companies", "room_types", "room_allocations", "pricing_revisions")
            }
            exclusion = c.scalar(
                sa.text(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE connamespace = 'hms'::regnamespace "
                    "AND conname = 'excl_active_room_overlap'"
                )
            )
            assert "EXCLUDE USING gist" in exclusion and "blocks_availability" in exclusion
            evidence["databases"][name] = dict(
                host=target.host,
                host_port=target.port,
                current_user=current[1],
                timezone=current[2],
                postgres=current[3],
                migration=head,
                row_counts=tables,
                check_constraints=checks,
                overlap_constraint=exclusion,
                btree_gist=c.scalar(
                    sa.text("SELECT extversion FROM pg_extension WHERE extname='btree_gist'")
                ),
            )
    finally:
        engine.dispose()

baseline = json.loads((root / "verification" / "frontend-baseline.json").read_text())
repository = root.parents[1]
changes = [
    path
    for path, digest in baseline.items()
    if hashlib.sha256((repository / path).read_bytes()).hexdigest() != digest
]
assert not changes, "Pre-existing non-backend files changed"
evidence["pre_existing_files_checked"] = len(baseline)
evidence["pre_existing_file_changes"] = changes
path = (
    root
    / "verification"
    / ("tuesday-foundation-audit-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + ".json")
)
path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
print("PASS: independent Python, two separate guarded DBs, UTC, 12 tables, 8 references each")
print(f"PASS: {len(baseline)} pre-existing files preserved")
print(f"Evidence: {path.name}")
