from __future__ import annotations


GENERIC_ENCLOSURE_CANDIDATE = "generic.enclosure_candidate"
GENERIC_SHEET_BOUNDARY_CANDIDATE = "generic.sheet_boundary_candidate"
GENERIC_TEXT_BLOCK = "generic.text_block"
GENERIC_TABLE_GRID = "generic.table_grid"
GENERIC_SYMBOL_LIKE_CLUSTER = "generic.symbol_like_cluster"
GENERIC_REPEATED_MOTIF_GROUP = "generic.repeated_motif_group"
GENERIC_PATH_NETWORK = "generic.path_network"
GENERIC_NETWORK_JUNCTION = "generic.network_junction"
GENERIC_NETWORK_TERMINAL = "generic.network_terminal"

CANONICAL_PATTERN_TYPES = (
    GENERIC_ENCLOSURE_CANDIDATE,
    GENERIC_NETWORK_JUNCTION,
    GENERIC_NETWORK_TERMINAL,
    GENERIC_PATH_NETWORK,
    GENERIC_REPEATED_MOTIF_GROUP,
    GENERIC_SHEET_BOUNDARY_CANDIDATE,
    GENERIC_SYMBOL_LIKE_CLUSTER,
    GENERIC_TABLE_GRID,
    GENERIC_TEXT_BLOCK,
)

DEPRECATED_ALIASES = {
    "TablePattern": GENERIC_TABLE_GRID,
    "enclosure": GENERIC_ENCLOSURE_CANDIDATE,
    "enclosure_pattern": GENERIC_ENCLOSURE_CANDIDATE,
    "generic.table_candidate": GENERIC_TABLE_GRID,
    "label_binding_candidate": GENERIC_TEXT_BLOCK,
    "label_candidate": GENERIC_TEXT_BLOCK,
    "network_crossing_semantics": GENERIC_PATH_NETWORK,
    "path_candidate": GENERIC_PATH_NETWORK,
    "repeated_group": GENERIC_REPEATED_MOTIF_GROUP,
    "symbol_candidate": GENERIC_SYMBOL_LIKE_CLUSTER,
    "table_candidate": GENERIC_TABLE_GRID,
    "table_grid": GENERIC_TABLE_GRID,
    "text_geometry_binding_candidate": GENERIC_TEXT_BLOCK,
}

_PROFESSIONAL_TOKENS = (
    "beam",
    "door",
    "frame",
    "room",
    "transformer",
    "wall",
    "window",
)


def ensure_canonical_pattern_type(value: str) -> str:
    if value in DEPRECATED_ALIASES:
        raise ValueError(
            f"Deprecated pattern type {value!r}; use {DEPRECATED_ALIASES[value]!r}"
        )
    if value not in CANONICAL_PATTERN_TYPES:
        raise ValueError(f"Unknown canonical pattern type: {value!r}")
    lowered = value.casefold()
    matched = tuple(token for token in _PROFESSIONAL_TOKENS if token in lowered)
    if matched:
        raise ValueError(
            f"Professional semantics are forbidden in pattern types: {matched!r}"
        )
    return value


def contains_professional_semantics(value: str) -> bool:
    lowered = value.casefold()
    return any(token in lowered for token in _PROFESSIONAL_TOKENS)
