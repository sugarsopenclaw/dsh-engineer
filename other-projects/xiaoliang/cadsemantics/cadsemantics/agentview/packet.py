from __future__ import annotations

from cadsemantics.graph import SemanticGraphBundle
from cadsemantics.packs import load_builtin_manifests


def semantic_evidence_packet(
    bundle: SemanticGraphBundle,
    representation_id: str,
) -> dict[str, object]:
    representation = next(
        (
            item
            for item in bundle.drawing_graph.representations
            if item.resolution_id == representation_id
            or item.representation_key == representation_id
        ),
        None,
    )
    if representation is None:
        raise KeyError(f"Unknown semantic representation: {representation_id}")
    context = next(
        item
        for item in bundle.drawing_graph.contexts
        if item.context_id == representation.context_id
    )
    evidence = {
        ref.evidence_id: ref
        for assertion in (*representation.class_assertions, *representation.properties)
        for ref in assertion.evidence.all_refs
    }
    associated_text = tuple(
        {
            "evidence_id": item.evidence_id,
            "ref_id": item.ref_id,
            "value": item.literal,
        }
        for item in evidence.values()
        if item.kind.value == "text"
    )
    manifest = next(
        (
            item
            for item in load_builtin_manifests()
            if item.pack_id == representation.domain_pack_id
        ),
        None,
    )
    return {
        "representation_id": representation.resolution_id,
        "representation_key": representation.representation_key,
        "scope_context": {
            "context_id": context.context_id,
            "discipline_candidates": tuple(item.value for item in context.discipline_candidates),
            "drawing_type_candidates": tuple(item.value for item in context.drawing_type_candidates),
            "representation_conventions": context.representation_conventions,
        },
        "pattern": {
            "pattern_keys": representation.source_pattern_keys,
            "detection_ids": representation.source_detection_ids,
            "geometry_signature": representation.geometry_signature,
            "bounds": representation.bounds,
        },
        "associated_text": associated_text,
        "class_candidates": (
            manifest.provides_classes
            if manifest is not None
            else tuple(item.class_id for item in representation.class_assertions)
        ),
        "allowed_properties": (
            manifest.provides_properties
            if manifest is not None
            else tuple(sorted({item.property_id for item in representation.properties}))
        ),
        "evidence_refs": tuple(
            {
                "evidence_id": item.evidence_id,
                "kind": item.kind.value,
                "ref_id": item.ref_id,
                "feature_key": item.feature_key,
                "geometry_proof_grade": item.geometry_proof_grade,
            }
            for item in sorted(evidence.values(), key=lambda value: value.evidence_id)
        ),
    }
