from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote, unquote

import httpx

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings  # noqa: E402
from app.services.oss_bucket import get_oss_bucket, has_oss_credentials  # noqa: E402


def read_package_version(package_json: Path) -> str:
    data = json.loads(package_json.read_text(encoding="utf-8"))
    return str(data.get("version") or "").strip()


def unquote_yaml_scalar(value: str) -> str:
    stripped = value.strip()
    if (stripped.startswith("'") and stripped.endswith("'")) or (
        stripped.startswith('"') and stripped.endswith('"')
    ):
        stripped = stripped[1:-1]
    return stripped.replace("''", "'").strip()


def read_update_yml(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line or raw_line.startswith(" ") or ":" not in raw_line:
            continue
        key, value = raw_line.split(":", 1)
        values[key.strip()] = unquote_yaml_scalar(value)
    required = ["version", "path", "sha512"]
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise SystemExit(f"{path} is missing required key(s): {', '.join(missing)}")
    return values


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def public_url_for_object(object_key: str) -> str:
    settings = get_settings()
    if settings.oss_public_base_url:
        return f"{settings.oss_public_base_url.rstrip('/')}/{quote(object_key, safe='/')}"
    bucket = settings.oss_bucket
    endpoint = f"oss-{settings.oss_region}.aliyuncs.com"
    return f"https://{bucket}.{endpoint}/{quote(object_key, safe='/')}"


def upload_file(path: Path, object_key: str, *, content_type: str) -> str:
    settings = get_settings()
    if not has_oss_credentials(settings):
        raise SystemExit("OSS credentials are incomplete. Set ALIBABA_CLOUD_* / OSS_BUCKET / OSS_REGION.")
    bucket = get_oss_bucket(settings)
    bucket.put_object_from_file(object_key, str(path), headers={"Content-Type": content_type})
    metadata = bucket.head_object(object_key)
    remote_size = getattr(metadata, "content_length", None)
    if remote_size is None:
        headers = getattr(metadata, "headers", {})
        try:
            remote_size = int(headers.get("Content-Length"))
        except (TypeError, ValueError, AttributeError):
            remote_size = None
    local_size = path.stat().st_size
    if remote_size != local_size:
        raise SystemExit(
            f"Uploaded object size mismatch for {object_key}: local={local_size}, remote={remote_size}"
        )
    print(f"Verified remote size: {object_key} ({remote_size} bytes)")
    return public_url_for_object(object_key)


def build_release_payload(args: argparse.Namespace, release_dir: Path) -> tuple[dict, list[tuple[Path, str, str]]]:
    feed_name = "beta.yml" if args.channel == "beta" else "latest.yml"
    feed_path = release_dir / feed_name
    if not feed_path.exists():
        raise SystemExit(f"Missing update feed: {feed_path}")

    yml = read_update_yml(feed_path)
    version = args.version or yml["version"]
    if version != yml["version"]:
        raise SystemExit(f"Version mismatch: --version {version} != {feed_name} {yml['version']}")

    package_json = args.package_json.resolve()
    if package_json.exists():
        package_version = read_package_version(package_json)
        if package_version != version:
            raise SystemExit(f"Version mismatch: {package_json} {package_version} != {feed_name} {version}")

    installer_name = unquote(yml["path"])
    installer_path = release_dir / installer_name
    blockmap_path = release_dir / f"{installer_name}.blockmap"
    if not installer_path.exists():
        raise SystemExit(f"Missing installer: {installer_path}")
    if not blockmap_path.exists():
        raise SystemExit(f"Missing installer blockmap: {blockmap_path}")

    prefix = args.oss_prefix.strip("/")
    release_prefix = f"{prefix}/windows/x64/{version}"
    installer_key = f"{release_prefix}/{installer_name}"
    blockmap_key = f"{release_prefix}/{blockmap_path.name}"
    uploads = [
        (installer_path, installer_key, "application/octet-stream"),
        (blockmap_path, blockmap_key, "application/octet-stream"),
    ]

    payload = {
        "platform": "windows",
        "arch": "x64",
        "channel": args.channel,
        "version": version,
        "status": args.status,
        "staging_percentage": args.staging_percentage,
        "notes": args.notes,
        "artifacts": [
            {
                "kind": "installer",
                "file_name": installer_name,
                "size_bytes": installer_path.stat().st_size,
                "sha512": yml["sha512"],
                "sha256": sha256_file(installer_path),
                "object_key": installer_key,
                "public_url": public_url_for_object(installer_key),
                "content_type": "application/octet-stream",
            },
            {
                "kind": "blockmap",
                "file_name": blockmap_path.name,
                "size_bytes": blockmap_path.stat().st_size,
                "sha256": sha256_file(blockmap_path),
                "object_key": blockmap_key,
                "public_url": public_url_for_object(blockmap_key),
                "content_type": "application/octet-stream",
            },
        ],
    }
    release_date = yml.get("releaseDate")
    if release_date:
        payload["release_date"] = release_date
    return payload, uploads


def admin_releases_endpoint(backend_url: str) -> str:
    base = backend_url.rstrip("/")
    if base.endswith("/api"):
        return f"{base}/desktop-updates/admin/releases"
    return f"{base}/api/desktop-updates/admin/releases"


def post_release(args: argparse.Namespace, payload: dict) -> None:
    token = (
        args.admin_token
        or os.environ.get("RELEASE_ADMIN_TOKEN", "")
        or get_settings().release_admin_token
    )
    if not token:
        raise SystemExit("Missing admin token. Pass --admin-token or set RELEASE_ADMIN_TOKEN.")
    endpoint = admin_releases_endpoint(args.backend_url)
    response = httpx.post(
        endpoint,
        headers={"X-Release-Admin-Token": token},
        json=payload,
        timeout=30,
    )
    if response.status_code >= 400:
        raise SystemExit(f"Admin API failed {response.status_code}: {response.text}")
    print(json.dumps(response.json(), ensure_ascii=False, indent=2))


def main() -> None:
    default_frontend = BACKEND_ROOT.parent / "frontend"
    parser = argparse.ArgumentParser(description="Publish XiaoLiang desktop update metadata and artifacts.")
    parser.add_argument("--release-dir", type=Path, default=default_frontend / "release")
    parser.add_argument("--package-json", type=Path, default=default_frontend / "package.json")
    parser.add_argument("--backend-url", default="https://xl.x3yun.com")
    parser.add_argument("--admin-token", default="")
    parser.add_argument("--oss-prefix", default="desktop-releases")
    parser.add_argument("--channel", choices=["stable", "beta"], default="stable")
    parser.add_argument("--version", default="")
    parser.add_argument("--status", choices=["draft", "published"], default="published")
    parser.add_argument("--staging-percentage", type=int, default=None)
    parser.add_argument("--notes", nargs="*", default=[])
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--dry-run", action="store_true")
    action.add_argument(
        "--upload-only",
        action="store_true",
        help="Upload and verify artifacts without creating the backend release record.",
    )
    args = parser.parse_args()

    release_dir = args.release_dir.resolve()
    payload, uploads = build_release_payload(args, release_dir)
    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        print("Dry run complete; no files uploaded and no admin API call made.")
        return

    for path, object_key, content_type in uploads:
        settings = get_settings()
        print(f"Uploading {path.name} -> oss://{settings.oss_bucket}/{object_key}")
        upload_file(path, object_key, content_type=content_type)
    if args.upload_only:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        print("Upload-only complete; artifacts were verified and no admin API call was made.")
        return
    post_release(args, payload)


if __name__ == "__main__":
    main()
