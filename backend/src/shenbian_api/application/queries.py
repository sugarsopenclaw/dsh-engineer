from __future__ import annotations

from collections import Counter

from shenbian_api.application.ports import DataCatalogReader, OntologyReader
from shenbian_api.domain.catalog import DataCatalogSummary
from shenbian_api.domain.ontology import ActionTypeDefinition, OntologySummary


class OntologyQueryService:
    def __init__(self, reader: OntologyReader) -> None:
        self._reader = reader

    def summary(self) -> OntologySummary:
        ontology = self._reader.get()
        return OntologySummary(
            schema_version=ontology.schema_version,
            namespace=ontology.namespace,
            display_name=ontology.display_name,
            description=ontology.description,
            object_type_count=len(ontology.object_types),
            link_type_count=len(ontology.link_types),
            action_type_count=len(ontology.action_types),
            object_type_ids=[item.id for item in ontology.object_types],
            link_type_ids=[item.id for item in ontology.link_types],
            action_type_ids=[item.id for item in ontology.action_types],
        )

    def actions(self) -> list[ActionTypeDefinition]:
        return list(self._reader.get().action_types)


class DataCatalogQueryService:
    def __init__(self, reader: DataCatalogReader) -> None:
        self._reader = reader

    def summary(self) -> DataCatalogSummary:
        entries = self._reader.list_entries()
        counts = Counter(entry.stage for entry in entries)
        return DataCatalogSummary(
            dataset_count=len(entries),
            by_stage=dict(sorted(counts.items())),
            datasets=entries,
        )
