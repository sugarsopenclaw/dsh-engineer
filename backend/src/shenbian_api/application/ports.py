from __future__ import annotations

from typing import Protocol

from shenbian_api.domain.catalog import DatasetCatalogEntry
from shenbian_api.domain.ontology import OntologyDefinition


class OntologyReader(Protocol):
    def get(self) -> OntologyDefinition: ...


class DataCatalogReader(Protocol):
    def list_entries(self) -> list[DatasetCatalogEntry]: ...


class DependencyProbe(Protocol):
    @property
    def name(self) -> str: ...

    async def check(self) -> None: ...

    async def close(self) -> None: ...
