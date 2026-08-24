from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_engine, init_database
from app.schemas.skill_release import SkillRelease
from app.services.skill_pack_builder import (
    build_pack_manifest,
    build_skill_pack_from_directory,
    canonical_json_bytes,
)
from app.services.skill_pack_storage import SkillPackStorage
from app.services.skill_pack_signing import sign_skill_pack_checksum


DEFAULT_SOURCE_DIR = Path(__file__).resolve().parents[1] / "assets" / "skills" / "cad" / "frustum-box-foundation"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Publish a CAD skill pack to storage and DB.")
    parser.add_argument("--source-dir", default=str(DEFAULT_SOURCE_DIR))
    parser.add_argument("--release-channel", default="stable")
    parser.add_argument("--skill-pack-version", required=True)
    parser.add_argument("--min-electron-version", default=None)
    parser.add_argument("--release-notes", default=None)
    parser.add_argument("--status", default="published")
    parser.add_argument("--domain", default="cad")
    parser.add_argument(
        "--signing-private-key-path",
        default=os.environ.get("SKILL_PACK_SIGNING_PRIVATE_KEY_PATH"),
        help="Ed25519 PEM private key path (or SKILL_PACK_SIGNING_PRIVATE_KEY_PATH).",
    )
    parser.add_argument(
        "--signing-key-id",
        default=os.environ.get("SKILL_PACK_SIGNING_KEY_ID", "primary-v1"),
    )
    parser.add_argument(
        "--released-at",
        default=None,
        help="ISO8601 timestamp, e.g. 2026-04-23T12:00:00Z",
    )
    return parser.parse_args()


def parse_released_at(raw: str | None) -> datetime:
    if not raw:
        return datetime.now(timezone.utc)
    normalized = raw.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    return datetime.fromisoformat(normalized)


def main() -> int:
    args = parse_args()
    init_database()

    release_channel = (args.release_channel or "stable").strip().lower() or "stable"
    skill_pack_version = args.skill_pack_version.strip()
    released_at = parse_released_at(args.released_at)
    pack = build_skill_pack_from_directory(
        source_dir=Path(args.source_dir),
        release_channel=release_channel,
        skill_pack_version=skill_pack_version,
        domain=(args.domain or "cad").strip() or "cad",
        built_at=released_at,
    )
    if not args.signing_private_key_path:
        raise SystemExit(
            "SKILL_PACK_SIGNING_PRIVATE_KEY_PATH is required; refusing to publish an unsigned pack."
        )
    pack["signature"] = sign_skill_pack_checksum(
        checksum=pack["skill_pack_checksum"],
        private_key_path=Path(args.signing_private_key_path).expanduser().resolve(),
        key_id=args.signing_key_id,
    )
    body = canonical_json_bytes(pack)
    storage_key = f"skills/releases/{release_channel}/{skill_pack_version}/skill-pack.json"
    SkillPackStorage().put_bytes(
        storage_key,
        body,
        content_type="application/json; charset=utf-8",
    )

    manifest = build_pack_manifest(pack)
    with Session(get_engine()) as session:
        existing = session.scalars(
            select(SkillRelease).where(
                SkillRelease.release_channel == release_channel,
                SkillRelease.skill_pack_version == skill_pack_version,
            )
        ).first()
        record = existing or SkillRelease(
            release_channel=release_channel,
            skill_pack_version=skill_pack_version,
        )
        record.skill_pack_checksum = pack["skill_pack_checksum"]
        record.pack_format_version = pack["pack_format_version"]
        record.pack_storage_key = storage_key
        record.pack_manifest_json = manifest
        record.skill_count = len(pack["skills"])
        record.min_electron_version = (
            args.min_electron_version.strip()
            if isinstance(args.min_electron_version, str) and args.min_electron_version.strip()
            else None
        )
        record.release_notes = args.release_notes
        record.status = args.status.strip() or "published"
        record.released_at = released_at
        if existing is None:
            session.add(record)
        session.commit()
        print(
            "published",
            {
                "id": record.id,
                "release_channel": record.release_channel,
                "skill_pack_version": record.skill_pack_version,
                "skill_pack_checksum": record.skill_pack_checksum,
                "skill_count": record.skill_count,
                "pack_storage_key": record.pack_storage_key,
                "status": record.status,
            },
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
