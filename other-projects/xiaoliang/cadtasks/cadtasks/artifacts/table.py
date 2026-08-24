from __future__ import annotations

from typing import Any, Iterable

from cadtasks.contracts import Artifact, ArtifactType


def table_artifact(
    *,
    task_run_id: str,
    columns: Iterable[str],
    rows: Iterable[Iterable[Any]],
    evidence_refs: Iterable[str],
) -> Artifact:
    return Artifact.create(
        task_run_id=task_run_id,
        artifact_type=ArtifactType.STRUCTURED_TABLE,
        media_type="application/vnd.xiaoliang.table+json",
        payload={
            "columns": tuple(str(item) for item in columns),
            "rows": tuple(tuple(value for value in row) for row in rows),
        },
        evidence_refs=evidence_refs,
    )

