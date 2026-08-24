from __future__ import annotations

from cadsemantics.graph import SemanticGraphBundle


def similar_representations(
    bundle: SemanticGraphBundle,
    representation_id: str,
) -> tuple[dict[str, object], ...]:
    source = next(
        (
            item
            for item in bundle.drawing_graph.representations
            if item.resolution_id == representation_id
            or item.representation_key == representation_id
        ),
        None,
    )
    if source is None:
        raise KeyError(f"Unknown semantic representation: {representation_id}")
    if source.geometry_signature is None:
        return ()
    return tuple(
        {
            "representation_id": item.resolution_id,
            "representation_key": item.representation_key,
            "semantic_class": item.semantic_class,
            "representation_mode": item.representation_mode.value,
            "geometry_signature": item.geometry_signature,
            "bounds": item.bounds,
        }
        for item in bundle.drawing_graph.representations
        if item.geometry_signature == source.geometry_signature
    )

