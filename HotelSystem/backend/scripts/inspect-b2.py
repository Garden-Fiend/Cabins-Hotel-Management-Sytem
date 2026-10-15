"""Read-only B2 constraint and compatibility counts; no business/contact values."""

import json

import sqlalchemy as sa
from dotenv import dotenv_values

from app.db import make_engine
from app.settings import require_isolated_local_database

for key in ("HMS_DATABASE_URL", "HMS_TEST_DATABASE_URL"):
    url = dotenv_values(".env")[key]
    require_isolated_local_database(url, test=key == "HMS_TEST_DATABASE_URL")
    engine = make_engine(url)
    with engine.connect() as c:
        print(key, "head", c.scalar(sa.text("SELECT version_num FROM public.alembic_version")))
        print(
            key, json.dumps(sa.inspect(c).get_unique_constraints("room_allocations", schema="hms"))
        )
        print(
            dict(
                c.execute(
                    sa.text(
                        "SELECT count(*) AS allocations, "
                        "count(DISTINCT reservation_id) AS reservations FROM hms.room_allocations"
                    )
                )
                .mappings()
                .one()
            )
        )
    engine.dispose()
