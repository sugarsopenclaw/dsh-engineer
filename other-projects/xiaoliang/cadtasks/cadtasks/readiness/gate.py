from __future__ import annotations

from cadtasks.binding import ProjectFactBundle
from cadtasks.capabilities import CapabilityRegistry
from cadtasks.contracts import (
    CapabilityGap,
    ClaimReadiness,
    QuantityBasis,
    ReadinessStatus,
    TaskReadinessReport,
    TaskSpec,
    TaskType,
)
from cadtasks.readiness.gaps import cross_file_identity_gap, schedule_row_gap
from cadtasks.recipes import RecipeManifest


def _selected_source_count(spec: TaskSpec, facts: ProjectFactBundle) -> int:
    if not spec.scope.files:
        return len(facts.sources)
    requested = set(spec.scope.files)
    return sum(
        1
        for source in facts.sources
        if requested.intersection(
            {
                source.source.snapshot_id,
                source.source.pattern_graph_id,
                source.source.drawing_semantic_graph_id,
                source.source.project_semantic_graph_id,
                source.source.snapshot_path,
            }
        )
    )


class CapabilityGate:
    version = "1.0.0"

    def evaluate(
        self,
        *,
        spec: TaskSpec,
        facts: ProjectFactBundle,
        recipe: RecipeManifest,
        capabilities: CapabilityRegistry,
    ) -> TaskReadinessReport:
        readiness = []
        gaps: list[CapabilityGap] = []
        graph_refs = tuple(
            source.source.drawing_semantic_graph_id for source in facts.sources
        )
        missing_capabilities = tuple(
            capability_id
            for capability_id in recipe.required_capabilities
            if capability_id not in capabilities
        )
        if missing_capabilities:
            for capability_id in missing_capabilities:
                gaps.append(
                    CapabilityGap.create(
                        capability_id=capability_id,
                        missing=capability_id,
                        reason="The selected recipe requires an unavailable capability.",
                        evidence_refs=graph_refs,
                    )
                )
            readiness.append(
                ClaimReadiness.create(
                    "TASK_RESULT",
                    ReadinessStatus.UNSUPPORTED,
                    missing=missing_capabilities,
                    capability_ids=recipe.required_capabilities,
                )
            )
            return TaskReadinessReport.create(
                task_spec_key=spec.task_spec_key,
                overall_status=ReadinessStatus.UNSUPPORTED,
                claim_readiness=readiness,
                capability_gaps=gaps,
            )

        if spec.task_type in {
            TaskType.LOCATE,
            TaskType.IDENTIFY,
            TaskType.DESCRIBE,
            TaskType.TRACE,
        }:
            self._query_readiness(spec, facts, readiness, gaps, graph_refs)
        elif spec.task_type in {TaskType.COUNT, TaskType.RECONCILE}:
            self._count_readiness(spec, facts, readiness, gaps, graph_refs)
        elif spec.task_type in {TaskType.MEASURE, TaskType.CHECK}:
            self._numeric_readiness(spec, facts, readiness, gaps, graph_refs)
        elif spec.task_type is TaskType.AUDIT:
            readiness.append(
                ClaimReadiness.create(
                    "LABEL_DISTINCTNESS",
                    ReadinessStatus.READY,
                    capability_ids=("semantic.query",),
                )
            )
        else:
            readiness.append(
                ClaimReadiness.create(
                    "TASK_RESULT",
                    ReadinessStatus.UNSUPPORTED,
                    missing=("recipe",),
                )
            )

        statuses = {item.status for item in readiness}
        if statuses == {ReadinessStatus.READY}:
            overall = ReadinessStatus.READY
        elif ReadinessStatus.READY in statuses or ReadinessStatus.PARTIAL in statuses:
            overall = ReadinessStatus.PARTIAL
        elif ReadinessStatus.UNSUPPORTED in statuses:
            overall = ReadinessStatus.UNSUPPORTED
        else:
            overall = ReadinessStatus.INSUFFICIENT_EVIDENCE
        data_gaps = tuple(
            sorted({gap.data_gap for gap in gaps if gap.data_gap is not None})
        )
        return TaskReadinessReport.create(
            task_spec_key=spec.task_spec_key,
            overall_status=overall,
            claim_readiness=readiness,
            capability_gaps=gaps,
            data_gaps=data_gaps,
        )

    @staticmethod
    def _query_readiness(
        spec: TaskSpec,
        facts: ProjectFactBundle,
        readiness: list[ClaimReadiness],
        gaps: list[CapabilityGap],
        graph_refs: tuple[str, ...],
    ) -> None:
        if spec.task_type is TaskType.LOCATE:
            explicit = None
            for name in ("detection_id", "representation_id", "subject_ref"):
                value = spec.target.selector(name)
                if value is not None:
                    explicit = str(value)
                    break
            seed_missing = False
            has_signature = False
            if explicit in facts.detection_index:
                has_signature = (
                    facts.detection_index[explicit].instance.feature(
                        "geometry_signature"
                    )
                    is not None
                )
            elif explicit in facts.resolution_index:
                has_signature = (
                    facts.resolution_index[explicit].representation.geometry_signature
                    is not None
                )
            elif explicit is not None:
                seed_missing = True
            else:
                has_signature = any(
                    bound.representation.geometry_signature is not None
                    for bound in facts.representations(
                        semantic_class=spec.target.semantic_class,
                        supported_only=True,
                    )
                )
            status = (
                ReadinessStatus.READY
                if has_signature
                else ReadinessStatus.INSUFFICIENT_EVIDENCE
            )
            missing = ()
            if not has_signature:
                missing = (
                    ("subject_ref",)
                    if seed_missing
                    else ("pattern.geometry_signature",)
                )
            readiness.append(
                ClaimReadiness.create(
                    "SIMILAR_STRUCTURE_SET",
                    status,
                    missing=missing,
                    capability_ids=("pattern.signature.lookup",),
                )
            )
            if seed_missing:
                gaps.append(
                    CapabilityGap.create(
                        capability_id="semantic.query",
                        missing="subject_ref",
                        reason="The selected seed fact is absent from the bound facts.",
                        claim_type="SIMILAR_STRUCTURE_SET",
                        evidence_refs=graph_refs,
                    )
                )
            elif not has_signature:
                gaps.append(
                    CapabilityGap.create(
                        capability_id="pattern.signature.lookup",
                        missing="pattern.geometry_signature",
                        reason="No selected supported fact exposes an invariant signature.",
                        claim_type="SIMILAR_STRUCTURE_SET",
                        evidence_refs=graph_refs,
                    )
                )
        else:
            claim_type = {
                TaskType.IDENTIFY: "IDENTIFIED_OBJECT_SET",
                TaskType.DESCRIBE: "OBJECT_DESCRIPTION",
                TaskType.TRACE: "EVIDENCE_LINEAGE",
            }[spec.task_type]
            subject_ref = (
                spec.target.selector("subject_ref")
                or spec.target.selector("representation_id")
                or spec.target.selector("detection_id")
                or (spec.scope.object_refs[0] if spec.scope.object_refs else None)
            )
            if spec.task_type is TaskType.TRACE:
                ready = subject_ref is not None and facts.has_evidence(str(subject_ref))
                missing = () if ready else ("subject_ref",)
            elif spec.task_type is TaskType.DESCRIBE:
                ready = (
                    subject_ref is not None
                    and facts.has_evidence(str(subject_ref))
                ) or bool(
                    facts.representations(
                        semantic_class=spec.target.semantic_class,
                        supported_only=True,
                    )
                )
                missing = () if ready else ("subject_ref",)
            else:
                ready = True
                missing = ()
            readiness.append(
                ClaimReadiness.create(
                    claim_type,
                    ReadinessStatus.READY
                    if ready
                    else ReadinessStatus.INSUFFICIENT_EVIDENCE,
                    missing=missing,
                    capability_ids=("semantic.query",),
                )
            )
            if not ready:
                gaps.append(
                    CapabilityGap.create(
                        capability_id="semantic.query",
                        missing="subject_ref",
                        reason="The task requires a concrete bound fact reference.",
                        claim_type=claim_type,
                        evidence_refs=graph_refs,
                    )
                )

    @staticmethod
    def _count_readiness(
        spec: TaskSpec,
        facts: ProjectFactBundle,
        readiness: list[ClaimReadiness],
        gaps: list[CapabilityGap],
        graph_refs: tuple[str, ...],
    ) -> None:
        bases = spec.quantity_bases or tuple(QuantityBasis)
        for basis in bases:
            if basis is QuantityBasis.BOM_DECLARED:
                gap = schedule_row_gap(graph_refs)
                gaps.append(gap)
                readiness.append(
                    ClaimReadiness.create(
                        "BOM_DECLARED_COUNT",
                        ReadinessStatus.INSUFFICIENT_EVIDENCE,
                        missing=(gap.missing,),
                    )
                )
            elif (
                basis is QuantityBasis.PHYSICAL_INSTANCE
                and _selected_source_count(spec, facts) > 1
            ):
                gap = cross_file_identity_gap(graph_refs)
                gaps.append(gap)
                readiness.append(
                    ClaimReadiness.create(
                        "PHYSICAL_INSTANCE_COUNT",
                        ReadinessStatus.INSUFFICIENT_EVIDENCE,
                        missing=(gap.missing,),
                    )
                )
            else:
                claim_type = {
                    QuantityBasis.DRAWING_OCCURRENCE: "DRAWING_OCCURRENCE_COUNT",
                    QuantityBasis.UNIQUE_TAG: "UNIQUE_TAG_COUNT",
                    QuantityBasis.PHYSICAL_INSTANCE: "PHYSICAL_INSTANCE_COUNT",
                }[basis]
                readiness.append(
                    ClaimReadiness.create(
                        claim_type,
                        ReadinessStatus.READY,
                        capability_ids=("semantic.query",),
                    )
                )

    @staticmethod
    def _numeric_readiness(
        spec: TaskSpec,
        facts: ProjectFactBundle,
        readiness: list[ClaimReadiness],
        gaps: list[CapabilityGap],
        graph_refs: tuple[str, ...],
    ) -> None:
        representations = facts.representations(
            semantic_class=spec.target.semantic_class,
            supported_only=True,
        )
        available = 0
        for bound in representations:
            representation = bound.representation
            has_pattern_area = any(
                pattern_bound.instance.feature("area") is not None
                for pattern_key in representation.source_pattern_keys
                for pattern_bound in facts.pattern_key_index.get(pattern_key, ())
                if pattern_bound.source_ordinal == bound.source_ordinal
            )
            has_linked_face = any(
                pattern_bound.instance.feature("face_id") in facts.face_index
                for pattern_key in representation.source_pattern_keys
                for pattern_bound in facts.pattern_key_index.get(pattern_key, ())
                if pattern_bound.source_ordinal == bound.source_ordinal
            )
            overlapping_faces = tuple(
                face
                for face in facts.face_index.values()
                if face.source_ordinal == bound.source_ordinal
                and representation.bounds is not None
                and face.bounds[0] <= representation.bounds[2]
                and face.bounds[2] >= representation.bounds[0]
                and face.bounds[1] <= representation.bounds[3]
                and face.bounds[3] >= representation.bounds[1]
            )
            has_face = has_linked_face or len(overlapping_faces) == 1
            if has_pattern_area or has_face:
                available += 1
        if representations and available == len(representations):
            status = ReadinessStatus.READY
        elif available:
            status = ReadinessStatus.PARTIAL
        else:
            status = ReadinessStatus.INSUFFICIENT_EVIDENCE
        claim_type = "ENCLOSED_AREA" if spec.task_type is TaskType.MEASURE else "CONDITION_CHECK"
        missing = () if status is ReadinessStatus.READY else ("persisted_area_fact",)
        if spec.task_type is TaskType.CHECK:
            parameters = spec.constraint("parameters", {})
            has_threshold = spec.constraint("threshold") is not None or (
                isinstance(parameters, dict) and "threshold" in parameters
            )
            if not has_threshold:
                status = ReadinessStatus.INSUFFICIENT_EVIDENCE
                missing = tuple(sorted({*missing, "parameter:threshold"}))
        readiness.append(
            ClaimReadiness.create(
                claim_type,
                status,
                missing=missing,
                capability_ids=("semantic.query", "topology.query_faces"),
            )
        )
        if missing:
            gaps.append(
                CapabilityGap.create(
                    capability_id="topology.query_faces",
                    missing=",".join(missing),
                    reason="The requested numeric result lacks one or more declared inputs.",
                    claim_type=claim_type,
                    data_gap=missing[0],
                    evidence_refs=graph_refs,
                )
            )
