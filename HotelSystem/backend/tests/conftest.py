from pathlib import Path

import pytest
from dotenv import dotenv_values

from app.db import make_engine
from app.seed import seed_reference_data
from app.settings import require_isolated_local_database


def pytest_addoption(parser):
    parser.addoption("--postgres", action="store_true", help="Opt into isolated hms_test DB checks")


@pytest.fixture(scope="session")
def pg_engine(request):
    if not request.config.getoption("--postgres"):
        pytest.skip("Run explicitly with --postgres against the isolated hms_test database")
    values = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
    url = values.get("HMS_TEST_DATABASE_URL")
    if not url:
        pytest.fail("Configure HMS_TEST_DATABASE_URL before opting into PostgreSQL tests")
    require_isolated_local_database(url, test=True)
    seed_reference_data(url, test=True)
    engine = make_engine(url)
    yield engine
    engine.dispose()


@pytest.fixture
def pg_connection(pg_engine):
    with pg_engine.connect() as connection:
        transaction = connection.begin()
        yield connection
        transaction.rollback()
