import pytest

from app.settings import require_isolated_local_database


def test_rehearsal_requires_explicit_process_opt_in(monkeypatch):
    url = "postgresql+psycopg://hms_rehearsal@127.0.0.1:55433/hms_rehearsal"
    monkeypatch.delenv("HMS_ALLOW_RECOVERY_REHEARSAL", raising=False)
    with pytest.raises(ValueError):
        require_isolated_local_database(url)
    monkeypatch.setenv("HMS_ALLOW_RECOVERY_REHEARSAL", "1")
    require_isolated_local_database(url)
    require_isolated_local_database(url.rsplit("/", 1)[0] + "/hms_restore")


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://hms_rehearsal@127.0.0.1:55433/hms_dev",
        "postgresql+psycopg://hms_rehearsal@127.0.0.1:55433/hms_test",
        "postgresql+psycopg://hms_rehearsal@127.0.0.1:55433/biotime",
        "postgresql+psycopg://hms_rehearsal@localhost:55433/hms_restore",
        "postgresql+psycopg://hms_dev@127.0.0.1:55433/hms_restore",
        "postgresql+psycopg://hms_rehearsal@127.0.0.1:55432/hms_restore",
        "postgresql+psycopg://hms_rehearsal@127.0.0.1:55433/hms_restore?host=remote",
    ],
)
def test_rehearsal_opt_in_does_not_authorize_other_targets(monkeypatch, url):
    monkeypatch.setenv("HMS_ALLOW_RECOVERY_REHEARSAL", "1")
    with pytest.raises(ValueError):
        require_isolated_local_database(url)
