import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app import main
from app.settings import require_isolated_local_database


def test_liveness_without_database():
    with TestClient(main.app) as client:
        assert client.get("/api/v1/live").json() == {"status": "ok"}


def test_readiness_failure_is_explicit_and_redacted(monkeypatch):
    class Unavailable:
        def connect(self):
            raise OperationalError("secret connection", {}, Exception("password"))

    monkeypatch.setattr(main, "get_engine", lambda: Unavailable())
    with TestClient(main.app) as client:
        response = client.get("/api/v1/health")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unavailable"}
    assert "password" not in response.text


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://hms_dev@127.0.0.1:5432/hms_dev",
        "postgresql+psycopg://hms_dev@127.0.0.1:55432/biotime",
        "postgresql+psycopg://hms_dev@db.example.com:55432/hms_dev",
        "sqlite:///hms_dev",
        "postgresql+psycopg://hms_dev@127.0.0.1:55432/hms_dev?host=db.example.com",
    ],
)
def test_admin_tools_refuse_unrelated_databases(url):
    with pytest.raises(ValueError):
        require_isolated_local_database(url)
