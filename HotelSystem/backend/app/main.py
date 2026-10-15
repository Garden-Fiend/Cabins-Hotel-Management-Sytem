import logging

from fastapi import FastAPI, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db import get_engine
from app.errors import DomainError
from app.modules.billing.router import router as billing_router
from app.modules.configuration.router import router as configuration_router
from app.modules.reservations.router import router
from app.settings import get_settings

logger = logging.getLogger("hms.health")


def create_app() -> FastAPI:
    application = FastAPI(title="HMS operational backend", version="0.1.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Content-Type", "Idempotency-Key"],
    )
    application.include_router(router)
    application.include_router(configuration_router)
    application.include_router(billing_router)

    @application.exception_handler(DomainError)
    async def domain_error(_request, error):
        return JSONResponse(status_code=error.status, content=error.response())

    @application.exception_handler(RequestValidationError)
    async def invalid_request(_request, error):
        body = DomainError("invalid_request", "Request validation failed", 422).response()
        body["field_errors"] = [
            dict(field=".".join(str(part) for part in item["loc"]), message=item["msg"])
            for item in error.errors()
        ]
        return JSONResponse(status_code=422, content=body)

    @application.exception_handler(SQLAlchemyError)
    async def database_error(_request, error):
        state = getattr(getattr(error, "orig", None), "sqlstate", None)
        if state == "23P01":
            fault = DomainError("room_conflict", "Room is already reserved for this interval")
        elif state and state.startswith("23"):
            fault = DomainError("integrity_error", "Record integrity requires review", 500)
        else:
            fault = DomainError(
                "database_unavailable", "Database temporarily unavailable; retry", 503
            )
        logger.warning("HMS database command failed")
        return JSONResponse(status_code=fault.status, content=fault.response())

    @application.exception_handler(ValidationError)
    async def invalid_saved_data(_request, _error):
        fault = DomainError("integrity_error", "Saved data requires integrity review", 500)
        return JSONResponse(status_code=500, content=fault.response())

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
        return {"status": "ok", "database": "ok", "scope": "direct-create-read-development"}

    @application.get("/api/v1/live")
    def live():
        return {"status": "ok"}

    return application


app = create_app()
