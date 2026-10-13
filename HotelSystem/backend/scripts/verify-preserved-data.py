"""Read-only comparison of existing data across the additive safeguards migration."""

import json
import sys
from pathlib import Path

import sqlalchemy as sa
from dotenv import dotenv_values

from app.db import make_engine
from app.settings import require_isolated_local_database

root = Path(__file__).resolve().parents[1]
values = dotenv_values(root / ".env")
snapshot = {}
for database, key in (("hms_dev", "HMS_DATABASE_URL"), ("hms_test", "HMS_TEST_DATABASE_URL")):
    url = values[key]
    require_isolated_local_database(url, test=database == "hms_test")
    engine = make_engine(url)
    try:
        metadata = sa.MetaData(schema="hms")
        metadata.reflect(engine)
        with engine.connect() as connection:
            snapshot[database] = {}
            # Read-only snapshots need stable name order, not dependency ordering.
            for table in sorted(metadata.tables.values(), key=lambda table: table.name):
                columns = [
                    c
                    for c in table.c
                    if c.name not in ("default_check_in_time", "default_check_out_time")
                ]
                rows = connection.execute(sa.select(*columns).order_by(table.c.id)).mappings()
                snapshot[database][table.name] = [dict(row) for row in rows]
    finally:
        engine.dispose()
encoded = json.dumps(snapshot, default=str, sort_keys=True, indent=2)
path = root / "verification" / "schema-safeguards-data-before.json"
if sys.argv[1:] == ["capture"]:
    if path.exists():
        raise SystemExit("Refusing to replace an existing preservation baseline")
    path.write_text(encoded + "\n", encoding="utf-8")
    print("Captured existing rows from both owned databases; no database writes")
elif sys.argv[1:] == ["check"]:
    baseline = json.loads(path.read_text(encoding="utf-8"))
    current = json.loads(encoded)
    # Additive migrations may introduce columns, but every baseline value and row must remain.
    for database, tables in baseline.items():
        for table, rows in tables.items():
            columns = set(rows[0]) if rows else set()
            current[database][table] = [
                {key: row[key] for key in columns} for row in current[database][table]
            ]
    if baseline != current:
        raise SystemExit("Existing data differs from the preservation baseline")
    print("PASS: all pre-existing column values and rows unchanged in both databases")
else:
    raise SystemExit("Use capture before migration or check after migration")
