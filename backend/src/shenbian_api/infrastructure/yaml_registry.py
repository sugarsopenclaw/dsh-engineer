from __future__ import annotations

from pathlib import Path

import yaml

from shenbian_api.domain.catalog import DatasetCatalogEntry
from shenbian_api.domain.ontology import OntologyDefinition


class YamlOntologyRegistry:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._definition = self._load()

    def _load(self) -> OntologyDefinition:
        with self._path.open("r", encoding="utf-8") as stream:
            payload = yaml.safe_load(stream)
        return OntologyDefinition.model_validate(payload)

    def get(self) -> OntologyDefinition:
        return self._definition


class YamlDataCatalogRegistry:
    def __init__(self, directory: Path) -> None:
        self._directory = directory
        self._entries = self._load()

    def _load(self) -> list[DatasetCatalogEntry]:
        entries: list[DatasetCatalogEntry] = []
        for path in sorted(self._directory.glob("*.yaml")):
            with path.open("r", encoding="utf-8") as stream:
                payload = yaml.safe_load(stream)
            entries.append(DatasetCatalogEntry.model_validate(payload))

        identifiers = [entry.id for entry in entries]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("duplicate_dataset_catalog_id")
        return entries

    def list_entries(self) -> list[DatasetCatalogEntry]:
        return list(self._entries)
