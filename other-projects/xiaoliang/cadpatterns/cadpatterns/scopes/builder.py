from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import networkx as nx
import numpy as np
import shapely

from cadkernel.ir import DrawingSnapshot
from cadkernel.topology import TopologyCompilation, face_polygon

from cadpatterns.contracts import (
    PatternLocalFrame,
    PatternScope,
    PatternToleranceProfile,
    ScopeType,
)


@dataclass(frozen=True, slots=True)
class ScopeTree:
    scopes: tuple[PatternScope, ...]

    def __post_init__(self) -> None:
        if tuple(sorted(self.scopes, key=lambda item: item.scope_id)) != self.scopes:
            raise ValueError("ScopeTree scopes must be ordered by scope_id")
        ids = {scope.scope_id for scope in self.scopes}
        if len(ids) != len(self.scopes):
            raise ValueError("ScopeTree contains duplicate scope ids")
        for scope in self.scopes:
            if scope.parent_scope_id is not None and scope.parent_scope_id not in ids:
                raise ValueError(f"Unknown parent scope: {scope.parent_scope_id}")

    def by_id(self, scope_id: str) -> PatternScope:
        for scope in self.scopes:
            if scope.scope_id == scope_id:
                return scope
        raise KeyError(scope_id)

    def of_type(self, scope_type: ScopeType) -> tuple[PatternScope, ...]:
        return tuple(scope for scope in self.scopes if scope.scope_type is scope_type)

    def children(self, scope_id: str) -> tuple[PatternScope, ...]:
        return tuple(scope for scope in self.scopes if scope.parent_scope_id == scope_id)


class _DisjointSet:
    def __init__(self, size: int) -> None:
        self.parents = list(range(size))

    def find(self, item: int) -> int:
        while self.parents[item] != item:
            self.parents[item] = self.parents[self.parents[item]]
            item = self.parents[item]
        return item

    def union(self, left: int, right: int) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root == right_root:
            return
        if left_root < right_root:
            self.parents[right_root] = left_root
        else:
            self.parents[left_root] = right_root


def _row_mask(snapshot: DrawingSnapshot, occurrence_ids: Iterable[str]) -> np.ndarray:
    values = tuple(occurrence_ids)
    if not values:
        return np.zeros(len(snapshot.geometry), dtype=np.bool_)
    return np.isin(snapshot.geometry.occurrence_ids, np.asarray(values))


def _bounds_for_rows(snapshot: DrawingSnapshot, rows: np.ndarray) -> tuple[float, float, float, float]:
    if len(rows) == 0:
        return snapshot.coordinate_frame.bounds
    bounds = snapshot.geometry.bounds[rows]
    return (
        float(np.min(bounds[:, 0])),
        float(np.min(bounds[:, 1])),
        float(np.max(bounds[:, 2])),
        float(np.max(bounds[:, 3])),
    )


def _text_ids_in_bounds(
    snapshot: DrawingSnapshot,
    bounds: tuple[float, float, float, float],
    allowed: set[str] | None = None,
) -> tuple[str, ...]:
    min_x, min_y, max_x, max_y = bounds
    points = snapshot.texts.points
    if not len(points):
        return ()
    mask = (
        (points[:, 0] >= min_x)
        & (points[:, 0] <= max_x)
        & (points[:, 1] >= min_y)
        & (points[:, 1] <= max_y)
    )
    values = (
        str(snapshot.texts.occurrence_ids[index])
        for index in np.flatnonzero(mask)
        if allowed is None or str(snapshot.texts.occurrence_ids[index]) in allowed
    )
    return tuple(sorted(values))


def _segment_facts(
    snapshot: DrawingSnapshot,
    rows: np.ndarray,
) -> tuple[list[float], list[tuple[float, str, int, np.ndarray]]]:
    lengths: list[float] = []
    directions: list[tuple[float, str, int, np.ndarray]] = []
    geometry = snapshot.geometry
    for row in rows:
        start = int(geometry.coordinate_offsets[row])
        end = int(geometry.coordinate_offsets[row + 1])
        points = geometry.coordinates[start:end, :2]
        for ordinal, (left, right) in enumerate(zip(points, points[1:])):
            vector = np.asarray(right - left, dtype=np.float64)
            length = float(np.linalg.norm(vector))
            if length <= 0.0:
                continue
            lengths.append(length)
            directions.append(
                (length, str(geometry.occurrence_ids[row]), ordinal, vector / length)
            )
    return lengths, directions


def _text_heights(snapshot: DrawingSnapshot, text_ids: tuple[str, ...]) -> list[float]:
    if not text_ids or len(snapshot.annotations) == 0:
        return []
    allowed = set(text_ids)
    heights: list[float] = []
    for index, occurrence_id in enumerate(snapshot.annotations.occurrence_ids):
        if str(occurrence_id) not in allowed:
            continue
        min_x, min_y, max_x, max_y = snapshot.annotations.text_bounds[index]
        if np.isfinite((min_x, min_y, max_x, max_y)).all() and max_y > min_y:
            heights.append(float(max_y - min_y))
    return heights


def derive_local_frame(
    snapshot: DrawingSnapshot,
    occurrence_ids: tuple[str, ...],
    text_occurrence_ids: tuple[str, ...],
    bounds: tuple[float, float, float, float],
) -> PatternLocalFrame:
    rows = np.flatnonzero(_row_mask(snapshot, occurrence_ids))
    lengths, directions = _segment_facts(snapshot, rows)
    heights = _text_heights(snapshot, text_occurrence_ids)
    scale_values: list[float] = []
    sources: list[str] = []
    if lengths:
        scale_values.append(float(np.median(np.asarray(lengths, dtype=np.float64))))
        sources.append("segment_length_median")
    if heights:
        scale_values.append(float(np.median(np.asarray(heights, dtype=np.float64))))
        sources.append("text_height_median")
    if scale_values:
        scale = float(np.median(np.asarray(scale_values, dtype=np.float64)))
    else:
        span_x = max(0.0, bounds[2] - bounds[0])
        span_y = max(0.0, bounds[3] - bounds[1])
        positive = tuple(value for value in (span_x, span_y) if value > 0.0)
        scale = min(positive) if positive else snapshot.coordinate_frame.grid_size
        sources.append("scope_extent" if positive else "precision_grid")
    scale = max(scale, snapshot.coordinate_frame.grid_size)

    if directions:
        _, _, _, axis = min(
            directions,
            key=lambda item: (-item[0], item[1], item[2]),
        )
        axis_x = (float(axis[0]), float(axis[1]))
        if axis_x[0] < 0.0 or (axis_x[0] == 0.0 and axis_x[1] < 0.0):
            axis_x = (-axis_x[0], -axis_x[1])
    else:
        axis_x = (1.0, 0.0)
    axis_y = (-axis_x[1], axis_x[0])
    origin = ((bounds[0] + bounds[2]) / 2.0, (bounds[1] + bounds[3]) / 2.0)
    return PatternLocalFrame(
        origin=origin,
        axis_x=axis_x,
        axis_y=axis_y,
        scale=scale,
        scale_sources=tuple(sources),
    )


def _make_scope(
    snapshot: DrawingSnapshot,
    scope_type: ScopeType,
    parent_scope_id: str | None,
    occurrence_ids: tuple[str, ...],
    text_ids: tuple[str, ...],
    bounds: tuple[float, float, float, float],
    *,
    source_ref: str | None = None,
) -> PatternScope:
    return PatternScope.create(
        snapshot_id=snapshot.snapshot_id,
        scope_type=scope_type,
        parent_scope_id=parent_scope_id,
        occurrence_ids=occurrence_ids,
        text_occurrence_ids=text_ids,
        bounds=bounds,
        local_frame=derive_local_frame(snapshot, occurrence_ids, text_ids, bounds),
        source_ref=source_ref,
    )


def _layout_by_occurrence(snapshot: DrawingSnapshot) -> dict[str, str]:
    return {
        str(occurrence_id): str(layout_name)
        for occurrence_id, layout_name in zip(
            snapshot.occurrences.occurrence_ids,
            snapshot.occurrences.layout_names,
        )
    }


def _spatial_groups(
    snapshot: DrawingSnapshot,
    occurrence_ids: tuple[str, ...],
    gap: float,
) -> tuple[tuple[str, ...], ...]:
    if not occurrence_ids:
        return ()
    positions = snapshot.geometry.positions(occurrence_ids)
    boxes = snapshot.geometry.bounds[positions]
    order = np.lexsort((snapshot.geometry.occurrence_ids[positions], boxes[:, 0]))
    disjoint = _DisjointSet(len(positions))
    active: list[int] = []
    for ordered_index in order:
        index = int(ordered_index)
        min_x, min_y, max_x, max_y = boxes[index]
        active = [other for other in active if boxes[other, 2] + gap >= min_x - gap]
        for other in active:
            other_min_x, other_min_y, other_max_x, other_max_y = boxes[other]
            overlaps = not (
                max_x + gap < other_min_x - gap
                or other_max_x + gap < min_x - gap
                or max_y + gap < other_min_y - gap
                or other_max_y + gap < min_y - gap
            )
            if overlaps:
                disjoint.union(index, other)
        active.append(index)
    groups: dict[int, list[str]] = {}
    for index, occurrence_id in enumerate(occurrence_ids):
        groups.setdefault(disjoint.find(index), []).append(occurrence_id)
    return tuple(
        sorted(
            (tuple(sorted(values)) for values in groups.values()),
            key=lambda values: (values[0], len(values)),
        )
    )


def _face_occurrence_ids(
    topology: TopologyCompilation,
    face_id: str,
) -> tuple[str, ...]:
    dcel = topology.dcel
    arrangement = topology.arrangement
    face = next(item for item in dcel.faces if item.face_id == face_id)
    ring_by_id = {ring.ring_id: ring for ring in dcel.rings}
    values: set[str] = set()
    for ring_id in (face.outer_ring_id, *face.hole_ring_ids):
        for half_edge in ring_by_id[ring_id].half_edges:
            edge_index = int(dcel.half_edge_edges[half_edge])
            start = int(arrangement.support_offsets[edge_index])
            end = int(arrangement.support_offsets[edge_index + 1])
            values.update(
                str(item) for item in arrangement.support_occurrence_ids[start:end]
            )
    return tuple(sorted(values))


def _best_parent(
    occurrence_ids: tuple[str, ...],
    preferred: Iterable[PatternScope],
    fallback: PatternScope,
) -> PatternScope:
    members = set(occurrence_ids)
    choices = [
        scope for scope in preferred if members.issubset(set(scope.occurrence_ids))
    ]
    if not choices:
        return fallback
    return min(choices, key=lambda item: (len(item.occurrence_ids), item.scope_id))


def build_scopes(
    snapshot: DrawingSnapshot,
    topology: TopologyCompilation,
    profile: PatternToleranceProfile,
) -> ScopeTree:
    """Build the deterministic five-level fact scope tree."""

    geometry_ids = tuple(str(item) for item in snapshot.geometry.occurrence_ids)
    text_ids = tuple(str(item) for item in snapshot.texts.occurrence_ids)
    drawing = _make_scope(
        snapshot,
        ScopeType.DRAWING,
        None,
        geometry_ids,
        text_ids,
        snapshot.coordinate_frame.bounds,
        source_ref=snapshot.snapshot_id,
    )
    scopes: list[PatternScope] = [drawing]
    occurrence_layout = _layout_by_occurrence(snapshot)
    layout_names = sorted(
        set(occurrence_layout.values())
        | {str(value) for value in snapshot.texts.layout_name}
    )
    layouts: list[PatternScope] = []
    for layout_name in layout_names:
        layout_occurrences = tuple(
            occurrence_id
            for occurrence_id in geometry_ids
            if occurrence_layout.get(occurrence_id, "") == layout_name
        )
        layout_text = tuple(
            str(snapshot.texts.occurrence_ids[index])
            for index in range(len(snapshot.texts))
            if str(snapshot.texts.layout_name[index]) == layout_name
        )
        rows = np.flatnonzero(_row_mask(snapshot, layout_occurrences))
        bounds = _bounds_for_rows(snapshot, rows)
        scope = _make_scope(
            snapshot,
            ScopeType.LAYOUT,
            drawing.scope_id,
            layout_occurrences,
            tuple(sorted(layout_text)),
            bounds,
            source_ref=layout_name,
        )
        layouts.append(scope)
        scopes.append(scope)
    if not layouts:
        layouts.append(drawing)

    spatial_scopes: list[PatternScope] = []
    for layout in layouts:
        if layout.scope_type is ScopeType.DRAWING:
            layout_occurrences = geometry_ids
            layout_text_ids = set(text_ids)
        else:
            layout_occurrences = layout.occurrence_ids
            layout_text_ids = set(layout.text_occurrence_ids)
        gap = profile.scope_cluster_gap_ratio * layout.local_frame.scale
        for group in _spatial_groups(snapshot, layout_occurrences, gap):
            rows = snapshot.geometry.positions(group)
            bounds = _bounds_for_rows(snapshot, rows)
            group_text = _text_ids_in_bounds(snapshot, bounds, layout_text_ids)
            scope = _make_scope(
                snapshot,
                ScopeType.SPATIAL_CLUSTER,
                layout.scope_id,
                group,
                group_text,
                bounds,
            )
            spatial_scopes.append(scope)
            scopes.append(scope)

    graph = topology.incidence_graph.to_networkx()
    component_scopes: list[PatternScope] = []
    node_position = {
        str(node_id): index for index, node_id in enumerate(topology.incidence_graph.node_ids)
    }
    for component in sorted(
        (tuple(sorted(str(node) for node in value)) for value in nx.connected_components(graph)),
        key=lambda value: (value[0] if value else "", len(value)),
    ):
        indices = np.asarray([node_position[node] for node in component], dtype=np.int64)
        member_mask = np.isin(topology.incidence_graph.edge_node_indices[:, 0], indices) & np.isin(
            topology.incidence_graph.edge_node_indices[:, 1], indices
        )
        geometry_rows = topology.incidence_graph.edge_geometry_rows[member_mask]
        occurrences = tuple(
            sorted(
                set(
                    str(value)
                    for value in snapshot.geometry.occurrence_ids[geometry_rows]
                )
            )
        )
        if not occurrences:
            continue
        fallback = next(
            (
                layout
                for layout in layouts
                if set(occurrences).issubset(set(layout.occurrence_ids))
            ),
            drawing,
        )
        parent = _best_parent(occurrences, spatial_scopes, fallback)
        bounds = _bounds_for_rows(snapshot, geometry_rows)
        component_text = _text_ids_in_bounds(snapshot, bounds)
        scope = _make_scope(
            snapshot,
            ScopeType.CONNECTED_COMPONENT,
            parent.scope_id,
            occurrences,
            component_text,
            bounds,
            source_ref=component[0] if component else None,
        )
        component_scopes.append(scope)
        scopes.append(scope)

    for face in topology.dcel.faces:
        grid_polygon = face_polygon(topology.arrangement, topology.dcel, face)
        if grid_polygon is None:
            continue
        polygon = shapely.transform(grid_polygon, snapshot.coordinate_frame.dequantize)
        bounds = tuple(float(value) for value in shapely.bounds(polygon))
        occurrences = _face_occurrence_ids(topology, face.face_id)
        fallback = _best_parent(occurrences, spatial_scopes, drawing)
        parent = _best_parent(occurrences, component_scopes, fallback)
        text_members: list[str] = []
        for index, point in enumerate(snapshot.texts.points[:, :2]):
            if bool(shapely.covers(polygon, shapely.Point(float(point[0]), float(point[1])))):
                text_members.append(str(snapshot.texts.occurrence_ids[index]))
        scopes.append(
            _make_scope(
                snapshot,
                ScopeType.ENCLOSURE,
                parent.scope_id,
                occurrences,
                tuple(sorted(text_members)),
                bounds,
                source_ref=face.face_id,
            )
        )

    ordered = tuple(sorted(scopes, key=lambda item: item.scope_id))
    return ScopeTree(ordered)
