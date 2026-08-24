from __future__ import annotations

import unittest
from typing import Any

from app.core.config import Settings
from app.core.errors import AppError
from app.services.web_search_service import WebSearchService


def _settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "DASHSCOPE_API_KEY": "sk-test",
        "DASHSCOPE_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "QWEN_WEB_SEARCH_MODEL": "qwen-search-test",
        "QWEN_WEB_FETCH_MODEL": "qwen-fetch-test",
        "QWEN_WEB_SOURCE_LIMIT": 8,
        "QWEN_WEB_SEARCH_TIMEOUT_SECONDS": 90,
        "QWEN_WEB_FETCH_TIMEOUT_SECONDS": 180,
    }
    values.update(overrides)
    return Settings(**values)


class WebSearchServiceTests(unittest.TestCase):
    def test_search_uses_responses_structured_sources_and_ignores_model_prose(self) -> None:
        service = WebSearchService(_settings())
        calls: list[dict[str, Any]] = []

        def fake_post_json(url: str, payload: dict, **kwargs: Any) -> dict:
            calls.append({"url": url, "payload": payload, "kwargs": kwargs})
            return {
                "output_text": "这段模型综述绝不能进入搜索结果",
                "output": [
                    {
                        "type": "web_search_call",
                        "action": {
                            "sources": [
                                {
                                    "title": "官方文档",
                                    "url": "https://www.gov.cn/doc",
                                    "snippet": "结构化摘要",
                                }
                            ]
                        },
                    },
                    {
                        "type": "message",
                        "content": [{"text": "https://invented.example/prose"}],
                    },
                ],
            }

        service._post_json = fake_post_json  # type: ignore[method-assign]
        result = service.search(
            query="联网搜索测试",
            limit=3,
            region="广东省深圳市",
            freshness="oneMonth",
            allowed_domains=["gov.cn"],
        )

        self.assertEqual(result.answer, "")
        self.assertEqual(result.content, "")
        self.assertEqual(result.provider, "qwen")
        self.assertEqual(result.status, "ok")
        self.assertEqual([source.url for source in result.sources], ["https://www.gov.cn/doc"])
        self.assertIsNone(result.sources[0].source_tier)
        self.assertEqual(
            calls[0]["url"],
            "https://dashscope.aliyuncs.com/compatible-mode/v1/responses",
        )
        self.assertEqual(calls[0]["payload"]["tools"], [{"type": "web_search"}])
        self.assertTrue(calls[0]["payload"]["enable_thinking"])
        self.assertIn("适用区域：广东省深圳市", calls[0]["payload"]["input"])
        self.assertIn("优先时间范围：最近一个月", calls[0]["payload"]["input"])
        self.assertIn("只检索这些域名：gov.cn", calls[0]["payload"]["input"])
        self.assertEqual(calls[0]["kwargs"]["timeout_seconds"], 90)

    def test_search_rejects_every_non_action_sources_compatibility_path(self) -> None:
        service = WebSearchService(_settings())

        def fake_post_json(*args: Any, **kwargs: Any) -> dict:
            return {
                "output_text": "模型正文带 https://example.com/prose",
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "annotations": [
                                    {"title": "annotation", "url": "https://example.com/a"}
                                ]
                            }
                        ],
                    },
                    {
                        "type": "web_extractor_call",
                        "goal": "https://example.com/b",
                        "output": "抓取内容",
                    },
                    {"type": "web_search_call", "action": {"query": "missing sources"}},
                ],
            }

        service._post_json = fake_post_json  # type: ignore[method-assign]
        result = service.search(query="没有结构化来源")

        self.assertEqual(result.sources, [])
        self.assertEqual(result.status, "empty")
        self.assertEqual(result.answer, "")
        self.assertIn("模型生成正文已忽略", result.warning or "")

    def test_search_filters_after_collecting_all_structured_sources(self) -> None:
        service = WebSearchService(_settings())
        disallowed = [
            {"url": f"https://example.com/{index}"}
            for index in range(15)
        ]
        allowed = [
            {"url": "https://www.gov.cn/late-1"},
            {"url": "https://www.gov.cn/late-2"},
        ]

        def fake_post_json(*args: Any, **kwargs: Any) -> dict:
            return {
                "output": [
                    {
                        "type": "web_search_call",
                        "action": {"sources": [*disallowed, *allowed]},
                    }
                ]
            }

        service._post_json = fake_post_json  # type: ignore[method-assign]
        result = service.search(
            query="只要官方命中",
            limit=2,
            allowed_domains=["gov.cn"],
        )

        self.assertEqual(
            [source.url for source in result.sources],
            ["https://www.gov.cn/late-1", "https://www.gov.cn/late-2"],
        )

    def test_fetch_accepts_only_matching_extractor_goal_output(self) -> None:
        service = WebSearchService(_settings())
        calls: list[dict[str, Any]] = []

        def fake_post_json(url: str, payload: dict, **kwargs: Any) -> dict:
            calls.append({"url": url, "payload": payload, "kwargs": kwargs})
            return {
                "output_text": "模型加工后的答案不得作为抓取内容",
                "output": [
                    {
                        "type": "web_search_call",
                        "action": {
                            "sources": [{"url": "https://example.com/search-result"}]
                        },
                    },
                    {
                        "type": "web_extractor_call",
                        "goal": "https://example.com/page/",
                        "output": "# 网页原始提取内容",
                        "content_type": "text/markdown",
                    },
                    {
                        "type": "message",
                        "content": [{"text": "另一段模型正文"}],
                    },
                ],
            }

        service._post_json = fake_post_json  # type: ignore[method-assign]
        result = service.fetch(
            url="https://example.com/page",
            prompt="读取正文",
            region="全国",
        )

        self.assertEqual(result.content, "# 网页原始提取内容")
        self.assertEqual(result.answer, result.content)
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.final_url, "https://example.com/page/")
        self.assertEqual(result.content_type, "text/markdown")
        self.assertIsNone(result.truncated)
        self.assertEqual([source.url for source in result.sources], [result.final_url])
        self.assertIsNone(result.sources[0].source_tier)
        self.assertEqual(
            calls[0]["url"],
            "https://dashscope.aliyuncs.com/compatible-mode/v1/responses",
        )
        self.assertEqual(
            calls[0]["payload"]["tools"],
            [{"type": "web_search"}, {"type": "web_extractor"}],
        )
        self.assertTrue(calls[0]["payload"]["enable_thinking"])
        self.assertEqual(calls[0]["kwargs"]["timeout_seconds"], 180)

    def test_fetch_accepts_extractor_https_upgrade_and_www_canonicalisation(self) -> None:
        service = WebSearchService(_settings())

        def fake_post_json(*args: Any, **kwargs: Any) -> dict:
            return {
                "output": [
                    {
                        "type": "web_extractor_call",
                        "goal": "读取网页",
                        "urls": ["https://www.example.com/page/?x=1"],
                        "output": "升级后的网页正文",
                    }
                ]
            }

        service._post_json = fake_post_json  # type: ignore[method-assign]
        result = service.fetch(url="http://example.com/page?x=1", prompt="读取")

        self.assertEqual(result.status, "ok")
        self.assertEqual(result.content, "升级后的网页正文")
        self.assertEqual(result.final_url, "https://www.example.com/page/?x=1")

    def test_fetch_rejects_https_downgrade_and_off_page_reports(self) -> None:
        service = WebSearchService(_settings())
        payloads = iter(
            [
                {
                    "output": [
                        {
                            "type": "web_extractor_call",
                            "goal": "http://example.com/page",
                            "output": "降级抓取的内容",
                        }
                    ]
                },
                {
                    "output": [
                        {
                            "type": "web_extractor_call",
                            "goal": "https://example.com/other",
                            "output": "别的页面",
                        }
                    ]
                },
                {
                    "output": [
                        {
                            "type": "web_extractor_call",
                            "goal": "https://example.com/page?x=2",
                            "output": "别的查询参数",
                        }
                    ]
                },
            ]
        )
        service._post_json = lambda *args, **kwargs: next(payloads)  # type: ignore[method-assign]

        downgraded = service.fetch(url="https://example.com/page", prompt="读取")
        moved = service.fetch(url="https://example.com/page", prompt="读取")
        different_query = service.fetch(url="https://example.com/page?x=1", prompt="读取")

        for result in (downgraded, moved, different_query):
            self.assertEqual(result.status, "empty")
            self.assertEqual(result.content, "")
            self.assertIsNone(result.final_url)

    def test_search_warning_distinguishes_filtered_hits_from_no_sources(self) -> None:
        service = WebSearchService(_settings())
        payloads = iter(
            [
                {
                    "output": [
                        {
                            "type": "web_search_call",
                            "action": {"sources": [{"url": "https://blog.example.com/a"}]},
                        }
                    ]
                },
                {"output": []},
            ]
        )
        service._post_json = lambda *args, **kwargs: next(payloads)  # type: ignore[method-assign]

        filtered = service.search(query="测试", allowed_domains=["gov.cn"])
        silent = service.search(query="测试")

        self.assertEqual(filtered.status, "empty")
        self.assertEqual(filtered.sources, [])
        self.assertIn("过滤", filtered.warning or "")
        self.assertNotIn("未返回结构化 sources", filtered.warning or "")
        self.assertEqual(silent.status, "empty")
        self.assertIn("未返回结构化 sources", silent.warning or "")

    def test_fetch_output_text_without_extractor_output_is_empty(self) -> None:
        service = WebSearchService(_settings())

        def fake_post_json(*args: Any, **kwargs: Any) -> dict:
            return {
                "output_text": "模型说页面 404 但又编了一段摘要",
                "output": [
                    {
                        "type": "web_extractor_call",
                        "goal": "https://example.com/missing",
                        "output": "   ",
                    }
                ],
            }

        service._post_json = fake_post_json  # type: ignore[method-assign]
        result = service.fetch(url="https://example.com/missing", prompt="读取")

        self.assertEqual(result.status, "empty")
        self.assertEqual(result.content, "")
        self.assertEqual(result.answer, "")
        self.assertEqual(result.final_url, "https://example.com/missing")
        self.assertIn("output_text 已忽略", result.warning or "")

    def test_fetch_live_shape_uses_urls_when_goal_is_a_description(self) -> None:
        target = "https://platform.qianwenai.com/docs/example"
        url_shapes: list[object] = [
            [target],
            target,
            [{"uri": target}],
            [{"link": target}],
        ]

        for raw_urls in url_shapes:
            with self.subTest(urls=raw_urls):
                service = WebSearchService(_settings())

                def fake_post_json(*args: Any, **kwargs: Any) -> dict:
                    return {
                        "output_text": "模型最终摘要",
                        "output": [
                            {
                                "type": "web_extractor_call",
                                "goal": "提取该文档中关于联网工具调用的章节",
                                "urls": raw_urls,
                                "output": "线上 extractor 返回的正文",
                                "status": "completed",
                            }
                        ],
                    }

                service._post_json = fake_post_json  # type: ignore[method-assign]
                result = service.fetch(url=target, prompt="读取工具调用章节")

                self.assertEqual(result.status, "ok")
                self.assertEqual(result.final_url, target)
                self.assertEqual(result.content, "线上 extractor 返回的正文")
                self.assertEqual(result.answer, result.content)
                self.assertEqual([source.url for source in result.sources], [target])
                self.assertNotIn("模型最终摘要", result.content)

    def test_fetch_ignores_nonmatching_output_and_marks_matching_truncation_partial(self) -> None:
        service = WebSearchService(_settings())
        payloads = iter(
            [
                {
                    "output": [
                        {
                            "type": "web_extractor_call",
                            "goal": "https://example.com/related",
                            "output": "相关页面内容",
                        }
                    ]
                },
                {
                    "output": [
                        {
                            "type": "web_extractor_call",
                            "goal": "https://example.com/requested",
                            "output": "不完整内容",
                            "status": "incomplete",
                            "truncated": True,
                        }
                    ]
                },
            ]
        )
        service._post_json = lambda *args, **kwargs: next(payloads)  # type: ignore[method-assign]

        related = service.fetch(url="https://example.com/requested", prompt="读取")
        truncated = service.fetch(url="https://example.com/requested", prompt="读取")

        self.assertEqual(related.status, "empty")
        self.assertEqual(related.content, "")
        self.assertIsNone(related.final_url)
        self.assertEqual(
            [source.url for source in related.sources],
            ["https://example.com/related"],
        )
        self.assertIn("其他页面 output 已忽略", related.warning or "")
        self.assertEqual(truncated.status, "partial")
        self.assertTrue(truncated.truncated)
        self.assertIn("status=incomplete", truncated.warning or "")

    def test_missing_api_key_and_invalid_or_credentialed_urls_are_rejected(self) -> None:
        service = WebSearchService(_settings(DASHSCOPE_API_KEY=""))
        with self.assertRaises(AppError) as missing_key:
            service.search(query="测试", limit=1)
        self.assertEqual(missing_key.exception.error_code, "web_search_config_missing")

        service = WebSearchService(_settings())
        for url in (
            "ftp://example.com/file",
            "https://user@example.com/private",
            "https://user:password@example.com/private",
            "https://example.com:not-a-port/private",
        ):
            with self.subTest(url=url), self.assertRaises(AppError) as invalid_url:
                service.fetch(url=url, prompt="读取")
            self.assertEqual(invalid_url.exception.error_code, "web_fetch_invalid_url")

    def test_default_models_and_official_responses_endpoint(self) -> None:
        service = WebSearchService(
            _settings(QWEN_WEB_SEARCH_MODEL="", QWEN_WEB_FETCH_MODEL="")
        )

        self.assertEqual(service.search_model, "qwen3.8-max")
        self.assertEqual(service.fetch_model, "qwen3.8-max")
        self.assertEqual(
            service._responses_url(),
            "https://dashscope.aliyuncs.com/compatible-mode/v1/responses",
        )

    def test_dashscope_error_message_is_readable(self) -> None:
        service = WebSearchService(_settings())
        response = type(
            "FakeResponse",
            (),
            {
                "text": '{"code":"InvalidParameter","message":"model not support"}',
                "json": lambda self: {
                    "code": "InvalidParameter",
                    "message": "model not support",
                    "request_id": "req-1",
                },
            },
        )()

        message = service._format_dashscope_error(response)  # type: ignore[arg-type]

        self.assertIn("code=InvalidParameter", message)
        self.assertIn("message=model not support", message)
        self.assertIn("request_id=req-1", message)


if __name__ == "__main__":
    unittest.main()
