from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile

from cadkernel.contracts import stable_json_dumps, stable_json_loads

from cadtasks.binding import ProjectBinding
from cadtasks.contracts import TaskResultBundle


TASK_STORE_SCHEMA_VERSION = 1


@dataclass(frozen=True, slots=True)
class TaskLocation:
    path: str
    task_run_id: str
    task_spec_key: str
    project_snapshot_set_id: str
    size_bytes: int
    file_sha256: tuple[tuple[str, str], ...]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _target_path(root: Path, task_run_id: str) -> Path:
    component = task_run_id.replace(":", "-", 1)
    if root.name in {task_run_id, component}:
        return root
    return root / "tasks-v1" / component


def _write_sqlite(path: Path, bundle: TaskResultBundle) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            PRAGMA page_size=16384;
            PRAGMA journal_mode=OFF;
            PRAGMA synchronous=OFF;
            PRAGMA temp_store=MEMORY;

            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE claims (
                claim_id TEXT PRIMARY KEY,
                claim_type TEXT NOT NULL,
                status TEXT NOT NULL,
                quantity_basis TEXT,
                claim_json TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE issues (
                issue_id TEXT PRIMARY KEY,
                rule_id TEXT NOT NULL,
                conclusion_status TEXT NOT NULL,
                issue_json TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE artifacts (
                artifact_id TEXT PRIMARY KEY,
                artifact_type TEXT NOT NULL,
                artifact_json TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE gaps (
                gap_id TEXT PRIMARY KEY,
                missing TEXT NOT NULL,
                gap_json TEXT NOT NULL
            ) WITHOUT ROWID;
            """
        )
        metadata = {
            "schema_version": str(TASK_STORE_SCHEMA_VERSION),
            "task_run_id": bundle.task_run_id,
            "task_spec_key": bundle.task_spec.task_spec_key,
            "project_snapshot_set_id": bundle.project_snapshot_set_id,
            "recipe_id": bundle.recipe_id,
            "recipe_version": bundle.recipe_version,
            "bundle_json": bundle.to_json(),
        }
        connection.executemany(
            "INSERT INTO metadata(key,value) VALUES (?,?)",
            sorted(metadata.items()),
        )
        connection.executemany(
            "INSERT INTO claims VALUES (?,?,?,?,?)",
            (
                (
                    claim.claim_id,
                    claim.claim_type,
                    claim.status.value,
                    None if claim.quantity_basis is None else claim.quantity_basis.value,
                    stable_json_dumps(claim),
                )
                for claim in bundle.claims
            ),
        )
        connection.executemany(
            "INSERT INTO issues VALUES (?,?,?,?)",
            (
                (
                    issue.issue_id,
                    issue.rule_id,
                    issue.conclusion_status.value,
                    stable_json_dumps(issue),
                )
                for issue in bundle.issues
            ),
        )
        connection.executemany(
            "INSERT INTO artifacts VALUES (?,?,?)",
            (
                (
                    artifact.artifact_id,
                    artifact.artifact_type.value,
                    stable_json_dumps(artifact),
                )
                for artifact in bundle.artifacts
            ),
        )
        connection.executemany(
            "INSERT INTO gaps VALUES (?,?,?)",
            (
                (gap.gap_id, gap.missing, stable_json_dumps(gap))
                for gap in bundle.gaps
            ),
        )
        connection.commit()
    finally:
        connection.close()


class TaskStore:
    """Immutable SQLite task result store pinned to all three upstream layers."""

    @staticmethod
    def create(
        root: str | Path,
        bundle: TaskResultBundle,
        *,
        binding: ProjectBinding,
    ) -> TaskLocation:
        binding_errors = binding.verify()
        if binding_errors:
            raise ValueError(
                "Project binding integrity failure: " + ", ".join(binding_errors)
            )
        if bundle.project_snapshot_set_id != binding.project_snapshot_set_id:
            raise ValueError("TaskResultBundle belongs to another project snapshot set")
        target = _target_path(Path(root), bundle.task_run_id)
        target_resolved = target.resolve()
        for source in binding.sources:
            for path, label in (
                (source.snapshot_path, "snapshot"),
                (source.pattern_path, "pattern"),
                (source.semantic_path, "semantic"),
            ):
                upstream = Path(path).resolve()
                if (
                    target_resolved == upstream
                    or target_resolved.is_relative_to(upstream)
                    or upstream.is_relative_to(target_resolved)
                ):
                    raise ValueError(
                        f"TaskStore must be outside immutable upstream {label} stores"
                    )
        if target.exists():
            errors = TaskStore.verify(target, binding=binding)
            if errors:
                raise ValueError(
                    "Existing TaskStore integrity failure: " + ", ".join(errors)
                )
            existing_bundle = TaskStore.load(target, verify=False)
            if existing_bundle.to_json() != bundle.to_json():
                raise ValueError(
                    "Existing task-run directory contains different deterministic output"
                )
            return TaskStore.describe(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(
            tempfile.mkdtemp(prefix=f"{target.name}.staging-", dir=target.parent)
        )
        try:
            _write_sqlite(staging / "task.sqlite3", bundle)
            files = tuple(
                (
                    path.relative_to(staging).as_posix(),
                    _sha256_file(path),
                    path.stat().st_size,
                )
                for path in sorted(item for item in staging.rglob("*") if item.is_file())
            )
            manifest = {
                "schema_version": TASK_STORE_SCHEMA_VERSION,
                "task_run_id": bundle.task_run_id,
                "task_spec_key": bundle.task_spec.task_spec_key,
                "project_id": binding.project_id,
                "project_snapshot_set_id": binding.project_snapshot_set_id,
                "recipe_id": bundle.recipe_id,
                "recipe_version": bundle.recipe_version,
                "sources": tuple(
                    {
                        "snapshot_id": source.snapshot_id,
                        "pattern_graph_id": source.pattern_graph_id,
                        "drawing_semantic_graph_id": source.drawing_semantic_graph_id,
                        "snapshot_manifest_sha256": source.snapshot_manifest_sha256,
                        "pattern_manifest_sha256": source.pattern_manifest_sha256,
                        "semantic_manifest_sha256": source.semantic_manifest_sha256,
                    }
                    for source in binding.sources
                ),
                "files": files,
            }
            (staging / "manifest.json").write_text(
                stable_json_dumps(manifest, pretty=True) + "\n",
                encoding="utf-8",
                newline="\n",
            )
            os.replace(staging, target)
        except BaseException:
            if staging.exists():
                shutil.rmtree(staging)
            raise
        post_errors = binding.verify()
        if post_errors:
            raise RuntimeError(
                "Task persistence changed immutable upstream integrity: "
                + ", ".join(post_errors)
            )
        return TaskStore.describe(target)

    @staticmethod
    def describe(path: str | Path) -> TaskLocation:
        root = Path(path)
        manifest = stable_json_loads(
            (root / "manifest.json").read_text(encoding="utf-8")
        )
        if int(manifest["schema_version"]) != TASK_STORE_SCHEMA_VERSION:
            raise ValueError("Unsupported TaskStore schema")
        files = tuple((str(item[0]), str(item[1])) for item in manifest["files"])
        return TaskLocation(
            str(root.resolve()),
            str(manifest["task_run_id"]),
            str(manifest["task_spec_key"]),
            str(manifest["project_snapshot_set_id"]),
            sum(item.stat().st_size for item in root.rglob("*") if item.is_file()),
            files,
        )

    @staticmethod
    def verify(
        path: str | Path,
        *,
        binding: ProjectBinding | None = None,
    ) -> tuple[str, ...]:
        root = Path(path)
        try:
            manifest = stable_json_loads(
                (root / "manifest.json").read_text(encoding="utf-8")
            )
        except (OSError, TypeError, ValueError) as error:
            return (f"manifest:{error}",)
        errors = []
        try:
            schema_version = int(manifest.get("schema_version", -1))
        except (TypeError, ValueError):
            schema_version = -1
        if schema_version != TASK_STORE_SCHEMA_VERSION:
            errors.append("schema_version")
        for relative, expected_hash, expected_size in manifest.get("files", ()):
            file_path = root / str(relative)
            if not file_path.is_file():
                errors.append(f"missing:{relative}")
                continue
            if file_path.stat().st_size != int(expected_size):
                errors.append(f"size:{relative}")
            if _sha256_file(file_path) != str(expected_hash):
                errors.append(f"sha256:{relative}")
        expected_files = {
            "manifest.json",
            *(str(item[0]) for item in manifest.get("files", ())),
        }
        actual_files = {
            item.relative_to(root).as_posix()
            for item in root.rglob("*")
            if item.is_file()
        }
        errors.extend(
            f"unexpected:{relative}"
            for relative in sorted(actual_files - expected_files)
        )
        database = root / "task.sqlite3"
        if database.is_file():
            try:
                connection = sqlite3.connect(database)
                try:
                    metadata = dict(connection.execute("SELECT key,value FROM metadata"))
                finally:
                    connection.close()
                if metadata.get("task_run_id") != str(manifest.get("task_run_id", "")):
                    errors.append("database_task_run_id")
                if metadata.get("task_spec_key") != str(
                    manifest.get("task_spec_key", "")
                ):
                    errors.append("database_task_spec_key")
            except sqlite3.DatabaseError:
                errors.append("database")
        if binding is not None:
            errors.extend(f"binding:{item}" for item in binding.verify())
            if binding.project_id != str(manifest.get("project_id", "")):
                errors.append("project_id")
            if binding.project_snapshot_set_id != str(
                manifest.get("project_snapshot_set_id", "")
            ):
                errors.append("project_snapshot_set_id")
            expected_sources = tuple(
                (
                    source.snapshot_id,
                    source.pattern_graph_id,
                    source.drawing_semantic_graph_id,
                    source.snapshot_manifest_sha256,
                    source.pattern_manifest_sha256,
                    source.semantic_manifest_sha256,
                )
                for source in binding.sources
            )
            manifest_sources = tuple(
                (
                    str(source["snapshot_id"]),
                    str(source["pattern_graph_id"]),
                    str(source["drawing_semantic_graph_id"]),
                    str(source["snapshot_manifest_sha256"]),
                    str(source["pattern_manifest_sha256"]),
                    str(source["semantic_manifest_sha256"]),
                )
                for source in manifest.get("sources", ())
            )
            if expected_sources != manifest_sources:
                errors.append("upstream_manifests")
        return tuple(errors)

    @staticmethod
    def load(path: str | Path, *, verify: bool = True) -> TaskResultBundle:
        root = Path(path)
        if verify:
            errors = TaskStore.verify(root)
            if errors:
                raise ValueError("TaskStore integrity failure: " + ", ".join(errors))
        connection = sqlite3.connect(root / "task.sqlite3")
        try:
            metadata = dict(connection.execute("SELECT key,value FROM metadata"))
        finally:
            connection.close()
        bundle = TaskResultBundle.from_json(metadata["bundle_json"])
        manifest = stable_json_loads(
            (root / "manifest.json").read_text(encoding="utf-8")
        )
        if bundle.task_run_id != str(manifest["task_run_id"]):
            raise ValueError("Task bundle and manifest identifiers disagree")
        if bundle.to_json() != metadata["bundle_json"]:
            raise ValueError("Task bundle canonical payload is not stable")
        return bundle

    @staticmethod
    def is_stale(path: str | Path, *, binding: ProjectBinding) -> bool:
        return bool(TaskStore.verify(path, binding=binding))

