from __future__ import annotations

import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError

from app.core.errors import register_exception_handlers


class DatabaseBusyErrorTests(unittest.TestCase):
    def test_pool_timeout_is_reported_as_retryable_503(self) -> None:
        app = FastAPI()
        register_exception_handlers(app)

        @app.get("/busy")
        def busy() -> None:
            raise SQLAlchemyTimeoutError("QueuePool limit reached")

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/busy")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["Retry-After"], "1")
        self.assertEqual(response.json()["code"], "database_busy")


if __name__ == "__main__":
    unittest.main()
