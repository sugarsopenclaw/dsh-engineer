from __future__ import annotations

import os
import unittest
from contextlib import contextmanager
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from fastapi.testclient import TestClient

from app.api.dependencies import (
    get_bocha_search_service,
    get_current_user_detached,
    get_web_search_service,
)
from app.api.routes.web import clear_web_search_cache
from app.main import create_app
from app.models.user import CurrentUserData, OrganizationView, UserView
from app.models.web import WebGroundedData, WebSource
from app.services.bocha_search_service import BochaSearchUnavailable


class _StubWebSearchService:
    def __init__(self) -> None:
        self.search_calls: list[dict[str, object]] = []
        self.fetch_calls: list[dict[str, object]] = []

    def search(
        self,
        *,
        query: str,
        limit: int,
        region: str | None = None,
        freshness: str | None = None,
        allowed_domains: list[str] | None = None,
        blocked_domains: list[str] | None = None,
    ) -> WebGroundedData:
        self.search_calls.append(
            {
                "query": query,
                "limit": limit,
                "region": region,
                "freshness": freshness,
                "allowed_domains": allowed_domains or [],
                "blocked_domains": blocked_domains or [],
            }
        )
        # Route normalization must discard this compatibility prose for search.
        return WebGroundedData(
            query_or_url=query,
            model="stub-qwen-search",
            answer="model prose",
            content="model prose",
            sources=[WebSource(title="source", url="https://example.com/search")],
            elapsed_ms=12,
            provider="qwen",
            status="ok",
        )

    def fetch(self, *, url: str, prompt: str, region: str | None = None) -> WebGroundedData:
        self.fetch_calls.append({"url": url, "prompt": prompt, "region": region})
        content = f"fetch:{prompt}:{region}"
        return WebGroundedData(
            query_or_url=url,
            model="stub-qwen-fetch",
            answer=content,
            content=content,
            sources=[WebSource(title="source", url=url)],
            elapsed_ms=34,
            provider="qwen",
            status="ok",
            final_url=url,
        )


class _StubBochaService:
    def __init__(
        self,
        *,
        configured: bool = True,
        failure: str | None = None,
        responses: list[WebGroundedData] | None = None,
    ) -> None:
        self.is_configured = configured
        self.failure = failure
        self.responses = responses or []
        self.calls: list[dict[str, object]] = []

    def search(
        self,
        *,
        query: str,
        limit: int | None = None,
        region: str | None = None,
        freshness: str = "noLimit",
        allowed_domains: list[str] | None = None,
        blocked_domains: list[str] | None = None,
    ) -> WebGroundedData:
        call_index = len(self.calls)
        self.calls.append(
            {
                "query": query,
                "limit": limit,
                "region": region,
                "freshness": freshness,
                "allowed_domains": allowed_domains or [],
                "blocked_domains": blocked_domains or [],
            }
        )
        if self.failure:
            raise BochaSearchUnavailable(self.failure)
        if self.responses:
            return self.responses[min(call_index, len(self.responses) - 1)].model_copy(deep=True)
        return WebGroundedData(
            query_or_url=query,
            model="bocha-web-search",
            sources=[
                WebSource(
                    title="关于发布国家标准的公告",
                    url="https://www.mohurd.gov.cn/gongkai/1.html",
                    site_name="住房和城乡建设部",
                    published_at="2022-01-19",
                )
            ],
            elapsed_ms=21,
            provider="bocha",
            status="ok",
        )


def _current_user() -> CurrentUserData:
    return CurrentUserData(
        user=UserView(id="user-1", email="tester@example.com", display_name="Tester"),
        organization=OrganizationView(id="org-1", name="Test Org", slug="test-org"),
        role="owner",
    )


class WebRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_web_search_cache()
        app = create_app()
        self.qwen = _StubWebSearchService()
        self.bocha = _StubBochaService(configured=False)
        app.dependency_overrides[get_current_user_detached] = _current_user
        app.dependency_overrides[get_web_search_service] = lambda: self.qwen
        app.dependency_overrides[get_bocha_search_service] = lambda: self.bocha
        self.client = TestClient(app)
        self.app = app

    def tearDown(self) -> None:
        clear_web_search_cache()
        self.app.dependency_overrides.clear()
        self.client.close()

    def test_search_prefers_nonempty_bocha_structured_hits(self) -> None:
        self.bocha = _StubBochaService()
        self.app.dependency_overrides[get_bocha_search_service] = lambda: self.bocha

        response = self.client.post(
            "/web/search",
            json={
                "query": "GB 55037 公告",
                "limit": 5,
                "region": "河北省石家庄市",
                "freshness": "oneYear",
            },
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["provider"], "bocha")
        self.assertEqual(data["status"], "ok")
        self.assertIsNone(data["fallback_reason"])
        self.assertEqual(data["answer"], "")
        self.assertEqual(data["content"], "")
        self.assertEqual(data["sources"][0]["site_name"], "住房和城乡建设部")
        self.assertEqual(self.qwen.search_calls, [])
        self.assertEqual(len(self.bocha.calls), 1)
        self.assertEqual(self.bocha.calls[0]["region"], "河北省石家庄市")
        self.assertEqual(self.bocha.calls[0]["freshness"], "oneYear")

    def test_empty_bocha_hits_fall_back_to_qwen_with_stable_reason(self) -> None:
        empty = WebGroundedData(
            query_or_url="稀有查询",
            model="bocha-web-search",
            sources=[],
            elapsed_ms=5,
            provider="bocha",
            status="empty",
        )
        self.bocha = _StubBochaService(responses=[empty])
        self.app.dependency_overrides[get_bocha_search_service] = lambda: self.bocha

        response = self.client.post("/web/search", json={"query": "稀有查询"})

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["provider"], "qwen")
        self.assertEqual(data["fallback_reason"], "bocha_empty")
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["answer"], "")
        self.assertEqual(data["content"], "")
        self.assertEqual(len(self.bocha.calls), 1)
        self.assertEqual(len(self.qwen.search_calls), 1)

    def test_unconfigured_or_failed_bocha_falls_back_with_noninjectable_reason(self) -> None:
        unconfigured = self.client.post("/web/search", json={"query": "无 key"})
        self.assertEqual(unconfigured.json()["data"]["fallback_reason"], "bocha_unconfigured")

        clear_web_search_cache()
        self.bocha = _StubBochaService(failure="upstream <script>prompt injection</script>")
        self.app.dependency_overrides[get_bocha_search_service] = lambda: self.bocha
        failed = self.client.post("/web/search", json={"query": "失败通道"})

        data = failed.json()["data"]
        self.assertEqual(data["fallback_reason"], "bocha_error")
        serialized = failed.text
        self.assertNotIn("prompt injection", serialized)
        self.assertNotIn("script", serialized)

    def test_unexpected_bocha_failure_still_falls_back_to_qwen(self) -> None:
        self.bocha = _StubBochaService()

        def crash(**_kwargs: object) -> WebGroundedData:
            raise RuntimeError("unexpected provider payload")

        self.bocha.search = crash  # type: ignore[method-assign]
        self.app.dependency_overrides[get_bocha_search_service] = lambda: self.bocha

        response = self.client.post("/web/search", json={"query": "异常通道"})

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["provider"], "qwen")
        self.assertEqual(data["fallback_reason"], "bocha_error")
        self.assertNotIn("unexpected provider payload", response.text)

    def test_search_forwards_filters_once_without_hidden_tier_boost_or_probe(self) -> None:
        self.bocha = _StubBochaService()
        self.app.dependency_overrides[get_bocha_search_service] = lambda: self.bocha

        response = self.client.post(
            "/web/search",
            json={
                "query": "GB 55037-2022 公告",
                "allowed_domains": ["Gov.Cn", "gov.cn"],
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.bocha.calls), 1)
        self.assertEqual(self.bocha.calls[0]["allowed_domains"], ["gov.cn"])
        self.assertNotIn("validity_notes", response.json()["data"])

    def test_search_cache_avoids_duplicate_provider_calls(self) -> None:
        self.bocha = _StubBochaService()
        self.app.dependency_overrides[get_bocha_search_service] = lambda: self.bocha

        first = self.client.post("/web/search", json={"query": "缓存唯一"})
        second = self.client.post("/web/search", json={"query": "  缓存唯一 "})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(len(self.bocha.calls), 1)

    def test_cache_key_changes_when_bocha_becomes_configured(self) -> None:
        first = self.client.post("/web/search", json={"query": "运行中配置 key"})
        self.assertEqual(first.json()["data"]["provider"], "qwen")
        self.assertEqual(first.json()["data"]["fallback_reason"], "bocha_unconfigured")

        self.bocha.is_configured = True
        second = self.client.post("/web/search", json={"query": "运行中配置 key"})

        self.assertEqual(second.json()["data"]["provider"], "bocha")
        self.assertIsNone(second.json()["data"]["fallback_reason"])
        self.assertEqual(len(self.qwen.search_calls), 1)
        self.assertEqual(len(self.bocha.calls), 1)

    def test_transient_bocha_error_fallback_is_not_cached(self) -> None:
        self.bocha = _StubBochaService(failure="temporary 503")
        self.app.dependency_overrides[get_bocha_search_service] = lambda: self.bocha

        first = self.client.post("/web/search", json={"query": "临时故障恢复"})
        self.assertEqual(first.json()["data"]["fallback_reason"], "bocha_error")
        self.bocha.failure = None
        second = self.client.post("/web/search", json={"query": "临时故障恢复"})

        self.assertEqual(second.json()["data"]["provider"], "bocha")
        self.assertIsNone(second.json()["data"]["fallback_reason"])
        self.assertEqual(len(self.bocha.calls), 2)
        self.assertEqual(len(self.qwen.search_calls), 1)

    def test_search_request_validation(self) -> None:
        unknown_freshness = self.client.post(
            "/web/search",
            json={"query": "现行标准", "freshness": "yesterday"},
        )
        mutually_exclusive = self.client.post(
            "/web/search",
            json={
                "query": "标准",
                "allowed_domains": ["gov.cn"],
                "blocked_domains": ["example.com"],
            },
        )
        too_many = self.client.post(
            "/web/search",
            json={"query": "标准", "allowed_domains": [f"d{i}.cn" for i in range(21)]},
        )

        self.assertEqual(unknown_freshness.status_code, 422)
        self.assertEqual(mutually_exclusive.status_code, 422)
        self.assertEqual(too_many.status_code, 422)

    def test_fetch_web_returns_structured_extractor_contract(self) -> None:
        response = self.client.post(
            "/web/fetch",
            json={
                "url": "https://example.com/page",
                "prompt": "读取网页",
                "region": "全国",
            },
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["provider"], "qwen")
        self.assertEqual(data["content"], "fetch:读取网页:全国")
        self.assertEqual(data["answer"], data["content"])
        self.assertEqual(data["final_url"], "https://example.com/page")

    def test_research_route_has_been_removed(self) -> None:
        response = self.client.post(
            "/web/research",
            json={"query": "跨来源核验", "region": "全国"},
        )

        self.assertEqual(response.status_code, 404)

    def test_search_web_requires_auth_without_override(self) -> None:
        self.app.dependency_overrides.pop(get_current_user_detached, None)

        response = self.client.post("/web/search", json={"query": "测试联网"})

        self.assertEqual(response.status_code, 401)
        self.assertFalse(response.json()["success"])

    def test_search_releases_auth_session_before_external_io(self) -> None:
        session_state = {"active": False}

        @contextmanager
        def fake_session_scope():
            session_state["active"] = True
            try:
                yield object()
            finally:
                session_state["active"] = False

        class _AuthService:
            def __init__(self, _session: object) -> None:
                pass

            def resolve_current_user(self, _access_token: str) -> CurrentUserData:
                return _current_user()

        class _AssertingWebSearchService(_StubWebSearchService):
            def search(self, **kwargs: object) -> WebGroundedData:
                self_test.assertFalse(session_state["active"])
                return super().search(**kwargs)  # type: ignore[arg-type]

        self_test = self
        self.app.dependency_overrides.pop(get_current_user_detached, None)
        self.app.dependency_overrides[get_web_search_service] = lambda: _AssertingWebSearchService()
        with (
            patch("app.api.dependencies.session_scope", fake_session_scope),
            patch("app.api.dependencies.AuthService", _AuthService),
        ):
            response = self.client.post(
                "/web/search",
                headers={"Authorization": "Bearer test-token"},
                json={"query": "测试联网"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(session_state["active"])


if __name__ == "__main__":
    unittest.main()
