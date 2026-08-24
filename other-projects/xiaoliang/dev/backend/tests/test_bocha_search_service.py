from __future__ import annotations

import unittest
from typing import Any

import httpx

from app.core.config import Settings
from app.services import bocha_search_service as bocha_mod
from app.services.bocha_search_service import (
    BochaSearchService,
    BochaSearchUnavailable,
)


def _settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "DASHSCOPE_API_KEY": "sk-test",
        "BOCHA_API_KEY": "bocha-test-key",
        "BOCHA_BASE_URL": "https://api.bochaai.com/v1",
        "BOCHA_SEARCH_COUNT": 10,
        "BOCHA_TIMEOUT_SECONDS": 30,
    }
    values.update(overrides)
    return Settings(**values)


class BochaSearchServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self._original_client = httpx.Client
        self._original_sleep = bocha_mod.time.sleep
        bocha_mod.time.sleep = lambda _seconds: None  # type: ignore[assignment]
        self.requests: list[httpx.Request] = []

    def tearDown(self) -> None:
        httpx.Client = self._original_client  # type: ignore[misc]
        bocha_mod.time.sleep = self._original_sleep  # type: ignore[assignment]

    def _route(self, handler) -> None:
        original = self._original_client
        requests = self.requests

        def record(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return handler(request)

        def patched(*args: Any, **kwargs: Any) -> httpx.Client:
            kwargs["transport"] = httpx.MockTransport(record)
            return original(*args, **kwargs)

        httpx.Client = patched  # type: ignore[misc]

    def test_hits_are_structured_and_carry_no_narration_or_summary(self) -> None:
        self._route(lambda _request: httpx.Response(
            200,
            json={
                "code": 200,
                "data": {
                    "webPages": {
                        "value": [
                            {
                                "name": "关于发布国家标准《建筑防火通用规范》的公告",
                                "url": "https://www.mohurd.gov.cn/gongkai/fdzdgknr/1.html",
                                "snippet": "现批准《建筑防火通用规范》为国家标准",
                                "siteName": "住房和城乡建设部",
                                "datePublished": "2022-01-19T00:00:00Z",
                            },
                            {
                                "name": "一文读懂地下车库装修防火等级",
                                "url": "https://zhuanlan.zhihu.com/p/123456",
                                "summary": "地下车库地面一律 A 级。",
                                "siteName": "知乎专栏",
                                "datePublished": "2023-05-01",
                            },
                            {"name": "缺少地址", "url": "javascript:void(0)"},
                            {
                                "name": "重复项",
                                "url": "https://www.mohurd.gov.cn/gongkai/fdzdgknr/1.html",
                            },
                        ]
                    }
                },
            },
        ))
        service = BochaSearchService(_settings())

        result = service.search(
            query="GB 55037 公告",
            limit=5,
            region="河北省石家庄市",
            freshness="oneYear",
        )

        self.assertEqual(result.provider, "bocha")
        self.assertEqual(result.model, "bocha-web-search")
        self.assertEqual(result.status, "ok")
        # No model wrote a narrative, so there is nothing to mistake for the clause text.
        self.assertEqual(result.answer, "")
        self.assertEqual(len(result.sources), 2)

        first, second = result.sources
        self.assertEqual(first.url, "https://www.mohurd.gov.cn/gongkai/fdzdgknr/1.html")
        self.assertEqual(first.site_name, "住房和城乡建设部")
        self.assertEqual(first.published_at, "2022-01-19")
        self.assertIsNone(first.source_tier)
        self.assertIsNone(second.source_tier)
        # Bocha's model-generated/expanded summary is never admitted as a hit snippet.
        self.assertIsNone(second.snippet)

        assert result.warning is not None
        self.assertIn("不含网页正文", result.warning)
        self.assertIn("河北省石家庄市", result.warning)

        request = self.requests[0]
        self.assertEqual(str(request.url), "https://api.bochaai.com/v1/web-search")
        self.assertEqual(request.headers["authorization"], "Bearer bocha-test-key")
        import json

        # Bocha has no region field, so the region must travel inside the query text.
        request_body = json.loads(request.content)
        self.assertEqual(request_body["query"], "河北省石家庄市 GB 55037 公告")
        self.assertEqual(request_body["freshness"], "oneYear")
        self.assertFalse(request_body["summary"])

    def test_limit_bounds_the_requested_and_returned_hit_count(self) -> None:
        self._route(lambda _request: httpx.Response(
            200,
            json={
                "webPages": {
                    "value": [
                        {"name": f"命中 {index}", "url": f"https://www.gov.cn/{index}"}
                        for index in range(20)
                    ]
                }
            },
        ))
        service = BochaSearchService(_settings())

        result = service.search(query="标准", limit=3)

        self.assertEqual(len(result.sources), 3)
        import json

        self.assertEqual(json.loads(self.requests[0].content)["count"], 3)

    def test_query_is_not_prefixed_when_region_is_blank(self) -> None:
        self._route(lambda _request: httpx.Response(200, json={"webPages": {"value": []}}))
        service = BochaSearchService(_settings())

        service.search(query="标准", region="   ")
        service.search(query="标准")

        import json

        for request in self.requests:
            self.assertEqual(json.loads(request.content)["query"], "标准")

    def test_retryable_status_is_retried_once(self) -> None:
        attempts = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(503, text="temporary")
            return httpx.Response(200, json={"webPages": {"value": []}})

        self._route(handler)
        result = BochaSearchService(_settings()).search(query="标准")

        self.assertEqual(attempts, 2)
        self.assertEqual(result.provider, "bocha")

    def test_domain_filters_are_added_to_query_and_enforced_on_hits(self) -> None:
        self._route(lambda _request: httpx.Response(
            200,
            json={
                "webPages": {
                    "value": [
                        {"url": "https://www.gov.cn/official"},
                        {"url": "https://sub.mohurd.gov.cn/notice"},
                        {"url": "https://example.com/repost"},
                    ]
                }
            },
        ))
        service = BochaSearchService(_settings())

        result = service.search(
            query="标准公告",
            allowed_domains=["gov.cn", "mohurd.gov.cn"],
        )

        import json

        request_query = json.loads(self.requests[0].content)["query"]
        self.assertIn("site:gov.cn OR site:mohurd.gov.cn", request_query)
        self.assertEqual(
            [source.url for source in result.sources],
            ["https://www.gov.cn/official", "https://sub.mohurd.gov.cn/notice"],
        )

        self.requests.clear()
        blocked = service.search(query="标准公告", blocked_domains=["example.com"])
        self.assertNotIn("site:", json.loads(self.requests[0].content)["query"])
        self.assertEqual(len(blocked.sources), 2)

    def test_missing_key_transport_error_and_error_code_all_signal_unavailable(self) -> None:
        unconfigured = BochaSearchService(_settings(BOCHA_API_KEY=""))
        self.assertFalse(unconfigured.is_configured)
        with self.assertRaises(BochaSearchUnavailable):
            unconfigured.search(query="标准")

        service = BochaSearchService(_settings())
        with self.assertRaises(BochaSearchUnavailable):
            service.search(query="   ")

        self._route(lambda _request: httpx.Response(500, text="upstream boom"))
        with self.assertRaises(BochaSearchUnavailable) as raised:
            service.search(query="标准")
        self.assertIn("500", str(raised.exception))

        self._route(lambda _request: httpx.Response(200, json={"code": 403, "msg": "quota"}))
        with self.assertRaises(BochaSearchUnavailable) as raised:
            service.search(query="标准")
        self.assertIn("403", str(raised.exception))

        self._route(lambda _request: httpx.Response(200, json={"code": "OK"}))
        with self.assertRaises(BochaSearchUnavailable) as raised:
            service.search(query="标准")
        self.assertIn("code 字段异常", str(raised.exception))

        self._route(lambda _request: httpx.Response(200, text="not json"))
        with self.assertRaises(BochaSearchUnavailable):
            service.search(query="标准")

        def explode(_request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("dns failure")

        self._route(explode)
        with self.assertRaises(BochaSearchUnavailable) as raised:
            service.search(query="标准")
        self.assertIn("dns failure", str(raised.exception))

    def test_a_malformed_hit_url_is_skipped_without_losing_later_valid_hits(self) -> None:
        self._route(lambda _request: httpx.Response(
            200,
            json={
                "webPages": {
                    "value": [
                        {"name": "坏地址", "url": "http://["},
                        {
                            "name": "有效公告",
                            "url": "https://www.gov.cn/zhengce/content/2026-01/01/content_1.htm",
                        },
                    ]
                }
            },
        ))
        service = BochaSearchService(_settings())

        result = service.search(query="标准公告")

        self.assertEqual(len(result.sources), 1)
        self.assertEqual(
            result.sources[0].url,
            "https://www.gov.cn/zhengce/content/2026-01/01/content_1.htm",
        )
        self.assertIsNone(result.sources[0].source_tier)

    def test_an_empty_hit_list_is_reported_rather_than_silently_returned(self) -> None:
        self._route(lambda _request: httpx.Response(200, json={"webPages": {"value": []}}))
        service = BochaSearchService(_settings())

        result = service.search(query="不存在的标准编号")

        self.assertEqual(result.sources, [])
        self.assertEqual(result.status, "empty")
        assert result.warning is not None
        self.assertIn("未命中", result.warning)


if __name__ == "__main__":
    unittest.main()
