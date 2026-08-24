from cadsemantics.ontology.definitions import RelationDefinition


CORE_RELATION_IDS = (
    "core.INSTANCE_OF",
    "core.REPRESENTS",
    "core.SAME_PHYSICAL_AS",
    "core.PART_OF",
    "core.HAS_PART",
    "core.CONTAINED_IN",
    "core.PRIMARY_CONTAINMENT",
    "core.REFERENCED_IN",
    "core.LOCATED_IN",
    "core.ADJACENT_TO",
    "core.ALIGNED_WITH",
    "core.CROSSES",
    "core.REPEATS",
    "core.ALTERNATIVE_TO",
    "core.BOUNDS",
    "core.CONNECTED_TO",
    "core.HAS_TYPE",
    "core.HAS_ROLE",
    "core.SCHEDULED_AS",
    "core.DESCRIBED_BY",
    "core.CLASSIFIED_AS",
    "core.DERIVED_FROM",
    "core.CONFLICTS_WITH",
    "core.POINTS_TO",
)

BUILTIN_RELATION_DEFINITIONS = tuple(
    RelationDefinition(
        relation_id=value,
        directional=value
        not in {
            "core.ADJACENT_TO",
            "core.ALIGNED_WITH",
            "core.CONNECTED_TO",
            "core.CROSSES",
        },
    )
    for value in CORE_RELATION_IDS
)
