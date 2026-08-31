import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ThcadArtifactStore } from "./artifact-store.ts";
import { THCAD_CAPABILITIES, getCapability } from "./capability-catalog.ts";

test("01-21 capability catalog is complete and unique", () => {
	assert.equal(THCAD_CAPABILITIES.length, 21);
	assert.deepEqual(THCAD_CAPABILITIES.map((item) => item.id), Array.from({ length: 21 }, (_, index) => index + 1));
	assert.equal(new Set(THCAD_CAPABILITIES.map((item) => item.artifact)).size, 21);
	assert.equal(getCapability(9).artifact, "dimension-topology.json");
	assert.equal(getCapability(20).artifact, "cross-drawing-observation.json");
	assert.equal(getCapability(21).artifact, "bom-instance-coverage.json");
});

test("artifact store returns bounded summaries, paths, and search contexts", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-thcad-artifacts-"));
	try {
		const artifactDirectory = path.join(root, "artifacts", "sample");
		const stateDirectory = path.join(root, "state");
		await Promise.all([mkdir(artifactDirectory, { recursive: true }), mkdir(stateDirectory, { recursive: true })]);
		await writeFile(path.join(artifactDirectory, "dimension-topology.json"), JSON.stringify({
			analysis_type: "dimension_topology",
			chains: [{ chain_id: "chain-1", displayed_total: 1710, source_handles: ["A1", "A2"] }],
			axis_offsets: [{ label: "器身中心线", offset: 30, status: "reference_axis_offset_not_symmetry_proof" }],
		}));
		await writeFile(path.join(artifactDirectory, "dimension-topology.md"), "# 尺寸拓扑\n\n- 1710 = 825 + 885\n");
		await writeFile(path.join(artifactDirectory, "extraction-report.json"), JSON.stringify({
			dimension_linear_count: 7,
			dimension_continuous_chain_count: 3,
			center_geometry_count: 99,
		}));
		await writeFile(path.join(stateDirectory, "current-analysis.json"), JSON.stringify({
			analysis_id: "fixture",
			document_name: "sample.dwg",
			source_status: "saved",
			dbmod_after: 0,
			report: "artifacts/sample/extraction-report.json",
			artifacts: { "9": "artifacts/sample/dimension-topology.json" },
		}));

		const store = new ThcadArtifactStore(root);
		const summary = await store.summary(9, 10_000);
		assert.equal(summary.document, "sample.dwg");
		assert.deepEqual(summary.report_summary, {
			dimension_linear_count: 7,
			dimension_continuous_chain_count: 3,
		});
		assert.match(String(summary.markdown_excerpt), /1710 = 825 \+ 885/);

		const byPath = await store.query(9, { jsonPath: "$.chains[0]" });
		assert.match(String(byPath.result_json), /"displayed_total": 1710/);
		assert.match(String(byPath.result_json), /"A1"/);

		const byTerm = await store.query(9, { terms: ["器身中心线"], limit: 5 });
		assert.match(String(byTerm.result_json), /reference_axis_offset_not_symmetry_proof/);
		assert.equal(byTerm.result_truncated, false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("artifact state cannot escape its bridge root", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-thcad-path-"));
	try {
		await mkdir(path.join(root, "state"), { recursive: true });
		await writeFile(path.join(root, "state", "current-analysis.json"), JSON.stringify({
			artifacts: { "1": "../outside.json" },
		}));
		const store = new ThcadArtifactStore(root);
		await assert.rejects(() => store.query(1, { jsonPath: "$" }), /PATH_OUTSIDE_BRIDGE_ROOT/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
