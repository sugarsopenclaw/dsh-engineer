from __future__ import annotations

from typing import Any, Iterable, Mapping

from cadsemantics.contracts import RepresentationMode, SemanticStatus

from cadtasks.binding import ProjectFactBundle
from cadtasks.contracts import (
    AssemblyPolicy,
    Claim,
    ClaimStatus,
    QuantityBasis,
    TaskSpec,
)
from cadtasks.rules import RuleRegistry
from cadtasks.scope import scoped_object_refs


_INSTANCE_MODES = {
    RepresentationMode.INSTANCE_VIEW,
    RepresentationMode.SCHEMATIC_INSTANCE,
    RepresentationMode.AGGREGATED_REPRESENTATION,
}


class ClaimValidationError(ValueError):
    pass


def _in_regions(
    bounds: tuple[float, float, float, float] | None,
    regions: tuple[tuple[float, float, float, float], ...],
) -> bool:
    if not regions:
        return True
    if bounds is None:
        return False
    return any(
        bounds[0] <= region[2]
        and bounds[2] >= region[0]
        and bounds[1] <= region[3]
        and bounds[3] >= region[1]
        for region in regions
    )


def _eligible_representations(
    claim: Claim,
    facts: ProjectFactBundle,
    spec: TaskSpec,
):
    layout_names = {*spec.scope.sheets, *spec.scope.views}
    regions = spec.scope.regions
    selector_bounds = spec.target.selector("bounds")
    if isinstance(selector_bounds, (tuple, list)) and len(selector_bounds) == 4:
        regions = (
            *regions,
            tuple(float(item) for item in selector_bounds),
        )
    object_refs = set(scoped_object_refs(spec, facts))

    def in_layout(bound: Any) -> bool:
        if not layout_names:
            return True
        member_refs = {
            member.ref.ref_id
            for pattern_key in bound.representation.source_pattern_keys
            for pattern_bound in facts.pattern_key_index.get(pattern_key, ())
            if pattern_bound.source_ordinal == bound.source_ordinal
            for member in pattern_bound.instance.members
        }
        return any(
            facts.occurrence_index[ref].layout_name in layout_names
            for ref in member_refs
            if ref in facts.occurrence_index
        )

    def in_object_refs(bound: Any) -> bool:
        if not object_refs:
            return True
        representation = bound.representation
        if {
            representation.resolution_id,
            representation.representation_key,
            *representation.source_pattern_keys,
            *representation.source_detection_ids,
            *(
                member.ref.ref_id
                for pattern_key in representation.source_pattern_keys
                for pattern_bound in facts.pattern_key_index.get(pattern_key, ())
                if pattern_bound.source_ordinal == bound.source_ordinal
                for member in pattern_bound.instance.members
            ),
        }.intersection(object_refs):
            return True
        return any(
            project_object.project_object.project_object_id in object_refs
            and representation.resolution_id
            in project_object.project_object.representation_ids
            for project_object in facts.project_object_index.values()
        )

    values = tuple(
        bound
        for bound in facts.representations(
            semantic_class=spec.target.semantic_class,
            snapshot_ids=claim.source_snapshot_ids,
        )
        if bound.representation.status is SemanticStatus.SUPPORTED
        and bound.representation.representation_mode in _INSTANCE_MODES
        and _in_regions(bound.representation.bounds, regions)
        and in_layout(bound)
        and in_object_refs(bound)
    )
    if spec.assembly_policy is AssemblyPolicy.COUNT_GROUPS:
        return tuple(
            bound
            for bound in values
            if bound.representation.representation_mode
            is RepresentationMode.AGGREGATED_REPRESENTATION
        )
    return tuple(
        bound
        for bound in values
        if bound.representation.representation_mode
        is not RepresentationMode.AGGREGATED_REPRESENTATION
    )


class ClaimValidator:
    version = "1.0.0"

    def __init__(self, rules: RuleRegistry | None = None) -> None:
        self.rules = rules

    def validate(
        self,
        claim: Claim,
        *,
        facts: ProjectFactBundle,
        spec: TaskSpec,
    ) -> None:
        if not claim.evidence_refs:
            raise ClaimValidationError(f"Claim has no evidence: {claim.claim_id}")
        missing = tuple(
            ref for ref in claim.evidence_refs if not facts.has_evidence(ref)
        )
        if missing:
            raise ClaimValidationError(
                f"Claim references facts outside the binding: {claim.claim_id}: "
                + ", ".join(missing)
            )
        bound_snapshots = set(facts.source_snapshot_ids)
        if not claim.source_snapshot_ids or not set(claim.source_snapshot_ids).issubset(
            bound_snapshots
        ):
            raise ClaimValidationError(
                f"Claim source snapshots are outside the binding: {claim.claim_id}"
            )
        if claim.scope_ref == "":
            raise ClaimValidationError(f"Claim scope is empty: {claim.claim_id}")
        if self.rules is not None:
            for rule_id in claim.rule_ids:
                self.rules.require(rule_id)

        if claim.quantity_basis is QuantityBasis.BOM_DECLARED:
            if claim.status is not ClaimStatus.ABSTAINED or claim.value is not None:
                raise ClaimValidationError(
                    "BOM_DECLARED must abstain until row-level declaration facts exist"
                )
        if claim.quantity_basis is QuantityBasis.PHYSICAL_INSTANCE:
            if claim.value_interval is None:
                raise ClaimValidationError("PHYSICAL_INSTANCE requires an interval")
            if claim.status is ClaimStatus.PROVEN:
                raise ClaimValidationError("PHYSICAL_INSTANCE cannot be marked PROVEN")
            if claim.status not in {ClaimStatus.AMBIGUOUS, ClaimStatus.ABSTAINED}:
                raise ClaimValidationError(
                    "PHYSICAL_INSTANCE must remain ambiguous or abstained"
                )

        if (
            claim.predicate == "count"
            and claim.quantity_basis is QuantityBasis.DRAWING_OCCURRENCE
        ):
            expected = len(_eligible_representations(claim, facts, spec))
            if claim.value != expected or claim.status is not ClaimStatus.PROVEN:
                raise ClaimValidationError(
                    f"Drawing-occurrence count is not reproducible: {claim.claim_id}"
                )
        if (
            claim.predicate == "count"
            and claim.quantity_basis is QuantityBasis.UNIQUE_TAG
        ):
            labels = {
                str(assertion.normalized_value).strip().casefold()
                for bound in _eligible_representations(claim, facts, spec)
                for assertion in bound.representation.properties
                if assertion.property_id == "core.label_text"
                and assertion.normalized_value is not None
                and str(assertion.normalized_value).strip()
            }
            if claim.value != len(labels) or claim.status is not ClaimStatus.SUPPORTED:
                raise ClaimValidationError(
                    f"Unique-label count is not reproducible: {claim.claim_id}"
                )
        if claim.claim_type == "TAG_COVERAGE":
            self._validate_tag_coverage(claim, facts, spec)
        if claim.predicate == "area" and claim.status is ClaimStatus.PROVEN:
            if not self._area_is_backed_by_fact(claim, facts):
                raise ClaimValidationError(
                    f"Area claim is not backed by a persisted area fact: {claim.claim_id}"
                )

    @staticmethod
    def _validate_tag_coverage(
        claim: Claim,
        facts: ProjectFactBundle,
        spec: TaskSpec,
    ) -> None:
        if not isinstance(claim.value, Mapping):
            raise ClaimValidationError("TAG_COVERAGE value must be an object")
        representations = _eligible_representations(claim, facts, spec)
        labeled = {
            bound.representation.resolution_id
            for bound in representations
            if any(
                assertion.property_id == "core.label_text"
                and assertion.normalized_value is not None
                and str(assertion.normalized_value).strip()
                for assertion in bound.representation.properties
            )
        }
        total = len(representations)
        expected = {
            "ratio": len(labeled) / total if total else 0,
            "labeled_representation_count": len(labeled),
            "unlabeled_representation_count": total - len(labeled),
            "total_representation_count": total,
        }
        if dict(claim.value) != expected:
            raise ClaimValidationError("TAG_COVERAGE is not reproducible")

    @staticmethod
    def _area_is_backed_by_fact(claim: Claim, facts: ProjectFactBundle) -> bool:
        if not isinstance(claim.value, (int, float)):
            return False
        for ref in claim.evidence_refs:
            pattern = facts.detection_index.get(ref)
            if pattern is not None:
                value = pattern.instance.feature("area")
                if value is not None and float(value) == float(claim.value):
                    return True
            for bound in facts.pattern_key_index.get(ref, ()):
                value = bound.instance.feature("area")
                if value is not None and float(value) == float(claim.value):
                    return True
            face = facts.face_index.get(ref)
            if face is not None and face.area == float(claim.value):
                return True
        return False

    def validate_all(
        self,
        claims: Iterable[Claim],
        *,
        facts: ProjectFactBundle,
        spec: TaskSpec,
    ) -> None:
        seen = set()
        for claim in claims:
            if claim.claim_id in seen:
                raise ClaimValidationError(f"Duplicate claim id: {claim.claim_id}")
            seen.add(claim.claim_id)
            self.validate(claim, facts=facts, spec=spec)
