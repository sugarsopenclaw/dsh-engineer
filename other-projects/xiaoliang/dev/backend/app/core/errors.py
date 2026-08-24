from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError


logger = logging.getLogger(__name__)


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        message: str,
        *,
        error_code: str | None = None,
        details: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.error_code = error_code
        self.details = details


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        payload: dict = {
            "success": False,
            "error": exc.message,
        }
        if exc.error_code:
            payload["message"] = exc.error_code
            payload["code"] = exc.error_code
        if exc.details is not None:
            payload["details"] = exc.details
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == status.HTTP_401_UNAUTHORIZED else None
        return JSONResponse(status_code=exc.status_code, content=payload, headers=headers)

    @app.exception_handler(SQLAlchemyTimeoutError)
    async def handle_database_busy(_: Request, exc: SQLAlchemyTimeoutError) -> JSONResponse:
        logger.warning("database connection pool exhausted: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "success": False,
                "error": "数据库连接繁忙，请稍后重试。",
                "message": "database_busy",
                "code": "database_busy",
            },
            headers={"Retry-After": "1"},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "error": "服务内部错误。",
                "message": exc.__class__.__name__,
            },
        )
