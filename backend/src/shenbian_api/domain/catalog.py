from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class CatalogSource(BaseModel):
    model_config = ConfigDict(extra="allow")

    kind: str
    path: str | None = None
    dataset_id: str | None = None
    import_path: str | None = None


class CatalogGovernance(BaseModel):
    model_config = ConfigDict(extra="allow")

    sensitivity: str
    immutable: bool
    git_tracked: bool


class DatasetCatalogEntry(BaseModel):
    model_config = ConfigDict(extra="allow")

    schema_version: str
    id: str
    stage: Literal["raw", "staging", "curated"]
    status: str
    description: str
    source: CatalogSource
    format: str
    media_types: list[str] = Field(default_factory=list)
    pipeline: str | None = None
    governance: CatalogGovernance
    observed: dict[str, Any] = Field(default_factory=dict)


class DataCatalogSummary(BaseModel):
    dataset_count: int
    by_stage: dict[str, int]
    datasets: list[DatasetCatalogEntry]
