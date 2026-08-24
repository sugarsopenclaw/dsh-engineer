from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
from typing import Any, Mapping

from cadkernel.contracts import stable_json_dumps, stable_json_loads
from cadtasks.agentview import export_bundle
from cadtasks.binding import ProjectBinding
from cadtasks.contracts import TaskRequest
from cadtasks.ports import StructuredTaskCompiler
from cadtasks.runtime import TaskRuntime

from cadstack.bind import binding_integrity_errors
from cadstack.layout import FactsLayout
from cadstack.state import read_project_state, replace_generated_tree


_MAX_SUMMARY_RECORDS = 50
_MAX_SUMMARY_SEQUENCE = 50
_MAX_SUMMARY_FIELDS = 40
_MAX_SUMMARY_TEXT = 1_000
_MAX_SUMMARY_BYTES = 750_000
_CLAIM_HEADER_FIELDS = (
    "claim_id",
    "claim_type",
    "status",
    "subject_ref",
    "predicate",
    "truth_basis",
    "quantity_basis",
    "value_interval",
    "unit",
    "derivation_ref",
)
_ISSUE_HEADER_FIELDS = (
    "issue_id",
    "issue_type",
    "status",
    "severity",
    "subject_ref",
    "message",
)
_GAP_HEADER_FIELDS = (
    "gap_id",
    "capability_id",
    "missing",
    "data_gap",
    "reason",
    "status",
)


def _mapping(path: Path) -> Mapping[str, Any]:
    value = stable_json_loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, Mapping):
        raise TypeError("task request JSON root must be an object")
    return value


def _portable_id(value: str) -> str:
    return value.replace(":", "-", 1)


def _json_value(value: object) -> Any:
    return json.loads(stable_json_dumps(value))


def _compact_json(value: Any, *, depth: int = 0) -> Any:
    if isinstance(value, str):
        return value if len(value) <= _MAX_SUMMARY_TEXT else value[:_MAX_SUMMARY_TEXT] + "…"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if depth >= 5:
        return {"truncated": True, "type": type(value).__name__}
    if isinstance(value, list):
        items = [
            _compact_json(item, depth=depth + 1)
            for item in value[:_MAX_SUMMARY_SEQUENCE]
        ]
        if len(value) <= _MAX_SUMMARY_SEQUENCE:
            return items
        return {
            "items": items,
            "total_count": len(value),
            "truncated": True,
        }
    if isinstance(value, Mapping):
        keys = sorted(str(key) for key in value)[:_MAX_SUMMARY_FIELDS]
        compact = {
            key: _compact_json(value[key], depth=depth + 1)
            for key in keys
        }
        if len(value) > _MAX_SUMMARY_FIELDS:
            compact["_truncated_field_count"] = len(value) - _MAX_SUMMARY_FIELDS
        return compact
    return _compact_json(str(value), depth=depth + 1)


def _compact_records(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        _compact_json(value)
        for value in values[:_MAX_SUMMARY_RECORDS]
    ]


def _headers(
    values: list[dict[str, Any]],
    fields: tuple[str, ...],
) -> list[dict[str, Any]]:
    return [
        {
            field: _compact_json(value[field])
            for field in fields
            if field in value
        }
        for value in values[:_MAX_SUMMARY_RECORDS]
    ]


def _fallbacks(gaps: list[dict[str, Any]]) -> list[str]:
    missing = " ".join(
        f"{gap.get('missing', '')} {gap.get('data_gap', '')}" for gap in gaps
    ).casefold()
    suggestions: list[str] = []
    if "measured_value" in missing or "persisted_area_fact" in missing:
        suggestions.append(
            "Use cad_extract action=read for authoritative AutoCAD fields, or "
            "cad_detail/cad_measure for a bounded local read."
        )
    if "row_segmentation" in missing or "bom" in missing:
        suggestions.append(
            "BOM-declared quantities require schedule row segmentation; use "
            "drawing_occurrence/unique_tag or inspect the schedule with an explicit fallback."
        )
    if not suggestions and gaps:
        suggestions.append(
            "Narrow the scope or acquire the missing evidence named by capability_gap."
        )
    return suggestions


def ask_project(
    *,
    project_root: str | Path,
    request_path: str | Path,
) -> dict[str, Any]:
    layout = FactsLayout.from_project_root(project_root)
    layout.ensure()
    if not layout.binding_json.is_file():
        raise FileNotFoundError("facts binding.json is missing; run cadstack bind first")
    binding = ProjectBinding.load(layout.binding_json)
    state = read_project_state(layout)
    binding_errors = binding_integrity_errors(
        layout,
        binding,
        expected_project_id=str(state["project_id"]),
    )
    if binding_errors:
        raise ValueError("ProjectBinding integrity failure: " + ", ".join(binding_errors))
    request_file = layout.resolve_input_path(
        request_path,
        suffixes=frozenset({".json"}),
    )
    request_mapping = _mapping(request_file)
    request = TaskRequest.create(
        request_mapping,
        original_text=(
            str(request_mapping.get("original_text"))
            if request_mapping.get("original_text") is not None
            else None
        ),
    )
    compilation = StructuredTaskCompiler().compile(
        request,
        default_project_id=binding.project_id,
    )
    if not compilation.complete or compilation.spec is None:
        return {
            "status": "invalid_request",
            "request_id": request.request_id,
            "missing_slots": compilation.missing_slots,
            "ambiguities": compilation.ambiguities,
            "capability_gap": [],
        }
    result = TaskRuntime().run(
        binding,
        compilation.spec,
        output_root=layout.store_root,
    )
    if result.location is None:
        raise RuntimeError("TaskRuntime did not persist its result")
    export_target = layout.tasks_root / _portable_id(result.bundle.task_run_id)
    export_target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".task-export-", dir=layout.tasks_root))
    try:
        export_bundle(result.bundle, staging)
        replace_generated_tree(staging, export_target)
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
    claims = [_json_value(item) for item in result.bundle.claims]
    issues = [_json_value(item) for item in result.bundle.issues]
    gaps = [_json_value(item) for item in result.bundle.gaps]
    evidence_refs = sorted(
        {
            *(ref for claim in result.bundle.claims for ref in claim.evidence_refs),
            *(ref for issue in result.bundle.issues for ref in issue.evidence_refs),
            *(ref for gap in result.bundle.gaps for ref in gap.evidence_refs),
        }
    )
    summary = {
        "request_id": request.request_id,
        "task_run_id": result.bundle.task_run_id,
        "status": result.bundle.status.value,
        "claims": _compact_records(claims),
        "claim_count": len(claims),
        "claims_truncated": len(claims) > _MAX_SUMMARY_RECORDS,
        "issues": _compact_records(issues),
        "issue_count": len(issues),
        "issues_truncated": len(issues) > _MAX_SUMMARY_RECORDS,
        "capability_gap": _compact_records(gaps),
        "capability_gap_count": len(gaps),
        "capability_gaps_truncated": len(gaps) > _MAX_SUMMARY_RECORDS,
        "evidence_refs": evidence_refs[:200],
        "evidence_ref_count": len(evidence_refs),
        "evidence_refs_truncated": len(evidence_refs) > 200,
        "fallback_suggestions": _fallbacks(gaps),
        "facts_paths": {
            "task": layout.relative(export_target),
            "task_index": layout.relative(export_target / "index.txt"),
            "bundle": layout.relative(export_target / "bundle.json"),
        },
    }
    if len(stable_json_dumps(summary).encode("utf-8")) > _MAX_SUMMARY_BYTES:
        summary.update(
            {
                "claims": _headers(claims, _CLAIM_HEADER_FIELDS),
                "issues": _headers(issues, _ISSUE_HEADER_FIELDS),
                "capability_gap": _headers(gaps, _GAP_HEADER_FIELDS),
                "evidence_refs": evidence_refs[:100],
                "claims_truncated": True,
                "issues_truncated": True,
                "capability_gaps_truncated": True,
                "evidence_refs_truncated": True,
                "summary_size_fallback": True,
            }
        )
    return summary
