from __future__ import annotations

import unittest

from fastapi.security import HTTPAuthorizationCredentials

from app.api.routes.agent_gateway import parse_gateway_credentials
from app.core.errors import AppError


class AgentGatewayAuthTests(unittest.TestCase):
    def test_parse_composite_credential(self) -> None:
        creds = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="xl.client-run-abc.jwt-token-value",
        )
        token, run_id = parse_gateway_credentials(creds, None)
        self.assertEqual(token, "jwt-token-value")
        self.assertEqual(run_id, "client-run-abc")

    def test_parse_header_run_id(self) -> None:
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="plain-jwt")
        token, run_id = parse_gateway_credentials(creds, "run-from-header")
        self.assertEqual(token, "plain-jwt")
        self.assertEqual(run_id, "run-from-header")

    def test_missing_token(self) -> None:
        with self.assertRaises(AppError) as raised:
            parse_gateway_credentials(None, None)
        self.assertEqual(raised.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
