from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from cadkernel.contracts import Diagnostic


@dataclass(frozen=True, slots=True)
class FaceIndexRecord:
    face_id: str
    depth: int
    hole_count: int
    area: float
    bounds: tuple[float, float, float, float]
    geometry_wkb: bytes
    boundary_json: str


@dataclass(frozen=True, slots=True)
class DerivedArtifactPayload:
    artifact_id: str
    operator_id: str
    operator_version: str
    tolerance_profile_id: str
    precision_model_id: str
    input_digest: str
    json_payload: str
    arrays: tuple[tuple[str, np.ndarray], ...] = ()
    faces: tuple[FaceIndexRecord, ...] = ()
    decision: str = "computed"
    validation_diagnostics: tuple[Diagnostic | str, ...] = ()
