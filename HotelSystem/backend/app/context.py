from dataclasses import dataclass
from uuid import UUID

from app.errors import DomainError
from app.settings import get_settings


@dataclass(frozen=True)
class CommandContext:
    company_id: UUID
    actor: str = "local-development"
    attribution: str = "local_development"


def get_command_context() -> CommandContext:
    settings = get_settings()
    if settings.env != "development":
        raise DomainError("development_only", "This API supports local development only", 503)
    return CommandContext(settings.company_id)
