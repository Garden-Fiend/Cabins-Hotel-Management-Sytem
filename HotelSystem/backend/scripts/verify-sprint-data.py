"""Hash-only preservation evidence for owned databases; never print guest data or credentials."""

import argparse
import hashlib
import json
from pathlib import Path

import sqlalchemy as sa
from dotenv import dotenv_values

from app.db import make_engine
from app.settings import require_isolated_local_database

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=("capture", "check"))
parser.add_argument("path", type=Path)
args = parser.parse_args()
path = args.path.resolve()
if not path.is_relative_to((root / "verification").resolve()):
    raise SystemExit("Evidence must remain inside backend/verification")
baseline = json.loads(path.read_text(encoding="utf-8")) if args.mode == "check" else {}
values = dotenv_values(root / ".env")
result = {}
for name, variable, test in (
    ("hms_dev", "HMS_DATABASE_URL", False),
    ("hms_test", "HMS_TEST_DATABASE_URL", True),
):
    url = values[variable]
    require_isolated_local_database(url, test=test)
    engine = make_engine(url)
    result[name] = {}
    with engine.connect() as connection:
        metadata = sa.MetaData(schema="hms")
        metadata.reflect(bind=connection)
        for table in sorted(metadata.tables.values(), key=lambda t: t.name):
            columns = (
                baseline[name][table.name]["columns"]
                if args.mode == "check" and table.name in baseline[name]
                else list(table.c.keys())
            )
            rows = [
                dict(row)
                for row in connection.execute(sa.select(*(table.c[c] for c in columns))).mappings()
            ]
            hashes = sorted(
                hashlib.sha256(json.dumps(row, sort_keys=True, default=str).encode()).hexdigest()
                for row in rows
            )
            result[name][table.name] = {"columns": columns, "rows": hashes}
    engine.dispose()
if args.mode == "capture":
    with path.open("x", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    print(f"Captured hash-only original rows/columns: {path}")
else:
    additions = {}
    for database, tables in baseline.items():
        additions[database] = {}
        for name, original in tables.items():
            if name not in result[database]:
                raise SystemExit("A pre-existing table is missing; no repair attempted.")
            actual = result[database][name]
            if not set(original["rows"]).issubset(set(actual["rows"])):
                raise SystemExit(
                    "Original row changed or missing; inspect concurrent work. No repair attempted."
                )
            extra = len(actual["rows"]) - len(original["rows"])
            if extra:
                additions[database][name] = extra
        for name, actual in result[database].items():
            if name not in tables:
                additions[database][name] = {"new_table_rows": len(actual["rows"])}
    print("PASS: all pre-existing rows/columns unchanged; additional rows retained:")
    print(json.dumps(additions, sort_keys=True))
