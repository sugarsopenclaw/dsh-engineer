"""原子 descriptor 与跨进程单实例锁。"""

from __future__ import annotations

import json
import os
import secrets
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

if os.name == "nt":
    import msvcrt
else:
    import fcntl

from xiaoliang_cad_bridge import PROTOCOL_VERSION


MAX_DESCRIPTOR_BYTES = 64 * 1024


@dataclass(frozen=True)
class BridgeDescriptor:
    pid: int
    port: int
    token: str
    protocol_version: int
    project_root: str
    started_at: str

    @classmethod
    def create(cls, port: int, project_root: Path) -> "BridgeDescriptor":
        return cls(
            pid=os.getpid(),
            port=port,
            token=secrets.token_urlsafe(48),
            protocol_version=PROTOCOL_VERSION,
            project_root=str(project_root.resolve()),
            started_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        )


def state_directory(home_directory: str | os.PathLike[str] | None = None) -> Path:
    home = Path(home_directory).expanduser() if home_directory is not None else Path.home()
    return home / ".xiaoliang"


def default_descriptor_path(home_directory: str | os.PathLike[str] | None = None) -> Path:
    return state_directory(home_directory) / "cad-bridge.json"


def default_lock_path(home_directory: str | os.PathLike[str] | None = None) -> Path:
    return state_directory(home_directory) / "cad-bridge.lock"


def write_descriptor(path: Path, descriptor: BridgeDescriptor) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass
    payload = f"{json.dumps(asdict(descriptor), ensure_ascii=False, indent=2)}\n"
    if len(payload.encode("utf-8")) > MAX_DESCRIPTOR_BYTES:
        raise ValueError("bridge descriptor exceeds 64KB")
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix="cad-bridge-",
        suffix=".json",
        dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        temporary_path.chmod(0o600)
        os.replace(temporary_path, path)
        try:
            path.chmod(0o600)
        except OSError:
            pass
    finally:
        temporary_path.unlink(missing_ok=True)


def read_descriptor(path: Path) -> BridgeDescriptor:
    stat = path.stat()
    if not path.is_file() or stat.st_size > MAX_DESCRIPTOR_BYTES:
        raise ValueError("bridge descriptor is missing or oversized")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("bridge descriptor must be a JSON object")
    descriptor = BridgeDescriptor(**value)
    try:
        datetime.fromisoformat(descriptor.started_at.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise ValueError("bridge descriptor has an invalid timestamp") from None
    if (
        descriptor.pid <= 0
        or not 1 <= descriptor.port <= 65535
        or len(descriptor.token) < 32
        or descriptor.protocol_version != PROTOCOL_VERSION
        or not Path(descriptor.project_root).is_absolute()
    ):
        raise ValueError("bridge descriptor is invalid")
    return descriptor


def remove_owned_descriptor(path: Path, pid: int) -> None:
    try:
        if read_descriptor(path).pid == pid:
            path.unlink(missing_ok=True)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        pass


class SingleInstanceLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.handle = None

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.handle = self.path.open("a+b")
        self.handle.seek(0)
        if self.path.stat().st_size == 0:
            self.handle.write(b"0")
            self.handle.flush()
            self.handle.seek(0)
        try:
            if os.name == "nt":
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.handle.close()
            self.handle = None
            raise RuntimeError("another xiaoliang cad-bridge instance holds the single-instance lock") from None

    def release(self) -> None:
        if self.handle is None:
            return
        try:
            self.handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        finally:
            self.handle.close()
            self.handle = None

    def __enter__(self) -> "SingleInstanceLock":
        self.acquire()
        return self

    def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
        self.release()
