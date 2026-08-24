from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


_DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$",
    re.IGNORECASE,
)


class WebSource(BaseModel):
    title: str | None = None
    url: str
    snippet: str | None = None
    site_name: str | None = None
    published_at: str | None = None
    # Deprecated wire compatibility only; generic search providers never classify authority.
    source_tier: str | None = None


class WebSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=800)
    limit: int = Field(default=8, ge=1, le=10)
    region: str | None = Field(default=None, max_length=100)
    freshness: Literal["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"] | None = None
    allowed_domains: list[str] = Field(default_factory=list, max_length=20)
    blocked_domains: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("allowed_domains", "blocked_domains", mode="before")
    @classmethod
    def normalize_domains(cls, value: object) -> object:
        if value is None:
            return []
        if not isinstance(value, list):
            return value
        if len(value) > 20:
            raise ValueError("域名过滤最多允许 20 个域名")
        normalized: list[str] = []
        seen: set[str] = set()
        for raw in value:
            if not isinstance(raw, str):
                normalized.append(raw)  # type: ignore[arg-type]
                continue
            domain = raw.strip().lower().rstrip(".")
            if domain.startswith("*."):
                domain = domain[2:]
            if not _DOMAIN_RE.fullmatch(domain):
                raise ValueError(f"无效域名: {raw[:100]}")
            if domain not in seen:
                normalized.append(domain)
                seen.add(domain)
        return normalized

    @model_validator(mode="after")
    def validate_domain_filters(self) -> "WebSearchRequest":
        if self.allowed_domains and self.blocked_domains:
            raise ValueError("allowed_domains 与 blocked_domains 不能同时使用")
        return self


class WebFetchRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    prompt: str = Field(min_length=1, max_length=1000)
    region: str | None = Field(default=None, max_length=100)


class WebGroundedData(BaseModel):
    query_or_url: str
    model: str
    # ``answer`` remains for desktop versions that predate the structured web contract.
    # Search never puts model prose here. Fetch mirrors the extractor content into it.
    answer: str = ""
    content: str = ""
    sources: list[WebSource] = Field(default_factory=list)
    elapsed_ms: int
    warning: str | None = None
    provider: str | None = None
    fallback_reason: str | None = None
    status: Literal["ok", "partial", "empty", "error"] | None = None
    final_url: str | None = None
    content_type: str | None = None
    truncated: bool | None = None
