from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PACK_FORMAT_VERSION = 1
ALLOWED_SKILL_FILE_PATTERN = re.compile(r"^(SKILL\.md|references/[^/]+\.(md|json))$")
SKILL_SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DOMAIN_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_SKILL_CHARS = 64_000
MAX_REFERENCE_CHARS = 120_000
MAX_TOTAL_CHARS = 300_000
MAX_SKILL_BODY_LINES = 500


def canonical_json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def calculate_skill_checksum(files: list[dict[str, str]]) -> str:
    hash_obj = hashlib.sha256()
    for item in sorted(files, key=lambda entry: entry["path"]):
        hash_obj.update(item["path"].encode("utf-8"))
        hash_obj.update(b"\0")
        hash_obj.update(item["content"].encode("utf-8"))
        hash_obj.update(b"\0")
    return hash_obj.hexdigest()


def calculate_pack_checksum(pack: dict[str, Any]) -> str:
    payload = {
        "pack_format_version": int(pack["pack_format_version"]),
        "release_channel": str(pack["release_channel"]),
        "skill_pack_version": str(pack["skill_pack_version"]),
        "skills": [
            {
                "slug": skill["slug"],
                "domain": skill["domain"],
                "version": skill["version"],
                "checksum": skill["checksum"],
            }
            for skill in sorted(pack["skills"], key=lambda item: item["slug"])
        ],
    }
    return hashlib.sha256(canonical_json_bytes(payload)).hexdigest()


def build_pack_manifest(pack: dict[str, Any]) -> dict[str, Any]:
    manifest = {
        "pack_format_version": pack["pack_format_version"],
        "release_channel": pack["release_channel"],
        "skill_pack_version": pack["skill_pack_version"],
        "skill_pack_checksum": pack["skill_pack_checksum"],
        "built_at": pack["built_at"],
        "skills": [
            {
                "slug": skill["slug"],
                "domain": skill["domain"],
                "name": skill["name"],
                "description": skill["description"],
                "version": skill["version"],
                "checksum": skill["checksum"],
                "updated_at": skill["updated_at"],
                "files": [
                    {
                        "path": item["path"],
                        "checksum": item["checksum"],
                        "size": len(item["content"].encode("utf-8")),
                    }
                    for item in skill["files"]
                ],
            }
            for skill in pack["skills"]
        ],
    }
    if isinstance(pack.get("signature"), dict):
        manifest["signature"] = pack["signature"]
    return manifest


def build_skill_pack_from_directory(
    *,
    source_dir: Path,
    release_channel: str,
    skill_pack_version: str,
    domain: str = "cad",
    built_at: datetime | None = None,
) -> dict[str, Any]:
    source_dir = source_dir.resolve()
    skill_file = source_dir / "SKILL.md"
    if not skill_file.exists():
        raise FileNotFoundError(f"缺少 SKILL.md: {skill_file}")

    files = _read_allowed_skill_files(source_dir)
    skill_content = skill_file.read_text(encoding="utf-8")
    frontmatter = _parse_frontmatter(skill_content)
    now = built_at or datetime.now(timezone.utc)
    slug = source_dir.name
    _validate_skill(
        slug=slug,
        domain=domain,
        content=skill_content,
        frontmatter=frontmatter,
        files=files,
    )
    skill_checksum = calculate_skill_checksum(files)
    skill = {
        "slug": slug,
        "domain": domain,
        "name": _extract_markdown_title(skill_content) or slug,
        "description": _clean_frontmatter_text(frontmatter.get("description")) or slug,
        "version": skill_pack_version,
        "checksum": skill_checksum,
        "updated_at": now.isoformat(),
        "files": [
            {
                "path": item["path"],
                "content": item["content"],
                "checksum": sha256_text(item["content"]),
            }
            for item in files
        ],
    }
    pack = {
        "pack_format_version": PACK_FORMAT_VERSION,
        "release_channel": release_channel,
        "skill_pack_version": skill_pack_version,
        "skill_pack_checksum": "",
        "built_at": now.isoformat(),
        "skills": [skill],
        "metadata": {
            "source": str(source_dir),
        },
    }
    pack["skill_pack_checksum"] = calculate_pack_checksum(pack)
    return pack


def _read_allowed_skill_files(source_dir: Path) -> list[dict[str, str]]:
    output: list[dict[str, str]] = []
    for path in sorted(source_dir.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"skill 目录不允许符号链接: {path}")
        if not path.is_file():
            continue
        relative_path = path.relative_to(source_dir).as_posix()
        if not ALLOWED_SKILL_FILE_PATTERN.match(relative_path):
            continue
        output.append(
            {
                "path": relative_path,
                "content": path.read_text(encoding="utf-8"),
            }
        )
    return output


def _validate_skill(
    *,
    slug: str,
    domain: str,
    content: str,
    frontmatter: dict[str, str],
    files: list[dict[str, str]],
) -> None:
    if len(slug) > 64 or not SKILL_SLUG_PATTERN.fullmatch(slug):
        raise ValueError(f"非法 skill slug: {slug}")
    if len(domain) > 64 or not DOMAIN_PATTERN.fullmatch(domain):
        raise ValueError(f"非法 skill domain: {domain}")
    name = _clean_frontmatter_text(frontmatter.get("name"))
    description = _clean_frontmatter_text(frontmatter.get("description"))
    if name != slug:
        raise ValueError(f"SKILL.md frontmatter name 必须等于目录 slug: {slug}")
    if not description or len(description) > 1024:
        raise ValueError("SKILL.md description 必须为 1-1024 字符。")
    if len(content) > MAX_SKILL_CHARS:
        raise ValueError(f"SKILL.md 不能超过 {MAX_SKILL_CHARS} 字符。")
    body = content.split("---", 2)[2] if content.startswith("---") else content
    if len(body.splitlines()) > MAX_SKILL_BODY_LINES:
        raise ValueError(f"SKILL.md 正文不能超过 {MAX_SKILL_BODY_LINES} 行。")
    total_chars = 0
    for item in files:
        limit = MAX_SKILL_CHARS if item["path"] == "SKILL.md" else MAX_REFERENCE_CHARS
        if len(item["content"]) > limit:
            raise ValueError(f"skill 文件过大: {item['path']}")
        total_chars += len(item["content"])
    if total_chars > MAX_TOTAL_CHARS:
        raise ValueError(f"skill 文件总长度不能超过 {MAX_TOTAL_CHARS} 字符。")


def _parse_frontmatter(content: str) -> dict[str, str]:
    if not content.startswith("---"):
        return {}
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}
    block = parts[1]
    result: dict[str, str] = {}
    for line in block.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key:
            result[key] = value
    return result


def _clean_frontmatter_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip().strip("\"'")
    return cleaned or None


def _extract_markdown_title(content: str) -> str | None:
    body = content.split("---", 2)[2] if content.startswith("---") else content
    match = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
    return match.group(1).strip() if match else None
