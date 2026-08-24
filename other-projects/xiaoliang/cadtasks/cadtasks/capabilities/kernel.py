from __future__ import annotations

from typing import Any

from cadkernel.aggregate import count
from cadkernel.annotations import query_region as query_annotations
from cadkernel.annotations import resolve_targets
from cadkernel.indexes import (
    point_in_face,
    query_endpoints,
    query_faces,
    query_region,
    search_text,
)
from cadkernel.kernel.measure import aabb, distance, extent, length

from cadtasks.binding import SourceFacts
from cadtasks.capabilities.registry import (
    CapabilityOutcome,
    CapabilityRegistry,
    CapabilitySpec,
    outcome_from_op_result,
)


_SPECS = (
    CapabilitySpec("measure.length", "1.1.0", "snapshot+occurrence_ids", "measurement_batch", "read", "cpu", "deterministic"),
    CapabilitySpec("measure.extent", "1.0.0", "snapshot+occurrence_ids", "measurement_batch", "read", "cpu", "deterministic"),
    CapabilitySpec("measure.aabb", "1.0.0", "snapshot+occurrence_ids", "measurement_batch", "read", "cpu", "deterministic"),
    CapabilitySpec("measure.distance", "1.0.0", "snapshot+occurrence_id_pairs", "measurement_batch", "read", "cpu", "deterministic"),
    CapabilitySpec("aggregate.count", "1.0.0", "snapshot+selector+identity_key", "count_result", "read", "cpu", "deterministic"),
    CapabilitySpec("spatial_index.query_region", "1.1.0", "snapshot+bounds", "spatial_query_batch", "read", "io", "deterministic"),
    CapabilitySpec("text_index.search", "1.1.0", "snapshot+query", "text_search_batch", "read", "io", "deterministic"),
    CapabilitySpec("endpoint_index.query_radius", "1.0.0", "snapshot+point", "endpoint_hit_batch", "read", "io", "deterministic"),
    CapabilitySpec("topology.query_faces", "1.1.0", "snapshot+bounds", "face_query_batch", "read", "io", "deterministic"),
    CapabilitySpec("topology.point_in_face", "1.0.0", "snapshot+point", "point_in_face_batch", "read", "io", "deterministic"),
    CapabilitySpec("annotation.query_region", "1.0.0", "snapshot+bounds", "annotation_query_batch", "read", "io", "deterministic"),
    CapabilitySpec("annotation.resolve_targets", "1.0.0", "snapshot+annotation_ids", "resolved_target_batch", "read", "cpu", "deterministic"),
)


def _wrap(spec: CapabilitySpec, result: Any) -> CapabilityOutcome:
    return outcome_from_op_result(spec.capability_id, spec.version, result)


def register_kernel_capabilities(registry: CapabilityRegistry) -> None:
    specs = {spec.capability_id: spec for spec in _SPECS}

    def measure_length(source: SourceFacts, occurrence_ids: Any = None) -> CapabilityOutcome:
        spec = specs["measure.length"]
        return _wrap(spec, length(source.snapshot, occurrence_ids))

    def measure_extent(source: SourceFacts, occurrence_ids: Any = None) -> CapabilityOutcome:
        spec = specs["measure.extent"]
        return _wrap(spec, extent(source.snapshot, occurrence_ids))

    def measure_aabb(source: SourceFacts, occurrence_ids: Any = None) -> CapabilityOutcome:
        spec = specs["measure.aabb"]
        return _wrap(spec, aabb(source.snapshot, occurrence_ids))

    def measure_distance(
        source: SourceFacts,
        occurrence_ids_a: Any,
        occurrence_ids_b: Any,
    ) -> CapabilityOutcome:
        spec = specs["measure.distance"]
        return _wrap(
            spec,
            distance(source.snapshot, occurrence_ids_a, occurrence_ids_b),
        )

    def aggregate_count(
        source: SourceFacts,
        selector: Any = None,
        *,
        identity_key: Any,
    ) -> CapabilityOutcome:
        spec = specs["aggregate.count"]
        return _wrap(
            spec,
            count(source.snapshot, selector, identity_key=identity_key),
        )

    def spatial_query(
        source: SourceFacts,
        bounds: tuple[float, float, float, float],
        **kwargs: Any,
    ) -> CapabilityOutcome:
        spec = specs["spatial_index.query_region"]
        return _wrap(
            spec,
            query_region(source.source.snapshot_path, source.snapshot, bounds, **kwargs),
        )

    def text_query(source: SourceFacts, query: str, **kwargs: Any) -> CapabilityOutcome:
        spec = specs["text_index.search"]
        return _wrap(
            spec,
            search_text(source.source.snapshot_path, source.snapshot, query, **kwargs),
        )

    def endpoint_query(
        source: SourceFacts,
        point: tuple[float, float],
        **kwargs: Any,
    ) -> CapabilityOutcome:
        spec = specs["endpoint_index.query_radius"]
        return _wrap(
            spec,
            query_endpoints(source.source.snapshot_path, source.snapshot, point, **kwargs),
        )

    def face_query(
        source: SourceFacts,
        bounds: tuple[float, float, float, float],
        **kwargs: Any,
    ) -> CapabilityOutcome:
        spec = specs["topology.query_faces"]
        return _wrap(
            spec,
            query_faces(source.source.snapshot_path, source.snapshot, bounds, **kwargs),
        )

    def face_point_query(
        source: SourceFacts,
        point: tuple[float, float],
        **kwargs: Any,
    ) -> CapabilityOutcome:
        spec = specs["topology.point_in_face"]
        return _wrap(
            spec,
            point_in_face(source.source.snapshot_path, source.snapshot, point, **kwargs),
        )

    def annotation_query(
        source: SourceFacts,
        bounds: tuple[float, float, float, float],
        **kwargs: Any,
    ) -> CapabilityOutcome:
        spec = specs["annotation.query_region"]
        return _wrap(
            spec,
            query_annotations(source.source.snapshot_path, source.snapshot, bounds, **kwargs),
        )

    def annotation_targets(
        source: SourceFacts,
        annotation_ids: Any,
        **kwargs: Any,
    ) -> CapabilityOutcome:
        spec = specs["annotation.resolve_targets"]
        return _wrap(
            spec,
            resolve_targets(source.snapshot, annotation_ids, **kwargs),
        )

    implementations = {
        "measure.length": measure_length,
        "measure.extent": measure_extent,
        "measure.aabb": measure_aabb,
        "measure.distance": measure_distance,
        "aggregate.count": aggregate_count,
        "spatial_index.query_region": spatial_query,
        "text_index.search": text_query,
        "endpoint_index.query_radius": endpoint_query,
        "topology.query_faces": face_query,
        "topology.point_in_face": face_point_query,
        "annotation.query_region": annotation_query,
        "annotation.resolve_targets": annotation_targets,
    }
    for spec in _SPECS:
        registry.register(spec, implementations[spec.capability_id])

