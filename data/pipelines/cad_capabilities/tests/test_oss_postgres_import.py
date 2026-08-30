from __future__ import annotations

import unittest

from data.pipelines.cad_capabilities.load_postgres_via_oss import (
    STAGING_TABLE_PREFIX,
    atom_insert_sql,
    graph_snapshot_copy_sql,
    graph_snapshot_scopes,
    server_pull_program,
)


class OssPostgresImportTests(unittest.TestCase):
    def test_server_pull_requires_https(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be HTTPS"):
            server_pull_program("http://example.com/atoms.jsonl.gz")

    def test_server_pull_keeps_signed_target_and_decompresses(self) -> None:
        program = server_pull_program(
            "https://bucket.example.com/atoms.jsonl.gz?signature=a%2Bb&expires=1"
        )
        self.assertIn("openssl s_client", program)
        self.assertIn("/atoms.jsonl.gz?signature=a%2Bb&expires=1", program)
        self.assertIn("gzip -dc", program)

    def test_atom_insert_maps_payload_without_host_merging(self) -> None:
        table_name = f"{STAGING_TABLE_PREFIX}abc123"
        statement = atom_insert_sql(table_name)
        self.assertIn("payload->>'atom_id'", statement)
        self.assertIn("jsonb_array_elements_text(payload->'observed_host_ids')", statement)
        self.assertNotIn("DISTINCT", statement.upper())
        self.assertIn(f"FROM ontology.{table_name}", statement)

    def test_graph_snapshot_scopes_cover_all_filters(self) -> None:
        manifest = {"counts": {"by_surface": {"dotnet": 3, "com": 2}}}
        inventories = [
            {"observed_host_id": "thcad-v24"},
            {"observed_host_id": "autocad-2024"},
        ]
        scopes = graph_snapshot_scopes(manifest, inventories)
        self.assertEqual(len(scopes), 9)
        self.assertIn((None, None), scopes)
        self.assertIn(("dotnet", "autocad-2024"), scopes)

    def test_graph_snapshot_copy_is_host_scoped_and_gzipped(self) -> None:
        statement = graph_snapshot_copy_sql(
            dataset_id="cad.capabilities.curated.v2",
            surface="dotnet",
            observed_host_id="autocad-2024",
            output_path="/tmp/cad-capability-graph-test.jsonl.gz",
        )
        self.assertIn("surface = 'dotnet'", statement)
        self.assertIn("'autocad-2024' = ANY(observed_host_ids)", statement)
        self.assertIn("gzip -n -c", statement)


if __name__ == "__main__":
    unittest.main()
