from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from enum import Enum
from typing import Any

import numpy as np

from cadkernel._ids import stable_id
from cadkernel._serialization import stable_json_loads
from cadkernel.contracts import (
    EvidenceRef,
    Exactness,
    OperatorSpec,
    OpResult,
    operator_registry,
)
from cadkernel.contracts.models import successful_result
from cadkernel.ir import DrawingSnapshot


class IdentityKey(str, Enum):
    OCCURRENCE = "occurrence"
    DEFINITION_INSTANCE = "definition_instance"
    ATTRIBUTE_VALUE = "attribute_value"
    ANNOTATION_RECORD = "annotation_record"
    GEOMETRY_SIGNATURE = "geometry_signature"


@dataclass(frozen=True, slots=True)
class CountSelector:
    occurrence_ids: tuple[str, ...] | None = None
    layer_in: tuple[str, ...] = ()
    layer_not_in: tuple[str, ...] = ()
    source_type_in: tuple[str, ...] = ()
    layout_in: tuple[str, ...] = ()
    block_in: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.occurrence_ids is not None:
            object.__setattr__(
                self,
                "occurrence_ids",
                tuple(sorted(set(str(value) for value in self.occurrence_ids))),
            )
        for name in (
            "layer_in",
            "layer_not_in",
            "source_type_in",
            "layout_in",
            "block_in",
        ):
            object.__setattr__(
                self,
                name,
                tuple(sorted(set(str(value) for value in getattr(self, name)))),
            )


@dataclass(frozen=True, slots=True)
class DedupEntry:
    kind: str
    key: str
    occurrence_ids: tuple[str, ...]
    layout_names: tuple[str, ...]
    retained_id: str | None
    excluded_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DedupReport:
    entries: tuple[DedupEntry, ...]


@dataclass(frozen=True, slots=True)
class CountResult:
    population: int | float
    identity_key: IdentityKey
    filters: tuple[tuple[str, tuple[str, ...]], ...]
    included_ids: tuple[str, ...]
    excluded_ids: tuple[str, ...]
    excluded_reasons: tuple[tuple[str, str], ...]
    assumptions: tuple[str, ...]
    evidence: tuple[EvidenceRef, ...]
    dedup_report: DedupReport


def _coerce_selector(selector: Any | None) -> CountSelector:
    if selector is None:
        return CountSelector()
    if isinstance(selector, CountSelector):
        return selector
    if isinstance(selector, str):
        return CountSelector(occurrence_ids=(selector,))
    occurrence_ids = getattr(selector, "occurrence_ids", None)
    if occurrence_ids is not None:
        return CountSelector(occurrence_ids=tuple(str(value) for value in occurrence_ids))
    hits = getattr(selector, "hits", None)
    if hits is not None:
        values = tuple(
            str(hit.occurrence_id)
            for hit in hits
            if getattr(hit, "occurrence_id", None) is not None
        )
        return CountSelector(occurrence_ids=values)
    try:
        return CountSelector(occurrence_ids=tuple(str(value) for value in selector))
    except TypeError as error:
        raise TypeError("selector must be CountSelector, query hits, or occurrence ids") from error


def _definition_position(snapshot: DrawingSnapshot, definition_id: str) -> int | None:
    position = int(np.searchsorted(snapshot.definitions.definition_ids, definition_id))
    if position >= len(snapshot.definitions):
        return None
    if str(snapshot.definitions.definition_ids[position]) != definition_id:
        return None
    return position


def _occurrence_position(snapshot: DrawingSnapshot, occurrence_id: str) -> int | None:
    position = int(np.searchsorted(snapshot.occurrences.occurrence_ids, occurrence_id))
    if position >= len(snapshot.occurrences):
        return None
    if str(snapshot.occurrences.occurrence_ids[position]) != occurrence_id:
        return None
    return position


def _properties(snapshot: DrawingSnapshot, occurrence_id: str) -> dict[str, str]:
    occurrence_position = _occurrence_position(snapshot, occurrence_id)
    if occurrence_position is None:
        return {"layer": "", "source_type": "", "layout": "", "block": "", "handle": ""}
    definition_id = str(snapshot.occurrences.definition_ids[occurrence_position])
    definition_position = _definition_position(snapshot, definition_id)
    if definition_position is None:
        return {"layer": "", "source_type": "", "layout": "", "block": "", "handle": ""}
    block_path = stable_json_loads(
        str(snapshot.definitions.block_definition_paths[definition_position])
    )
    source_type = str(snapshot.definitions.dxf_types[definition_position])
    try:
        geometry_position = int(snapshot.geometry.positions([occurrence_id])[0])
    except KeyError:
        geometry_position = None
    if geometry_position is not None:
        source_type = str(snapshot.geometry.source_types[geometry_position])
    return {
        "layer": str(snapshot.definitions.layers[definition_position]),
        "source_type": source_type,
        "layout": str(snapshot.occurrences.layout_names[occurrence_position]),
        "block": str(block_path[-1]) if block_path else "",
        "handle": str(snapshot.definitions.source_handles[definition_position]),
    }


def _universe(snapshot: DrawingSnapshot, identity_key: IdentityKey) -> tuple[str, ...]:
    if identity_key is IdentityKey.ANNOTATION_RECORD:
        return tuple(str(value) for value in snapshot.annotations.occurrence_ids)
    if identity_key is IdentityKey.ATTRIBUTE_VALUE:
        return tuple(
            sorted(
                {
                    str(snapshot.texts.occurrence_ids[index])
                    for index in range(len(snapshot.texts))
                    if str(snapshot.texts.block_attribute_value[index]) != ""
                }
            )
        )
    if identity_key is IdentityKey.DEFINITION_INSTANCE:
        insert_definition_ids = set(
            str(snapshot.definitions.definition_ids[index])
            for index in range(len(snapshot.definitions))
            if str(snapshot.definitions.dxf_types[index]).upper() == "INSERT"
        )
        return tuple(
            str(snapshot.occurrences.occurrence_ids[index])
            for index in range(len(snapshot.occurrences))
            if str(snapshot.occurrences.definition_ids[index]) in insert_definition_ids
        )
    if identity_key is IdentityKey.OCCURRENCE:
        return tuple(
            str(snapshot.occurrences.occurrence_ids[index])
            for index in range(len(snapshot.occurrences))
            if "annotation-derived:" not in str(snapshot.occurrences.instance_paths[index])
        )
    return tuple(
        str(snapshot.geometry.occurrence_ids[index])
        for index in range(len(snapshot.geometry))
        if not snapshot.geometry.annotation_derived[index]
    )


def _apply_filters(
    snapshot: DrawingSnapshot,
    universe: tuple[str, ...],
    selector: CountSelector,
) -> tuple[tuple[str, ...], tuple[tuple[str, str], ...]]:
    selected = set(selector.occurrence_ids) if selector.occurrence_ids is not None else None
    included: list[str] = []
    excluded: list[tuple[str, str]] = []
    universe_set = set(universe)
    candidates = universe_set if selected is None else universe_set & selected
    for occurrence_id in sorted(candidates):
        properties = _properties(snapshot, occurrence_id)
        reason = None
        if selector.layer_in and properties["layer"] not in selector.layer_in:
            reason = "layer_not_included"
        elif selector.layer_not_in and properties["layer"] in selector.layer_not_in:
            reason = "layer_excluded"
        elif selector.source_type_in and properties["source_type"] not in selector.source_type_in:
            reason = "source_type_not_included"
        elif selector.layout_in and properties["layout"] not in selector.layout_in:
            reason = "layout_not_included"
        elif selector.block_in and properties["block"] not in selector.block_in:
            reason = "block_not_included"
        if reason is None:
            included.append(occurrence_id)
        else:
            excluded.append((occurrence_id, reason))
    if selected is not None:
        unknown = sorted(selected - universe_set)
        excluded.extend((occurrence_id, "not_in_identity_population") for occurrence_id in unknown)
    return tuple(included), tuple(sorted(excluded))


def _geometry_signature(snapshot: DrawingSnapshot, occurrence_id: str) -> str:
    row = int(snapshot.geometry.positions([occurrence_id])[0])
    start = int(snapshot.geometry.coordinate_offsets[row])
    end = int(snapshot.geometry.coordinate_offsets[row + 1])
    coordinates = tuple(
        tuple(float(value) for value in point)
        for point in snapshot.geometry.coordinates[start:end]
    )
    parameters = tuple(
        None if np.isnan(value) else float(value)
        for value in snapshot.geometry.parameters[row]
    )
    return stable_id(
        "geometry-signature-v1",
        int(snapshot.geometry.kinds[row]),
        bool(snapshot.geometry.closed[row]),
        coordinates,
        parameters,
        length=64,
    )


def _cross_layout_entries(
    snapshot: DrawingSnapshot,
    occurrence_ids: tuple[str, ...],
) -> list[DedupEntry]:
    groups: dict[str, list[str]] = {}
    for occurrence_id in occurrence_ids:
        handle = _properties(snapshot, occurrence_id)["handle"]
        if handle:
            groups.setdefault(handle, []).append(occurrence_id)
    entries: list[DedupEntry] = []
    for handle, ids in sorted(groups.items()):
        layouts = tuple(sorted({_properties(snapshot, value)["layout"] for value in ids}))
        if len(layouts) < 2:
            continue
        ordered = tuple(sorted(ids))
        entries.append(
            DedupEntry(
                kind="source_handle_across_layouts",
                key=handle,
                occurrence_ids=ordered,
                layout_names=layouts,
                retained_id=None,
                excluded_ids=(),
            )
        )
    return entries


_NUMBER = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$")


def _attribute_population(
    snapshot: DrawingSnapshot,
    occurrence_ids: tuple[str, ...],
) -> tuple[int | float, tuple[str, ...], tuple[tuple[str, str], ...]]:
    value_by_occurrence = {
        str(snapshot.texts.occurrence_ids[index]): str(
            snapshot.texts.block_attribute_value[index]
        )
        for index in range(len(snapshot.texts))
        if str(snapshot.texts.block_attribute_value[index]) != ""
    }
    total = 0.0
    included: list[str] = []
    excluded: list[tuple[str, str]] = []
    for occurrence_id in occurrence_ids:
        normalized = unicodedata.normalize(
            "NFKC", value_by_occurrence.get(occurrence_id, "")
        ).strip().replace(",", "")
        if not _NUMBER.fullmatch(normalized):
            excluded.append((occurrence_id, "attribute_value_not_numeric"))
            continue
        total += float(normalized)
        included.append(occurrence_id)
    population: int | float = int(total) if total.is_integer() else total
    return population, tuple(included), tuple(excluded)


@operator_registry.operator(
    OperatorSpec(
        "aggregate.count",
        "1.0.0",
        "Count an explicitly selected identity population with a deduplication audit",
        "DrawingSnapshot+selector+identity_key",
        "CountResult",
        Exactness.EXACT,
    )
)
def count(
    snapshot: DrawingSnapshot,
    selector: Any | None = None,
    *,
    identity_key: IdentityKey | str,
) -> OpResult[CountResult]:
    key = IdentityKey(identity_key)
    resolved_selector = _coerce_selector(selector)
    universe = _universe(snapshot, key)
    filtered, excluded_reasons = _apply_filters(snapshot, universe, resolved_selector)
    included = filtered
    population: int | float = len(included)
    dedup_entries = _cross_layout_entries(snapshot, filtered)
    assumptions: list[str] = []

    if key is IdentityKey.ATTRIBUTE_VALUE:
        population, included, attribute_excluded = _attribute_population(snapshot, filtered)
        excluded_reasons = tuple(sorted((*excluded_reasons, *attribute_excluded)))
        assumptions.append("attribute values are summed only when the complete normalized value is numeric")
    elif key is IdentityKey.GEOMETRY_SIGNATURE:
        signature_groups: dict[str, list[str]] = {}
        for occurrence_id in filtered:
            signature_groups.setdefault(
                _geometry_signature(snapshot, occurrence_id), []
            ).append(occurrence_id)
        retained: list[str] = []
        signature_excluded: list[tuple[str, str]] = []
        for signature, ids in sorted(signature_groups.items()):
            ordered = tuple(sorted(ids))
            retained.append(ordered[0])
            if len(ordered) > 1:
                excluded = ordered[1:]
                signature_excluded.extend(
                    (occurrence_id, "duplicate_geometry_signature")
                    for occurrence_id in excluded
                )
                dedup_entries.append(
                    DedupEntry(
                        kind="geometry_signature",
                        key=signature,
                        occurrence_ids=ordered,
                        layout_names=tuple(
                            sorted({_properties(snapshot, value)["layout"] for value in ordered})
                        ),
                        retained_id=ordered[0],
                        excluded_ids=excluded,
                    )
                )
        included = tuple(retained)
        population = len(included)
        excluded_reasons = tuple(sorted((*excluded_reasons, *signature_excluded)))
        assumptions.append(
            "geometry_signature v1 is coordinate-exact and does not claim translation, rotation, or mirror invariance"
        )

    evidence: list[EvidenceRef] = []
    for occurrence_id in included:
        occurrence_position = _occurrence_position(snapshot, occurrence_id)
        definition_id = (
            str(snapshot.occurrences.definition_ids[occurrence_position])
            if occurrence_position is not None
            else None
        )
        evidence.append(
            EvidenceRef(
                snapshot_id=snapshot.snapshot_id,
                occurrence_id=occurrence_id,
                definition_entity_id=definition_id,
            )
        )
    filters = tuple(
        (name, tuple(getattr(resolved_selector, name)))
        for name in (
            "layer_in",
            "layer_not_in",
            "source_type_in",
            "layout_in",
            "block_in",
        )
        if getattr(resolved_selector, name)
    )
    result = CountResult(
        population=population,
        identity_key=key,
        filters=filters,
        included_ids=tuple(included),
        excluded_ids=tuple(sorted({value for value, _ in excluded_reasons})),
        excluded_reasons=excluded_reasons,
        assumptions=tuple(assumptions),
        evidence=tuple(evidence),
        dedup_report=DedupReport(
            tuple(sorted(dedup_entries, key=lambda item: (item.kind, item.key)))
        ),
    )
    return successful_result(
        result,
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.EXACT,
        evidence=result.evidence,
        assumptions=result.assumptions,
        derivation=(
            f"identity_key={key.value}",
            "selector filters and exclusions are retained in CountResult",
            "cross-layout source-handle duplicates are reported without silently changing occurrence counts",
        ),
    )
