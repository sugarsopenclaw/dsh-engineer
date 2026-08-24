from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import re

from cadsemantics.contracts import UnitStatus
from cadsemantics.ontology import UnitRegistry


_QUANTITY = re.compile(
    r"^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([A-Za-z\"']+)\s*$"
)
_NUMBER = re.compile(r"^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$")


@dataclass(frozen=True, slots=True)
class NormalizedQuantity:
    normalized_value: float | None
    normalized_unit: str | None
    quantity_dimension: str | None
    original_literal: str
    unit_status: UnitStatus


def _decimal(value: str) -> Decimal | None:
    try:
        return Decimal(value)
    except InvalidOperation:
        return None


def normalize_quantity(
    literal: str,
    unit_registry: UnitRegistry,
    *,
    drawing_unit_status: str = "unknown",
    dimlfac: float | None = None,
    allow_drawing_unit: bool = False,
) -> NormalizedQuantity:
    explicit = _QUANTITY.match(literal)
    if explicit is not None:
        value = _decimal(explicit.group(1))
        unit = unit_registry.by_literal(explicit.group(2))
        if value is not None and unit is not None:
            return NormalizedQuantity(
                float(value * Decimal(str(unit.factor_to_canonical))),
                unit.canonical_unit,
                unit.quantity_dimension,
                literal,
                UnitStatus.EXPLICIT,
            )
    numeric = _NUMBER.match(literal)
    if numeric is None:
        return NormalizedQuantity(None, None, None, literal, UnitStatus.UNRESOLVED)
    value = _decimal(numeric.group(1))
    drawing_unit = unit_registry.by_literal(drawing_unit_status)
    if value is not None and allow_drawing_unit and drawing_unit is not None:
        scale = Decimal(str(dimlfac)) if dimlfac is not None else Decimal("1")
        return NormalizedQuantity(
            float(value * scale * Decimal(str(drawing_unit.factor_to_canonical))),
            drawing_unit.canonical_unit,
            drawing_unit.quantity_dimension,
            literal,
            UnitStatus.DIMENSION_SCALE if dimlfac is not None else UnitStatus.DRAWING_UNIT,
        )
    return NormalizedQuantity(None, None, None, literal, UnitStatus.UNRESOLVED)
