from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session

from app.settings import get_settings, require_isolated_local_database


class Base(DeclarativeBase):
    metadata = MetaData(
        schema="hms",
        naming_convention={
            "ix": "ix_%(table_name)s_%(column_0_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        },
    )


def make_engine(url: str | None = None):
    target = url or get_settings().database_url.get_secret_value()
    from sqlalchemy.engine import make_url

    require_isolated_local_database(target, test=make_url(target).database == "hms_test")
    return create_engine(
        target,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 3, "options": "-c timezone=UTC"},
    )


def get_session() -> Iterator[Session]:
    # Session ownership is per request; later business commands use session.begin().
    with Session(get_engine()) as session:
        yield session


@lru_cache
def get_engine():
    return make_engine()
