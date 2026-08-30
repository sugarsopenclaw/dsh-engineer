from __future__ import annotations


class CadCapabilitiesQueryError(RuntimeError):
    code = "cad_capabilities_query_failed"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.safe_message = message


class CapabilityDatasetNotFoundError(CadCapabilitiesQueryError):
    code = "capability_dataset_not_found"


class CapabilityAtomNotFoundError(CadCapabilitiesQueryError):
    code = "capability_atom_not_found"


class CadCapabilitiesUnavailableError(CadCapabilitiesQueryError):
    code = "postgres_unavailable"

    def __init__(self) -> None:
        super().__init__("The CAD capability store is temporarily unavailable.")
