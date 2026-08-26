from pathlib import Path

import pytest

from shenbian_api.infrastructure.yaml_registry import (
    YamlDataCatalogRegistry,
    YamlOntologyRegistry,
)


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def test_repository_ontology_contract_is_valid() -> None:
    ontology = YamlOntologyRegistry(
        repository_root() / "ontology" / "shenbian" / "v1" / "ontology.yaml"
    ).get()
    assert len(ontology.object_types) == 15
    assert len(ontology.link_types) == 16
    assert len(ontology.action_types) == 14


def test_repository_catalog_ids_are_unique() -> None:
    catalog = YamlDataCatalogRegistry(repository_root() / "data" / "catalog")
    identifiers = [entry.id for entry in catalog.list_entries()]
    assert len(identifiers) == len(set(identifiers))


def test_invalid_ontology_reference_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "ontology.yaml"
    path.write_text(
        """
schema_version: '1.0'
namespace: test
display_name: Test
description: Test
object_types:
  - id: item
    display_name: Item
    identity_property: id
    properties: [id]
link_types:
  - { id: broken, from: item, to: missing }
action_types: []
""".strip(),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="unknown_link_object_type"):
        YamlOntologyRegistry(path)
