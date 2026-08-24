from __future__ import annotations

import ast
from pathlib import Path
from typing import Iterator

import pytest
import yaml

from cadsemantics.contracts import (
    EvidenceBundle,
    EvidenceGrade,
    EvidenceKind,
    EvidenceRef,
    RepresentationMode,
    SemanticRepresentation,
    SemanticStatus,
    SemanticToleranceProfile,
    representation_key,
    resolution_id,
)
from cadsemantics.mapping import PREDICATE_WHITELIST, semantic_mapping_spec_from_mapping
from cadsemantics.ontology import BUILTIN_CLASS_IDS, builtin_ontology
from cadsemantics.packs import (
    apply_overlays,
    load_builtin_manifests,
    pack_manifest_from_mapping,
)


def test_representation_key_excludes_versions_and_resolution_includes_them() -> None:
    key = representation_key("generic.TagLabel", "context:a", ("pattern:b", "pattern:a"))
    first = resolution_id(
        key,
        ontology_version="o1",
        pack_id="generic_engineering",
        pack_version="1",
        mapping_version="1",
        backend_version="rule:1",
        project_profile_version="p1",
    )
    second = resolution_id(
        key,
        ontology_version="o1",
        pack_id="generic_engineering",
        pack_version="2",
        mapping_version="1",
        backend_version="rule:1",
        project_profile_version="p1",
    )
    assert key.startswith("semrep:") and len(key.removeprefix("semrep:")) == 64
    assert first != second
    assert first.startswith("semres:") and len(first.removeprefix("semres:")) == 64


def test_builtin_classes_are_manifest_whitelisted() -> None:
    manifests = load_builtin_manifests()
    declared = tuple(sorted(class_id for item in manifests for class_id in item.provides_classes))
    assert declared == BUILTIN_CLASS_IDS
    ontology = builtin_ontology({class_id: item.pack_id for item in manifests for class_id in item.provides_classes})
    with pytest.raises(ValueError, match="Unregistered semantic class"):
        ontology.classes.require("electrical.Transformer")


def test_mapping_predicates_are_whitelisted() -> None:
    assert {
        "pattern_type_is",
        "feature_at_least",
        "feature_in",
        "member_count_at_least",
        "has_edge",
        "inside_pattern_of_type",
        "shares_feature_with_pattern_type",
        "text_matches_lexicon",
        "context_discipline_any",
        "source_layer_matches",
        "block_attribute_present",
        "annotation_kind_present",
    } == set(PREDICATE_WHITELIST)


def test_pack_overlays_follow_core_cn_company_project_order() -> None:
    def manifest(pack_id: str, layer: str, extends: str | None = None):
        return pack_manifest_from_mapping(
            {
                "pack_id": pack_id,
                "version": "1.0.0",
                "namespace": "example",
                "family": "example",
                "overlay_layer": layer,
                "extends": extends,
                "provides_classes": [f"example.{layer}"],
                "lexicons": {"labels": [layer]},
            }
        )

    effective = apply_overlays(
        (
            manifest("example.project", "project", "example.company"),
            manifest("example.core", "core"),
            manifest("example.company", "company", "example.cn"),
            manifest("example.cn", "cn", "example.core"),
        )
    )[0]
    assert effective.overlay_chain == (
        "example.core",
        "example.cn",
        "example.company",
        "example.project",
    )
    assert effective.provides_classes == (
        "example.cn",
        "example.company",
        "example.core",
        "example.project",
    )


def test_packs_do_not_import_each_other_or_contain_geometry_thresholds() -> None:
    package = Path(__file__).parents[1] / "cadsemantics"
    failures = []
    for directory_name in ("packs", "mapping"):
        for path in (package / directory_name).rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    names = [
                        alias.name
                        for alias in node.names
                    ] if isinstance(node, ast.Import) else [node.module or ""]
                    if any(name.startswith(("shapely", "numpy")) for name in names):
                        failures.append((path.name, node.lineno, "geometry-import"))
                if (
                    isinstance(node, ast.Constant)
                    and isinstance(node.value, (int, float))
                    and not isinstance(node.value, bool)
                    and node.value not in (0, 1, 2)
                ):
                    failures.append((path.name, node.lineno, node.value))
    # Predicate arguments live in the declarative mapping data, so the same
    # bare-number rule must hold there or a pack could smuggle in a geometry
    # threshold (e.g. rectangularity >= 0.8) without touching scanned code.
    for path in (package / "packs").rglob("*.yaml"):
        for number in _yaml_numbers(yaml.safe_load(path.read_text(encoding="utf-8"))):
            if number not in (0, 1, 2):
                failures.append((path.name, "yaml", number))
    assert failures == []


def _yaml_numbers(value: object) -> Iterator[int | float]:
    if isinstance(value, dict):
        for item in value.values():
            yield from _yaml_numbers(item)
    elif isinstance(value, list):
        for item in value:
            yield from _yaml_numbers(item)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        yield value


def test_semantic_should_threshold_is_a_dimensionless_ratio() -> None:
    with pytest.raises(ValueError, match="supported_should_ratio"):
        SemanticToleranceProfile(supported_should_ratio=1.01)
