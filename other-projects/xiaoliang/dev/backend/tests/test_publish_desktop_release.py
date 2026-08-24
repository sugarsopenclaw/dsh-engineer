from __future__ import annotations

import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from scripts import publish_desktop_release


class PublishDesktopReleaseTests(unittest.TestCase):
    def test_post_release_falls_back_to_dotenv_settings_token(self) -> None:
        args = SimpleNamespace(admin_token="", backend_url="https://xl.example.com")
        response = Mock(status_code=200)
        response.json.return_value = {"version": "0.8.17"}

        with (
            patch.dict(os.environ, {"RELEASE_ADMIN_TOKEN": ""}),
            patch.object(
                publish_desktop_release,
                "get_settings",
                return_value=SimpleNamespace(release_admin_token="dotenv-token"),
            ),
            patch.object(publish_desktop_release.httpx, "post", return_value=response) as post,
        ):
            publish_desktop_release.post_release(args, {"version": "0.8.17"})

        post.assert_called_once_with(
            "https://xl.example.com/api/desktop-updates/admin/releases",
            headers={"X-Release-Admin-Token": "dotenv-token"},
            json={"version": "0.8.17"},
            timeout=30,
        )


if __name__ == "__main__":
    unittest.main()
