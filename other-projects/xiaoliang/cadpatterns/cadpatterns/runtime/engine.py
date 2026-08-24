from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from cadkernel.indexes import SnapshotStore
from cadkernel.ir import DrawingSnapshot
from cadkernel.topology import TopologyCompilation, load_topology

from cadpatterns import detectors as _builtin_detectors
from cadpatterns.candidates import DetectionBatch, DetectionContext
from cadpatterns.composers import REPEAT_COMPOSER_SPEC, compose_hierarchy
from cadpatterns.contracts import PatternToleranceProfile, TraceEvent, detector_registry
from cadpatterns.features import build_feature_store
from cadpatterns.graph import PatternGraph
from cadpatterns.ontology import PatternSpec, load_specs
from cadpatterns.relations import build_relations
from cadpatterns.resolvers import KNOWN_RESOLVERS, resolve_candidates
from cadpatterns.scopes import build_scopes
from cadpatterns.storage import PatternLocation, PatternStore

del _builtin_detectors


_COMPOSERS = (REPEAT_COMPOSER_SPEC,)


def _validate_spec_set(specs: tuple[PatternSpec, ...]) -> None:
    """Reject spec subsets that cannot run deterministically.

    Producers hard-emit companion pattern types (a path network also emits its
    junctions and terminals; the motif composer emits repeated motif groups),
    so a subset that loads the producer without the companion spec would fail
    deep inside detection. Resolver names must also be known up front.
    """

    seen: set[str] = set()
    for spec in specs:
        if spec.pattern_type in seen:
            raise ValueError(f"Duplicate PatternSpec for {spec.pattern_type!r}")
        seen.add(spec.pattern_type)
        if spec.resolver not in KNOWN_RESOLVERS:
            raise ValueError(
                f"Unknown resolver {spec.resolver!r} declared for "
                f"{spec.pattern_type!r}; known resolvers: {', '.join(KNOWN_RESOLVERS)}"
            )
    loaded = {spec.pattern_type for spec in specs}
    required: dict[str, str] = {}
    for spec in specs:
        for declaration in spec.detectors:
            detector_spec, _ = detector_registry.resolve(declaration.detector_id)
            for emitted in detector_spec.emits:
                required.setdefault(emitted, declaration.detector_id)
    for composer in _COMPOSERS:
        if any(consumed in loaded for consumed in composer.consumes):
            for emitted in composer.emits:
                required.setdefault(emitted, composer.detector_id)
    missing = sorted(set(required) - loaded)
    if missing:
        producers = sorted({required[pattern_type] for pattern_type in missing})
        raise ValueError(
            "PatternSpec set is not closed: "
            + ", ".join(missing)
            + " are emitted by "
            + ", ".join(producers)
            + "; load the companion specs or drop the producing specs"
        )


@dataclass(frozen=True, slots=True)
class PatternBuildResult:
    graph: PatternGraph
    location: PatternLocation | None = None


class PatternRuntime:
    """Execute the 2A–2F pipeline over immutable first-layer facts."""

    def __init__(
        self,
        *,
        specs: Iterable[PatternSpec] | None = None,
        profile: PatternToleranceProfile | None = None,
    ) -> None:
        self.specs = (
            tuple(sorted(specs, key=lambda item: item.pattern_type))
            if specs is not None
            else load_specs()
        )
        _validate_spec_set(self.specs)
        self.profile = profile

    def build(
        self,
        snapshot: DrawingSnapshot,
        topology: TopologyCompilation,
        *,
        snapshot_path: str | Path | None = None,
    ) -> PatternGraph:
        if topology.snap_plan.snapshot_id != snapshot.snapshot_id:
            raise ValueError("TopologyCompilation belongs to another snapshot")
        profile = self.profile or PatternToleranceProfile(
            upstream_tolerance_profile_id=snapshot.tolerance_profile_id
        )
        if profile.upstream_tolerance_profile_id != snapshot.tolerance_profile_id:
            raise ValueError("Pattern tolerance profile references another first-layer profile")
        source_root = None if snapshot_path is None else Path(snapshot_path)
        if source_root is not None:
            errors = SnapshotStore.verify(source_root)
            if errors:
                raise ValueError("Source snapshot integrity failure: " + ", ".join(errors))

        scopes = build_scopes(snapshot, topology, profile)
        features = build_feature_store(snapshot, topology, scopes, self.specs, profile)
        context = DetectionContext(
            snapshot=snapshot,
            topology=topology,
            scopes=scopes,
            features=features,
            specs=self.specs,
            profile=profile,
        )
        batches = []
        for spec in self.specs:
            for declaration in spec.detectors:
                detector_spec, function = detector_registry.resolve(
                    declaration.detector_id
                )
                if detector_spec.version != declaration.version:
                    raise ValueError(
                        f"PatternSpec requests {declaration.detector_id} "
                        f"{declaration.version}, registry provides {detector_spec.version}"
                    )
                if detector_spec.pattern_type != spec.pattern_type:
                    raise ValueError(
                        f"Detector {declaration.detector_id} emits "
                        f"{detector_spec.pattern_type}, not {spec.pattern_type}"
                    )
                batch = function(context)
                if not isinstance(batch, DetectionBatch):
                    raise TypeError(
                        f"Detector {declaration.detector_id} did not return DetectionBatch"
                    )
                batches.append(batch)
        detected = DetectionBatch.combine(batches)
        composed = compose_hierarchy(context, detected.instances, detected.edges)
        relation_edges = build_relations(context, composed.instances, composed.edges)
        resolved = resolve_candidates(context, composed.instances, relation_edges)
        trace = (
            *detected.trace,
            *composed.trace,
            *resolved.trace,
            TraceEvent.create(
                "runtime",
                snapshot.snapshot_id,
                "2A–2F generic pattern pipeline completed",
                (
                    ("edge_count", len(resolved.edges)),
                    ("instance_count", len(resolved.instances)),
                    ("scope_count", len(scopes.scopes)),
                ),
            ),
        )
        graph = PatternGraph.create(
            snapshot_id=snapshot.snapshot_id,
            topology_graph_id=topology.snap_plan.graph_id,
            arrangement_id=topology.arrangement.arrangement_id,
            dcel_id=topology.dcel.dcel_id,
            pattern_tolerance_profile_id=profile.profile_id,
            scopes=scopes.scopes,
            instances=resolved.instances,
            edges=resolved.edges,
            virtual_geometries=detected.virtual_geometries,
            features=features.records(),
            trace=trace,
        )
        if source_root is not None:
            errors = SnapshotStore.verify(source_root)
            if errors:
                raise RuntimeError(
                    "Pattern inference changed immutable source snapshot integrity: "
                    + ", ".join(errors)
                )
        return graph

    def build_and_store(
        self,
        snapshot_path: str | Path,
        output_root: str | Path,
    ) -> PatternBuildResult:
        source_root = Path(snapshot_path)
        snapshot = SnapshotStore.load(source_root)
        loaded = load_topology(source_root, snapshot)
        if loaded.value is None:
            message = "; ".join(item.message for item in loaded.diagnostics)
            raise ValueError("Topology artifact cannot be loaded: " + message)
        graph = self.build(snapshot, loaded.value, snapshot_path=source_root)
        location = PatternStore.create(
            output_root,
            graph,
            snapshot_path=source_root,
        )
        return PatternBuildResult(graph=graph, location=location)
