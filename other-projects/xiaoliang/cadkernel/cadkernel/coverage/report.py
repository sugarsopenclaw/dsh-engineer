from __future__ import annotations

import ctypes
import os
import sqlite3
import time
from collections import Counter, defaultdict
from ctypes import wintypes
from pathlib import Path

import numpy as np
import shapely

from cadkernel._ids import stable_id
from cadkernel.adapters.conformance import compare_mlight_index
from cadkernel.adapters.dxf import ConversionProvenance, DxfAdapter
from cadkernel.contracts import Decision, PrecisionModel, ToleranceProfile
from cadkernel.coverage.models import (
    AnnotationFacts,
    AreaDistribution,
    CapabilityReport,
    CoverageDiagnostic,
    DrawingCoverageReport,
    DuplicateFacts,
    FaceFacts,
    GeometryDuplicateGroup,
    ReportScale,
    RepeatedDefinition,
    StageTiming,
    TextFacts,
)
from cadkernel.indexes import SnapshotStore
from cadkernel.ir import DrawingSnapshot
from cadkernel.topology import (
    TopologyCompilation,
    compile_topology,
    make_topology_payload,
)


def _peak_working_set_bytes() -> int:
    """Return the process peak without instrumenting every Python allocation.

    ``tracemalloc`` changes this NumPy/GEOS-heavy build by several multiples, so
    the report uses the same OS-level acceptance measure as the performance gate.
    A zero result means that the host does not expose a supported process counter.
    """

    if os.name != "nt":
        try:
            import resource

            value = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
            return value * (1024 if value < 10**10 else 1)
        except (ImportError, OSError):
            return 0
    try:
        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        get_current_process = ctypes.windll.kernel32.GetCurrentProcess
        get_current_process.restype = wintypes.HANDLE
        get_process_memory_info = ctypes.windll.psapi.GetProcessMemoryInfo
        get_process_memory_info.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(ProcessMemoryCounters),
            wintypes.DWORD,
        ]
        get_process_memory_info.restype = wintypes.BOOL
        if not get_process_memory_info(
            get_current_process(), ctypes.byref(counters), counters.cb
        ):
            return 0
        return int(counters.PeakWorkingSetSize)
    except (AttributeError, OSError):
        return 0


def _coverage(
    adapter_result,
    compilation: TopologyCompilation,
) -> DrawingCoverageReport:
    snapshot = adapter_result.snapshot
    statistics = adapter_result.statistics
    # Coverage is measured against authored definitions, not expanded occurrence
    # rows. Only a definition with a persisted normalized row is "indexed" —
    # either a geometry row or an annotation-fact row; supported text
    # contributes its insertion-point geometry, while bare INSERT/unsupported
    # occurrences must not inflate this numerator.
    indexed_definitions = len(
        set(str(item) for item in snapshot.geometry.definition_ids)
        | set(str(item) for item in snapshot.annotations.definition_ids)
    )
    topology_definitions = len(
        set(
            str(item)
            for item in snapshot.geometry.definition_ids[
                snapshot.geometry.topology_eligible
                & ~snapshot.geometry.annotation_derived
            ]
        )
    )
    diagnostics: list[CoverageDiagnostic] = []
    for entity_type, count in statistics.unsupported_by_type:
        diagnostics.append(
            CoverageDiagnostic(
                code="UNSUPPORTED_ENTITY_TYPE",
                severity="warning",
                message=f"{count} authored {entity_type} entities are preserved but not geometrically normalized in M1.",
                entity_type=entity_type,
                count=count,
                required_action="conversion_or_future_operator",
            )
        )
    if statistics.transform_failures:
        diagnostics.append(
            CoverageDiagnostic(
                code="TRANSFORM_FAILURES",
                severity="error",
                message=f"{len(statistics.transform_failures)} block transforms could not be fully expanded.",
                count=len(statistics.transform_failures),
                required_action="inspect_source_or_convert_with_autocad",
            )
        )
    if snapshot.unit_status in {"unknown", "unitless", "insunits:0"}:
        diagnostics.append(
            CoverageDiagnostic(
                code="DRAWING_UNITS_UNRESOLVED",
                severity="warning",
                message="Drawing units are unitless or unresolved; numeric geometry remains valid but physical-unit claims do not.",
                required_action="supply_unit_assumption",
            )
        )
    for diagnostic in adapter_result.diagnostics:
        diagnostics.append(
            CoverageDiagnostic(
                code=diagnostic.code,
                severity=diagnostic.severity.value,
                message=diagnostic.message,
            )
        )
    for diagnostic in compilation.diagnostics:
        diagnostics.append(
            CoverageDiagnostic(
                code=diagnostic.code,
                severity=diagnostic.severity.value,
                message=diagnostic.message,
                required_action=(
                    "inspect_topology_stage"
                    if compilation.decision is not Decision.COMPUTED
                    else None
                ),
            )
        )
    execution_status = "complete"
    if (
        statistics.unsupported_by_type
        or statistics.transform_failures
        or compilation.decision is not Decision.COMPUTED
    ):
        execution_status = "partial"
    total = statistics.total_source_entities
    ratio = lambda value: 1.0 if total == 0 else value / total
    return DrawingCoverageReport(
        execution_status=execution_status,
        total_source_entities=statistics.total_source_entities,
        parsed=statistics.parsed_source_entities,
        geometry_supported=statistics.geometry_supported_source_entities,
        indexed=indexed_definitions,
        topology_eligible=topology_definitions,
        unsupported_by_type=statistics.unsupported_by_type,
        unit_status=snapshot.unit_status,
        transform_failures=statistics.transform_failures,
        approximation_count=statistics.approximation_count,
        diagnostics=tuple(sorted(diagnostics, key=lambda item: (item.code, item.entity_type or ""))),
        parsed_ratio=ratio(statistics.parsed_source_entities),
        geometry_supported_ratio=ratio(statistics.geometry_supported_source_entities),
        indexed_ratio=ratio(indexed_definitions),
        topology_eligible_ratio=ratio(topology_definitions),
    )


def _face_facts(
    snapshot: DrawingSnapshot,
    compilation: TopologyCompilation,
) -> FaceFacts:
    dcel = compilation.dcel
    area_scale = snapshot.coordinate_frame.grid_size**2
    areas = np.asarray([face.area_grid * area_scale for face in dcel.faces], dtype=np.float64)
    if len(areas):
        distribution = AreaDistribution(
            count=len(areas),
            minimum=float(areas.min()),
            median=float(np.median(areas)),
            maximum=float(areas.max()),
            total=float(areas.sum()),
            unit=f"{snapshot.unit_status}^2",
        )
    else:
        distribution = AreaDistribution(0, None, None, None, 0.0, f"{snapshot.unit_status}^2")
    return FaceFacts(
        closed_face_count=len(dcel.faces),
        faces_with_holes=sum(bool(face.hole_ring_ids) for face in dcel.faces),
        hole_count=sum(len(face.hole_ring_ids) for face in dcel.faces),
        containment_max_depth=max((face.depth for face in dcel.faces), default=0),
        area_distribution=distribution,
        dcel_valid=dcel.validation.valid,
        euler_left=dcel.validation.euler_left,
        euler_right=dcel.validation.euler_right,
        validation_diagnostics=dcel.validation.diagnostics,
        compilation_decision=compilation.decision.value,
        compilation_diagnostics=compilation.diagnostics,
    )


def _geometry_objects(snapshot: DrawingSnapshot) -> np.ndarray:
    geometry = snapshot.geometry
    counts = np.diff(geometry.coordinate_offsets)
    line_rows = np.flatnonzero(geometry.topology_eligible & (counts >= 2))
    objects = np.empty(len(line_rows), dtype=object)
    if len(line_rows):
        coordinate_owners = np.repeat(np.arange(len(geometry), dtype=np.int64), counts)
        eligible = np.zeros(len(geometry), dtype=np.bool_)
        eligible[line_rows] = True
        selected = eligible[coordinate_owners]
        row_to_line = np.full(len(geometry), -1, dtype=np.int64)
        row_to_line[line_rows] = np.arange(len(line_rows), dtype=np.int64)
        lines = shapely.linestrings(
            geometry.coordinates[selected, :2],
            indices=row_to_line[coordinate_owners[selected]],
        )
        objects[:] = lines
    return objects


def _text_facts(snapshot_path: Path, snapshot: DrawingSnapshot) -> TextFacts:
    del snapshot_path
    # fts5vocab follows the schema of its source table. Build the vocabulary in
    # memory so a report never mutates the immutable on-disk snapshot.
    connection = sqlite3.connect(":memory:")
    try:
        connection.execute(
            "CREATE VIRTUAL TABLE report_fts USING fts5(raw_text,normalized_text,plain_text,"
            "block_attribute_tag,block_attribute_value,layer_name,block_name,layout_name,drawing_title,"
            "tokenize='unicode61 remove_diacritics 2')"
        )
        connection.executemany(
            "INSERT INTO report_fts VALUES (?,?,?,?,?,?,?,?,?)",
            zip(
                snapshot.texts.raw_text,
                snapshot.texts.normalized_text,
                snapshot.texts.plain_text,
                snapshot.texts.block_attribute_tag,
                snapshot.texts.block_attribute_value,
                snapshot.texts.layer_name,
                snapshot.texts.block_name,
                snapshot.texts.layout_name,
                snapshot.texts.drawing_title,
            ),
        )
        connection.execute("CREATE VIRTUAL TABLE fts_vocab USING fts5vocab(report_fts, 'row')")
        term_count = int(connection.execute("SELECT count(*) FROM fts_vocab").fetchone()[0])
    finally:
        connection.close()
    attribute_count = int(
        np.count_nonzero(
            (snapshot.texts.block_attribute_tag != "")
            | (snapshot.texts.block_attribute_value != "")
        )
    )
    buckets = Counter({"coincident": 0, "near": 0, "local": 0, "far": 0, "no_geometry": 0})
    if len(snapshot.texts) == 0:
        pass
    elif not np.any(snapshot.geometry.topology_eligible):
        buckets["no_geometry"] = len(snapshot.texts)
    else:
        objects = _geometry_objects(snapshot)
        tree = shapely.STRtree(objects)
        points = shapely.points(snapshot.texts.points[:, :2])
        _, distances = tree.query_nearest(points, all_matches=False, return_distance=True)
        tolerance = ToleranceProfile.from_json(snapshot.tolerance_profile_json)
        for distance in distances:
            value = float(distance)
            if value <= tolerance.numeric_equality:
                buckets["coincident"] += 1
            elif value <= tolerance.endpoint_snap:
                buckets["near"] += 1
            elif value <= max(1.0, tolerance.endpoint_snap * 100):
                buckets["local"] += 1
            else:
                buckets["far"] += 1
    return TextFacts(
        text_record_count=len(snapshot.texts),
        fts_term_count=term_count,
        block_attribute_record_count=attribute_count,
        block_attribute_coverage=(attribute_count / len(snapshot.texts) if len(snapshot.texts) else 0.0),
        nearest_geometry_distance_buckets=tuple(sorted(buckets.items())),
    )


def _annotation_facts(adapter_result) -> AnnotationFacts:
    snapshot = adapter_result.snapshot
    annotations = snapshot.annotations
    dimension_rows = np.flatnonzero(annotations.source_types == "DIMENSION")
    measured_definition_ids = set(
        str(annotations.definition_ids[row])
        for row in dimension_rows
        if annotations.measured_value_present[row]
    )
    diagnostic_definition_ids: set[str] = set()
    for row in dimension_rows:
        if annotations.measured_value_present[row]:
            continue
        start = int(annotations.diagnostic_offsets[row])
        end = int(annotations.diagnostic_offsets[row + 1])
        if end > start:
            diagnostic_definition_ids.add(str(annotations.definition_ids[row]))
    for diagnostic in adapter_result.diagnostics:
        if diagnostic.code != "DIMENSION_DEFINITION_WITHOUT_OCCURRENCE":
            continue
        details = dict(diagnostic.details)
        definition_id = details.get("definition_id")
        if definition_id:
            diagnostic_definition_ids.add(definition_id)
    diagnostic_definition_ids -= measured_definition_ids
    source_counts = dict(adapter_result.statistics.source_counts_by_type)
    return AnnotationFacts(
        annotation_record_count=len(annotations),
        source_dimension_count=int(source_counts.get("DIMENSION", 0)),
        dimension_record_count=len(dimension_rows),
        dimension_measured_count=len(measured_definition_ids),
        dimension_diagnostic_count=len(diagnostic_definition_ids),
        dimension_fact_coverage=len(
            measured_definition_ids | diagnostic_definition_ids
        ),
        text_override_count=int(np.count_nonzero(annotations.text_override_present)),
        target_ref_count=int(annotations.target_ref_offsets[-1]),
        annotation_derived_geometry_count=int(
            np.count_nonzero(snapshot.geometry.annotation_derived)
        ),
    )


def _duplicate_facts(
    snapshot: DrawingSnapshot,
    *,
    detail_limit: int = 1_000,
) -> DuplicateFacts:
    definition_counts = Counter(str(item) for item in snapshot.occurrences.definition_ids)
    all_repeated = tuple(
        RepeatedDefinition(definition_id, count)
        for definition_id, count in sorted(definition_counts.items())
        if count > 1
    )
    signatures: dict[str, list[str]] = defaultdict(list)
    geometry = snapshot.geometry
    for row in range(len(geometry)):
        start = int(geometry.coordinate_offsets[row])
        end = int(geometry.coordinate_offsets[row + 1])
        coordinates = geometry.grid_coordinates[start:end]
        relative = coordinates - coordinates[0]
        signature = stable_id(
            "geometry-signature-v1",
            int(geometry.kinds[row]),
            bool(geometry.closed[row]),
            relative,
            length=64,
        )
        signatures[signature].append(str(geometry.occurrence_ids[row]))
    all_groups = tuple(
        GeometryDuplicateGroup(signature, tuple(sorted(occurrence_ids)))
        for signature, occurrence_ids in sorted(signatures.items())
        if len(occurrence_ids) > 1
    )
    return DuplicateFacts(
        repeated_definitions=all_repeated[:detail_limit],
        geometry_candidate_groups=all_groups[:detail_limit],
        repeated_definition_count=len(all_repeated),
        geometry_candidate_group_count=len(all_groups),
        details_truncated=(
            len(all_repeated) > detail_limit or len(all_groups) > detail_limit
        ),
    )


def build_capability_report(
    drawing: str | Path,
    snapshot_root: str | Path,
    *,
    tolerance: ToleranceProfile | None = None,
    precision: PrecisionModel | None = None,
    conversion_provenance: ConversionProvenance | None = None,
    logical_source_path: str | Path | None = None,
    mlight_index: str | Path | None = None,
) -> CapabilityReport:
    drawing_path = Path(drawing)
    if drawing_path.suffix.casefold() != ".dxf":
        raise ValueError("build_capability_report requires DXF input; convert DWG explicitly")
    tolerance = tolerance or ToleranceProfile()
    precision = precision or PrecisionModel()
    timings: list[StageTiming] = []
    started = time.perf_counter()
    adapter_result = DxfAdapter().build(
        drawing_path,
        tolerance=tolerance,
        precision=precision,
        conversion_provenance=conversion_provenance,
        logical_source_path=logical_source_path,
    )
    snapshot = adapter_result.snapshot
    timings.append(StageTiming("adapter", time.perf_counter() - started))

    snapshot_path = Path(snapshot_root) / snapshot.snapshot_id
    compilation = compile_topology(
        snapshot,
        tolerance=tolerance,
        incidence_detail_limit=1_000,
        stage_timing_callback=lambda stage, seconds: timings.append(
            StageTiming(stage, seconds)
        ),
    )
    incidence_facts = compilation.incidence_facts
    arrangement = compilation.arrangement
    dcel = compilation.dcel

    started = time.perf_counter()
    topology_payload = make_topology_payload(snapshot, compilation)
    location = SnapshotStore.create(
        snapshot_path,
        snapshot,
        derived_artifacts=(topology_payload,),
    )
    timings.append(StageTiming("snapshot_indexes", time.perf_counter() - started))

    started = time.perf_counter()
    coverage = _coverage(adapter_result, compilation)
    faces = _face_facts(snapshot, compilation)
    text = _text_facts(snapshot_path, snapshot)
    annotation = _annotation_facts(adapter_result)
    duplicates = _duplicate_facts(snapshot)
    conformance = compare_mlight_index(adapter_result, mlight_index) if mlight_index else None
    timings.append(StageTiming("report_facts", time.perf_counter() - started))
    peak_memory = _peak_working_set_bytes()
    scale = ReportScale(
        definition_count=len(snapshot.definitions),
        occurrence_count=len(snapshot.occurrences),
        geometry_count=len(snapshot.geometry),
        coordinate_count=len(snapshot.geometry.coordinates),
        arrangement_vertex_count=len(arrangement.vertices_grid),
        arrangement_edge_count=len(arrangement.edge_vertices),
        arrangement_support_fragment_count=int(arrangement.support_offsets[-1]),
        arrangement_unsupported_edge_count=int(
            np.count_nonzero(np.diff(arrangement.support_offsets) == 0)
        ),
        snapshot_size_bytes=location.size_bytes,
        peak_memory_bytes=peak_memory,
    )
    return CapabilityReport(
        schema_version=3,
        snapshot_id=snapshot.snapshot_id,
        source_path=snapshot.source_path,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        tolerance_profile_id=snapshot.tolerance_profile_id,
        precision_model_id=snapshot.precision_model_id,
        coverage=coverage,
        topology=incidence_facts,
        faces=faces,
        text=text,
        annotation=annotation,
        duplicates=duplicates,
        scale=scale,
        timings=tuple(timings),
        mlight_conformance=conformance,
    )
