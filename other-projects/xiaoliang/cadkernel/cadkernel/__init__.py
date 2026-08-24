"""Deterministic cross-discipline CAD atomic-operator kernel."""

from cadkernel.contracts import (
    Decision,
    Exactness,
    OpResult,
    OpStatus,
    PrecisionModel,
    ToleranceProfile,
    operator_registry,
)
from cadkernel.ir import DrawingSnapshot


def load_builtin_operators():
    """Import the domain-neutral built-ins and return their stable manifests."""

    # Imports are deliberately centralized here so registry discovery does not
    # depend on whichever implementation module a caller happened to import.
    from cadkernel.aggregate import count as _aggregate_count
    from cadkernel.annotations import operators as _annotations
    from cadkernel.indexes import queries as _queries
    from cadkernel.kernel import curves as _curves
    from cadkernel.kernel import intersect as _intersect
    from cadkernel.kernel import measure as _measure
    from cadkernel.kernel import precision as _precision
    from cadkernel.kernel import units as _units
    from cadkernel.repair import snap as _snap
    from cadkernel.topology import arrangement as _arrangement
    from cadkernel.topology import dcel as _dcel
    from cadkernel.topology import incidence as _incidence
    from cadkernel.topology import persistence as _persistence

    del (
        _queries,
        _aggregate_count,
        _annotations,
        _curves,
        _intersect,
        _measure,
        _precision,
        _units,
        _snap,
        _arrangement,
        _dcel,
        _incidence,
        _persistence,
    )
    return operator_registry.specs()


BUILTIN_OPERATOR_SPECS = load_builtin_operators()

__all__ = [
    "Decision",
    "DrawingSnapshot",
    "Exactness",
    "OpResult",
    "OpStatus",
    "PrecisionModel",
    "ToleranceProfile",
    "BUILTIN_OPERATOR_SPECS",
    "load_builtin_operators",
]

__version__ = "0.1.0"
