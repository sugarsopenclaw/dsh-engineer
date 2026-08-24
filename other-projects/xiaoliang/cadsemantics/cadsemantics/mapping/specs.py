from __future__ import annotations

from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any

import yaml

from cadsemantics.contracts import RepresentationMode
from cadsemantics.packs import PackManifest


PREDICATE_WHITELIST = tuple(
    sorted(
        (
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
        )
    )
)


@dataclass(frozen=True, slots=True)
class PredicateCall:
    predicate: str
    arguments: tuple[tuple[str, Any], ...]

    def argument(self, name: str, default: Any = None) -> Any:
        for key, value in self.arguments:
            if key == name:
                return value
        return default


@dataclass(frozen=True, slots=True)
class SemanticMappingSpec:
    mapping_id: str
    version: str
    pack_id: str
    target_class: str
    source_patterns: tuple[str, ...]
    representation_mode: RepresentationMode
    functional_roles: tuple[str, ...]
    must: tuple[PredicateCall, ...]
    must_any: tuple[PredicateCall, ...]
    should: tuple[PredicateCall, ...]
    must_not: tuple[PredicateCall, ...]


def _calls(value: object) -> tuple[PredicateCall, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise TypeError("Semantic mapping predicate group must be a list")
    result = []
    for item in value:
        if not isinstance(item, dict) or "predicate" not in item:
            raise TypeError("Semantic mapping predicate must be a mapping with predicate")
        predicate = str(item["predicate"])
        if predicate not in PREDICATE_WHITELIST:
            raise ValueError(
                f"Predicate {predicate!r} is not allowed; whitelist={PREDICATE_WHITELIST}"
            )
        result.append(
            PredicateCall(
                predicate,
                tuple(
                    (str(key), raw)
                    for key, raw in sorted(item.items())
                    if key != "predicate"
                ),
            )
        )
    return tuple(result)


def semantic_mapping_spec_from_mapping(
    value: object,
    *,
    pack_id: str,
) -> SemanticMappingSpec:
    if not isinstance(value, dict):
        raise TypeError("SemanticMappingSpec must be a mapping")
    return SemanticMappingSpec(
        mapping_id=str(value["mapping_id"]),
        version=str(value["version"]),
        pack_id=pack_id,
        target_class=str(value["target_class"]),
        source_patterns=tuple(sorted(set(str(item) for item in value.get("source_patterns", ())))),
        representation_mode=RepresentationMode(str(value.get("representation_mode", RepresentationMode.UNKNOWN.value))),
        functional_roles=tuple(sorted(set(str(item) for item in value.get("functional_roles", ())))),
        must=_calls(value.get("must")),
        must_any=_calls(value.get("must_any")),
        should=_calls(value.get("should")),
        must_not=_calls(value.get("must_not")),
    )


def _load_document(payload: str, *, pack_id: str) -> tuple[SemanticMappingSpec, ...]:
    value = yaml.safe_load(payload)
    if not isinstance(value, dict) or not isinstance(value.get("mappings"), list):
        raise TypeError("Semantic mapping document requires a mappings list")
    result = tuple(
        semantic_mapping_spec_from_mapping(item, pack_id=pack_id)
        for item in value["mappings"]
    )
    ids = tuple(item.mapping_id for item in result)
    if len(ids) != len(set(ids)):
        raise ValueError("Semantic mapping document contains duplicate mapping ids")
    return tuple(sorted(result, key=lambda item: item.mapping_id))


def load_mapping_specs(path: str | Path, *, pack_id: str) -> tuple[SemanticMappingSpec, ...]:
    return _load_document(Path(path).read_text(encoding="utf-8"), pack_id=pack_id)


def load_pack_mapping_specs(manifest: PackManifest) -> tuple[SemanticMappingSpec, ...]:
    package = resources.files("cadsemantics.packs") / manifest.family
    values = []
    for resource_name in manifest.mapping_resources:
        values.extend(
            _load_document(
                (package / resource_name).read_text(encoding="utf-8"),
                pack_id=manifest.pack_id,
            )
        )
    return tuple(sorted(values, key=lambda item: item.mapping_id))
