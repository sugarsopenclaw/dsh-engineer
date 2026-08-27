from __future__ import annotations


class BusinessRequirementsQueryError(RuntimeError):
    code = "business_requirements_query_failed"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.safe_message = message


class DatasetNotFoundError(BusinessRequirementsQueryError):
    code = "dataset_not_found"


class GraphViewNotFoundError(BusinessRequirementsQueryError):
    code = "graph_view_not_found"


class RequirementNotFoundError(BusinessRequirementsQueryError):
    code = "requirement_not_found"


class BusinessRequirementsUnavailableError(BusinessRequirementsQueryError):
    code = "postgres_unavailable"

    def __init__(self) -> None:
        super().__init__("The business requirements store is temporarily unavailable.")
