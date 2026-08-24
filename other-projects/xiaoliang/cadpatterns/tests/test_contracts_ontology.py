from __future__ import annotations

import ast
from pathlib import Path

import pytest

from cadpatterns.contracts import (
    PatternMember,
    PatternRef,
    PatternStatus,
    PatternToleranceProfile,
    ProofGrade,
    ReferenceKind,
    create_pattern_instance,
)
from cadpatterns.ontology import (
    CANONICAL_PATTERN_TYPES,
    DEPRECATED_ALIASES,
    contains_professional_semantics,
    load_builtin_specs,
    pattern_spec_from_mapping,
)


def test_builtin_specs_are_the_complete_canonical_ontology() -> None:
    specs = load_builtin_specs()
    assert len(CANONICAL_PATTERN_TYPES) == 9
    assert tuple(sorted(spec.pattern_type for spec in specs)) == CANONICAL_PATTERN_TYPES
    assert all(not contains_professional_semantics(value) for value in CANONICAL_PATTERN_TYPES)
    assert not any(value in CANONICAL_PATTERN_TYPES for value in DEPRECATED_ALIASES)


def test_deprecated_alias_is_rejected_in_executable_spec() -> None:
    with pytest.raises(ValueError, match="Deprecated pattern type"):
        pattern_spec_from_mapping(
            {
                "schema_version": 1,
                "pattern_type": "table_candidate",
                "spec_version": "1.0.0",
                "feature_set_version": "1.0.0",
                "feature_precision": 8,
                "detectors": [],
                "required_features": [],
                "style_features": [],
                "resolver": "nested",
                "resolver_version": "1.0.0",
                "tolerance_fields": [],
                "hard_constraints": [],
            }
        )


def test_pattern_identity_excludes_versions_but_detection_identity_includes_them() -> None:
    member = PatternMember(
        "source",
        PatternRef(ReferenceKind.OCCURRENCE, "occurrence-a", "snapshot-a"),
    )
    common = {
        "snapshot_id": "snapshot-a",
        "pattern_type": "generic.text_block",
        "scope_id": "scope:a",
        "detector_id": "text.block",
        "detector_version": "1.0.0",
        "feature_set_version": "1.0.0",
        "resolver_version": "1.0.0",
        "pattern_tolerance_profile_id": "pattern-tolerance:a",
        "status": PatternStatus.CANDIDATE,
        "proof_grade": ProofGrade.TOLERANCE_DERIVED,
        "score": 1.0,
        "members": (member,),
    }
    first = create_pattern_instance(spec_version="1.0.0", **common)
    second = create_pattern_instance(spec_version="2.0.0", **common)
    assert first.pattern_key == second.pattern_key
    assert first.detection_id != second.detection_id
    assert len(first.pattern_key.removeprefix("pattern:")) == 64


def test_detectors_and_features_have_no_naked_threshold_literals() -> None:
    package_root = Path(__file__).parents[1] / "cadpatterns"
    failures = []
    for directory_name in ("detectors", "features"):
        for path in (package_root / directory_name).glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Constant)
                    and isinstance(node.value, (int, float))
                    and not isinstance(node.value, bool)
                    and node.value not in (0, 1, 2)
                ):
                    failures.append((path.name, node.lineno, node.value))
    assert failures == []


def test_pattern_module_names_are_domain_neutral() -> None:
    package_root = Path(__file__).parents[1] / "cadpatterns"
    failures = [
        path.relative_to(package_root).as_posix()
        for path in package_root.rglob("*.py")
        if contains_professional_semantics(path.stem)
    ]
    assert failures == []


def test_sheet_candidate_thresholds_are_dimensionless_ratios() -> None:
    with pytest.raises(ValueError, match="sheet_min_rectangularity"):
        PatternToleranceProfile(
            upstream_tolerance_profile_id="tolerance:a",
            sheet_min_rectangularity=1.01,
        )
