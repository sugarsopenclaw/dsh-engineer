from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.core.config import Settings


class SecurityHardeningTests(unittest.TestCase):
    def test_production_rejects_wildcard_cors(self) -> None:
        with self.assertRaisesRegex(ValidationError, "CORS_ORIGINS"):
            Settings(
                _env_file=None,
                APP_ENV="production",
                CORS_ORIGINS="*",
            )

    def test_production_accepts_explicit_cors_origins(self) -> None:
        settings = Settings(
            _env_file=None,
            APP_ENV="production",
            CORS_ORIGINS="https://xl.x3yun.com,https://admin.x3yun.com",
        )
        self.assertEqual(
            settings.cors_origins,
            ["https://xl.x3yun.com", "https://admin.x3yun.com"],
        )


if __name__ == "__main__":
    unittest.main()
