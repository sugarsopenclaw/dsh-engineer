from __future__ import annotations


class TopologySemanticsError(RuntimeError):
    code = "topology_semantics_failed"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.safe_message = message


class TopologySemanticNotFoundError(TopologySemanticsError):
    code = "topology_semantic_not_found"


class TopologySemanticConflictError(TopologySemanticsError):
    code = "topology_semantic_conflict"


class TopologySemanticsUnavailableError(TopologySemanticsError):
    code = "sqlite_unavailable"

    def __init__(self) -> None:
        super().__init__("The topology semantics store is temporarily unavailable.")
