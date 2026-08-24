"""Create a local, Git-ignored dual-channel capture case for one CAD drawing."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    if not normalized:
        raise ValueError(f"cannot derive a safe directory name from {value!r}")
    return normalized[:80]


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}-{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--project", required=True, help="Stable project directory name")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "real-projects" / "projects",
    )
    parser.add_argument("--overwrite-manifest", action="store_true")
    args = parser.parse_args()

    source = args.source.resolve(strict=True)
    source_hash = sha256_file(source)
    project_id = slug(args.project)
    case_id = f"{slug(source.stem)}-{source_hash[:12]}"
    case_root = (args.root.resolve() / project_id / case_id)
    source_manifest_path = case_root / "source" / "manifest.json"
    if source_manifest_path.exists() and not args.overwrite_manifest:
        existing = json.loads(source_manifest_path.read_text(encoding="utf-8"))
        if existing.get("source", {}).get("sha256") != source_hash:
            raise RuntimeError(f"existing case manifest has a different source hash: {source_manifest_path}")
    for relative in (
        "source",
        "channels/autocad-com",
        "channels/mlightcad",
        "comparison",
        "run/logs",
    ):
        (case_root / relative).mkdir(parents=True, exist_ok=True)

    stat = source.stat()
    manifest = {
        "schema_version": 1,
        "project_id": project_id,
        "case_id": case_id,
        "created_at": utc_now(),
        "source": {
            "path": str(source),
            "file_name": source.name,
            "extension": source.suffix.casefold(),
            "sha256": source_hash,
            "size_bytes": stat.st_size,
            "mtime_utc": datetime.fromtimestamp(stat.st_mtime, timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
            "copied_into_case": False,
        },
        "intended_channels": ["autocad-com", "mlightcad"],
        "capture_scope": "database_authored_entities",
        "scope_limitations": [
            "block references are not recursively expanded into occurrence geometry",
            "proxy and OLE payloads may remain opaque",
            "unresolved external references may have no readable definition geometry",
        ],
    }
    atomic_json(source_manifest_path, manifest)
    atomic_json(
        case_root / "run" / "manifest.json",
        {
            "schema_version": 1,
            "case_id": case_id,
            "status": "prepared",
            "updated_at": utc_now(),
            "channels": {},
        },
    )
    print(
        json.dumps(
            {
                "ok": True,
                "case_root": str(case_root),
                "source_sha256": source_hash,
                "autocad_output": str(case_root / "channels" / "autocad-com"),
                "mlightcad_output": str(case_root / "channels" / "mlightcad"),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

