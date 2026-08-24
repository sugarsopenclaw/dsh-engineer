from __future__ import annotations

from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Iterable

import yaml


_OVERLAY_ORDER = ("core", "cn", "company", "project")


@dataclass(frozen=True, slots=True)
class PackManifest:
    pack_id: str
    version: str
    namespace: str
    family: str
    overlay_layer: str
    extends: str | None
    supported_disciplines: tuple[str, ...]
    supported_drawing_types: tuple[str, ...]
    requires_patterns: tuple[str, ...]
    provides_classes: tuple[str, ...]
    provides_properties: tuple[str, ...]
    provides_relations: tuple[str, ...]
    provides_roles: tuple[str, ...]
    mapping_resources: tuple[str, ...]
    lexicons: tuple[tuple[str, tuple[str, ...]], ...]
    overlay_chain: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.overlay_layer not in _OVERLAY_ORDER:
            raise ValueError(f"Unknown pack overlay layer: {self.overlay_layer}")
        if not self.pack_id or not self.version or not self.namespace:
            raise ValueError("PackManifest requires pack_id, version, and namespace")

    def lexicon(self, name: str) -> tuple[str, ...]:
        for key, values in self.lexicons:
            if key == name:
                return values
        raise KeyError(f"Pack {self.pack_id} has no lexicon {name!r}")


@dataclass(frozen=True, slots=True)
class PackRoutingDecision:
    pack_id: str
    context_id: str
    accepted: bool
    reasons: tuple[str, ...]


def _strings(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, (list, tuple)):
        raise TypeError("Pack manifest list field must be a list")
    return tuple(sorted(set(str(item) for item in value)))


def pack_manifest_from_mapping(value: object) -> PackManifest:
    if not isinstance(value, dict):
        raise TypeError("Pack manifest must be a mapping")
    contexts = value.get("supported_contexts", {})
    if not isinstance(contexts, dict):
        raise TypeError("supported_contexts must be a mapping")
    raw_lexicons = value.get("lexicons", {})
    if not isinstance(raw_lexicons, dict):
        raise TypeError("lexicons must be a mapping")
    return PackManifest(
        pack_id=str(value["pack_id"]),
        version=str(value["version"]),
        namespace=str(value["namespace"]),
        family=str(value.get("family", value["pack_id"])),
        overlay_layer=str(value.get("overlay_layer", "core")),
        extends=None if value.get("extends") is None else str(value["extends"]),
        supported_disciplines=_strings(contexts.get("disciplines")),
        supported_drawing_types=_strings(contexts.get("drawing_types")),
        requires_patterns=_strings(value.get("requires_patterns")),
        provides_classes=_strings(value.get("provides_classes")),
        provides_properties=_strings(value.get("provides_properties")),
        provides_relations=_strings(value.get("provides_relations")),
        provides_roles=_strings(value.get("provides_roles")),
        mapping_resources=_strings(value.get("mapping_resources")),
        lexicons=tuple(
            (str(name), _strings(items))
            for name, items in sorted(raw_lexicons.items())
        ),
        overlay_chain=(str(value["pack_id"]),),
    )


def load_pack_manifest(path: str | Path) -> PackManifest:
    return pack_manifest_from_mapping(
        yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    )


def load_builtin_manifests() -> tuple[PackManifest, ...]:
    package = resources.files("cadsemantics.packs")
    manifests = []
    for directory in package.iterdir():
        resource = directory / "manifest.yaml"
        if resource.is_file():
            manifests.append(
                pack_manifest_from_mapping(yaml.safe_load(resource.read_text(encoding="utf-8")))
            )
    return apply_overlays(manifests)


def _merge(left: PackManifest, right: PackManifest) -> PackManifest:
    if left.family != right.family or left.namespace != right.namespace:
        raise ValueError("Pack overlays must retain family and namespace")
    if right.extends != left.pack_id and right.extends not in left.overlay_chain:
        raise ValueError(f"Pack overlay {right.pack_id} does not extend the active chain")
    if _OVERLAY_ORDER.index(right.overlay_layer) <= _OVERLAY_ORDER.index(left.overlay_layer):
        raise ValueError("Pack overlays must follow core→cn→company→project order")
    lexicons = {name: set(values) for name, values in left.lexicons}
    for name, values in right.lexicons:
        lexicons.setdefault(name, set()).update(values)
    return PackManifest(
        pack_id=right.pack_id,
        version=right.version,
        namespace=right.namespace,
        family=right.family,
        overlay_layer=right.overlay_layer,
        extends=right.extends,
        supported_disciplines=tuple(sorted(set(left.supported_disciplines) | set(right.supported_disciplines))),
        supported_drawing_types=tuple(sorted(set(left.supported_drawing_types) | set(right.supported_drawing_types))),
        requires_patterns=tuple(sorted(set(left.requires_patterns) | set(right.requires_patterns))),
        provides_classes=tuple(sorted(set(left.provides_classes) | set(right.provides_classes))),
        provides_properties=tuple(sorted(set(left.provides_properties) | set(right.provides_properties))),
        provides_relations=tuple(sorted(set(left.provides_relations) | set(right.provides_relations))),
        provides_roles=tuple(sorted(set(left.provides_roles) | set(right.provides_roles))),
        mapping_resources=tuple(sorted(set(left.mapping_resources) | set(right.mapping_resources))),
        lexicons=tuple((name, tuple(sorted(values))) for name, values in sorted(lexicons.items())),
        overlay_chain=(*left.overlay_chain, right.pack_id),
    )


def apply_overlays(manifests: Iterable[PackManifest]) -> tuple[PackManifest, ...]:
    grouped: dict[str, list[PackManifest]] = {}
    for manifest in manifests:
        grouped.setdefault(manifest.family, []).append(manifest)
    result = []
    for family, values in sorted(grouped.items()):
        ordered = sorted(values, key=lambda item: (_OVERLAY_ORDER.index(item.overlay_layer), item.pack_id))
        core_manifests = tuple(item for item in ordered if item.overlay_layer == "core")
        if len(core_manifests) != 1:
            raise ValueError(f"Pack family {family!r} requires exactly one core manifest")
        active = core_manifests[0]
        ordered.remove(active)
        for overlay in ordered:
            active = _merge(active, overlay)
        result.append(active)
    return tuple(sorted(result, key=lambda item: item.pack_id))
