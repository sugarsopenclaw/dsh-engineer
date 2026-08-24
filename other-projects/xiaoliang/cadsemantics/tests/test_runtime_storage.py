from __future__ import annotations

from collections import Counter
from pathlib import Path

from cadkernel.contracts import stable_json_loads
from cadkernel.indexes import SnapshotStore
from cadpatterns.storage import PatternStore

from cadsemantics.agentview import (
    export_text_tree,
    semantic_evidence_packet,
    similar_representations,
)
from cadsemantics.cli.main import main as cli_main
from cadsemantics.contracts import (
    EvidenceBundle,
    EvidenceGrade,
    IdentityAssertion,
    IdentityEdgeType,
    RepresentationMode,
    SemanticStatus,
)
from cadsemantics.evaluation import deterministic_reproduction, evidence_and_leakage_gate
from cadsemantics.identity import resolve_identity
from cadsemantics.inference import SemanticInferenceResult
from cadsemantics.runtime import SemanticRuntime
from cadsemantics.storage import SemanticStore


class _RecordingBackend:
    backend_version = "recording:1.0.0"

    def __init__(self) -> None:
        self.packets = []

    def classify_object(self, packet):
        self.packets.append(packet)
        return SemanticInferenceResult(
            class_assertions=packet.existing_class_assertions,
        )

    def extract_properties(self, packet):
        return SemanticInferenceResult(abstention_reason="not requested")

    def resolve_relation(self, packet):
        return SemanticInferenceResult(abstention_reason="not requested")

    def interpret_context(self, packet):
        return SemanticInferenceResult(abstention_reason="not requested")


def _repeated_signature_source(bundle):
    counts = Counter(
        item.geometry_signature
        for item in bundle.drawing_graph.representations
        if item.geometry_signature is not None
    )
    signature, count = min(
        counts.items(),
        key=lambda item: (-item[1], item[0]),
    )
    assert count >= 3
    return next(
        item
        for item in bundle.drawing_graph.representations
        if item.geometry_signature == signature
    )


def test_full_pipeline_is_deterministic_evidenced_and_domain_neutral(semantic_sources) -> None:
    snapshot, pattern_graph, snapshot_path, pattern_path = semantic_sources
    runtime = SemanticRuntime()
    first = runtime.build(
        snapshot,
        pattern_graph,
        snapshot_path=snapshot_path,
        pattern_path=pattern_path,
    )
    second = runtime.build(
        snapshot,
        pattern_graph,
        snapshot_path=snapshot_path,
        pattern_path=pattern_path,
    )
    assert first.bundle.to_json() == second.bundle.to_json()
    assert first.drawing_graph.representations
    assert first.coverage.evidence_coverage == 1.0
    assert first.coverage.domain_leakage_rate == 0.0
    assert evidence_and_leakage_gate(first.bundle)
    assert SnapshotStore.verify(snapshot_path) == ()
    assert PatternStore.verify(pattern_path, snapshot_path=snapshot_path) == ()
    assert all(
        assertion.evidence.all_refs
        for representation in first.drawing_graph.representations
        for assertion in representation.class_assertions
    )
    assert any(
        item.representation_mode is RepresentationMode.LEGEND_SYMBOL
        for item in first.drawing_graph.representations
    )
    assert any(
        item.representation_mode is RepresentationMode.SCHEDULE_RECORD
        for item in first.drawing_graph.representations
    )
    assert all(item.relation_type.startswith("core.") for item in first.drawing_graph.relations)
    modes_by_id = {
        item.resolution_id: item.representation_mode
        for item in first.drawing_graph.representations
    }
    assert all(
        modes_by_id[representation_id] is not RepresentationMode.LEGEND_SYMBOL
        for item in first.project_graph.project_objects
        for representation_id in item.representation_ids
    )
    project_node_ids = {
        item.project_object_id for item in first.project_graph.project_objects
    } | {item.object_type_id for item in first.project_graph.object_types}
    assert all(
        relation.source_id in project_node_ids and relation.target_id in project_node_ids
        for relation in first.project_graph.relations
    )
    assert all(
        member_id in project_node_ids
        for system in first.project_graph.systems
        for member_id in system.member_ids
    )


def test_semantic_store_round_trip_and_agent_view(semantic_sources, tmp_path: Path) -> None:
    snapshot, pattern_graph, snapshot_path, pattern_path = semantic_sources
    result = SemanticRuntime().build(snapshot, pattern_graph)
    location = SemanticStore.create(
        tmp_path / "semantic-output",
        result.bundle,
        snapshot_path=snapshot_path,
        pattern_path=pattern_path,
    )
    loaded = SemanticStore.load(location.path)
    assert loaded.to_json() == result.bundle.to_json()
    assert SemanticStore.verify(location.path, snapshot_path=snapshot_path, pattern_path=pattern_path) == ()
    values = SemanticStore.query(location.path, status=SemanticStatus.SUPPORTED)
    assert values
    representation = loaded.drawing_graph.representations[0]
    packet = semantic_evidence_packet(loaded, representation.resolution_id)
    assert packet["evidence_refs"]
    signature_source = _repeated_signature_source(loaded)
    similar = similar_representations(loaded, signature_source.resolution_id)
    assert len({item["representation_key"] for item in similar}) >= 3
    assert all(item["bounds"] is not None for item in similar)
    export_root = export_text_tree(loaded, tmp_path / "agentview")
    assert (export_root / "index.txt").is_file()
    assert (export_root / "unexplained-patterns.txt").is_file()
    second = SemanticStore.create(
        tmp_path / "second-semantic-output",
        result.bundle,
        snapshot_path=snapshot_path,
        pattern_path=pattern_path,
    )
    assert location.file_sha256 == second.file_sha256


def test_determinism_metric_runs_two_byte_equal_builds(semantic_sources) -> None:
    snapshot, pattern_graph, _, _ = semantic_sources
    runtime = SemanticRuntime()
    metric = deterministic_reproduction(
        lambda: runtime.build(snapshot, pattern_graph).bundle
    )
    assert metric.reproducible
    assert len(set(metric.graph_ids)) == 1


def test_runtime_invokes_inference_through_evidence_packets(semantic_sources) -> None:
    snapshot, pattern_graph, _, _ = semantic_sources
    backend = _RecordingBackend()
    result = SemanticRuntime(backend=backend).build(snapshot, pattern_graph)
    assert backend.packets
    assert any(packet.associated_text for packet in backend.packets)
    assert all(packet.class_candidates for packet in backend.packets)
    assert all(
        item.backend_version == backend.backend_version
        for item in result.drawing_graph.representations
    )


def test_negative_identity_evidence_blocks_transitive_false_merge(
    semantic_sources,
) -> None:
    snapshot, pattern_graph, _, _ = semantic_sources
    representations = SemanticRuntime().build(
        snapshot,
        pattern_graph,
    ).drawing_graph.representations
    groups = {}
    for item in representations:
        if item.semantic_class is None or item.geometry_signature is None:
            continue
        key = (
            item.semantic_class,
            item.representation_mode,
            item.geometry_signature,
        )
        groups.setdefault(key, []).append(item)
    selected = tuple(
        sorted(
            max(groups.values(), key=len),
            key=lambda item: item.resolution_id,
        )[:3]
    )
    assert len(selected) == 3

    def evidence(left, right):
        return EvidenceBundle.create(
            supporting=tuple(
                ref
                for representation in (left, right)
                for assertion in representation.class_assertions
                for ref in assertion.evidence.all_refs
            )
        )

    left, middle, right = selected
    assertions = (
        IdentityAssertion.create(
            source_representation_id=left.resolution_id,
            target_representation_id=middle.resolution_id,
            edge_type=IdentityEdgeType.SAME_OBJECT_SUPPORTED,
            status=SemanticStatus.SUPPORTED,
            evidence_grade=EvidenceGrade.MULTI_EVIDENCE_SUPPORTED,
            evidence=evidence(left, middle),
        ),
        IdentityAssertion.create(
            source_representation_id=middle.resolution_id,
            target_representation_id=right.resolution_id,
            edge_type=IdentityEdgeType.SAME_OBJECT_SUPPORTED,
            status=SemanticStatus.SUPPORTED,
            evidence_grade=EvidenceGrade.MULTI_EVIDENCE_SUPPORTED,
            evidence=evidence(middle, right),
        ),
        IdentityAssertion.create(
            source_representation_id=left.resolution_id,
            target_representation_id=right.resolution_id,
            edge_type=IdentityEdgeType.DIFFERENT_OBJECT_PROVEN,
            status=SemanticStatus.SUPPORTED,
            evidence_grade=EvidenceGrade.DETERMINISTIC_RULE_DERIVED,
            evidence=evidence(left, right),
        ),
    )
    identity = resolve_identity(selected, assertions, pattern_graph)
    assert not any(
        {left.resolution_id, right.resolution_id}.issubset(cluster.representation_ids)
        for cluster in identity.clusters
    )


def test_cli_build_query_report_packet_and_export(semantic_sources, tmp_path: Path, capsys) -> None:
    _, _, snapshot_path, pattern_path = semantic_sources
    output = tmp_path / "cli-output"
    assert cli_main(["build", str(snapshot_path), str(pattern_path), "--output", str(output)]) == 0
    built = stable_json_loads(capsys.readouterr().out)
    store_path = built["path"]
    assert cli_main(["query", store_path, "--status", "supported"]) == 0
    queried = stable_json_loads(capsys.readouterr().out)
    assert queried
    assert cli_main(["report", store_path]) == 0
    report = stable_json_loads(capsys.readouterr().out)
    assert report["evidence_coverage"] == 1.0
    representation_id = queried[0]["resolution_id"]
    assert cli_main(["packet", store_path, "--representation", representation_id]) == 0
    packet = stable_json_loads(capsys.readouterr().out)
    assert packet["representation_id"] == representation_id
    signature_id = _repeated_signature_source(
        SemanticStore.load(store_path)
    ).resolution_id
    assert cli_main(["similar", store_path, "--representation", signature_id]) == 0
    similar = stable_json_loads(capsys.readouterr().out)
    assert len(similar) >= 3
    assert cli_main(["export", store_path, "--out", str(tmp_path / "export")]) == 0
    assert stable_json_loads(capsys.readouterr().out)["path"]
