from __future__ import annotations

import os
import json
import re
from pathlib import Path

import pytest

from tests.corpus.run_corpus import (
    PROJECT_ROOT,
    load_manifest,
    main as run_corpus,
    verify_record,
)


SHA256 = re.compile(r"^[0-9a-f]{64}$")


def test_manifest_pins_two_cross_discipline_corpora() -> None:
    manifest = load_manifest()
    sources = manifest["sources"]
    disciplines = [record["discipline"] for record in sources]
    assert disciplines.count("architecture") >= 3
    assert disciplines.count("electrical_transformer") >= 3
    assert len({record["id"] for record in sources}) == len(sources)
    assert manifest["official_archive"]["publisher"] == "Autodesk"
    assert manifest["official_archive"]["source_page"].startswith("https://help.autodesk.com/")
    assert SHA256.fullmatch(manifest["official_archive"]["sha256"])
    for record in sources:
        assert SHA256.fullmatch(record["source_sha256"])
        assert SHA256.fullmatch(record["reference_dxf_sha256"])
        if "mlight_index" in record:
            assert SHA256.fullmatch(record["mlight_sha256"])


def _assert_corpus_invariants(summary: dict[str, object]) -> None:
    drawings = summary["drawings"]
    assert isinstance(drawings, list)
    assert len(drawings) == 6
    disciplines = summary["disciplines"]
    assert isinstance(disciplines, dict)
    assert disciplines["architecture"]["drawing_count"] == 3
    assert disciplines["electrical_transformer"]["drawing_count"] == 3
    assert all(
        row["scale"]["arrangement_unsupported_edges"] == 0 for row in drawings
    )
    assert all(row["faces"]["dcel_valid"] for row in drawings)
    assert all(
        row["faces"]["euler_left"] == row["faces"]["euler_right"]
        for row in drawings
    )
    assert all(not row["faces"]["validation_diagnostics"] for row in drawings)
    assert all(
        row["faces"]["compilation_decision"] in {"computed", "ambiguous"}
        and (
            (row["faces"]["compilation_decision"] == "computed")
            == (
                not any(
                    diagnostic["severity"] == "error"
                    for diagnostic in row["faces"]["compilation_diagnostics"]
                )
            )
        )
        for row in drawings
    )
    assert all(
        diagnostic["code"] != "ARRANGEMENT_GRID_NODING_DID_NOT_CONVERGE"
        for row in drawings
        for diagnostic in row["faces"]["compilation_diagnostics"]
    )
    assert all(
        aggregate["valid_dcel_count"] == aggregate["drawing_count"]
        for aggregate in disciplines.values()
    )
    transformer_rows = [
        row for row in drawings if row["discipline"] == "electrical_transformer"
    ]
    newly_supported = {"DIMENSION", "LEADER", "HATCH", "SOLID", "POLYLINE"}
    assert all(
        not newly_supported
        & {entity_type for entity_type, _ in row["coverage"]["unsupported_by_type"]}
        for row in transformer_rows
    )
    assert all(
        row["annotation"]["dimension_fact_coverage"]
        == row["annotation"]["source_dimensions"]
        for row in transformer_rows
    )
    expected_topology_ratios = {
        "transformer-5tbc-384-1": 0.238,
        "transformer-5tbc-426": 0.465,
        "transformer-5tbc-709": 0.819,
    }
    assert all(
        row["coverage"]["topology_eligible_ratio"]
        >= expected_topology_ratios[row["corpus_id"]]
        for row in transformer_rows
    )
    first_transformer = next(
        row
        for row in transformer_rows
        if row["corpus_id"] == "transformer-5tbc-384-1"
    )
    assert first_transformer["annotation"]["source_dimensions"] == 227
    assert first_transformer["annotation"]["dimension_fact_coverage"] == 227
    differential = next(
        row["mlight_conformance"]
        for row in drawings
        if row["mlight_conformance"] is not None
    )
    assert differential["matches"] is True
    assert differential["unexplained_difference_count"] == 0


def test_committed_summary_records_structural_and_differential_evidence() -> None:
    summary_path = PROJECT_ROOT / "benchmarks" / "corpus" / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    _assert_corpus_invariants(summary)


@pytest.mark.corpus
@pytest.mark.skipif(
    os.environ.get("CADKERNEL_RUN_CORPUS") != "1",
    reason="set CADKERNEL_RUN_CORPUS=1 when the pinned external corpus is present",
)
def test_external_corpus_rebuilds_and_satisfies_invariants(tmp_path: Path) -> None:
    manifest = load_manifest()
    dxf_root = PROJECT_ROOT / ".corpus-work" / "dxf"
    for record in manifest["sources"]:
        source, dxf = verify_record(record, dxf_root=dxf_root)
        assert source.is_file()
        assert dxf.is_file()

    output_root = tmp_path / "reports"
    assert (
        run_corpus(
            [
                "--dxf-root",
                str(dxf_root),
                "--snapshot-root",
                str(tmp_path / "snapshots"),
                "--output-root",
                str(output_root),
            ]
        )
        == 0
    )
    rebuilt = json.loads((output_root / "summary.json").read_text(encoding="utf-8"))
    _assert_corpus_invariants(rebuilt)
