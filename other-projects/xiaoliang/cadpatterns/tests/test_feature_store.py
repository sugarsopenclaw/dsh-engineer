from __future__ import annotations

from cadpatterns.contracts import FeatureRecord, GeometryProvenance
from cadpatterns.features.store import PatternFeatureStore


def _records(count: int, first_value: object) -> tuple[FeatureRecord, ...]:
    return tuple(
        FeatureRecord(
            scope_id=f"scope:{index:06d}",
            subject_ref=f"subject:{index:06d}",
            name="text.content",
            value=first_value if index == 0 else "x",
            provenance=GeometryProvenance.SOURCE_FACT,
        )
        for index in range(count)
    )


def test_feature_store_keeps_short_text_fixed_width() -> None:
    store = PatternFeatureStore.from_records(_records(3, "panel"), feature_precision=2)
    assert store.value_json.dtype.kind == "U"
    assert not store.value_json.flags.writeable
    assert store.get("scope:000000", "subject:000000", "text.content") == "panel"
    assert store.get("missing", "missing", "missing") is None


def test_feature_store_degrades_oversized_value_column_to_object() -> None:
    # 3,000 rows at a 100k-character maximum would need ~1.2 GB as one
    # fixed-width <U column; a real 39k-character MTEXT reached 98 GiB.
    long_text = "长" * 100_000
    store = PatternFeatureStore.from_records(_records(3_000, long_text), feature_precision=2)
    assert store.value_json.dtype == object
    assert not store.value_json.flags.writeable
    assert len(store) == 3_000
    assert store.get("scope:000000", "subject:000000", "text.content") == long_text
    assert store.get("scope:002999", "subject:002999", "text.content") == "x"
    # Key columns stay on the fixed-width fast path.
    assert store.scope_ids.dtype.kind == "U"
    assert store.names.dtype.kind == "U"
