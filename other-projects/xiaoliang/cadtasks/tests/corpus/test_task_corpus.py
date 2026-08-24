from __future__ import annotations

import os
from pathlib import Path

import pytest

from cadtasks.storage import TaskStore


@pytest.mark.corpus
def test_external_task_corpus_is_canonical() -> None:
    root_value = os.environ.get("CADTASKS_CORPUS")
    if not root_value:
        pytest.skip("CADTASKS_CORPUS is not configured")
    stores = tuple(Path(root_value).rglob("task.sqlite3"))
    assert stores
    for database in stores:
        store = database.parent
        assert TaskStore.verify(store) == ()
        bundle = TaskStore.load(store)
        assert TaskStore.load(store).to_json() == bundle.to_json()

