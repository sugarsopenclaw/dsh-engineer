from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
from typing import Any, Iterator, Mapping

from cadstack.layout import FACTS_SCHEMA_VERSION, FactsLayout, validate_drawing_key


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _project_id(layout: FactsLayout) -> str:
    normalized = layout.project_root.as_posix()
    if os.name == "nt":
        normalized = normalized.casefold()
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return "project:" + digest


def empty_project_state(layout: FactsLayout) -> dict[str, Any]:
    return {
        "schema_version": FACTS_SCHEMA_VERSION,
        "project_id": _project_id(layout),
        "updated_at": utc_now(),
        "drawings": {},
    }


def read_project_state(layout: FactsLayout) -> dict[str, Any]:
    if not layout.project_json.is_file():
        return empty_project_state(layout)
    value = json.loads(layout.project_json.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise TypeError("facts project.json root must be an object")
    if int(value.get("schema_version", -1)) != FACTS_SCHEMA_VERSION:
        raise ValueError("unsupported facts project.json schema")
    if not isinstance(value.get("drawings"), dict):
        raise TypeError("facts project.json drawings must be an object")
    expected_id = _project_id(layout)
    if str(value.get("project_id", "")) != expected_id:
        # The facts directory may have moved with the project. Keep its durable id;
        # only missing/invalid ids are rejected.
        declared = str(value.get("project_id", ""))
        if not declared.startswith("project:") or len(declared) != 72:
            raise ValueError("facts project id is invalid")
    return value


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.tmp-", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def atomic_write_json(path: Path, value: object) -> None:
    atomic_write_text(
        path,
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
    )


@contextmanager
def _file_lock(path: Path, *, timeout_seconds: float) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        stream.seek(0, os.SEEK_END)
        if stream.tell() == 0:
            stream.write(b"\0")
            stream.flush()
        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                stream.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("timed out waiting for the facts state lock")
                time.sleep(0.05)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


@contextmanager
def state_lock(layout: FactsLayout, *, timeout_seconds: float = 30.0) -> Iterator[None]:
    with _file_lock(layout.state_lock_path, timeout_seconds=timeout_seconds):
        yield


@contextmanager
def binding_lock(
    layout: FactsLayout,
    *,
    timeout_seconds: float = 15 * 60.0,
) -> Iterator[None]:
    with _file_lock(layout.binding_lock_path, timeout_seconds=timeout_seconds):
        yield


def save_project_state(layout: FactsLayout, state: Mapping[str, Any]) -> None:
    from cadstack.views import render_project_index

    document = dict(state)
    document["updated_at"] = utc_now()
    atomic_write_json(layout.project_json, document)
    atomic_write_text(layout.project_index, render_project_index(document))


def record_failure(
    layout: FactsLayout,
    drawing_key: str,
    stage: str,
    error: BaseException,
    *,
    expected_snapshot_id: str | None = None,
) -> None:
    drawing_key = validate_drawing_key(drawing_key)
    layout.ensure()
    with state_lock(layout):
        state = read_project_state(layout)
        drawings = state["drawings"]
        record = dict(drawings.get(drawing_key, {"drawing_key": drawing_key}))
        if (
            expected_snapshot_id is not None
            and record.get("snapshot_id") != expected_snapshot_id
        ):
            return
        layers = dict(record.get("layers", {}))
        layers[stage] = "failed"
        layer_order = ("l1", "l2", "l3", "l4")
        if stage in layer_order:
            for downstream in layer_order[layer_order.index(stage) + 1 :]:
                layers[downstream] = "missing"
        record["layers"] = layers
        record["last_error"] = {
            "stage": stage,
            "type": type(error).__name__,
            "message": str(error)[:4_000],
            "at": utc_now(),
        }
        drawings[drawing_key] = record
        save_project_state(layout, state)


def replace_generated_tree(staging: Path, target: Path) -> None:
    """Publish a completely generated directory while retaining rollback."""

    if not staging.is_dir():
        raise NotADirectoryError(staging)
    target.parent.mkdir(parents=True, exist_ok=True)
    backup = target.parent / f".{target.name}.backup-{os.getpid()}-{time.time_ns()}"
    moved_old = False
    try:
        if target.exists():
            if not target.is_dir() or target.is_symlink():
                raise ValueError(f"generated view target is not a regular directory: {target}")
            os.replace(target, backup)
            moved_old = True
        os.replace(staging, target)
        if moved_old:
            shutil.rmtree(backup)
    except BaseException:
        if not target.exists() and moved_old and backup.exists():
            os.replace(backup, target)
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        if backup.exists() and target.exists():
            shutil.rmtree(backup, ignore_errors=True)
