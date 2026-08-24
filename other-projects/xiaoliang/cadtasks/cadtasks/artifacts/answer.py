from __future__ import annotations

from typing import Iterable

from cadtasks.contracts import Artifact, ArtifactType


def answer_artifact(
    *,
    task_run_id: str,
    text: str,
    evidence_refs: Iterable[str],
) -> Artifact:
    return Artifact.create(
        task_run_id=task_run_id,
        artifact_type=ArtifactType.ANSWER,
        media_type="text/plain",
        payload={"text": str(text)},
        evidence_refs=evidence_refs,
    )

