from __future__ import annotations

import argparse
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.database import init_database, get_engine
from app.schemas.skill_release import SkillRelease


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Register a skill release metadata record.",
    )
    parser.add_argument("--release-channel", default="stable")
    parser.add_argument("--skill-pack-version", required=True)
    parser.add_argument("--skill-pack-checksum", required=True)
    parser.add_argument("--min-electron-version", default=None)
    parser.add_argument("--release-notes", default=None)
    parser.add_argument("--status", default="published")
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
    released_at = parse_released_at(args.released_at)
    with Session(get_engine()) as session:
        record = SkillRelease(
            release_channel=args.release_channel.strip() or "stable",
            skill_pack_version=args.skill_pack_version.strip(),
            skill_pack_checksum=args.skill_pack_checksum.strip(),
            min_electron_version=(
                args.min_electron_version.strip()
                if isinstance(args.min_electron_version, str) and args.min_electron_version.strip()
                else None
            ),
            release_notes=args.release_notes,
            status=args.status.strip() or "published",
            released_at=released_at,
        )
        session.add(record)
        session.commit()
        print(
            "registered",
            {
                "id": record.id,
                "release_channel": record.release_channel,
                "skill_pack_version": record.skill_pack_version,
                "status": record.status,
                "released_at": record.released_at.isoformat(),
            },
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
