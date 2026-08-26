from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


def find_repository_root(start: Path | None = None) -> Path:
    candidate = (start or Path(__file__)).resolve()
    if candidate.is_file():
        candidate = candidate.parent

    for directory in (candidate, *candidate.parents):
        if (directory / "AGENTS.md").is_file() and (directory / "ontology").is_dir():
            return directory
    raise RuntimeError("repository_root_not_found")


REPOSITORY_ROOT = find_repository_root()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPOSITORY_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
        populate_by_name=True,
    )

    database_url: SecretStr = Field(validation_alias="DATABASE_URL")
    redis_url: SecretStr = Field(validation_alias="REDIS_URL")
    alibaba_cloud_access_key_id: SecretStr = Field(validation_alias="ALIBABA_CLOUD_ACCESS_KEY_ID")
    alibaba_cloud_access_key_secret: SecretStr = Field(
        validation_alias="ALIBABA_CLOUD_ACCESS_KEY_SECRET"
    )
    oss_bucket: str = Field(validation_alias="OSS_BUCKET")
    oss_region: str = Field(validation_alias="OSS_REGION")
    oss_public_base_url: str | None = Field(
        default=None,
        validation_alias="OSS_PUBLIC_BASE_URL",
    )

    @property
    def ontology_path(self) -> Path:
        return REPOSITORY_ROOT / "ontology" / "shenbian" / "v1" / "ontology.yaml"

    @property
    def catalog_directory(self) -> Path:
        return REPOSITORY_ROOT / "data" / "catalog"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
