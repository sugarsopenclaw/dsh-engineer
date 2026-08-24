from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

import numpy as np

from cadkernel._serialization import freeze_array
from cadkernel.contracts import (
    Decision,
    Diagnostic,
    DiagnosticSeverity,
    Exactness,
    OperatorSpec,
    OpResult,
    OpStatus,
    operator_registry,
)
from cadkernel.contracts.models import successful_result
from cadkernel.ir import DrawingSnapshot


class QuantityKind(str, Enum):
    LENGTH = "length"
    AREA = "area"
    VOLUME = "volume"


@dataclass(frozen=True, slots=True, eq=False)
class UnitConversionBatch:
    values: np.ndarray
    from_unit: str
    to_unit: str
    quantity: QuantityKind
    factor: float

    def __post_init__(self) -> None:
        values = freeze_array(self.values, dtype=np.float64)
        if not np.isfinite(values).all():
            raise ValueError("unit.convert requires finite values")
        object.__setattr__(self, "values", values)


_UNIT_ALIASES = {
    "mm": "millimetre",
    "millimeter": "millimetre",
    "millimeters": "millimetre",
    "millimetres": "millimetre",
    "cm": "centimetre",
    "centimeter": "centimetre",
    "centimeters": "centimetre",
    "centimetres": "centimetre",
    "dm": "decimetre",
    "decimeter": "decimetre",
    "decimeters": "decimetre",
    "decimetres": "decimetre",
    "m": "metre",
    "meter": "metre",
    "meters": "metre",
    "metres": "metre",
    "km": "kilometre",
    "kilometer": "kilometre",
    "kilometers": "kilometre",
    "kilometres": "kilometre",
    "in": "inch",
    "inches": "inch",
    "ft": "foot",
    "feet": "foot",
    "yd": "yard",
    "yards": "yard",
}

_METRES = {
    "millimetre": 0.001,
    "centimetre": 0.01,
    "decimetre": 0.1,
    "metre": 1.0,
    "kilometre": 1000.0,
    "inch": 0.0254,
    "foot": 0.3048,
    "yard": 0.9144,
}


def _parse_unit(value: str) -> tuple[str, int | None]:
    normalized = value.strip().casefold().replace(" ", "_")
    power: int | None = None
    for suffix, suffix_power in (("^2", 2), ("²", 2), ("^3", 3), ("³", 3)):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)]
            power = suffix_power
            break
    normalized = _UNIT_ALIASES.get(normalized, normalized)
    return normalized, power


@operator_registry.operator(
    OperatorSpec(
        "unit.convert",
        "1.0.0",
        "Convert length, area, or volume values through an explicit unit contract",
        "DrawingSnapshot+values+units",
        "UnitConversionBatch",
        Exactness.EXACT,
        requires_coordinate_frame=False,
    )
)
def convert(
    snapshot: DrawingSnapshot,
    values: Any,
    to_unit: str,
    *,
    from_unit: str | None = None,
    quantity: QuantityKind | str = QuantityKind.LENGTH,
) -> OpResult[UnitConversionBatch]:
    source_value = snapshot.unit_status if from_unit is None else str(from_unit)
    source, source_power = _parse_unit(source_value)
    target, target_power = _parse_unit(str(to_unit))
    requested_quantity = QuantityKind(quantity)
    requested_power = {
        QuantityKind.LENGTH: 1,
        QuantityKind.AREA: 2,
        QuantityKind.VOLUME: 3,
    }[requested_quantity]
    declared_powers = {power for power in (source_power, target_power) if power is not None}
    if len(declared_powers) > 1:
        raise ValueError("from_unit and to_unit powers disagree")
    if declared_powers:
        declared_power = next(iter(declared_powers))
        if requested_quantity is QuantityKind.LENGTH:
            requested_power = declared_power
            requested_quantity = {
                2: QuantityKind.AREA,
                3: QuantityKind.VOLUME,
            }.get(declared_power, QuantityKind.LENGTH)
        elif declared_power != requested_power:
            raise ValueError("unit suffix power disagrees with quantity")
    numeric_values = np.atleast_1d(np.asarray(values, dtype=np.float64))
    if not np.isfinite(numeric_values).all():
        raise ValueError("unit.convert requires finite values")
    if source == target:
        factor = 1.0
    elif source not in _METRES or target not in _METRES:
        diagnostic = Diagnostic(
            code="UNIT_CONVERSION_UNRESOLVED",
            message=(
                f"Cannot convert {source_value!r} to {to_unit!r}; "
                "the drawing unit must be resolved explicitly."
            ),
            severity=DiagnosticSeverity.WARNING,
        )
        return OpResult(
            status=OpStatus.UNSUPPORTED,
            value=None,
            decision=Decision.UNSUPPORTED,
            exactness=Exactness.UNKNOWN,
            snapshot_id=snapshot.snapshot_id,
            coordinate_frame_id=snapshot.coordinate_frame.frame_id,
            diagnostics=(diagnostic,),
            derivation=("unresolved unit conversion is never guessed",),
        )
    else:
        factor = (_METRES[source] / _METRES[target]) ** requested_power
    batch = UnitConversionBatch(
        values=numeric_values * factor,
        from_unit=source,
        to_unit=target,
        quantity=requested_quantity,
        factor=float(factor),
    )
    return successful_result(
        batch,
        snapshot_id=snapshot.snapshot_id,
        coordinate_frame_id=snapshot.coordinate_frame.frame_id,
        exactness=Exactness.EXACT,
        derivation=(
            f"SI metre factor raised to power {requested_power}",
            "no drawing-unit assumption was introduced",
        ),
    )
