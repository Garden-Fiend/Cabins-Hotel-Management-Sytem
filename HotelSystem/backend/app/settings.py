from functools import lru_cache
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="HMS_",
        env_file=Path(__file__).resolve().parents[1] / ".env",
        extra="ignore",
        hide_input_in_errors=True,
    )
    env: str = "development"
    database_url: SecretStr
    company_id: UUID = uuid5(NAMESPACE_URL, "hms-local-reference:company")
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @field_validator("database_url")
    @classmethod
    def postgres_only(cls, value: SecretStr) -> SecretStr:
        url = make_url(value.get_secret_value())
        if url.drivername != "postgresql+psycopg":
            raise ValueError("HMS requires PostgreSQL with the psycopg driver")
        require_isolated_local_database(value.get_secret_value(), test=url.database == "hms_test")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


def require_isolated_local_database(url_value: str, *, test: bool = False) -> None:
    """Destructive/admin tooling fails closed; no third-party or hosted database targets."""
    url = make_url(url_value)
    expected = "hms_test" if test else "hms_dev"
    if (
        url.drivername != "postgresql+psycopg"
        or url.host not in {"127.0.0.1", "localhost"}
        or url.port != 55432
        or url.username != "hms_dev"
        or url.database != expected
        or bool(url.query)  # Driver query parameters must not override the guarded target.
    ):
        raise ValueError(f"Only isolated local {expected} on port 55432 is authorized")
