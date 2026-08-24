from __future__ import annotations

from typing import Literal

from typing import Any

from pydantic import BaseModel, Field

SkillReleaseCheckStatus = Literal["up_to_date", "update_available", "unsupported_client"]


class SkillReleaseCheckView(BaseModel):
    status: SkillReleaseCheckStatus
    latest_skill_pack_version: str | None = None
    latest_skill_pack_checksum: str | None = None
    skill_count: int = 0
    release_notes: str | None = None
    required_electron_version: str | None = None


class SkillPackFileView(BaseModel):
    path: str
    content: str
    checksum: str


class SkillPackSkillView(BaseModel):
    slug: str
    domain: str
    name: str
    description: str
    version: str
    checksum: str
    updated_at: str
    files: list[SkillPackFileView] = Field(default_factory=list)


class SkillPackSignatureView(BaseModel):
    algorithm: Literal["Ed25519"]
    key_id: str
    value: str


class SkillPackView(BaseModel):
    pack_format_version: int
    release_channel: str
    skill_pack_version: str
    skill_pack_checksum: str
    built_at: str
    skills: list[SkillPackSkillView] = Field(default_factory=list)
    signature: SkillPackSignatureView | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
