from __future__ import annotations

import logging
from pathlib import Path

import anyio.to_thread
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.database import init_database
from app.core.errors import register_exception_handlers


def _configure_logging(*, debug: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if debug else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # httpx/httpcore connection traces are noise in both dev and prod.
    for noisy in ("httpcore", "httpx", "hpack", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def create_app() -> FastAPI:
    settings = get_settings()
    _configure_logging(debug=settings.debug)

    app = FastAPI(title=settings.app_name, version=settings.app_version)
    allow_credentials = settings.cors_origins != ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)
    app.include_router(api_router)

    @app.on_event("startup")
    def startup() -> None:
        # Starlette runs sync startup hooks inside the event loop, so the AnyIO RunVar is live.
        anyio.to_thread.current_default_thread_limiter().total_tokens = (
            settings.server_thread_pool_size
        )
        Path(settings.storage_root).mkdir(parents=True, exist_ok=True)
        if settings.auto_create_tables:
            init_database()

    return app


app = create_app()