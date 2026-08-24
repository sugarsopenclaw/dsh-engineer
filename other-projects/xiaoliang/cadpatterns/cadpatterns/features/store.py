from __future__ import annotations

from decimal import Decimal, ROUND_HALF_EVEN
from typing import Any, Iterable

import numpy as np

from cadkernel.contracts import (
    freeze_text_array,
    stable_json_dumps,
    stable_json_loads,
)
from cadkernel.ir import DrawingSnapshot
from cadkernel.topology import TopologyCompilation

from cadpatterns.contracts import (
    FeatureRecord,
    GeometryProvenance,
    PatternToleranceProfile,
    ScopeType,
)
from cadpatterns.ontology import PatternSpec
from cadpatterns.scopes import ScopeTree


def _text_array(values: Iterable[str]) -> np.ndarray:
    # freeze_text_array keeps short columns fixed-width and degrades oversized
    # ones (for example a long MTEXT in a value_json payload) to object arrays
    # instead of attempting a giant allocation.
    return freeze_text_array(values)


def quantize_feature_value(value: Any, precision: int) -> Any:
    """Apply deterministic decimal half-even quantization recursively."""

    if isinstance(value, (bool, int, str)) or value is None:
        return value
    if isinstance(value, np.generic):
        return quantize_feature_value(value.item(), precision)
    if isinstance(value, float):
        quantum = Decimal(1).scaleb(-precision)
        return float(Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_EVEN))
    if isinstance(value, dict):
        return {
            str(key): quantize_feature_value(item, precision)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (tuple, list)):
        return tuple(quantize_feature_value(item, precision) for item in value)
    raise TypeError(f"Unsupported feature value: {type(value).__qualname__}")


class PatternFeatureStore:
    """Immutable columnar feature facts keyed by scope, subject, and name."""

    __slots__ = (
        "scope_ids",
        "subject_refs",
        "names",
        "value_json",
        "provenance",
        "feature_precision",
    )

    def __init__(
        self,
        scope_ids: Iterable[str],
        subject_refs: Iterable[str],
        names: Iterable[str],
        value_json: Iterable[str],
        provenance: Iterable[str],
        *,
        feature_precision: int,
    ) -> None:
        self.scope_ids = _text_array(scope_ids)
        self.subject_refs = _text_array(subject_refs)
        self.names = _text_array(names)
        self.value_json = _text_array(value_json)
        self.provenance = _text_array(provenance)
        self.feature_precision = int(feature_precision)
        lengths = {
            len(self.scope_ids),
            len(self.subject_refs),
            len(self.names),
            len(self.value_json),
            len(self.provenance),
        }
        if len(lengths) != 1:
            raise ValueError("PatternFeatureStore columns disagree")
        keys = list(zip(self.scope_ids, self.subject_refs, self.names))
        if keys != sorted(keys) or len(keys) != len(set(keys)):
            raise ValueError("Feature rows must have unique canonical keys")

    def __len__(self) -> int:
        return len(self.scope_ids)

    @classmethod
    def from_records(
        cls,
        records: Iterable[FeatureRecord],
        *,
        feature_precision: int,
    ) -> "PatternFeatureStore":
        by_key: dict[tuple[str, str, str], FeatureRecord] = {}
        for record in records:
            if record.key() in by_key:
                if stable_json_dumps(by_key[record.key()].value) != stable_json_dumps(record.value):
                    raise ValueError(f"Conflicting feature value for {record.key()!r}")
                continue
            by_key[record.key()] = record
        ordered = tuple(by_key[key] for key in sorted(by_key))
        return cls(
            (record.scope_id for record in ordered),
            (record.subject_ref for record in ordered),
            (record.name for record in ordered),
            (
                stable_json_dumps(
                    quantize_feature_value(record.value, feature_precision)
                )
                for record in ordered
            ),
            (record.provenance.value for record in ordered),
            feature_precision=feature_precision,
        )

    @classmethod
    def empty(cls, *, feature_precision: int = 0) -> "PatternFeatureStore":
        return cls((), (), (), (), (), feature_precision=feature_precision)

    def get(
        self,
        scope_id: str,
        subject_ref: str,
        name: str,
        default: Any = None,
    ) -> Any:
        target = (scope_id, subject_ref, name)
        lower = 0
        upper = len(self)
        while lower < upper:
            middle = (lower + upper) // 2
            key = (
                str(self.scope_ids[middle]),
                str(self.subject_refs[middle]),
                str(self.names[middle]),
            )
            if key < target:
                lower = middle + 1
            else:
                upper = middle
        if lower >= len(self):
            return default
        key = (
            str(self.scope_ids[lower]),
            str(self.subject_refs[lower]),
            str(self.names[lower]),
        )
        if key != target:
            return default
        return stable_json_loads(str(self.value_json[lower]))

    def records(self) -> tuple[FeatureRecord, ...]:
        return tuple(
            FeatureRecord(
                scope_id=str(self.scope_ids[index]),
                subject_ref=str(self.subject_refs[index]),
                name=str(self.names[index]),
                value=stable_json_loads(str(self.value_json[index])),
                provenance=GeometryProvenance(str(self.provenance[index])),
            )
            for index in range(len(self))
        )

    def for_scope(self, scope_id: str) -> tuple[FeatureRecord, ...]:
        return tuple(record for record in self.records() if record.scope_id == scope_id)


def _geometry_length_and_direction(
    snapshot: DrawingSnapshot,
    row: int,
) -> tuple[float, float]:
    geometry = snapshot.geometry
    start = int(geometry.coordinate_offsets[row])
    end = int(geometry.coordinate_offsets[row + 1])
    points = geometry.coordinates[start:end, :2]
    if len(points) < 2:
        return 0.0, 0.0
    vectors = np.diff(points, axis=0)
    lengths = np.linalg.norm(vectors, axis=1)
    total = float(np.sum(lengths))
    nonzero = np.flatnonzero(lengths > 0.0)
    if len(nonzero) == 0:
        return total, 0.0
    vector = vectors[int(nonzero[0])]
    return total, float(np.arctan2(vector[1], vector[0]))


def _text_geometry_row(snapshot: DrawingSnapshot, occurrence_id: str) -> int | None:
    positions = np.searchsorted(snapshot.geometry.occurrence_ids, occurrence_id)
    if positions >= len(snapshot.geometry):
        return None
    if str(snapshot.geometry.occurrence_ids[positions]) != occurrence_id:
        return None
    return int(positions)


def _text_metrics(
    snapshot: DrawingSnapshot,
    occurrence_id: str,
    fallback_height: float,
) -> tuple[float, float, bool, bool]:
    row = _text_geometry_row(snapshot, occurrence_id)
    if row is None:
        return fallback_height, 0.0, False, False
    parameters = snapshot.geometry.parameters[row]
    height_present = bool(np.isfinite(parameters[0]) and parameters[0] > 0.0)
    rotation_present = bool(np.isfinite(parameters[1]))
    height = float(parameters[0]) if height_present else fallback_height
    rotation = float(parameters[1]) if rotation_present else 0.0
    return height, rotation, height_present, rotation_present


def build_feature_store(
    snapshot: DrawingSnapshot,
    topology: TopologyCompilation,
    scopes: ScopeTree,
    specs: tuple[PatternSpec, ...],
    profile: PatternToleranceProfile,
) -> PatternFeatureStore:
    precision = max((spec.feature_precision for spec in specs), default=0)
    declared_style = {
        name for spec in specs for name in spec.style_features
    }
    records: list[FeatureRecord] = []
    geometry = snapshot.geometry
    occurrence_rows = {
        str(occurrence_id): index
        for index, occurrence_id in enumerate(geometry.occurrence_ids)
    }
    text_rows = {
        str(occurrence_id): index
        for index, occurrence_id in enumerate(snapshot.texts.occurrence_ids)
    }
    face_by_id = {face.face_id: face for face in topology.dcel.faces}

    def add(
        scope_id: str,
        subject: str,
        name: str,
        value: Any,
        provenance: GeometryProvenance,
    ) -> None:
        records.append(FeatureRecord(scope_id, subject, name, value, provenance))

    for scope in scopes.scopes:
        add(
            scope.scope_id,
            scope.scope_id,
            "spatial.bounds",
            scope.bounds,
            GeometryProvenance.SOURCE_FACT,
        )
        add(
            scope.scope_id,
            scope.scope_id,
            "spatial.local_scale",
            scope.local_frame.scale,
            GeometryProvenance.PATTERN_DERIVED,
        )
        for occurrence_id in scope.occurrence_ids:
            row = occurrence_rows.get(occurrence_id)
            if row is None:
                continue
            length, direction = _geometry_length_and_direction(snapshot, row)
            add(scope.scope_id, occurrence_id, "geometry.kind", int(geometry.kinds[row]), GeometryProvenance.SOURCE_FACT)
            add(scope.scope_id, occurrence_id, "geometry.bounds", tuple(float(item) for item in geometry.bounds[row]), GeometryProvenance.SOURCE_FACT)
            add(scope.scope_id, occurrence_id, "geometry.length", length, GeometryProvenance.SOURCE_FACT)
            add(scope.scope_id, occurrence_id, "geometry.direction", direction, GeometryProvenance.SOURCE_FACT)
            add(scope.scope_id, occurrence_id, "repeat.definition_id", str(geometry.definition_ids[row]), GeometryProvenance.SOURCE_FACT)
            for style_name in declared_style:
                if style_name == "style.layer":
                    definition_id = str(geometry.definition_ids[row])
                    definition_position = int(np.searchsorted(snapshot.definitions.definition_ids, definition_id))
                    if definition_position < len(snapshot.definitions):
                        add(scope.scope_id, occurrence_id, style_name, str(snapshot.definitions.layers[definition_position]), GeometryProvenance.SOURCE_FACT)
        fallback_height = scope.local_frame.scale * profile.text_height_ratio
        for occurrence_id in scope.text_occurrence_ids:
            text_row = text_rows.get(occurrence_id)
            if text_row is None:
                continue
            point = snapshot.texts.points[text_row]
            height, rotation, height_present, rotation_present = _text_metrics(
                snapshot, occurrence_id, fallback_height
            )
            add(scope.scope_id, occurrence_id, "text.anchor", (float(point[0]), float(point[1])), GeometryProvenance.SOURCE_FACT)
            add(
                scope.scope_id,
                occurrence_id,
                "text.height",
                height,
                GeometryProvenance.SOURCE_FACT
                if height_present
                else GeometryProvenance.PATTERN_DERIVED,
            )
            add(
                scope.scope_id,
                occurrence_id,
                "text.rotation",
                rotation,
                GeometryProvenance.SOURCE_FACT
                if rotation_present
                else GeometryProvenance.PATTERN_DERIVED,
            )
            add(scope.scope_id, occurrence_id, "text.content", str(snapshot.texts.plain_text[text_row]), GeometryProvenance.SOURCE_FACT)
        if scope.scope_type is ScopeType.ENCLOSURE and scope.source_ref in face_by_id:
            face = face_by_id[scope.source_ref]
            add(scope.scope_id, face.face_id, "topology.face", face.face_id, GeometryProvenance.DERIVED_TOPOLOGY)
            add(scope.scope_id, face.face_id, "topology.face_adjacency", face.adjacent_face_ids, GeometryProvenance.DERIVED_TOPOLOGY)
        if scope.scope_type is ScopeType.CONNECTED_COMPONENT:
            add(scope.scope_id, scope.scope_id, "topology.component", scope.source_ref, GeometryProvenance.DERIVED_TOPOLOGY)
            incidence = topology.incidence_graph
            component_occurrences = set(scope.occurrence_ids)
            edge_occurrences = np.asarray(
                [
                    str(snapshot.geometry.occurrence_ids[row])
                    for row in incidence.edge_geometry_rows
                ]
            )
            edge_mask = np.asarray(
                [
                    str(occurrence_id) in component_occurrences
                    for occurrence_id in edge_occurrences
                ],
                dtype=np.bool_,
            )
            component_edges = incidence.edge_node_indices[edge_mask]
            degrees = np.bincount(
                component_edges.reshape(-1), minlength=incidence.node_count
            )
            for node_index in np.flatnonzero(degrees > 0):
                add(
                    scope.scope_id,
                    str(incidence.node_ids[node_index]),
                    "topology.degree",
                    int(degrees[node_index]),
                    GeometryProvenance.DERIVED_TOPOLOGY,
                )
    return PatternFeatureStore.from_records(records, feature_precision=precision)
