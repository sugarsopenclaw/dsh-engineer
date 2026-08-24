from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum
import math
from typing import Any, Iterable

from cadkernel.contracts import stable_id, stable_json_dumps


class SemanticStatus(str, Enum):
    SUPPORTED = "supported"
    AMBIGUOUS = "ambiguous"
    REJECTED = "rejected"
    ABSTAINED = "abstained"
    CONFLICTED = "conflicted"


class EvidenceGrade(str, Enum):
    SOURCE_DECLARED = "source_declared"
    PROJECT_RULE_DERIVED = "project_rule_derived"
    DETERMINISTIC_RULE_DERIVED = "deterministic_rule_derived"
    MULTI_EVIDENCE_SUPPORTED = "multi_evidence_supported"
    MODEL_INFERRED = "model_inferred"
    HUMAN_CONFIRMED = "human_confirmed"
    CONFLICTED = "conflicted"
    UNKNOWN = "unknown"


class RepresentationMode(str, Enum):
    INSTANCE_VIEW = "instance_view"
    SCHEMATIC_INSTANCE = "schematic_instance"
    TYPE_DETAIL = "type_detail"
    LEGEND_SYMBOL = "legend_symbol"
    SCHEDULE_RECORD = "schedule_record"
    AGGREGATED_REPRESENTATION = "aggregated_representation"
    REFERENCE_ONLY = "reference_only"
    UNKNOWN = "unknown"


class PropertyScope(str, Enum):
    REPRESENTATION = "representation"
    OBJECT_OCCURRENCE = "object_occurrence"
    OBJECT_TYPE = "object_type"
    SYSTEM = "system"
    PROJECT = "project"


class UnitStatus(str, Enum):
    EXPLICIT = "explicit"
    DRAWING_UNIT = "drawing_unit"
    DIMENSION_SCALE = "dimension_scale"
    UNRESOLVED = "unit_unresolved"
    NOT_APPLICABLE = "not_applicable"


class EvidenceKind(str, Enum):
    OCCURRENCE = "occurrence"
    TEXT = "text"
    ANNOTATION = "annotation"
    FACE = "face"
    PATTERN = "pattern"
    DETECTION = "detection"
    FEATURE = "feature"
    PATTERN_EDGE = "pattern_edge"
    LAYOUT = "layout"
    CONTEXT = "context"


class IdentityEdgeType(str, Enum):
    SAME_OBJECT_SUPPORTED = "same_object_supported"
    SAME_OBJECT_POSSIBLE = "same_object_possible"
    DIFFERENT_OBJECT_PROVEN = "different_object_proven"
    SAME_TYPE_ONLY = "same_type_only"
    REPRESENTS_TYPE = "represents_type"


class FailureCode(str, Enum):
    CONTEXT_ROUTING_ERROR = "context_routing_error"
    ONTOLOGY_GAP = "ontology_gap"
    CANDIDATE_GENERATION_MISS = "candidate_generation_miss"
    CLASSIFICATION_ERROR = "classification_error"
    ATTRIBUTE_EXTRACTION_ERROR = "attribute_extraction_error"
    ATTRIBUTE_SCOPE_ERROR = "attribute_scope_error"
    RELATION_ASSEMBLY_ERROR = "relation_assembly_error"
    PORT_SEMANTICS_ERROR = "port_semantics_error"
    SYSTEM_ASSEMBLY_ERROR = "system_assembly_error"
    IDENTITY_FALSE_MERGE = "identity_false_merge"
    IDENTITY_FALSE_SPLIT = "identity_false_split"
    REPRESENTATION_MODE_ERROR = "representation_mode_error"
    EXTERNAL_MAPPING_ERROR = "external_mapping_error"
    MODEL_UNSUPPORTED_ASSERTION = "model_unsupported_assertion"
    DOMAIN_LEAKAGE = "domain_leakage"


@dataclass(frozen=True, slots=True)
class SemanticToleranceProfile:
    context_text_rank: float = 1.0
    context_pattern_rank: float = 1.0
    supported_should_ratio: float = 0.5
    identity_tag_support_rank: float = 1.0
    profile_name: str = "normal"

    def __post_init__(self) -> None:
        for name in (
            "context_text_rank",
            "context_pattern_rank",
            "supported_should_ratio",
            "identity_tag_support_rank",
        ):
            value = getattr(self, name)
            if not math.isfinite(value) or value < 0.0:
                raise ValueError(f"{name} must be finite and non-negative")
        if self.supported_should_ratio > 1.0:
            raise ValueError("supported_should_ratio must be within [0, 1]")

    @property
    def profile_id(self) -> str:
        return "semantic-tolerance:" + stable_id(
            "semantic-tolerance-profile", self, length=64
        )


@dataclass(frozen=True, slots=True)
class EvidenceRef:
    evidence_id: str
    kind: EvidenceKind
    ref_id: str
    source_snapshot_id: str
    source_pattern_graph_id: str | None = None
    feature_key: str | None = None
    geometry_proof_grade: str | None = None
    literal: str | None = None

    def __post_init__(self) -> None:
        if not self.evidence_id.startswith("evidence:"):
            raise ValueError("EvidenceRef id must use evidence:<64hex>")
        if not self.ref_id or not self.source_snapshot_id:
            raise ValueError("EvidenceRef requires a source fact and snapshot")

    @classmethod
    def create(
        cls,
        *,
        kind: EvidenceKind,
        ref_id: str,
        source_snapshot_id: str,
        source_pattern_graph_id: str | None = None,
        feature_key: str | None = None,
        geometry_proof_grade: str | None = None,
        literal: str | None = None,
    ) -> "EvidenceRef":
        digest = stable_id(
            "semantic-evidence",
            kind.value,
            ref_id,
            source_snapshot_id,
            source_pattern_graph_id,
            feature_key,
            geometry_proof_grade,
            literal,
            length=64,
        )
        return cls(
            evidence_id="evidence:" + digest,
            kind=kind,
            ref_id=ref_id,
            source_snapshot_id=source_snapshot_id,
            source_pattern_graph_id=source_pattern_graph_id,
            feature_key=feature_key,
            geometry_proof_grade=geometry_proof_grade,
            literal=literal,
        )


def _ordered_evidence(values: Iterable[EvidenceRef]) -> tuple[EvidenceRef, ...]:
    indexed = {item.evidence_id: item for item in values}
    return tuple(indexed[key] for key in sorted(indexed))


@dataclass(frozen=True, slots=True)
class EvidenceBundle:
    bundle_id: str
    supporting: tuple[EvidenceRef, ...] = ()
    opposing: tuple[EvidenceRef, ...] = ()
    excluding: tuple[EvidenceRef, ...] = ()
    missing_required: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.bundle_id.startswith("evidence-bundle:"):
            raise ValueError("EvidenceBundle id must use evidence-bundle:<64hex>")
        for values in (self.supporting, self.opposing, self.excluding):
            if _ordered_evidence(values) != values:
                raise ValueError("EvidenceBundle references must be in canonical order")

    @classmethod
    def create(
        cls,
        *,
        supporting: Iterable[EvidenceRef] = (),
        opposing: Iterable[EvidenceRef] = (),
        excluding: Iterable[EvidenceRef] = (),
        missing_required: Iterable[str] = (),
    ) -> "EvidenceBundle":
        support = _ordered_evidence(supporting)
        oppose = _ordered_evidence(opposing)
        exclude = _ordered_evidence(excluding)
        missing = tuple(sorted(set(str(item) for item in missing_required)))
        digest = stable_id(
            "semantic-evidence-bundle",
            tuple(item.evidence_id for item in support),
            tuple(item.evidence_id for item in oppose),
            tuple(item.evidence_id for item in exclude),
            missing,
            length=64,
        )
        return cls("evidence-bundle:" + digest, support, oppose, exclude, missing)

    @property
    def all_refs(self) -> tuple[EvidenceRef, ...]:
        return _ordered_evidence((*self.supporting, *self.opposing, *self.excluding))


@dataclass(frozen=True, slots=True)
class ClassAssertion:
    assertion_id: str
    class_id: str
    status: SemanticStatus
    evidence_grade: EvidenceGrade
    evidence: EvidenceBundle
    geometry_proof_grades: tuple[str, ...] = ()
    ranking_score: float | None = None

    def __post_init__(self) -> None:
        if not self.assertion_id.startswith("class-assertion:"):
            raise ValueError("ClassAssertion id must use class-assertion:<64hex>")
        if self.ranking_score is not None and not math.isfinite(self.ranking_score):
            raise ValueError("ClassAssertion ranking score must be finite")
        if tuple(sorted(set(self.geometry_proof_grades))) != self.geometry_proof_grades:
            raise ValueError("geometry proof grades must be unique and sorted")

    @classmethod
    def create(
        cls,
        *,
        class_id: str,
        status: SemanticStatus,
        evidence_grade: EvidenceGrade,
        evidence: EvidenceBundle,
        geometry_proof_grades: Iterable[str] = (),
        ranking_score: float | None = None,
    ) -> "ClassAssertion":
        grades = tuple(sorted(set(str(item) for item in geometry_proof_grades)))
        digest = stable_id(
            "class-assertion",
            class_id,
            status.value,
            evidence_grade.value,
            evidence.bundle_id,
            grades,
            ranking_score,
            length=64,
        )
        return cls(
            "class-assertion:" + digest,
            class_id,
            status,
            evidence_grade,
            evidence,
            grades,
            ranking_score,
        )


@dataclass(frozen=True, slots=True)
class PropertyAssertion:
    assertion_id: str
    subject_id: str
    property_id: str
    normalized_value: Any | None
    normalized_unit: str | None
    original_literal: str
    applies_to_scope: PropertyScope
    source_kind: str
    source_ref: str
    unit_status: UnitStatus
    status: SemanticStatus
    evidence_grade: EvidenceGrade
    evidence: EvidenceBundle
    geometry_proof_grades: tuple[str, ...] = ()
    effective_revision: str | None = None

    def __post_init__(self) -> None:
        if not self.assertion_id.startswith("property-assertion:"):
            raise ValueError("PropertyAssertion id must use property-assertion:<64hex>")
        stable_json_dumps(self.normalized_value)
        if self.unit_status is UnitStatus.UNRESOLVED and self.normalized_unit is not None:
            raise ValueError("Unresolved units cannot expose a normalized unit")

    @classmethod
    def create(
        cls,
        *,
        subject_id: str,
        property_id: str,
        normalized_value: Any | None,
        normalized_unit: str | None,
        original_literal: str,
        applies_to_scope: PropertyScope,
        source_kind: str,
        source_ref: str,
        unit_status: UnitStatus,
        status: SemanticStatus,
        evidence_grade: EvidenceGrade,
        evidence: EvidenceBundle,
        geometry_proof_grades: Iterable[str] = (),
        effective_revision: str | None = None,
    ) -> "PropertyAssertion":
        grades = tuple(sorted(set(str(item) for item in geometry_proof_grades)))
        digest = stable_id(
            "property-assertion",
            subject_id,
            property_id,
            normalized_value,
            normalized_unit,
            original_literal,
            applies_to_scope.value,
            source_ref,
            evidence.bundle_id,
            length=64,
        )
        return cls(
            "property-assertion:" + digest,
            subject_id,
            property_id,
            normalized_value,
            normalized_unit,
            original_literal,
            applies_to_scope,
            source_kind,
            source_ref,
            unit_status,
            status,
            evidence_grade,
            evidence,
            grades,
            effective_revision,
        )

    def conflicted(self) -> "PropertyAssertion":
        return replace(
            self,
            status=SemanticStatus.CONFLICTED,
            evidence_grade=EvidenceGrade.CONFLICTED,
        )


@dataclass(frozen=True, slots=True)
class SemanticRelation:
    relation_id: str
    relation_type: str
    source_id: str
    target_id: str
    properties: tuple[tuple[str, Any], ...]
    status: SemanticStatus
    evidence_grade: EvidenceGrade
    evidence: EvidenceBundle
    geometry_proof_grades: tuple[str, ...] = ()

    @classmethod
    def create(
        cls,
        *,
        relation_type: str,
        source_id: str,
        target_id: str,
        properties: Iterable[tuple[str, Any]] = (),
        status: SemanticStatus,
        evidence_grade: EvidenceGrade,
        evidence: EvidenceBundle,
        geometry_proof_grades: Iterable[str] = (),
    ) -> "SemanticRelation":
        normalized_properties = tuple(sorted(properties, key=lambda item: item[0]))
        stable_json_dumps(normalized_properties)
        grades = tuple(sorted(set(str(item) for item in geometry_proof_grades)))
        digest = stable_id(
            "semantic-relation",
            relation_type,
            source_id,
            target_id,
            normalized_properties,
            evidence.bundle_id,
            length=64,
        )
        return cls(
            "semantic-relation:" + digest,
            relation_type,
            source_id,
            target_id,
            normalized_properties,
            status,
            evidence_grade,
            evidence,
            grades,
        )


@dataclass(frozen=True, slots=True)
class SemanticPort:
    port_id: str
    owner_representation_id: str
    generic_pattern_port_ref: str
    semantic_role: str
    direction: str
    attributes: tuple[PropertyAssertion, ...]
    status: SemanticStatus
    evidence: EvidenceBundle

    @classmethod
    def create(
        cls,
        *,
        owner_representation_id: str,
        generic_pattern_port_ref: str,
        semantic_role: str,
        direction: str = "unknown",
        attributes: Iterable[PropertyAssertion] = (),
        status: SemanticStatus = SemanticStatus.SUPPORTED,
        evidence: EvidenceBundle,
    ) -> "SemanticPort":
        ordered = tuple(sorted(attributes, key=lambda item: item.assertion_id))
        digest = stable_id(
            "semantic-port",
            owner_representation_id,
            generic_pattern_port_ref,
            semantic_role,
            direction,
            length=64,
        )
        return cls(
            "semantic-port:" + digest,
            owner_representation_id,
            generic_pattern_port_ref,
            semantic_role,
            direction,
            ordered,
            status,
            evidence,
        )


def representation_key(
    class_id: str,
    context_id: str,
    source_pattern_keys: Iterable[str],
) -> str:
    sources = tuple(sorted(set(str(item) for item in source_pattern_keys)))
    return "semrep:" + stable_id(
        "semantic-representation-key", class_id, context_id, sources, length=64
    )


def resolution_id(
    representation_key_value: str,
    *,
    ontology_version: str,
    pack_id: str,
    pack_version: str,
    mapping_version: str,
    backend_version: str,
    project_profile_version: str,
) -> str:
    return "semres:" + stable_id(
        "semantic-resolution",
        representation_key_value,
        ontology_version,
        pack_id,
        pack_version,
        mapping_version,
        backend_version,
        project_profile_version,
        length=64,
    )


@dataclass(frozen=True, slots=True)
class SemanticRepresentation:
    representation_key: str
    resolution_id: str
    source_snapshot_id: str
    source_pattern_keys: tuple[str, ...]
    source_detection_ids: tuple[str, ...]
    context_id: str
    class_assertions: tuple[ClassAssertion, ...]
    representation_mode: RepresentationMode
    properties: tuple[PropertyAssertion, ...]
    ports: tuple[SemanticPort, ...]
    relation_ids: tuple[str, ...]
    identity_cluster_id: str | None
    object_type_id: str | None
    functional_roles: tuple[str, ...]
    lifecycle_state: str | None
    project_phase: str | None
    alternatives: tuple[str, ...]
    conflicts: tuple[str, ...]
    diagnostics: tuple[str, ...]
    domain_pack_id: str
    domain_pack_version: str
    mapping_version: str
    ontology_version: str
    backend_version: str
    project_profile_version: str
    status: SemanticStatus
    bounds: tuple[float, float, float, float] | None = None
    geometry_signature: str | None = None

    def __post_init__(self) -> None:
        if not self.representation_key.startswith("semrep:"):
            raise ValueError("representation_key must use semrep:<64hex>")
        if not self.resolution_id.startswith("semres:"):
            raise ValueError("resolution_id must use semres:<64hex>")
        if tuple(sorted(set(self.source_pattern_keys))) != self.source_pattern_keys:
            raise ValueError("source pattern keys must be unique and sorted")
        if tuple(sorted(self.class_assertions, key=lambda item: item.assertion_id)) != self.class_assertions:
            raise ValueError("class assertions must be in canonical order")
        class_ids = {item.class_id for item in self.class_assertions}
        axis_values = set(self.functional_roles)
        if self.object_type_id is not None:
            axis_values.add(self.object_type_id)
        if self.lifecycle_state is not None:
            axis_values.add(self.lifecycle_state)
        if self.project_phase is not None:
            axis_values.add(self.project_phase)
        if class_ids.intersection(axis_values):
            raise ValueError(
                "semantic class, object type, functional role, lifecycle state, and project phase must remain separate"
            )
        non_class_axes = (
            self.object_type_id,
            *self.functional_roles,
            self.lifecycle_state,
            self.project_phase,
        )
        present_axes = tuple(item for item in non_class_axes if item is not None)
        if len(present_axes) != len(set(present_axes)):
            raise ValueError(
                "object type, functional roles, lifecycle state, and project phase cannot reuse identifiers"
            )

    @property
    def representation_id(self) -> str:
        return self.resolution_id

    @property
    def semantic_class(self) -> str | None:
        supported = tuple(
            item.class_id
            for item in self.class_assertions
            if item.status is SemanticStatus.SUPPORTED
        )
        return supported[0] if supported else None

    @classmethod
    def create(
        cls,
        *,
        class_id: str,
        source_snapshot_id: str,
        source_pattern_keys: Iterable[str],
        source_detection_ids: Iterable[str],
        context_id: str,
        class_assertions: Iterable[ClassAssertion],
        representation_mode: RepresentationMode,
        domain_pack_id: str,
        domain_pack_version: str,
        mapping_version: str,
        ontology_version: str,
        backend_version: str,
        project_profile_version: str,
        status: SemanticStatus,
        properties: Iterable[PropertyAssertion] = (),
        ports: Iterable[SemanticPort] = (),
        relation_ids: Iterable[str] = (),
        identity_cluster_id: str | None = None,
        object_type_id: str | None = None,
        functional_roles: Iterable[str] = (),
        lifecycle_state: str | None = None,
        project_phase: str | None = None,
        alternatives: Iterable[str] = (),
        conflicts: Iterable[str] = (),
        diagnostics: Iterable[str] = (),
        bounds: tuple[float, float, float, float] | None = None,
        geometry_signature: str | None = None,
    ) -> "SemanticRepresentation":
        source_keys = tuple(sorted(set(str(item) for item in source_pattern_keys)))
        key = representation_key(class_id, context_id, source_keys)
        resolved = resolution_id(
            key,
            ontology_version=ontology_version,
            pack_id=domain_pack_id,
            pack_version=domain_pack_version,
            mapping_version=mapping_version,
            backend_version=backend_version,
            project_profile_version=project_profile_version,
        )
        return cls(
            key,
            resolved,
            source_snapshot_id,
            source_keys,
            tuple(sorted(set(str(item) for item in source_detection_ids))),
            context_id,
            tuple(sorted(class_assertions, key=lambda item: item.assertion_id)),
            representation_mode,
            tuple(sorted(properties, key=lambda item: item.assertion_id)),
            tuple(sorted(ports, key=lambda item: item.port_id)),
            tuple(sorted(set(str(item) for item in relation_ids))),
            identity_cluster_id,
            object_type_id,
            tuple(sorted(set(str(item) for item in functional_roles))),
            lifecycle_state,
            project_phase,
            tuple(sorted(set(str(item) for item in alternatives))),
            tuple(sorted(set(str(item) for item in conflicts))),
            tuple(sorted(set(str(item) for item in diagnostics))),
            domain_pack_id,
            domain_pack_version,
            mapping_version,
            ontology_version,
            backend_version,
            project_profile_version,
            status,
            None if bounds is None else tuple(float(item) for item in bounds),
            geometry_signature,
        )


@dataclass(frozen=True, slots=True)
class IdentityAssertion:
    assertion_id: str
    source_representation_id: str
    target_representation_id: str
    edge_type: IdentityEdgeType
    status: SemanticStatus
    evidence_grade: EvidenceGrade
    evidence: EvidenceBundle

    @classmethod
    def create(
        cls,
        *,
        source_representation_id: str,
        target_representation_id: str,
        edge_type: IdentityEdgeType,
        status: SemanticStatus,
        evidence_grade: EvidenceGrade,
        evidence: EvidenceBundle,
    ) -> "IdentityAssertion":
        left, right = sorted((source_representation_id, target_representation_id))
        digest = stable_id(
            "identity-assertion",
            left,
            right,
            edge_type.value,
            evidence.bundle_id,
            length=64,
        )
        return cls(
            "identity-assertion:" + digest,
            left,
            right,
            edge_type,
            status,
            evidence_grade,
            evidence,
        )


@dataclass(frozen=True, slots=True)
class RepresentationIdentityGraph:
    identity_graph_id: str
    source_snapshot_ids: tuple[str, ...]
    representation_ids: tuple[str, ...]
    assertions: tuple[IdentityAssertion, ...]

    @classmethod
    def create(
        cls,
        *,
        source_snapshot_ids: Iterable[str],
        representation_ids: Iterable[str],
        assertions: Iterable[IdentityAssertion] = (),
    ) -> "RepresentationIdentityGraph":
        snapshots = tuple(sorted(set(source_snapshot_ids)))
        representations = tuple(sorted(set(representation_ids)))
        ordered_assertions = tuple(sorted(assertions, key=lambda item: item.assertion_id))
        digest = stable_id(
            "representation-identity-graph",
            snapshots,
            representations,
            ordered_assertions,
            length=64,
        )
        return cls(
            "representation-identity-graph:" + digest,
            snapshots,
            representations,
            ordered_assertions,
        )


@dataclass(frozen=True, slots=True)
class IdentityCluster:
    cluster_id: str
    representation_ids: tuple[str, ...]
    source_snapshot_ids: tuple[str, ...]
    project_object_class: str
    identity_status: SemanticStatus
    supporting_evidence: tuple[EvidenceRef, ...]
    conflicts: tuple[str, ...] = ()
    unresolved_representation_ids: tuple[str, ...] = ()

    @classmethod
    def create(
        cls,
        *,
        representation_ids: Iterable[str],
        source_snapshot_ids: Iterable[str],
        project_object_class: str,
        identity_status: SemanticStatus,
        supporting_evidence: Iterable[EvidenceRef] = (),
        conflicts: Iterable[str] = (),
        unresolved_representation_ids: Iterable[str] = (),
    ) -> "IdentityCluster":
        members = tuple(sorted(set(representation_ids)))
        snapshots = tuple(sorted(set(source_snapshot_ids)))
        digest = stable_id(
            "semantic-identity-cluster",
            project_object_class,
            members,
            snapshots,
            length=64,
        )
        return cls(
            "identity:" + digest,
            members,
            snapshots,
            project_object_class,
            identity_status,
            _ordered_evidence(supporting_evidence),
            tuple(sorted(set(conflicts))),
            tuple(sorted(set(unresolved_representation_ids))),
        )


@dataclass(frozen=True, slots=True)
class ProjectObject:
    project_object_id: str
    semantic_class: str
    representation_ids: tuple[str, ...]
    source_snapshot_ids: tuple[str, ...]
    object_type_id: str | None
    functional_roles: tuple[str, ...]
    lifecycle_state: str | None
    project_phase: str | None
    status: SemanticStatus
    evidence: EvidenceBundle

    @classmethod
    def create(
        cls,
        *,
        semantic_class: str,
        representation_ids: Iterable[str],
        source_snapshot_ids: Iterable[str],
        evidence: EvidenceBundle,
        object_type_id: str | None = None,
        functional_roles: Iterable[str] = (),
        lifecycle_state: str | None = None,
        project_phase: str | None = None,
        status: SemanticStatus = SemanticStatus.SUPPORTED,
    ) -> "ProjectObject":
        representations = tuple(sorted(set(representation_ids)))
        snapshots = tuple(sorted(set(source_snapshot_ids)))
        digest = stable_id(
            "semantic-project-object",
            semantic_class,
            representations,
            snapshots,
            length=64,
        )
        return cls(
            "project-object:" + digest,
            semantic_class,
            representations,
            snapshots,
            object_type_id,
            tuple(sorted(set(functional_roles))),
            lifecycle_state,
            project_phase,
            status,
            evidence,
        )


@dataclass(frozen=True, slots=True)
class ObjectType:
    object_type_id: str
    semantic_class: str
    representation_ids: tuple[str, ...]
    properties: tuple[PropertyAssertion, ...]
    status: SemanticStatus
    evidence: EvidenceBundle

    @classmethod
    def create(
        cls,
        *,
        semantic_class: str,
        representation_ids: Iterable[str],
        properties: Iterable[PropertyAssertion],
        status: SemanticStatus,
        evidence: EvidenceBundle,
    ) -> "ObjectType":
        representations = tuple(sorted(set(representation_ids)))
        ordered_properties = tuple(sorted(properties, key=lambda item: item.assertion_id))
        digest = stable_id(
            "semantic-object-type",
            semantic_class,
            representations,
            tuple(item.assertion_id for item in ordered_properties),
            length=64,
        )
        return cls(
            "object-type:" + digest,
            semantic_class,
            representations,
            ordered_properties,
            status,
            evidence,
        )


@dataclass(frozen=True, slots=True)
class SemanticSystem:
    system_id: str
    semantic_class: str
    member_ids: tuple[str, ...]
    source_network_refs: tuple[str, ...]
    properties: tuple[PropertyAssertion, ...]
    status: SemanticStatus
    evidence: EvidenceBundle

    @classmethod
    def create(
        cls,
        *,
        semantic_class: str,
        member_ids: Iterable[str],
        source_network_refs: Iterable[str],
        properties: Iterable[PropertyAssertion] = (),
        status: SemanticStatus,
        evidence: EvidenceBundle,
    ) -> "SemanticSystem":
        members = tuple(sorted(set(member_ids)))
        networks = tuple(sorted(set(source_network_refs)))
        ordered_properties = tuple(sorted(properties, key=lambda item: item.assertion_id))
        digest = stable_id(
            "semantic-system",
            semantic_class,
            members,
            networks,
            length=64,
        )
        return cls(
            "semantic-system:" + digest,
            semantic_class,
            members,
            networks,
            ordered_properties,
            status,
            evidence,
        )


@dataclass(frozen=True, slots=True)
class SemanticFailure:
    failure_id: str
    code: FailureCode
    subject_id: str
    message: str
    evidence_refs: tuple[EvidenceRef, ...] = ()

    @classmethod
    def create(
        cls,
        code: FailureCode,
        subject_id: str,
        message: str,
        evidence_refs: Iterable[EvidenceRef] = (),
    ) -> "SemanticFailure":
        evidence = _ordered_evidence(evidence_refs)
        digest = stable_id(
            "semantic-failure",
            code.value,
            subject_id,
            message,
            tuple(item.evidence_id for item in evidence),
            length=64,
        )
        return cls("semantic-failure:" + digest, code, subject_id, message, evidence)
