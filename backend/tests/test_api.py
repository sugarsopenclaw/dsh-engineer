from fastapi.testclient import TestClient

from shenbian_api.app_factory import create_app
from shenbian_api.application.ports import DependencyProbe
from shenbian_api.core.config import Settings


class FailingProbe(DependencyProbe):
    name = "postgresql"

    async def check(self) -> None:
        raise RuntimeError("must-not-appear:postgresql://user:secret@example/db")

    async def close(self) -> None:
        return None


def test_live(client: TestClient) -> None:
    response = client.get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


def test_ready_reports_each_dependency(client: TestClient) -> None:
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert [item["name"] for item in payload["dependencies"]] == [
        "postgresql",
        "redis",
        "oss",
    ]


def test_readiness_error_is_sanitized(settings: Settings) -> None:
    app = create_app(settings=settings, probes=[FailingProbe()])
    with TestClient(app) as failing_client:
        response = failing_client.get("/api/v1/health/ready")

    assert response.status_code == 503
    serialized = response.text
    assert "secret" not in serialized
    assert response.json()["dependencies"][0]["error_type"] == "RuntimeError"


def test_ontology_summary(client: TestClient) -> None:
    response = client.get("/api/v1/ontology")
    assert response.status_code == 200
    payload = response.json()
    assert payload["namespace"] == "shenbian.drawing_review"
    assert payload["object_type_count"] == 15
    assert payload["action_type_count"] == 14
    assert "drawing_revision" in payload["object_type_ids"]
    assert "export_production_dxf" in payload["action_type_ids"]


def test_action_contract_exposes_risk_and_approval(client: TestClient) -> None:
    response = client.get("/api/v1/ontology/actions")
    assert response.status_code == 200
    actions = {item["id"]: item for item in response.json()}
    export_action = actions["export_production_dxf"]
    assert export_action["risk"] == "external_side_effect"
    assert export_action["requires_approval"] is True


def test_data_catalog_lists_registered_sources(client: TestClient) -> None:
    response = client.get("/api/v1/data-catalog")
    assert response.status_code == 200
    payload = response.json()
    assert payload["dataset_count"] == 5
    assert payload["by_stage"] == {"curated": 1, "raw": 3, "staging": 1}
    assert "shenbian.client_requirements.curated.v1" in {
        dataset["id"] for dataset in payload["datasets"]
    }
    assert all(dataset["governance"]["immutable"] for dataset in payload["datasets"])
