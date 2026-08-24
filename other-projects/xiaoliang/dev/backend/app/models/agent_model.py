from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


ManagedModelKind = Literal["default", "vision", "expert"]
ManagedCallPurpose = Literal[
    "main",
    "subagent",
    "cad_query",
    "visual_index",
    # 预留档位：目录会下发它的输出上限，但仓库内还没有调用方。
    "schema_repair",
    "compaction",
]


class ManagedAgentModelView(BaseModel):
    id: str
    object: Literal["model"] = "model"
    kind: ManagedModelKind
    provider_model: str
    owned_by: str = "xiaoliang"
    input_modalities: list[Literal["text", "image"]]
    context_window: int = Field(..., ge=8_192)
    max_output_tokens: int = Field(..., ge=256)
    purpose_max_output_tokens: dict[ManagedCallPurpose, int]
    supports_reasoning_effort: bool
    reasoning_efforts: list[Literal["low", "medium", "xhigh"]]


class ManagedAgentModelCatalogView(BaseModel):
    object: Literal["list"] = "list"
    catalog_version: str
    data: list[ManagedAgentModelView]
