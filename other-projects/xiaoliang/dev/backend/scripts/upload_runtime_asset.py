"""上传桌面端运行时资产(git-bash / MinGit)到私有 OSS。

桌面端 AI bash 工具的「一键准备」以后端 `/runtime-assets/git-bash` 返回的
signed URL 为主下载源(npmmirror / 华为云镜像兜底)。本脚本完成运维侧动作:

1. 获取 MinGit zip(默认从 npmmirror 自动下载官方包,也可 --source 指定本地文件);
2. 校验 SHA-256 与 git-for-windows 官方 release 公布值一致;
3. 上传到 OSS 并核对远端大小;
4. 生成短期 signed GET URL 并实际 HEAD 验证可下载;
5. 输出 .env 所需的 RUNTIME_ASSET_GIT_BASH_* 配置行。

用法(在 dev/backend 下):
    python scripts/upload_runtime_asset.py            # 自动下载并上传当前默认版本
    python scripts/upload_runtime_asset.py --source C:/path/MinGit-2.55.0.3-64-bit.zip

升级版本时显式传 --download-url / --sha256 / --version。
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import httpx

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings  # noqa: E402
from app.services.oss_bucket import get_oss_bucket, has_oss_credentials  # noqa: E402

# 当前默认资产:与前端 GIT_BASH_ASSET_FALLBACKS 常量保持一致。
DEFAULT_VERSION = "2.55.0.windows.3"
DEFAULT_DOWNLOAD_URL = (
    "https://registry.npmmirror.com/-/binary/git-for-windows/"
    f"v{DEFAULT_VERSION}/MinGit-2.55.0.3-64-bit.zip"
)
DEFAULT_SHA256 = "f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05"
OSS_KEY_PREFIX = "runtime-assets/git-bash"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_asset(url: str, target: Path) -> None:
    print(f"Downloading {url}")
    with httpx.stream("GET", url, follow_redirects=True, timeout=300) as response:
        response.raise_for_status()
        total = int(response.headers.get("content-length") or 0)
        received = 0
        next_report = 0
        with target.open("wb") as handle:
            for chunk in response.iter_bytes(1024 * 256):
                handle.write(chunk)
                received += len(chunk)
                if total and received >= next_report:
                    print(f"  {received / 1024 / 1024:.1f} / {total / 1024 / 1024:.1f} MB")
                    next_report += total // 4 or total
    print(f"Downloaded {received} bytes -> {target}")


def upload_and_verify(path: Path, object_key: str) -> None:
    settings = get_settings()
    if not has_oss_credentials(settings):
        raise SystemExit("OSS credentials are incomplete. Set ALIBABA_CLOUD_* / OSS_BUCKET / OSS_REGION.")
    bucket = get_oss_bucket(settings)
    print(f"Uploading -> oss://{settings.oss_bucket}/{object_key}")
    bucket.put_object_from_file(
        object_key,
        str(path),
        headers={"Content-Type": "application/zip"},
    )
    metadata = bucket.head_object(object_key)
    remote_size = getattr(metadata, "content_length", None)
    local_size = path.stat().st_size
    if remote_size != local_size:
        raise SystemExit(f"Uploaded size mismatch: local={local_size}, remote={remote_size}")
    print(f"Verified remote size: {remote_size} bytes")

    signed_url = bucket.sign_url(
        "GET",
        object_key,
        settings.oss_release_signed_url_expires_seconds,
        slash_safe=True,
    )
    # OSS 签名包含 HTTP 动词,GET 签名的 URL 不能用 HEAD 验证;
    # 用 Range GET 取 1 字节,与桌面端实际下载方式一致。
    probe = httpx.get(signed_url, headers={"Range": "bytes=0-0"}, timeout=30)
    if probe.status_code not in (200, 206):
        raise SystemExit(f"Signed URL check failed: HTTP {probe.status_code}")
    content_range = probe.headers.get("content-range", "")
    total = int(content_range.rsplit("/", 1)[-1]) if "/" in content_range else len(probe.content)
    if total != local_size:
        raise SystemExit(f"Signed URL size mismatch: expected {local_size}, got {total}")
    print(f"Signed URL verified: HTTP {probe.status_code}, size matches.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload git-bash (MinGit) runtime asset to OSS.")
    parser.add_argument("--source", type=Path, default=None, help="本地 MinGit zip;缺省自动下载")
    parser.add_argument("--download-url", default=DEFAULT_DOWNLOAD_URL)
    parser.add_argument("--sha256", default=DEFAULT_SHA256, help="官方 release 页公布的 SHA-256")
    parser.add_argument("--version", default=DEFAULT_VERSION)
    parser.add_argument("--object-key", default="", help="缺省 runtime-assets/git-bash/<文件名>")
    args = parser.parse_args()

    expected_sha = args.sha256.strip().lower()
    if len(expected_sha) != 64:
        raise SystemExit("--sha256 必须是 64 位十六进制。")

    with tempfile.TemporaryDirectory(prefix="xl-runtime-asset-") as tempdir:
        if args.source is not None:
            source = args.source.resolve()
            if not source.exists():
                raise SystemExit(f"Source not found: {source}")
        else:
            file_name = Path(urlsplit(args.download_url).path).name
            source = Path(tempdir) / file_name
            download_asset(args.download_url, source)

        actual_sha = sha256_file(source)
        if actual_sha != expected_sha:
            raise SystemExit(
                f"SHA-256 mismatch: expected {expected_sha}, got {actual_sha}. "
                "请核对 git-for-windows 官方 release 页。"
            )
        print(f"SHA-256 verified: {actual_sha}")

        object_key = args.object_key.strip() or f"{OSS_KEY_PREFIX}/{source.name}"
        upload_and_verify(source, object_key)
        size_bytes = source.stat().st_size

    print("\n把以下配置写入 dev/backend/.env(改动后需重启后端):")
    print(f"RUNTIME_ASSET_GIT_BASH_OBJECT_KEY={object_key}")
    print(f"RUNTIME_ASSET_GIT_BASH_SHA256={expected_sha}")
    print(f"RUNTIME_ASSET_GIT_BASH_VERSION={args.version}")
    print(f"RUNTIME_ASSET_GIT_BASH_SIZE_BYTES={size_bytes}")


if __name__ == "__main__":
    main()
