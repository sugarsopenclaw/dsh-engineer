from __future__ import annotations

from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any, Iterable

import yaml

from cadpatterns.ontology.pattern_types import ensure_canonical_pattern_type


@dataclass(frozen=True, slots=True)
class DetectorDeclaration:
    detector_id: str
    version: str


@dataclass(frozen=True, slots=True)
class PatternSpec:
    schema_version: int
    pattern_type: str
    spec_version: str
    feature_set_version: str
    feature_precision: int
    detectors: tuple[DetectorDeclaration, ...]
    required_features: tuple[str, ...]
    style_features: tuple[str, ...]
    resolver: str
    resolver_version: str
    tolerance_fields: tuple[str, ...]
    hard_constraints: tuple[str, ...]
    composed_by: str | None = None

    def __post_init__(self) -> None:
        ensure_canonical_pattern_type(self.pattern_type)
        if self.schema_version != 1:
            raise ValueError(
                f"Unsupported PatternSpec schema {self.schema_version!r}"
            )
        if self.feature_precision < 0:
            raise ValueError("feature_precision must be non-negative")
        if any(not item.startswith("style.") for item in self.style_features):
            raise ValueError("Every declared style feature must use the style.* namespace")


def _string_tuple(value: object, field: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise TypeError(f"PatternSpec {field} must be a list")
    return tuple(str(item) for item in value)


def pattern_spec_from_mapping(value: object) -> PatternSpec:
    if not isinstance(value, dict):
        raise TypeError("PatternSpec document must be a mapping")
    detector_values = value.get("detectors", ())
    if not isinstance(detector_values, (list, tuple)):
        raise TypeError("PatternSpec detectors must be a list")
    detectors: list[DetectorDeclaration] = []
    for item in detector_values:
        if not isinstance(item, dict):
            raise TypeError("PatternSpec detector declaration must be a mapping")
        detectors.append(
            DetectorDeclaration(
                detector_id=str(item["id"]),
                version=str(item["version"]),
            )
        )
    composed_by = value.get("composed_by")
    return PatternSpec(
        schema_version=int(value["schema_version"]),
        pattern_type=ensure_canonical_pattern_type(str(value["pattern_type"])),
        spec_version=str(value["spec_version"]),
        feature_set_version=str(value["feature_set_version"]),
        feature_precision=int(value["feature_precision"]),
        detectors=tuple(detectors),
        required_features=_string_tuple(value.get("required_features"), "required_features"),
        style_features=_string_tuple(value.get("style_features"), "style_features"),
        resolver=str(value["resolver"]),
        resolver_version=str(value["resolver_version"]),
        tolerance_fields=_string_tuple(value.get("tolerance_fields"), "tolerance_fields"),
        hard_constraints=_string_tuple(value.get("hard_constraints"), "hard_constraints"),
        composed_by=None if composed_by is None else str(composed_by),
    )


def load_pattern_spec(path: str | Path) -> PatternSpec:
    payload = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return pattern_spec_from_mapping(payload)


def load_builtin_specs() -> tuple[PatternSpec, ...]:
    package = resources.files("cadpatterns.specs")
    specs = [
        pattern_spec_from_mapping(yaml.safe_load(resource.read_text(encoding="utf-8")))
        for resource in package.iterdir()
        if resource.name.endswith(".yaml")
    ]
    specs.sort(key=lambda item: item.pattern_type)
    pattern_types = tuple(spec.pattern_type for spec in specs)
    if len(pattern_types) != len(set(pattern_types)):
        raise ValueError("Built-in PatternSpecs contain duplicate pattern types")
    return tuple(specs)


def load_specs(paths: Iterable[str | Path] | None = None) -> tuple[PatternSpec, ...]:
    return (
        load_builtin_specs()
        if paths is None
        else tuple(sorted((load_pattern_spec(path) for path in paths), key=lambda item: item.pattern_type))
    )
