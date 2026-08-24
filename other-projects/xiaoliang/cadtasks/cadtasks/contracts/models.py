from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import math
from typing import Any, Iterable, Mapping

from cadkernel.contracts import stable_id, stable_json_dumps, stable_json_loads


ID_LENGTH = 64


class TaskType(str, Enum):
    LOCATE = "locate"
    IDENTIFY = "identify"
    DESCRIBE = "describe"
    TRACE = "trace"
    MEASURE = "measure"
    COUNT = "count"
    RECONCILE = "reconcile"
    CHECK = "check"
    AUDIT = "audit"


class TruthBasis(str, Enum):
    FILE_FACT = "file_fact"
    DRAWING_EXPRESSION = "drawing_expression"
    DESIGN_INTENT = "design_intent"
    BOM_DECLARATION = "bom_declaration"
    PHYSICAL_REALITY = "physical_reality"


class QuantityBasis(str, Enum):
    DRAWING_OCCURRENCE = "drawing_occurrence"
    UNIQUE_TAG = "unique_tag"
    BOM_DECLARED = "bom_declared"
    PHYSICAL_INSTANCE = "physical_instance"


class MutationPolicy(str, Enum):
    READ_ONLY = "read_only"
    GENERATE_NEW_ARTIFACT = "generate_new_artifact"
    PROPOSE_CHANGESET = "propose_changeset"
    APPLY_TO_BRANCH = "apply_to_branch"
    COMMIT_APPROVED_CHANGE = "commit_approved_change"


class RiskTier(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ScopeType(str, Enum):
    ENTITY = "entity"
    PATTERN = "pattern"
    SEMANTIC_REPRESENTATION = "semantic_representation"
    PROJECT_OBJECT = "project_object"
    REGION = "region"
    VIEW = "view"
    SHEET = "sheet"
    FILE = "file"
    STOREY = "storey"
    BUILDING = "building"
    SYSTEM = "system"
    DISCIPLINE = "discipline"
    PROJECT = "project"
    REVISION_RANGE = "revision_range"


class AssemblyPolicy(str, Enum):
    COUNT_MEMBERS = "count_members"
    COUNT_GROUPS = "count_groups"
    REPORT_BOTH = "report_both"


class TaskStatus(str, Enum):
    RECEIVED = "received"
    SPECIFIED = "specified"
    PREFLIGHTED = "preflighted"
    PLANNED = "planned"
    RUNNING = "running"
    VALIDATING = "validating"
    COMPLETED = "completed"
    PARTIAL = "partial"
    REVIEW_REQUIRED = "review_required"
    BLOCKED = "blocked"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ClaimStatus(str, Enum):
    PROVEN = "proven"
    SUPPORTED = "supported"
    HYPOTHESIS = "hypothesis"
    CONFLICTED = "conflicted"
    UNKNOWN = "unknown"
    REJECTED = "rejected"
    ABSTAINED = "abstained"
    AMBIGUOUS = "ambiguous"


class ReadinessStatus(str, Enum):
    READY = "ready"
    PARTIAL = "partial"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    UNSUPPORTED = "unsupported"


class ConclusionStatus(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    OBSERVATION = "observation"
    NOT_APPLICABLE = "not_applicable"
    INSUFFICIENT_INFORMATION = "insufficient_information"
    REVIEW_REQUIRED = "review_required"


class ApplicabilityStatus(str, Enum):
    APPLICABLE = "applicable"
    NOT_APPLICABLE = "not_applicable"
    UNDETERMINED = "undetermined"


class Severity(str, Enum):
    INFO = "info"
    MINOR = "minor"
    MAJOR = "major"
    CRITICAL = "critical"


class ArtifactType(str, Enum):
    ANSWER = "answer"
    STRUCTURED_TABLE = "structured_table"
    SOURCE_HIGHLIGHTS = "source_highlights"
    EVIDENCE_TRACE = "evidence_trace"


class FailureCode(str, Enum):
    TASK_INTENT_ERROR = "task_intent_error"
    SCOPE_RESOLUTION_ERROR = "scope_resolution_error"
    RECIPE_UNAVAILABLE = "recipe_unavailable"
    CAPABILITY_UNAVAILABLE = "capability_unavailable"
    DATA_GAP = "data_gap"
    RULE_UNAVAILABLE = "rule_unavailable"
    PLAN_STATIC_CHECK_FAILED = "plan_static_check_failed"
    EXECUTION_ERROR = "execution_error"
    VALIDATION_ERROR = "validation_error"


def _ordered_strings(values: Iterable[object]) -> tuple[str, ...]:
    return tuple(sorted({str(value) for value in values if str(value)}))


def _ordered_pairs(
    values: Mapping[str, Any] | Iterable[tuple[str, Any]],
) -> tuple[tuple[str, Any], ...]:
    items = values.items() if isinstance(values, Mapping) else values
    indexed: dict[str, Any] = {}
    for name, value in items:
        key = str(name)
        if not key:
            raise ValueError("Contract mapping keys cannot be empty")
        if key in indexed:
            raise ValueError(f"Duplicate contract mapping key: {key}")
        stable_json_dumps(value)
        indexed[key] = value
    return tuple((key, indexed[key]) for key in sorted(indexed))


def _pair_value(values: tuple[tuple[str, Any], ...], name: str, default: Any = None) -> Any:
    return next((value for key, value in values if key == name), default)


@dataclass(frozen=True, slots=True)
class TaskRequest:
    request_id: str
    payload: tuple[tuple[str, Any], ...]
    original_text: str | None = None

    @classmethod
    def create(
        cls,
        payload: Mapping[str, Any],
        *,
        original_text: str | None = None,
    ) -> "TaskRequest":
        normalized = _ordered_pairs(payload)
        digest = stable_id(
            "task-request", normalized, original_text, length=ID_LENGTH
        )
        return cls("task-request:" + digest, normalized, original_text)


@dataclass(frozen=True, slots=True)
class TaskTarget:
    semantic_class: str
    selectors: tuple[tuple[str, Any], ...] = ()

    def __post_init__(self) -> None:
        if not self.semantic_class:
            raise ValueError("TaskTarget requires semantic_class")

    @classmethod
    def create(
        cls,
        semantic_class: str,
        selectors: Mapping[str, Any] | Iterable[tuple[str, Any]] = (),
    ) -> "TaskTarget":
        return cls(str(semantic_class), _ordered_pairs(selectors))

    def selector(self, name: str, default: Any = None) -> Any:
        return _pair_value(self.selectors, name, default)


@dataclass(frozen=True, slots=True)
class TaskScope:
    scope_type: ScopeType
    project_id: str
    files: tuple[str, ...] = ()
    sheets: tuple[str, ...] = ()
    views: tuple[str, ...] = ()
    regions: tuple[tuple[float, float, float, float], ...] = ()
    systems: tuple[str, ...] = ()
    storeys: tuple[str, ...] = ()
    object_refs: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.project_id:
            raise ValueError("TaskScope requires project_id")
        for bounds in self.regions:
            if len(bounds) != 4 or not all(math.isfinite(value) for value in bounds):
                raise ValueError("TaskScope regions require four finite coordinates")
            if bounds[2] < bounds[0] or bounds[3] < bounds[1]:
                raise ValueError("TaskScope region bounds are not ordered")

    @classmethod
    def create(
        cls,
        *,
        scope_type: ScopeType | str = ScopeType.PROJECT,
        project_id: str,
        files: Iterable[object] = (),
        sheets: Iterable[object] = (),
        views: Iterable[object] = (),
        regions: Iterable[Iterable[float]] = (),
        systems: Iterable[object] = (),
        storeys: Iterable[object] = (),
        object_refs: Iterable[object] = (),
    ) -> "TaskScope":
        normalized_regions = tuple(
            sorted(
                {
                    tuple(float(coordinate) for coordinate in bounds)
                    for bounds in regions
                }
            )
        )
        return cls(
            ScopeType(scope_type),
            str(project_id),
            _ordered_strings(files),
            _ordered_strings(sheets),
            _ordered_strings(views),
            normalized_regions,
            _ordered_strings(systems),
            _ordered_strings(storeys),
            _ordered_strings(object_refs),
        )


@dataclass(frozen=True, slots=True)
class EvidencePolicy:
    minimum_grade: str = "deterministic_rule_derived"
    allow_model_inferred: bool = False
    allow_assumptions: bool = False
    partial_result_allowed: bool = True


def task_spec_key(
    *,
    task_type: TaskType,
    target: TaskTarget,
    scope: TaskScope,
    revision_policy: str,
    truth_basis: TruthBasis,
    quantity_bases: tuple[QuantityBasis, ...],
    constraints: tuple[tuple[str, Any], ...],
    evidence_policy: EvidencePolicy,
    output_contract: tuple[ArtifactType, ...],
    mutation_policy: MutationPolicy,
    risk_tier: RiskTier,
    assembly_policy: AssemblyPolicy,
) -> str:
    digest = stable_id(
        "task-spec-key",
        task_type.value,
        target,
        scope,
        revision_policy,
        truth_basis.value,
        tuple(value.value for value in quantity_bases),
        constraints,
        evidence_policy,
        tuple(value.value for value in output_contract),
        mutation_policy.value,
        risk_tier.value,
        assembly_policy.value,
        length=ID_LENGTH,
    )
    return "task-spec:" + digest


@dataclass(frozen=True, slots=True)
class TaskSpec:
    task_spec_key: str
    task_type: TaskType
    target: TaskTarget
    scope: TaskScope
    revision_policy: str
    truth_basis: TruthBasis
    quantity_bases: tuple[QuantityBasis, ...]
    constraints: tuple[tuple[str, Any], ...]
    evidence_policy: EvidencePolicy
    output_contract: tuple[ArtifactType, ...]
    mutation_policy: MutationPolicy
    risk_tier: RiskTier
    assembly_policy: AssemblyPolicy = AssemblyPolicy.COUNT_MEMBERS

    def __post_init__(self) -> None:
        if not self.task_spec_key.startswith("task-spec:"):
            raise ValueError("TaskSpec key must use task-spec:<64hex>")
        if len(self.task_spec_key.removeprefix("task-spec:")) != ID_LENGTH:
            raise ValueError("TaskSpec key must contain a full SHA-256 digest")
        if not self.revision_policy:
            raise ValueError("TaskSpec requires revision_policy")
        if self.scope.project_id == "":
            raise ValueError("TaskSpec scope requires a project")

    @classmethod
    def create(
        cls,
        *,
        task_type: TaskType | str,
        target: TaskTarget,
        scope: TaskScope,
        revision_policy: str = "pinned",
        truth_basis: TruthBasis | str = TruthBasis.DRAWING_EXPRESSION,
        quantity_bases: Iterable[QuantityBasis | str] = (),
        constraints: Mapping[str, Any] | Iterable[tuple[str, Any]] = (),
        evidence_policy: EvidencePolicy | None = None,
        output_contract: Iterable[ArtifactType | str] = (ArtifactType.ANSWER,),
        mutation_policy: MutationPolicy | str = MutationPolicy.READ_ONLY,
        risk_tier: RiskTier | str = RiskTier.LOW,
        assembly_policy: AssemblyPolicy | str = AssemblyPolicy.COUNT_MEMBERS,
    ) -> "TaskSpec":
        resolved_type = TaskType(task_type)
        resolved_truth = TruthBasis(truth_basis)
        bases = tuple(sorted({QuantityBasis(value) for value in quantity_bases}, key=lambda value: value.value))
        normalized_constraints = _ordered_pairs(constraints)
        policy = evidence_policy or EvidencePolicy()
        outputs = tuple(sorted({ArtifactType(value) for value in output_contract}, key=lambda value: value.value))
        mutation = MutationPolicy(mutation_policy)
        risk = RiskTier(risk_tier)
        assembly = AssemblyPolicy(assembly_policy)
        key = task_spec_key(
            task_type=resolved_type,
            target=target,
            scope=scope,
            revision_policy=str(revision_policy),
            truth_basis=resolved_truth,
            quantity_bases=bases,
            constraints=normalized_constraints,
            evidence_policy=policy,
            output_contract=outputs,
            mutation_policy=mutation,
            risk_tier=risk,
            assembly_policy=assembly,
        )
        return cls(
            key,
            resolved_type,
            target,
            scope,
            str(revision_policy),
            resolved_truth,
            bases,
            normalized_constraints,
            policy,
            outputs,
            mutation,
            risk,
            assembly,
        )

    def constraint(self, name: str, default: Any = None) -> Any:
        return _pair_value(self.constraints, name, default)

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "TaskSpec":
        target_value = value["target"]
        scope_value = value["scope"]
        evidence_value = value.get("evidence_policy", {})
        if not isinstance(target_value, Mapping) or not isinstance(scope_value, Mapping):
            raise TypeError("TaskSpec target and scope must be objects")
        return cls.create(
            task_type=str(value["task_type"]),
            target=TaskTarget.create(
                str(target_value["semantic_class"]),
                target_value.get("selectors", ()),
            ),
            scope=TaskScope.create(
                scope_type=str(scope_value.get("scope_type", scope_value.get("type", "project"))),
                project_id=str(scope_value["project_id"]),
                files=scope_value.get("files", ()),
                sheets=scope_value.get("sheets", ()),
                views=scope_value.get("views", ()),
                regions=scope_value.get("regions", ()),
                systems=scope_value.get("systems", ()),
                storeys=scope_value.get("storeys", ()),
                object_refs=scope_value.get("object_refs", ()),
            ),
            revision_policy=str(value.get("revision_policy", "pinned")),
            truth_basis=str(value.get("truth_basis", "drawing_expression")),
            quantity_bases=value.get("quantity_bases", ()),
            constraints=value.get("constraints", ()),
            evidence_policy=EvidencePolicy(
                minimum_grade=str(evidence_value.get("minimum_grade", "deterministic_rule_derived")),
                allow_model_inferred=bool(evidence_value.get("allow_model_inferred", False)),
                allow_assumptions=bool(evidence_value.get("allow_assumptions", False)),
                partial_result_allowed=bool(evidence_value.get("partial_result_allowed", True)),
            ),
            output_contract=value.get("output_contract", ("answer",)),
            mutation_policy=str(value.get("mutation_policy", "read_only")),
            risk_tier=str(value.get("risk_tier", "low")),
            assembly_policy=str(value.get("assembly_policy", "count_members")),
        )

    @classmethod
    def from_json(cls, payload: str) -> "TaskSpec":
        value = stable_json_loads(payload)
        if not isinstance(value, Mapping):
            raise TypeError("TaskSpec JSON root must be an object")
        return cls.from_mapping(value)


@dataclass(frozen=True, slots=True)
class CapabilityGap:
    gap_id: str
    capability_id: str
    missing: str
    reason: str
    claim_type: str | None = None
    data_gap: str | None = None
    evidence_refs: tuple[str, ...] = ()

    @property
    def registry_id(self) -> str:
        return self.gap_id

    @property
    def version(self) -> str:
        return "1"

    @classmethod
    def create(
        cls,
        *,
        capability_id: str,
        missing: str,
        reason: str,
        claim_type: str | None = None,
        data_gap: str | None = None,
        evidence_refs: Iterable[object] = (),
    ) -> "CapabilityGap":
        refs = _ordered_strings(evidence_refs)
        digest = stable_id(
            "capability-gap",
            capability_id,
            missing,
            reason,
            claim_type,
            data_gap,
            refs,
            length=ID_LENGTH,
        )
        return cls(
            "gap:" + digest,
            str(capability_id),
            str(missing),
            str(reason),
            None if claim_type is None else str(claim_type),
            None if data_gap is None else str(data_gap),
            refs,
        )


@dataclass(frozen=True, slots=True)
class ClaimReadiness:
    claim_type: str
    status: ReadinessStatus
    missing: tuple[str, ...] = ()
    capability_ids: tuple[str, ...] = ()

    @classmethod
    def create(
        cls,
        claim_type: str,
        status: ReadinessStatus | str,
        *,
        missing: Iterable[object] = (),
        capability_ids: Iterable[object] = (),
    ) -> "ClaimReadiness":
        return cls(
            str(claim_type),
            ReadinessStatus(status),
            _ordered_strings(missing),
            _ordered_strings(capability_ids),
        )


@dataclass(frozen=True, slots=True)
class TaskReadinessReport:
    report_id: str
    task_spec_key: str
    overall_status: ReadinessStatus
    claim_readiness: tuple[ClaimReadiness, ...]
    capability_gaps: tuple[CapabilityGap, ...] = ()
    data_gaps: tuple[str, ...] = ()

    @classmethod
    def create(
        cls,
        *,
        task_spec_key: str,
        overall_status: ReadinessStatus | str,
        claim_readiness: Iterable[ClaimReadiness] = (),
        capability_gaps: Iterable[CapabilityGap] = (),
        data_gaps: Iterable[object] = (),
    ) -> "TaskReadinessReport":
        claims = tuple(sorted(claim_readiness, key=lambda item: item.claim_type))
        gaps = tuple(sorted(capability_gaps, key=lambda item: item.gap_id))
        data = _ordered_strings(data_gaps)
        digest = stable_id(
            "task-readiness",
            task_spec_key,
            ReadinessStatus(overall_status).value,
            claims,
            gaps,
            data,
            length=ID_LENGTH,
        )
        return cls(
            "readiness:" + digest,
            task_spec_key,
            ReadinessStatus(overall_status),
            claims,
            gaps,
            data,
        )


@dataclass(frozen=True, slots=True)
class Claim:
    claim_id: str
    claim_type: str
    subject_ref: str
    predicate: str
    value: Any | None
    value_interval: tuple[float, float] | None
    unit: str | None
    scope_ref: str
    truth_basis: TruthBasis
    quantity_basis: QuantityBasis | None
    status: ClaimStatus
    evidence_refs: tuple[str, ...]
    assumptions: tuple[str, ...]
    derivation_ref: str
    source_snapshot_ids: tuple[str, ...]
    recipe_id: str
    recipe_version: str
    rule_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.claim_id.startswith("claim:"):
            raise ValueError("Claim id must use claim:<64hex>")
        if not self.claim_type or not self.subject_ref or not self.predicate:
            raise ValueError("Claim requires type, subject, and predicate")
        stable_json_dumps(self.value)
        if self.value_interval is not None:
            lower, upper = self.value_interval
            if not math.isfinite(lower) or not math.isfinite(upper) or upper < lower:
                raise ValueError("Claim value interval must be finite and ordered")

    @classmethod
    def create(
        cls,
        *,
        task_run_id: str,
        claim_type: str,
        subject_ref: str,
        predicate: str,
        value: Any | None,
        scope_ref: str,
        truth_basis: TruthBasis | str,
        status: ClaimStatus | str,
        evidence_refs: Iterable[object],
        derivation_ref: str,
        source_snapshot_ids: Iterable[object],
        recipe_id: str,
        recipe_version: str,
        value_interval: tuple[float, float] | None = None,
        unit: str | None = None,
        quantity_basis: QuantityBasis | str | None = None,
        assumptions: Iterable[object] = (),
        rule_ids: Iterable[object] = (),
    ) -> "Claim":
        refs = _ordered_strings(evidence_refs)
        snapshots = _ordered_strings(source_snapshot_ids)
        normalized_assumptions = _ordered_strings(assumptions)
        rules = _ordered_strings(rule_ids)
        basis = None if quantity_basis is None else QuantityBasis(quantity_basis)
        interval = (
            None
            if value_interval is None
            else (float(value_interval[0]), float(value_interval[1]))
        )
        digest = stable_id(
            "task-claim",
            task_run_id,
            claim_type,
            subject_ref,
            predicate,
            value,
            interval,
            unit,
            scope_ref,
            TruthBasis(truth_basis).value,
            None if basis is None else basis.value,
            ClaimStatus(status).value,
            refs,
            normalized_assumptions,
            derivation_ref,
            snapshots,
            recipe_id,
            recipe_version,
            rules,
            length=ID_LENGTH,
        )
        return cls(
            "claim:" + digest,
            str(claim_type),
            str(subject_ref),
            str(predicate),
            value,
            interval,
            None if unit is None else str(unit),
            str(scope_ref),
            TruthBasis(truth_basis),
            basis,
            ClaimStatus(status),
            refs,
            normalized_assumptions,
            str(derivation_ref),
            snapshots,
            str(recipe_id),
            str(recipe_version),
            rules,
        )


@dataclass(frozen=True, slots=True)
class AuditIssue:
    issue_id: str
    rule_id: str
    rule_version: str
    affected_object_refs: tuple[str, ...]
    observation_claim_ids: tuple[str, ...]
    applicability_status: ApplicabilityStatus
    conclusion_status: ConclusionStatus
    severity: Severity
    evidence_refs: tuple[str, ...]
    assumptions: tuple[str, ...]
    recommendation: str
    source_rule_ref: str

    @classmethod
    def create(
        cls,
        *,
        task_run_id: str,
        rule_id: str,
        rule_version: str,
        affected_object_refs: Iterable[object],
        observation_claim_ids: Iterable[object],
        applicability_status: ApplicabilityStatus | str,
        conclusion_status: ConclusionStatus | str,
        severity: Severity | str,
        evidence_refs: Iterable[object],
        recommendation: str,
        source_rule_ref: str,
        assumptions: Iterable[object] = (),
    ) -> "AuditIssue":
        affected = _ordered_strings(affected_object_refs)
        observations = _ordered_strings(observation_claim_ids)
        refs = _ordered_strings(evidence_refs)
        normalized_assumptions = _ordered_strings(assumptions)
        digest = stable_id(
            "audit-issue",
            task_run_id,
            rule_id,
            rule_version,
            affected,
            observations,
            ApplicabilityStatus(applicability_status).value,
            ConclusionStatus(conclusion_status).value,
            Severity(severity).value,
            refs,
            normalized_assumptions,
            recommendation,
            source_rule_ref,
            length=ID_LENGTH,
        )
        return cls(
            "issue:" + digest,
            str(rule_id),
            str(rule_version),
            affected,
            observations,
            ApplicabilityStatus(applicability_status),
            ConclusionStatus(conclusion_status),
            Severity(severity),
            refs,
            normalized_assumptions,
            str(recommendation),
            str(source_rule_ref),
        )


@dataclass(frozen=True, slots=True)
class Artifact:
    artifact_id: str
    artifact_type: ArtifactType
    media_type: str
    payload: tuple[tuple[str, Any], ...]
    evidence_refs: tuple[str, ...]

    @classmethod
    def create(
        cls,
        *,
        task_run_id: str,
        artifact_type: ArtifactType | str,
        media_type: str,
        payload: Mapping[str, Any] | Iterable[tuple[str, Any]],
        evidence_refs: Iterable[object] = (),
    ) -> "Artifact":
        normalized_payload = _ordered_pairs(payload)
        refs = _ordered_strings(evidence_refs)
        digest = stable_id(
            "task-artifact",
            task_run_id,
            ArtifactType(artifact_type).value,
            media_type,
            normalized_payload,
            refs,
            length=ID_LENGTH,
        )
        return cls(
            "artifact:" + digest,
            ArtifactType(artifact_type),
            str(media_type),
            normalized_payload,
            refs,
        )

    def field(self, name: str, default: Any = None) -> Any:
        return _pair_value(self.payload, name, default)


@dataclass(frozen=True, slots=True)
class TraceRecord:
    trace_id: str
    ordinal: int
    phase: str
    subject_ref: str
    status: str
    message: str
    details: tuple[tuple[str, Any], ...] = ()

    @classmethod
    def create(
        cls,
        *,
        task_run_id: str,
        ordinal: int,
        phase: str,
        subject_ref: str,
        status: str,
        message: str,
        details: Mapping[str, Any] | Iterable[tuple[str, Any]] = (),
    ) -> "TraceRecord":
        normalized = _ordered_pairs(details)
        digest = stable_id(
            "task-trace",
            task_run_id,
            ordinal,
            phase,
            subject_ref,
            status,
            message,
            normalized,
            length=ID_LENGTH,
        )
        return cls(
            "trace:" + digest,
            int(ordinal),
            str(phase),
            str(subject_ref),
            str(status),
            str(message),
            normalized,
        )


@dataclass(frozen=True, slots=True)
class DependencyEntry:
    claim_id: str
    evidence_refs: tuple[str, ...]
    upstream_manifest_sha256: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ResultDependencyGraph:
    graph_id: str
    project_snapshot_set_id: str
    entries: tuple[DependencyEntry, ...]

    @classmethod
    def create(
        cls,
        *,
        project_snapshot_set_id: str,
        claims: Iterable[Claim],
        upstream_manifest_sha256: Iterable[object],
    ) -> "ResultDependencyGraph":
        manifests = _ordered_strings(upstream_manifest_sha256)
        entries = tuple(
            DependencyEntry(claim.claim_id, claim.evidence_refs, manifests)
            for claim in sorted(claims, key=lambda item: item.claim_id)
        )
        digest = stable_id(
            "result-dependency-graph",
            project_snapshot_set_id,
            entries,
            length=ID_LENGTH,
        )
        return cls("dependency-graph:" + digest, project_snapshot_set_id, entries)

    def is_stale(self, manifest_sha256: Iterable[object]) -> bool:
        current = _ordered_strings(manifest_sha256)
        return any(entry.upstream_manifest_sha256 != current for entry in self.entries)


@dataclass(frozen=True, slots=True)
class TaskFragment:
    claims: tuple[Claim, ...] = ()
    issues: tuple[AuditIssue, ...] = ()
    artifacts: tuple[Artifact, ...] = ()
    gaps: tuple[CapabilityGap, ...] = ()
    records: tuple[tuple[str, Any], ...] = ()

    @classmethod
    def create(
        cls,
        *,
        claims: Iterable[Claim] = (),
        issues: Iterable[AuditIssue] = (),
        artifacts: Iterable[Artifact] = (),
        gaps: Iterable[CapabilityGap] = (),
        records: Mapping[str, Any] | Iterable[tuple[str, Any]] = (),
    ) -> "TaskFragment":
        return cls(
            tuple(sorted({item.claim_id: item for item in claims}.values(), key=lambda item: item.claim_id)),
            tuple(sorted({item.issue_id: item for item in issues}.values(), key=lambda item: item.issue_id)),
            tuple(sorted({item.artifact_id: item for item in artifacts}.values(), key=lambda item: item.artifact_id)),
            tuple(sorted({item.gap_id: item for item in gaps}.values(), key=lambda item: item.gap_id)),
            _ordered_pairs(records),
        )

    def record(self, name: str, default: Any = None) -> Any:
        return _pair_value(self.records, name, default)


@dataclass(frozen=True, slots=True)
class TaskResultBundle:
    task_run_id: str
    task_spec: TaskSpec
    project_snapshot_set_id: str
    recipe_id: str
    recipe_version: str
    status: TaskStatus
    readiness: TaskReadinessReport
    claims: tuple[Claim, ...]
    issues: tuple[AuditIssue, ...]
    artifacts: tuple[Artifact, ...]
    gaps: tuple[CapabilityGap, ...]
    trace: tuple[TraceRecord, ...]
    dependency_graph: ResultDependencyGraph
    capability_versions: tuple[tuple[str, str], ...]
    rule_versions: tuple[tuple[str, str], ...]
    ontology_versions: tuple[str, ...]
    pack_versions: tuple[str, ...]
    model_versions: tuple[tuple[str, str], ...] = ()
    diagnostics: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.task_run_id.startswith("task-run:"):
            raise ValueError("Task run id must use task-run:<64hex>")
        if self.task_spec.task_spec_key != self.readiness.task_spec_key:
            raise ValueError("Task result readiness belongs to another TaskSpec")
        if self.project_snapshot_set_id != self.dependency_graph.project_snapshot_set_id:
            raise ValueError("Task result dependency graph belongs to another project set")

    @classmethod
    def create(
        cls,
        *,
        task_run_id: str,
        task_spec: TaskSpec,
        project_snapshot_set_id: str,
        recipe_id: str,
        recipe_version: str,
        status: TaskStatus | str,
        readiness: TaskReadinessReport,
        claims: Iterable[Claim],
        issues: Iterable[AuditIssue],
        artifacts: Iterable[Artifact],
        gaps: Iterable[CapabilityGap],
        trace: Iterable[TraceRecord],
        dependency_graph: ResultDependencyGraph,
        capability_versions: Mapping[str, str] | Iterable[tuple[str, str]],
        rule_versions: Mapping[str, str] | Iterable[tuple[str, str]],
        ontology_versions: Iterable[object],
        pack_versions: Iterable[object],
        model_versions: Mapping[str, str] | Iterable[tuple[str, str]] = (),
        diagnostics: Iterable[object] = (),
    ) -> "TaskResultBundle":
        return cls(
            task_run_id,
            task_spec,
            project_snapshot_set_id,
            recipe_id,
            recipe_version,
            TaskStatus(status),
            readiness,
            tuple(sorted(claims, key=lambda item: item.claim_id)),
            tuple(sorted(issues, key=lambda item: item.issue_id)),
            tuple(sorted(artifacts, key=lambda item: item.artifact_id)),
            tuple(sorted(gaps, key=lambda item: item.gap_id)),
            tuple(sorted(trace, key=lambda item: (item.ordinal, item.trace_id))),
            dependency_graph,
            tuple((key, str(value)) for key, value in _ordered_pairs(capability_versions)),
            tuple((key, str(value)) for key, value in _ordered_pairs(rule_versions)),
            _ordered_strings(ontology_versions),
            _ordered_strings(pack_versions),
            tuple((key, str(value)) for key, value in _ordered_pairs(model_versions)),
            _ordered_strings(diagnostics),
        )

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)

    @classmethod
    def from_json(cls, payload: str) -> "TaskResultBundle":
        value = stable_json_loads(payload)
        if not isinstance(value, Mapping):
            raise TypeError("TaskResultBundle JSON root must be an object")
        return _result_bundle_from_mapping(value)


def _gap_from_mapping(value: Mapping[str, Any]) -> CapabilityGap:
    return CapabilityGap(
        str(value["gap_id"]),
        str(value["capability_id"]),
        str(value["missing"]),
        str(value["reason"]),
        None if value.get("claim_type") is None else str(value["claim_type"]),
        None if value.get("data_gap") is None else str(value["data_gap"]),
        tuple(str(item) for item in value.get("evidence_refs", ())),
    )


def _claim_from_mapping(value: Mapping[str, Any]) -> Claim:
    interval = value.get("value_interval")
    basis = value.get("quantity_basis")
    return Claim(
        str(value["claim_id"]),
        str(value["claim_type"]),
        str(value["subject_ref"]),
        str(value["predicate"]),
        value.get("value"),
        None if interval is None else (float(interval[0]), float(interval[1])),
        None if value.get("unit") is None else str(value["unit"]),
        str(value["scope_ref"]),
        TruthBasis(value["truth_basis"]),
        None if basis is None else QuantityBasis(basis),
        ClaimStatus(value["status"]),
        tuple(str(item) for item in value.get("evidence_refs", ())),
        tuple(str(item) for item in value.get("assumptions", ())),
        str(value["derivation_ref"]),
        tuple(str(item) for item in value.get("source_snapshot_ids", ())),
        str(value["recipe_id"]),
        str(value["recipe_version"]),
        tuple(str(item) for item in value.get("rule_ids", ())),
    )


def _issue_from_mapping(value: Mapping[str, Any]) -> AuditIssue:
    return AuditIssue(
        str(value["issue_id"]),
        str(value["rule_id"]),
        str(value["rule_version"]),
        tuple(str(item) for item in value.get("affected_object_refs", ())),
        tuple(str(item) for item in value.get("observation_claim_ids", ())),
        ApplicabilityStatus(value["applicability_status"]),
        ConclusionStatus(value["conclusion_status"]),
        Severity(value["severity"]),
        tuple(str(item) for item in value.get("evidence_refs", ())),
        tuple(str(item) for item in value.get("assumptions", ())),
        str(value.get("recommendation", "")),
        str(value["source_rule_ref"]),
    )


def _artifact_from_mapping(value: Mapping[str, Any]) -> Artifact:
    return Artifact(
        str(value["artifact_id"]),
        ArtifactType(value["artifact_type"]),
        str(value["media_type"]),
        tuple((str(name), item) for name, item in value.get("payload", ())),
        tuple(str(item) for item in value.get("evidence_refs", ())),
    )


def _readiness_from_mapping(value: Mapping[str, Any]) -> TaskReadinessReport:
    return TaskReadinessReport(
        str(value["report_id"]),
        str(value["task_spec_key"]),
        ReadinessStatus(value["overall_status"]),
        tuple(
            ClaimReadiness(
                str(item["claim_type"]),
                ReadinessStatus(item["status"]),
                tuple(str(missing) for missing in item.get("missing", ())),
                tuple(str(capability) for capability in item.get("capability_ids", ())),
            )
            for item in value.get("claim_readiness", ())
        ),
        tuple(_gap_from_mapping(item) for item in value.get("capability_gaps", ())),
        tuple(str(item) for item in value.get("data_gaps", ())),
    )


def _result_bundle_from_mapping(value: Mapping[str, Any]) -> TaskResultBundle:
    dependency_value = value["dependency_graph"]
    dependency = ResultDependencyGraph(
        str(dependency_value["graph_id"]),
        str(dependency_value["project_snapshot_set_id"]),
        tuple(
            DependencyEntry(
                str(item["claim_id"]),
                tuple(str(ref) for ref in item.get("evidence_refs", ())),
                tuple(str(digest) for digest in item.get("upstream_manifest_sha256", ())),
            )
            for item in dependency_value.get("entries", ())
        ),
    )
    return TaskResultBundle(
        str(value["task_run_id"]),
        TaskSpec.from_mapping(value["task_spec"]),
        str(value["project_snapshot_set_id"]),
        str(value["recipe_id"]),
        str(value["recipe_version"]),
        TaskStatus(value["status"]),
        _readiness_from_mapping(value["readiness"]),
        tuple(_claim_from_mapping(item) for item in value.get("claims", ())),
        tuple(_issue_from_mapping(item) for item in value.get("issues", ())),
        tuple(_artifact_from_mapping(item) for item in value.get("artifacts", ())),
        tuple(_gap_from_mapping(item) for item in value.get("gaps", ())),
        tuple(
            TraceRecord(
                str(item["trace_id"]),
                int(item["ordinal"]),
                str(item["phase"]),
                str(item["subject_ref"]),
                str(item["status"]),
                str(item["message"]),
                tuple((str(name), detail) for name, detail in item.get("details", ())),
            )
            for item in value.get("trace", ())
        ),
        dependency,
        tuple((str(name), str(version)) for name, version in value.get("capability_versions", ())),
        tuple((str(name), str(version)) for name, version in value.get("rule_versions", ())),
        tuple(str(item) for item in value.get("ontology_versions", ())),
        tuple(str(item) for item in value.get("pack_versions", ())),
        tuple((str(name), str(version)) for name, version in value.get("model_versions", ())),
        tuple(str(item) for item in value.get("diagnostics", ())),
    )
