from __future__ import annotations

from cadsemantics.contracts import EvidenceBundle, EvidenceGrade, SemanticStatus


def fuse_evidence(
    bundle: EvidenceBundle,
    *,
    has_required_alternative: bool,
    should_declared: bool,
    should_matched: bool | None = None,
    should_match_ratio: float | None = None,
    minimum_should_ratio: float = 0.5,
) -> tuple[SemanticStatus, EvidenceGrade]:
    if not 0.0 <= minimum_should_ratio <= 1.0:
        raise ValueError("minimum_should_ratio must be within [0, 1]")
    if should_match_ratio is not None and not 0.0 <= should_match_ratio <= 1.0:
        raise ValueError("should_match_ratio must be within [0, 1]")
    if bundle.excluding:
        return SemanticStatus.REJECTED, EvidenceGrade.DETERMINISTIC_RULE_DERIVED
    if bundle.missing_required:
        return SemanticStatus.REJECTED, EvidenceGrade.DETERMINISTIC_RULE_DERIVED
    if not has_required_alternative:
        return SemanticStatus.ABSTAINED, EvidenceGrade.UNKNOWN
    effective_ratio = (
        should_match_ratio
        if should_match_ratio is not None
        else 1.0
        if should_matched
        else 0.0
    )
    if should_declared and effective_ratio < minimum_should_ratio:
        return SemanticStatus.AMBIGUOUS, EvidenceGrade.DETERMINISTIC_RULE_DERIVED
    if len(bundle.supporting) > 1:
        return SemanticStatus.SUPPORTED, EvidenceGrade.MULTI_EVIDENCE_SUPPORTED
    return SemanticStatus.SUPPORTED, EvidenceGrade.DETERMINISTIC_RULE_DERIVED
