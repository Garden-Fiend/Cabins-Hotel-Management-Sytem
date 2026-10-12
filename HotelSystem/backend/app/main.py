import logging

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db import get_engine
from app.settings import get_settings

logger = logging.getLogger("hms.health")


def create_app() -> FastAPI:
    application = FastAPI(title="HMS operational backend", version="0.1.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
    )

    @application.get("/api/v1/health")
    def health(response: Response):
        try:
            with get_engine().connect() as connection:
                connection.execute(text("SELECT 1"))
        except SQLAlchemyError:
            # Never send connection URLs/passwords or raw driver errors to callers/logs.
            logger.warning("HMS database readiness check failed")
            response.status_code = 503
            return {"status": "unavailable", "database": "unavailable"}
        return {"status": "ok", "database": "ok", "scope": "foundation-only"}

    @application.get("/api/v1/live")
    def live():
        return {"status": "ok"}

    return application


app = create_app()
