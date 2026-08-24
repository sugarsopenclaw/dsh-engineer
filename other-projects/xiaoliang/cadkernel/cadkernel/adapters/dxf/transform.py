from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

import numpy as np


class TransformClass(str, Enum):
    RIGID = "rigid"
    SIMILARITY = "similarity"
    AFFINE = "affine"
    MIRRORED = "mirrored"
    NON_UNIFORM_SCALE = "non_uniform_scale"
    SINGULAR = "singular"


@dataclass(frozen=True, slots=True)
class TransformClassification:
    kind: TransformClass
    determinant: float
    singular_values: tuple[float, float, float]


def classify_transform(matrix: Any, *, tolerance: float = 1e-10) -> TransformClassification:
    value = np.asarray(matrix, dtype=np.float64)
    if value.shape == (16,):
        value = value.reshape((4, 4))
    if value.shape != (4, 4) or not np.isfinite(value).all():
        raise ValueError("Transform must be a finite 4x4 matrix")
    linear = value[:3, :3]
    determinant = float(np.linalg.det(linear))
    singular_values_array = np.linalg.svd(linear, compute_uv=False)
    singular_values = tuple(float(item) for item in singular_values_array)
    scale = max(float(singular_values_array.max(initial=0.0)), 1.0)
    if abs(determinant) <= tolerance * scale**3 or float(singular_values_array.min()) <= tolerance:
        kind = TransformClass.SINGULAR
    elif determinant < 0:
        kind = TransformClass.MIRRORED
    elif np.allclose(singular_values_array, 1.0, rtol=tolerance, atol=tolerance):
        kind = TransformClass.RIGID
    elif np.allclose(
        singular_values_array,
        singular_values_array[0],
        rtol=tolerance,
        atol=tolerance * scale,
    ):
        kind = TransformClass.SIMILARITY
    else:
        gram = linear @ linear.T
        off_diagonal = gram - np.diag(np.diag(gram))
        if np.allclose(off_diagonal, 0.0, rtol=tolerance, atol=tolerance * scale**2):
            kind = TransformClass.NON_UNIFORM_SCALE
        else:
            kind = TransformClass.AFFINE
    return TransformClassification(kind, determinant, singular_values)
