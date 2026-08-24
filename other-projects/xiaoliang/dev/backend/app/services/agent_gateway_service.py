from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Generator
from typing import Any

import httpx

from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.domain.billing.errors import BillingErrorCode
from app.models.agent_model import ManagedAgentModelCatalogView, ManagedAgentModelView

logger = logging.getLogger(__name__)

MODEL_ALIASES = {
    "xiaoliang-agent-default",
    "xiaoliang-agent-vision",
    "xiaoliang-agent-expert",
}
MODEL_ALIAS_KINDS = {
    "xiaoliang-agent-default": "default",
    "xiaoliang-agent-vision": "vision",
    "xiaoliang-agent-expert": "expert",
}
MANAGED_PROVIDER_MODEL = "qwen3.8-max"
# schema_repair 是预留档位：仅参与鉴权白名单与输出上限下发，仓库内还没有调用方和提示词。
CALL_PURPOSES = {"main", "subagent", "cad_query", "visual_index", "schema_repair", "compaction"}
CAD_AUXILIARY_CALL_PURPOSES = {"cad_query", "visual_index", "schema_repair"}
REASONING_EFFORTS = ("low", "medium", "xhigh")
DEFAULT_GATEWAY_TIMEOUT_SECONDS = 120.0
DEFAULT_CAD_GATEWAY_TIMEOUT_SECONDS = 35 * 60.0

FORWARDED_FIELDS = {
    "messages",
    "tools",
    "tool_choice",
    "stream",
    "max_tokens",
    "max_completion_tokens",
    "temperature",
    "top_p",
    "response_format",
    "vl_high_resolution_images",
    "stream_options",
    "parallel_tool_calls",
    "presence_penalty",
    "frequency_penalty",
    "stop",
    # DashScope / Qwen-compatible thinking (desktop 极速=low / 深度=xhigh).
    "enable_thinking",
    "reasoning_effort",
    # Kept for compatibility; must not be sent together with reasoning_effort on qwen3.8-max.
    "thinking_budget",
}


class AgentGatewayService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def resolve_provider_model(self, model: Any) -> str:
        model_key = str(model or "").strip()
        if model_key not in MODEL_ALIASES:
            raise AppError(
                400,
                "模型别名不被允许。",
                error_code=BillingErrorCode.MODEL_NOT_ALLOWED,
                details={"allowed_models": sorted(MODEL_ALIASES)},
            )
        if model_key == "xiaoliang-agent-vision":
            resolved = self.settings.agent_vision_model
        elif model_key == "xiaoliang-agent-expert":
            resolved = self.settings.agent_expert_model
        else:
            resolved = self.settings.agent_default_model
        if str(resolved or "").strip() != MANAGED_PROVIDER_MODEL:
            raise AppError(
                500,
                "托管模型目录配置无效。",
                error_code="managed_model_catalog_invalid",
            )
        return MANAGED_PROVIDER_MODEL

    def _positive_setting(self, name: str, fallback: int) -> int:
        value = getattr(self.settings, name, fallback)
        if isinstance(value, bool) or not isinstance(value, int):
            return fallback
        return max(256, value)

    def context_window(self) -> int:
        return max(8_192, self._positive_setting("agent_default_context_window", 1_000_000))

    def max_output_tokens(self) -> int:
        return min(
            self.context_window(),
            self._positive_setting("agent_max_output_tokens", 65_536),
        )

    def purpose_max_output_tokens(self, call_purpose: str) -> int:
        if call_purpose not in CALL_PURPOSES:
            raise AppError(422, "模型调用用途无效。", error_code="invalid_call_purpose")
        maximum = self.max_output_tokens()
        setting_by_purpose = {
            "cad_query": ("agent_cad_query_max_output_tokens", 16_384),
            "visual_index": ("agent_visual_index_max_output_tokens", 4_096),
            "schema_repair": ("agent_schema_repair_max_output_tokens", 8_192),
            "compaction": ("agent_compaction_max_output_tokens", 4_096),
        }
        name, fallback = setting_by_purpose.get(
            call_purpose,
            ("agent_max_output_tokens", 65_536),
        )
        return min(maximum, self._positive_setting(name, fallback))

    def _timeout_setting(self, name: str, fallback: float) -> float:
        value = getattr(self.settings, name, fallback)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return fallback
        return max(10.0, float(value))

    def non_stream_timeout_seconds(self, call_purpose: str) -> float:
        if call_purpose not in CALL_PURPOSES:
            raise AppError(422, "模型调用用途无效。", error_code="invalid_call_purpose")
        general_timeout = self._timeout_setting(
            "agent_gateway_timeout_seconds",
            DEFAULT_GATEWAY_TIMEOUT_SECONDS,
        )
        if call_purpose not in CAD_AUXILIARY_CALL_PURPOSES:
            return general_timeout
        cad_timeout = self._timeout_setting(
            "agent_gateway_cad_timeout_seconds",
            DEFAULT_CAD_GATEWAY_TIMEOUT_SECONDS,
        )
        # Never let a CAD-specific override accidentally shorten a more generous
        # global provider timeout.
        return max(general_timeout, cad_timeout)

    def model_catalog(self) -> ManagedAgentModelCatalogView:
        compaction_model = str(self.settings.agent_compaction_model or "").strip()
        if compaction_model != MANAGED_PROVIDER_MODEL:
            raise AppError(
                500,
                "托管模型目录配置无效。",
                error_code="managed_model_catalog_invalid",
            )
        purpose_limits = {
            purpose: self.purpose_max_output_tokens(purpose)
            for purpose in sorted(CALL_PURPOSES)
        }
        models = [
            ManagedAgentModelView(
                id=alias,
                kind=kind,  # type: ignore[arg-type]
                provider_model=self.resolve_provider_model(alias),
                input_modalities=["text", "image"],
                context_window=self.context_window(),
                max_output_tokens=self.max_output_tokens(),
                purpose_max_output_tokens=purpose_limits,  # type: ignore[arg-type]
                supports_reasoning_effort=True,
                reasoning_efforts=list(REASONING_EFFORTS),
            )
            for alias, kind in MODEL_ALIAS_KINDS.items()
        ]
        fingerprint = hashlib.sha256(
            json.dumps(
                [model.model_dump(mode="json") for model in models],
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()[:24]
        return ManagedAgentModelCatalogView(
            catalog_version=f"managed-models-{fingerprint}",
            data=models,
        )

    def build_provider_payload(
        self,
        payload: dict[str, Any],
        call_purpose: str = "main",
    ) -> dict[str, Any]:
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            raise AppError(422, "messages 必须是非空数组。", error_code="invalid_agent_request")

        provider_model = self.resolve_provider_model(payload.get("model"))
        forwarded = {key: payload[key] for key in FORWARDED_FIELDS if key in payload}
        forwarded["model"] = provider_model
        forwarded["messages"] = messages
        maximum = self.purpose_max_output_tokens(call_purpose)
        requested_legacy_max = forwarded.pop("max_tokens", None)
        requested_completion_max = forwarded.get("max_completion_tokens")
        if requested_legacy_max is not None and requested_completion_max is not None:
            raise AppError(
                422,
                "max_tokens 与 max_completion_tokens 不能同时设置。",
                error_code="invalid_agent_request",
            )
        requested_max = (
            requested_completion_max
            if requested_completion_max is not None
            else requested_legacy_max
        )
        if requested_max is None:
            forwarded["max_completion_tokens"] = maximum
        elif (
            isinstance(requested_max, bool)
            or not isinstance(requested_max, int)
            or requested_max < 1
            or requested_max > maximum
        ):
            raise AppError(
                422,
                "模型输出长度超出托管模型目录限制。",
                error_code="invalid_agent_request",
                details={"maximum": maximum, "call_purpose": call_purpose},
            )
        else:
            forwarded["max_completion_tokens"] = requested_max

        if "reasoning_effort" in forwarded:
            reasoning_effort = forwarded["reasoning_effort"]
            if reasoning_effort not in REASONING_EFFORTS:
                raise AppError(
                    422,
                    "reasoning_effort 不受支持。",
                    error_code="invalid_agent_request",
                    details={"allowed": list(REASONING_EFFORTS)},
                )
            forwarded.pop("thinking_budget", None)

        if forwarded.get("stream"):
            # Billing reads token usage from the final SSE chunk, so the client
            # is never allowed to opt out of usage reporting.
            stream_options = forwarded.get("stream_options")
            stream_options = dict(stream_options) if isinstance(stream_options, dict) else {}
            stream_options["include_usage"] = True
            forwarded["stream_options"] = stream_options
        return forwarded

    def complete(self, payload: dict[str, Any], call_purpose: str = "main") -> dict[str, Any]:
        provider_payload = self.build_provider_payload(
            {**payload, "stream": False},
            call_purpose,
        )
        api_key = (self.settings.dashscope_api_key or "").strip()
        if not api_key:
            raise AppError(500, "模型服务未配置。", error_code="model_not_configured")

        url = f"{self.settings.dashscope_base_url.rstrip('/')}/chat/completions"
        try:
            with httpx.Client(timeout=self.non_stream_timeout_seconds(call_purpose)) as client:
                response = client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=provider_payload,
                )
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPStatusError as exc:
            logger.warning("agent gateway provider error status=%s", exc.response.status_code)
            raise AppError(502, "模型服务返回错误。", error_code="model_request_failed") from exc
        except AppError:
            raise
        except Exception as exc:
            logger.exception("agent gateway request failed")
            raise AppError(502, "模型请求失败。", error_code="model_request_failed") from exc

        return data if isinstance(data, dict) else {"choices": []}

    def stream(
        self,
        payload: dict[str, Any],
        call_purpose: str = "main",
    ) -> Generator[str, None, None]:
        provider_payload = self.build_provider_payload(
            {**payload, "stream": True},
            call_purpose,
        )
        api_key = (self.settings.dashscope_api_key or "").strip()
        if not api_key:
            yield (
                'data: {"error":{"code":"model_not_configured","message":"模型服务未配置。"}}\n\n'
            )
            yield "data: [DONE]\n\n"
            return

        url = f"{self.settings.dashscope_base_url.rstrip('/')}/chat/completions"
        try:
            timeout = httpx.Timeout(
                connect=15.0,
                read=self.settings.agent_gateway_stream_read_timeout_seconds,
                write=60.0,
                pool=15.0,
            )
            with httpx.Client(timeout=timeout) as client:
                with client.stream(
                    "POST",
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=provider_payload,
                ) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if not line:
                            continue
                        if line.startswith("data:"):
                            yield f"{line}\n\n"
                        else:
                            yield f"data: {line}\n\n"
        except httpx.HTTPStatusError:
            yield (
                'data: {"error":{"code":"model_request_failed","message":"模型服务返回错误。"}}\n\n'
            )
            yield "data: [DONE]\n\n"
        except Exception:
            yield (
                'data: {"error":{"code":"model_stream_interrupted","message":"模型流式中断。"}}\n\n'
            )
            yield "data: [DONE]\n\n"
