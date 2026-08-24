from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from cadkernel._serialization import freeze_array, freeze_text_array


def _unicode_array(values: Any) -> np.ndarray:
    # freeze_text_array keeps short columns fixed-width and degrades oversized
    # ones to object arrays instead of attempting a giant allocation.
    return freeze_text_array(values)


@dataclass(frozen=True, slots=True, eq=False)
class EntityDefinitionTable:
    definition_ids: np.ndarray
    file_ids: np.ndarray
    layout_ids: np.ndarray
    block_definition_paths: np.ndarray
    source_handles: np.ndarray
    dxf_types: np.ndarray
    layers: np.ndarray

    def __post_init__(self) -> None:
        fields = (
            "definition_ids",
            "file_ids",
            "layout_ids",
            "block_definition_paths",
            "source_handles",
            "dxf_types",
            "layers",
        )
        length: int | None = None
        for name in fields:
            array = _unicode_array(getattr(self, name))
            object.__setattr__(self, name, array)
            length = len(array) if length is None else length
            if len(array) != length:
                raise ValueError("EntityDefinitionTable columns must have equal length")

    def __len__(self) -> int:
        return len(self.definition_ids)

    @classmethod
    def empty(cls) -> "EntityDefinitionTable":
        return cls(*([np.asarray([], dtype="<U1")] * 7))


@dataclass(frozen=True, slots=True, eq=False)
class EntityOccurrenceTable:
    occurrence_ids: np.ndarray
    definition_ids: np.ndarray
    layout_names: np.ndarray
    instance_paths: np.ndarray
    transform_classes: np.ndarray
    transform_offsets: np.ndarray
    transforms: np.ndarray

    def __post_init__(self) -> None:
        for name in (
            "occurrence_ids",
            "definition_ids",
            "layout_names",
            "instance_paths",
            "transform_classes",
        ):
            object.__setattr__(self, name, _unicode_array(getattr(self, name)))
        row_count = len(self.occurrence_ids)
        if any(
            len(getattr(self, name)) != row_count
            for name in ("definition_ids", "layout_names", "instance_paths", "transform_classes")
        ):
            raise ValueError("EntityOccurrenceTable columns must have equal length")
        offsets = freeze_array(self.transform_offsets, dtype=np.int64, ndim=1)
        transforms = freeze_array(self.transforms, dtype=np.float64, ndim=3)
        if transforms.shape[1:] != (4, 4):
            raise ValueError("transforms must have shape (N, 4, 4)")
        if offsets.shape != (row_count + 1,) or offsets[0] != 0 or offsets[-1] != len(transforms):
            raise ValueError("Invalid transform offsets")
        if np.any(offsets[1:] < offsets[:-1]):
            raise ValueError("transform_offsets must be monotonic")
        object.__setattr__(self, "transform_offsets", offsets)
        object.__setattr__(self, "transforms", transforms)

    def __len__(self) -> int:
        return len(self.occurrence_ids)

    @classmethod
    def empty(cls) -> "EntityOccurrenceTable":
        empty_text = np.asarray([], dtype="<U1")
        return cls(
            empty_text,
            empty_text,
            empty_text,
            empty_text,
            empty_text,
            np.asarray([0], dtype=np.int64),
            np.empty((0, 4, 4), dtype=np.float64),
        )


TEXT_FIELDS = (
    "raw_text",
    "normalized_text",
    "plain_text",
    "block_attribute_tag",
    "block_attribute_value",
    "layer_name",
    "block_name",
    "layout_name",
    "drawing_title",
)


@dataclass(frozen=True, slots=True, eq=False)
class TextStore:
    occurrence_ids: np.ndarray
    raw_text: np.ndarray
    normalized_text: np.ndarray
    plain_text: np.ndarray
    block_attribute_tag: np.ndarray
    block_attribute_value: np.ndarray
    layer_name: np.ndarray
    block_name: np.ndarray
    layout_name: np.ndarray
    drawing_title: np.ndarray
    points: np.ndarray

    def __post_init__(self) -> None:
        object.__setattr__(self, "occurrence_ids", _unicode_array(self.occurrence_ids))
        for name in TEXT_FIELDS:
            object.__setattr__(self, name, _unicode_array(getattr(self, name)))
        row_count = len(self.occurrence_ids)
        if any(len(getattr(self, name)) != row_count for name in TEXT_FIELDS):
            raise ValueError("TextStore columns must have equal length")
        points = freeze_array(self.points, dtype=np.float64, ndim=2)
        if points.shape != (row_count, 3):
            raise ValueError("TextStore.points must have shape (N, 3)")
        object.__setattr__(self, "points", points)

    def __len__(self) -> int:
        return len(self.occurrence_ids)

    @classmethod
    def empty(cls) -> "TextStore":
        empty = np.asarray([], dtype="<U1")
        return cls(
            empty,
            *([empty] * len(TEXT_FIELDS)),
            np.empty((0, 3), dtype=np.float64),
        )

