from __future__ import annotations

import numpy as np
import pytest

import cadkernel
from cadkernel.contracts import Decision, EvidenceRef, Exactness, OpResult, OpStatus, PrecisionModel, ToleranceProfile
from cadkernel.contracts.models import successful_result
from cadkernel.ir import CoordinateFrame, GeometryKind, GeometryRecord, GeometryStore, TextStore
from cadkernel.ir.coordinate_frame import CoordinateOverflowError


SNAPSHOT_ID = "snapshot-test"


def test_contracts_have_stable_round_trip() -> None:
    profile = ToleranceProfile(profile_name="strict", endpoint_snap=0.0001)
    assert ToleranceProfile.from_json(profile.to_json()) == profile
    assert profile.profile_id == ToleranceProfile.from_json(profile.to_json()).profile_id

    result = OpResult(
        status=OpStatus.SUCCESS,
        value=np.asarray([[1, 2], [3, 4]], dtype=np.int64),
        decision=Decision.COMPUTED,
        exactness=Exactness.EXACT_PREDICATE,
        snapshot_id=SNAPSHOT_ID,
        coordinate_frame_id="frame",
        evidence=(EvidenceRef(snapshot_id=SNAPSHOT_ID, source_parameter_range=(0.0, 1.0)),),
    )
    restored = OpResult.from_json(result.to_json())
    assert restored == result
    assert restored.to_json() == result.to_json()

    nonfinite = OpResult(
        status=OpStatus.SUCCESS,
        value=np.asarray([np.nan, np.inf, -np.inf], dtype=np.float64),
        decision=Decision.COMPUTED,
        exactness=Exactness.UNKNOWN,
        snapshot_id=SNAPSHOT_ID,
        coordinate_frame_id="frame",
    )
    nonfinite_payload = nonfinite.to_json()
    assert "NaN" not in nonfinite_payload and "Infinity" not in nonfinite_payload
    decoded = OpResult.from_json(nonfinite_payload).value
    assert np.isnan(decoded[0]) and np.isposinf(decoded[1]) and np.isneginf(decoded[2])


def test_result_and_evidence_cannot_cross_snapshots() -> None:
    with pytest.raises(ValueError, match="snapshot_id"):
        OpResult(
            status=OpStatus.SUCCESS,
            value=1,
            decision=Decision.COMPUTED,
            exactness=Exactness.EXACT,
            snapshot_id="one",
            coordinate_frame_id=None,
            evidence=(EvidenceRef(snapshot_id="two"),),
        )


def test_result_status_and_decision_cannot_contradict_each_other() -> None:
    ambiguous = successful_result(
        1,
        snapshot_id=SNAPSHOT_ID,
        coordinate_frame_id=None,
        exactness=Exactness.UNKNOWN,
        decision=Decision.AMBIGUOUS,
    )
    assert ambiguous.status is OpStatus.AMBIGUOUS
    with pytest.raises(ValueError, match="incompatible"):
        OpResult(
            status=OpStatus.SUCCESS,
            value=1,
            decision=Decision.UNSUPPORTED,
            exactness=Exactness.UNKNOWN,
            snapshot_id=SNAPSHOT_ID,
            coordinate_frame_id=None,
        )


def test_builtin_operator_registry_is_complete_and_versioned() -> None:
    specs = {spec.operator_id: spec for spec in cadkernel.BUILTIN_OPERATOR_SPECS}
    assert len(specs) >= 30
    assert {
        "measure.length",
        "intersection.geometry_pairs",
        "snap.propose",
        "topology.build_arrangement",
        "topology.build_dcel",
        "topology.compile",
        "topology.query_faces",
        "topology.point_in_face",
        "annotation.query_region",
        "annotation.resolve_targets",
        "aggregate.count",
        "measure.angle",
        "unit.convert",
    } <= specs.keys()
    assert specs["topology.compile"].version == "1.2.0"
    assert not any(
        term in operator_id.casefold()
        for operator_id in specs
        for term in ("room", "transformer", "drawing_frame")
    )


def test_coordinate_frame_rebases_large_coordinates_and_freezes_geometry() -> None:
    precision = PrecisionModel(grid_size=1e-3, max_region_span=2e6)
    frame = CoordinateFrame.from_bounds((2_600_000.0, 900_000.0, 2_700_000.0, 1_000_000.0), precision)
    points = np.asarray([[2_600_000.0, 900_000.0], [2_700_000.0, 1_000_000.0]])
    grid = frame.quantize(points)
    np.testing.assert_allclose(frame.dequantize(grid), points, atol=precision.grid_size / 2)

    records = [
        GeometryRecord(
            occurrence_id="b",
            definition_id="db",
            kind=GeometryKind.LINE,
            coordinates=((2_600_000.0, 900_000.0, 0.0), (2_600_001.0, 900_001.0, 0.0)),
            source_type="LINE",
        ),
        GeometryRecord(
            occurrence_id="a",
            definition_id="da",
            kind=GeometryKind.LINE,
            coordinates=((2_600_002.0, 900_000.0, 0.0), (2_600_003.0, 900_001.0, 0.0)),
            source_type="LINE",
        ),
    ]
    store = GeometryStore.from_records(records, quantize=frame.quantize)
    assert store.occurrence_ids.tolist() == ["a", "b"]
    assert not store.coordinates.flags.writeable
    with pytest.raises(ValueError):
        store.coordinates[0, 0] = 0


def test_coordinate_frame_rejects_points_outside_its_checked_overflow_domain() -> None:
    frame = CoordinateFrame.from_bounds(
        (-10.0, -10.0, 10.0, 10.0),
        PrecisionModel(grid_size=1.0, max_region_span=100.0),
    )
    with pytest.raises(CoordinateOverflowError, match="outside frame"):
        frame.quantize([[12.0, 0.0]])


def _text_store(row_count: int, plain_text: list[str]) -> TextStore:
    return TextStore(
        occurrence_ids=[f"model:{index}" for index in range(row_count)],
        raw_text=["x"] * row_count,
        normalized_text=["x"] * row_count,
        plain_text=plain_text,
        block_attribute_tag=[""] * row_count,
        block_attribute_value=[""] * row_count,
        layer_name=["0"] * row_count,
        block_name=[""] * row_count,
        layout_name=["Model"] * row_count,
        drawing_title=[""] * row_count,
        points=[[0.0, 0.0, 0.0]] * row_count,
    )


def test_text_store_keeps_short_text_fixed_width() -> None:
    store = _text_store(2, ["alpha", "b"])
    assert store.plain_text.dtype == np.dtype("<U5")
    assert store.plain_text.tolist() == ["alpha", "b"]
    assert not store.plain_text.flags.writeable


def test_text_store_degrades_oversized_column_to_object_instead_of_giant_allocation() -> None:
    # 3,000 rows at a 100k-character maximum would need ~1.2 GB as one
    # fixed-width <U column; with real drawings this reached 98 GiB.
    long_text = "长" * 100_000
    store = _text_store(3_000, [long_text] + ["x"] * 2_999)
    assert store.plain_text.dtype == object
    assert store.plain_text[0] == long_text
    assert not store.plain_text.flags.writeable
    # Identifier columns stay on the fixed-width fast path.
    assert store.occurrence_ids.dtype.kind == "U"
