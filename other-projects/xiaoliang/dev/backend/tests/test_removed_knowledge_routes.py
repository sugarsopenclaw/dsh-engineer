from __future__ import annotations

from app.main import app


def test_removed_knowledge_routes_are_not_registered() -> None:
    registered_paths = {route.path for route in app.routes}

    assert "/knowledge/search" not in registered_paths
    assert "/cad-knowledge/artifacts" not in registered_paths
    assert "/cad-knowledge/extract" not in registered_paths
