from __future__ import annotations

from cadsemantics.contracts import IdentityAssertion, IdentityEdgeType


def proven_different_pairs(
    assertions: tuple[IdentityAssertion, ...],
) -> tuple[tuple[str, str], ...]:
    return tuple(
        sorted(
            {
                tuple(
                    sorted(
                        (
                            item.source_representation_id,
                            item.target_representation_id,
                        )
                    )
                )
                for item in assertions
                if item.edge_type is IdentityEdgeType.DIFFERENT_OBJECT_PROVEN
            }
        )
    )


def supported_merge_pairs(
    assertions: tuple[IdentityAssertion, ...],
) -> tuple[tuple[str, str], ...]:
    forbidden = set(proven_different_pairs(assertions))
    supported = {
        tuple(sorted((item.source_representation_id, item.target_representation_id)))
        for item in assertions
        if item.edge_type is IdentityEdgeType.SAME_OBJECT_SUPPORTED
    }
    return tuple(sorted(supported - forbidden))
