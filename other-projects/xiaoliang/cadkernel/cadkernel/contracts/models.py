from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Generic, TypeVar

from cadkernel._ids import stable_id
from cadkernel._serialization import stable_json_dumps, stable_json_loads


class OpStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"
    AMBIGUOUS = "ambiguous"
    UNSUPPORTED = "unsupported"
    CONVERSION_REQUIRED = "conversion_required"


class Decision(str, Enum):
    COMPUTED = "computed"
    PROVEN_TRUE = "proven_true"
    PROVEN_FALSE = "proven_false"
    APPROXIMATED = "approximated"
    AMBIGUOUS = "ambiguous"
    UNSUPPORTED = "unsupported"
    REJECTED = "rejected"


class Exactness(str, Enum):
    EXACT = "exact"
    EXACT_PREDICATE = "exact_predicate"
    GRID_SNAPPED = "grid_snapped"
    APPROXIMATED_CURVE = "approximated_curve"
    FLOATING_CONSTRUCTION = "floating_construction"
    UNKNOWN = "unknown"


class DiagnosticSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class Diagnostic:
    code: str
    message: str
    severity: DiagnosticSeverity = DiagnosticSeverity.WARNING
    details: tuple[tuple[str, str], ...] = ()

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "Diagnostic":
        return cls(
            code=str(value["code"]),
            message=str(value["message"]),
            severity=DiagnosticSeverity(value.get("severity", "warning")),
            details=tuple((str(k), str(v)) for k, v in value.get("details", ())),
        )


@dataclass(frozen=True, slots=True)
class EvidenceRef:
    snapshot_id: str
    occurrence_id: str | None = None
    definition_entity_id: str | None = None
    source_parameter_range: tuple[float, float] | None = None
    vertex_range: tuple[int, int] | None = None

    def __post_init__(self) -> None:
        if not self.snapshot_id:
            raise ValueError("EvidenceRef requires snapshot_id")
        if self.source_parameter_range is not None:
            start, end = self.source_parameter_range
            if start > end:
                raise ValueError("source_parameter_range must be ordered")

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "EvidenceRef":
        parameter_range = value.get("source_parameter_range")
        vertex_range = value.get("vertex_range")
        return cls(
            snapshot_id=str(value["snapshot_id"]),
            occurrence_id=value.get("occurrence_id"),
            definition_entity_id=value.get("definition_entity_id"),
            source_parameter_range=(
                tuple(float(item) for item in parameter_range) if parameter_range is not None else None
            ),
            vertex_range=(tuple(int(item) for item in vertex_range) if vertex_range is not None else None),
        )


@dataclass(frozen=True, slots=True)
class ToleranceProfile:
    numeric_equality: float = 1e-9
    endpoint_snap: float = 1e-3
    collinearity: float = 1e-6
    parallel_angle: float = 1e-6
    perpendicular_angle: float = 1e-6
    topological_closure: float = 1e-3
    coplanarity: float = 1e-6
    curve_chord_error: float = 1e-2
    max_curve_segment_length: float = 100.0
    linear_unit: str = "drawing_unit"
    profile_name: str = "normal"

    def __post_init__(self) -> None:
        numeric_fields = (
            "numeric_equality",
            "endpoint_snap",
            "collinearity",
            "parallel_angle",
            "perpendicular_angle",
            "topological_closure",
            "coplanarity",
            "curve_chord_error",
            "max_curve_segment_length",
        )
        for name in numeric_fields:
            if getattr(self, name) < 0:
                raise ValueError(f"{name} must be non-negative")
        if self.curve_chord_error == 0:
            raise ValueError("curve_chord_error must be positive")
        if self.max_curve_segment_length == 0:
            raise ValueError("max_curve_segment_length must be positive")

    @property
    def profile_id(self) -> str:
        return stable_id("tolerance-profile", self, length=64)

    def to_json(self) -> str:
        return stable_json_dumps(self)

    @classmethod
    def from_json(cls, payload: str) -> "ToleranceProfile":
        return cls(**stable_json_loads(payload))


@dataclass(frozen=True, slots=True)
class PrecisionModel:
    grid_size: float = 1e-3
    max_region_span: float = 1e6
    overflow_safety_factor: float = 0.5
    integer_dtype: str = "int64"
    rounding: str = "half_even"
    model_name: str = "millimetre-micron-grid"

    def __post_init__(self) -> None:
        if self.grid_size <= 0:
            raise ValueError("grid_size must be positive")
        if self.max_region_span <= 0:
            raise ValueError("max_region_span must be positive")
        if not 0 < self.overflow_safety_factor <= 1:
            raise ValueError("overflow_safety_factor must be in (0, 1]")
        if self.integer_dtype != "int64":
            raise ValueError("M1 precision predicates require int64")
        if self.rounding != "half_even":
            raise ValueError("M1 supports deterministic NumPy half-even rounding only")

    @property
    def model_id(self) -> str:
        return stable_id("precision-model", self, length=64)

    def to_json(self) -> str:
        return stable_json_dumps(self)

    @classmethod
    def from_json(cls, payload: str) -> "PrecisionModel":
        return cls(**stable_json_loads(payload))


@dataclass(frozen=True, slots=True)
class OperatorSpec:
    operator_id: str
    version: str
    summary: str
    input_type: str
    output_type: str
    exactness: Exactness
    tolerance_fields: tuple[str, ...] = ()
    requires_coordinate_frame: bool = True
    deterministic: bool = True

    @property
    def spec_id(self) -> str:
        return stable_id("operator-spec", self.operator_id, self.version, length=64)


T = TypeVar("T")


@dataclass(frozen=True, slots=True, eq=False)
class OpResult(Generic[T]):
    status: OpStatus
    value: T | None
    decision: Decision
    exactness: Exactness
    snapshot_id: str
    coordinate_frame_id: str | None
    evidence: tuple[EvidenceRef, ...] = ()
    assumptions: tuple[str, ...] = ()
    diagnostics: tuple[Diagnostic, ...] = ()
    derivation: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.snapshot_id:
            raise ValueError("Every computation result requires snapshot_id")
        if self.status is OpStatus.SUCCESS and self.value is None:
            raise ValueError("A successful OpResult requires a value")
        incompatible = {
            OpStatus.SUCCESS: {Decision.AMBIGUOUS, Decision.UNSUPPORTED, Decision.REJECTED},
            OpStatus.AMBIGUOUS: set(Decision) - {Decision.AMBIGUOUS},
            OpStatus.UNSUPPORTED: set(Decision) - {Decision.UNSUPPORTED},
            OpStatus.FAILED: set(Decision) - {Decision.REJECTED},
        }
        if self.decision in incompatible.get(self.status, set()):
            raise ValueError(
                f"OpStatus {self.status.value!r} is incompatible with "
                f"Decision {self.decision.value!r}"
            )
        if any(item.snapshot_id != self.snapshot_id for item in self.evidence):
            raise ValueError("EvidenceRef snapshot_id must match OpResult snapshot_id")

    def to_json(self, *, pretty: bool = False) -> str:
        return stable_json_dumps(self, pretty=pretty)

    @classmethod
    def from_json(
        cls,
        payload: str,
        *,
        value_decoder: Callable[[Any], T] | None = None,
    ) -> "OpResult[T]":
        value = stable_json_loads(payload)
        decoded_value = value.get("value")
        if value_decoder is not None and decoded_value is not None:
            decoded_value = value_decoder(decoded_value)
        return cls(
            status=OpStatus(value["status"]),
            value=decoded_value,
            decision=Decision(value["decision"]),
            exactness=Exactness(value["exactness"]),
            snapshot_id=str(value["snapshot_id"]),
            coordinate_frame_id=value.get("coordinate_frame_id"),
            evidence=tuple(EvidenceRef.from_dict(item) for item in value.get("evidence", ())),
            assumptions=tuple(str(item) for item in value.get("assumptions", ())),
            diagnostics=tuple(Diagnostic.from_dict(item) for item in value.get("diagnostics", ())),
            derivation=tuple(str(item) for item in value.get("derivation", ())),
        )

    def __eq__(self, other: object) -> bool:
        return isinstance(other, OpResult) and self.to_json() == other.to_json()


def successful_result(
    value: T,
    *,
    snapshot_id: str,
    coordinate_frame_id: str | None,
    exactness: Exactness,
    decision: Decision = Decision.COMPUTED,
    evidence: tuple[EvidenceRef, ...] = (),
    assumptions: tuple[str, ...] = (),
    diagnostics: tuple[Diagnostic, ...] = (),
    derivation: tuple[str, ...] = (),
    status: OpStatus | None = None,
) -> OpResult[T]:
    resolved_status = status
    if resolved_status is None:
        resolved_status = {
            Decision.AMBIGUOUS: OpStatus.AMBIGUOUS,
            Decision.UNSUPPORTED: OpStatus.UNSUPPORTED,
            Decision.REJECTED: OpStatus.FAILED,
        }.get(decision, OpStatus.SUCCESS)
    return OpResult(
        status=resolved_status,
        value=value,
        decision=decision,
        exactness=exactness,
        snapshot_id=snapshot_id,
        coordinate_frame_id=coordinate_frame_id,
        evidence=evidence,
        assumptions=assumptions,
        diagnostics=diagnostics,
        derivation=derivation,
    )
