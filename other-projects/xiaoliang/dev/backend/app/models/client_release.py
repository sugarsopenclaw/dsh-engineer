from __future__ import annotations

from pydantic import BaseModel, Field


class ClientReleaseArtifactManifest(BaseModel):
    platform: str
    label: str
    file_name: str
    fallback_url: str | None = None
    file_size: str | None = None
    checksum_sha512: str | None = None
    notes: list[str] = Field(default_factory=list)


class ClientReleaseManifest(BaseModel):
    product_name: str
    tagline: str
    summary: str
    release_channel: str = "stable"
    version: str
    published_at: str
    release_notes_title: str | None = None
    release_notes: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)
    installation_steps: list[str] = Field(default_factory=list)
    support_text: str | None = None
    github_release_url: str | None = None
    artifacts: list[ClientReleaseArtifactManifest] = Field(default_factory=list)


class ClientReleaseArtifactView(BaseModel):
    platform: str
    label: str
    file_name: str
    download_url: str
    backup_url: str | None = None
    file_size: str | None = None
    checksum_sha512: str | None = None
    notes: list[str] = Field(default_factory=list)


class ClientReleaseView(BaseModel):
    product_name: str
    tagline: str
    summary: str
    release_channel: str
    version: str
    published_at: str
    release_notes_title: str | None = None
    release_notes: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)
    installation_steps: list[str] = Field(default_factory=list)
    support_text: str | None = None
    github_release_url: str | None = None
    artifacts: list[ClientReleaseArtifactView] = Field(default_factory=list)
