"""Content-addressed local blob store. Bytes live once; user trees hardlink."""

from __future__ import annotations

import os
import shutil
import threading
import uuid
from pathlib import Path

from flywheel.layout import win_long_path
from flywheel.oss import download_object_to_path, sha256_file, OssError


class HashMismatch(RuntimeError):
    def __init__(self, expected: str, actual: str, size: int) -> None:
        super().__init__(f"sha256 mismatch expected={expected} actual={actual} size={size}")
        self.expected = expected
        self.actual = actual
        self.size = size


class BlobStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.sha_root = root / "sha256"
        self.tmp_root = root / "tmp"
        self.quarantine_root = root.parent / "quarantine"
        self._lock = threading.Lock()
        self.sha_root.mkdir(parents=True, exist_ok=True)
        self.tmp_root.mkdir(parents=True, exist_ok=True)

    def path_for(self, sha256: str) -> Path:
        digest = sha256.lower()
        return self.sha_root / digest[:2] / digest

    def has(self, sha256: str, size_bytes: int | None = None) -> bool:
        path = self.path_for(sha256)
        if not path.exists():
            return False
        if size_bytes is not None and path.stat().st_size != int(size_bytes):
            return False
        return True

    def fetch(
        self,
        storage_key: str,
        *,
        expected_sha256: str | None,
        expected_size: int | None,
        force: bool = False,
    ) -> dict:
        expected = (expected_sha256 or "").lower() or None
        if expected and self.has(expected, expected_size) and not force:
            return {
                "ok": True,
                "cached": True,
                "sha256": expected,
                "size_bytes": self.path_for(expected).stat().st_size,
                "path": str(self.path_for(expected)),
            }

        tmp = self.tmp_root / uuid.uuid4().hex
        try:
            download_object_to_path(storage_key, tmp)
            actual_sha = sha256_file(tmp)
            actual_size = tmp.stat().st_size
            if expected_size is not None and actual_size != int(expected_size):
                # Size mismatch is often a truncated GET; still check hash.
                pass
            if expected and actual_sha != expected:
                qdir = self.quarantine_root / actual_sha[:2]
                qdir.mkdir(parents=True, exist_ok=True)
                dest = qdir / actual_sha
                tmp.replace(dest)
                raise HashMismatch(expected, actual_sha, actual_size)

            final_sha = expected or actual_sha
            dest = self.path_for(final_sha)
            with self._lock:
                dest.parent.mkdir(parents=True, exist_ok=True)
                if dest.exists() and dest.stat().st_size == actual_size and not force:
                    tmp.unlink(missing_ok=True)
                else:
                    tmp.replace(dest)
            return {
                "ok": True,
                "cached": False,
                "sha256": final_sha,
                "size_bytes": actual_size,
                "path": str(dest),
            }
        except HashMismatch:
            raise
        except OssError:
            if tmp.exists():
                tmp.unlink(missing_ok=True)
            raise
        except Exception:
            if tmp.exists():
                tmp.unlink(missing_ok=True)
            raise

    def link_or_copy(self, sha256: str, dest: Path) -> str:
        src = self.path_for(sha256)
        if not src.exists():
            raise FileNotFoundError(f"blob missing: {sha256}")
        dest_w = win_long_path(dest)
        dest_w.parent.mkdir(parents=True, exist_ok=True)
        if dest_w.exists():
            if dest_w.stat().st_size == src.stat().st_size:
                return "exists"
            dest_w.unlink()
        try:
            os.link(src, dest_w)
            return "hardlink"
        except OSError:
            shutil.copy2(src, dest_w)
            return "copy"
