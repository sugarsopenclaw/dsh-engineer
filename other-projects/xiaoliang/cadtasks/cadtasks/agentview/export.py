from __future__ import annotations

from pathlib import Path
from typing import Any

from cadkernel.contracts import stable_json_dumps

from cadtasks.contracts import ArtifactType, TaskResultBundle
from cadtasks.storage import TaskStore


def _portable_id(value: str) -> str:
    return value.replace(":", "-", 1)


def highlights_payload(bundle: TaskResultBundle) -> tuple[Any, ...]:
    values = []
    for artifact in bundle.artifacts:
        if artifact.artifact_type is not ArtifactType.SOURCE_HIGHLIGHTS:
            continue
        items = artifact.field("items", ())
        if isinstance(items, (list, tuple)):
            values.extend(items)
    return tuple(
        sorted(
            values,
            key=lambda item: stable_json_dumps(item),
        )
    )


def export_bundle(bundle: TaskResultBundle, out: str | Path) -> Path:
    target = Path(out)
    target.mkdir(parents=True, exist_ok=True)
    directories = {
        name: target / name
        for name in ("claims", "issues", "gaps", "highlights", "evidence")
    }
    for directory in directories.values():
        directory.mkdir(exist_ok=True)
    for claim in bundle.claims:
        path = directories["claims"] / f"{_portable_id(claim.claim_id)}.json"
        path.write_text(
            stable_json_dumps(claim, pretty=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    for issue in bundle.issues:
        path = directories["issues"] / f"{_portable_id(issue.issue_id)}.json"
        path.write_text(
            stable_json_dumps(issue, pretty=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    for gap in bundle.gaps:
        path = directories["gaps"] / f"{_portable_id(gap.gap_id)}.json"
        path.write_text(
            stable_json_dumps(gap, pretty=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    highlights = highlights_payload(bundle)
    (directories["highlights"] / "highlights.json").write_text(
        stable_json_dumps(highlights, pretty=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    evidence_refs = tuple(
        sorted(
            {
                *(ref for claim in bundle.claims for ref in claim.evidence_refs),
                *(ref for issue in bundle.issues for ref in issue.evidence_refs),
            }
        )
    )
    (directories["evidence"] / "refs.json").write_text(
        stable_json_dumps(evidence_refs, pretty=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    lines = [
        f"task run: {bundle.task_run_id}",
        f"status: {bundle.status.value}",
        f"recipe: {bundle.recipe_id}@{bundle.recipe_version}",
        f"claims: {len(bundle.claims)}",
        f"issues: {len(bundle.issues)}",
        f"gaps: {len(bundle.gaps)}",
        f"highlights: {len(highlights)}",
        "",
        "claim summary:",
        *(
            f"  {claim.claim_type}: {claim.status.value} value={claim.value!r}"
            for claim in bundle.claims
        ),
        "",
        "gap summary:",
        *(f"  {gap.missing}: {gap.reason}" for gap in bundle.gaps),
    ]
    (target / "index.txt").write_text(
        "\n".join(lines) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    (target / "bundle.json").write_text(
        bundle.to_json(pretty=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return target.resolve()


def export_task_store(path: str | Path, out: str | Path) -> Path:
    return export_bundle(TaskStore.load(path), out)

