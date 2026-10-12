from alembic import context

from app import models  # noqa: F401
from app.db import Base, make_engine
from app.settings import get_settings, require_isolated_local_database

settings = get_settings()
url = settings.database_url.get_secret_value()
# Hosted migrations need a separate reviewed deployment workflow later.
require_isolated_local_database(url, test=url.endswith("/hms_test"))
target_metadata = Base.metadata


def include_name(name, type_, parent_names):
    if type_ == "schema":
        return name == "hms"
    return True


if context.is_offline_mode():
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = make_engine(url)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
            include_name=include_name,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()
