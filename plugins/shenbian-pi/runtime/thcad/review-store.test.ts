import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { exportReviewCandidates } from "./review-dataset.ts";
import { ThcadReviewStore } from "./review-store.ts";
import { buildEvidenceContent } from "./subagent-runner.ts";

async function startRun(
	store: ThcadReviewStore,
	runId: string,
	childRole: "mechanical" | "vision" = "mechanical",
): Promise<void> {
	await store.beginRun({
		runId,
		task: "只读取证测试",
		childSystemPrompt: "system",
		childModel: "fixture/model",
		childThinkingLevel: "off",
		childRole,
		cwd: process.cwd(),
		parent: { sessionId: "parent", prompt: "检查当前图" },
	});
	await store.recordChildResult(runId, {
		status: "completed",
		startedAtUtc: "2026-08-30T00:00:00.000Z",
		finishedAtUtc: "2026-08-30T00:00:01.000Z",
		durationMs: 1000,
		exitCode: 0,
		model: "fixture/model",
		stopReason: "stop",
		toolCallCount: 1,
		turns: 1,
		usage: {},
	});
	await store.writeEvidence(runId, "# evidence\n");
}

test("review CAS preserves overwritten artifacts and deduplicates unchanged generations", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-thcad-review-"));
	try {
		const bridge = path.join(root, "bridge");
		const reviews = path.join(root, "reviews");
		const artifacts = path.join(bridge, "artifacts", "sample");
		const stateDirectory = path.join(bridge, "state");
		await Promise.all([
			mkdir(artifacts, { recursive: true }),
			mkdir(stateDirectory, { recursive: true }),
		]);
		const source = path.join(artifacts, "dimension-topology.json");
		const childImage = path.join(root, "frame-overview.png");
		const state = path.join(stateDirectory, "current-analysis.json");
		await writeFile(source, JSON.stringify({ equation: "1710=825+885", generation: 1 }));
		await writeFile(childImage, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]));
		await writeFile(state, JSON.stringify({
			analysis_id: "analysis-1",
			artifact_directory: "artifacts/sample",
			artifacts: { "9": "artifacts/sample/dimension-topology.json" },
		}));

		const store = new ThcadReviewStore({ root: reviews, bridgeRoot: bridge });
		await startRun(store, "thcad-test-one", "vision");
		const request = JSON.parse(
			await readFile(path.join(store.runDirectory("thcad-test-one"), "request.json"), "utf8"),
		) as { provenance: { node_version?: string; integration_worktree_dirty?: boolean } };
		assert.match(request.provenance.node_version ?? "", /^v\d+/);
		assert.equal(typeof request.provenance.integration_worktree_dirty, "boolean");
		const childInput = await store.snapshotChildInput("thcad-test-one", {
			source: childImage,
			logicalPath: "visual/frame-overview.png",
			role: "vision_user_image",
			mediaType: "image/png",
			metadata: { frame_id: "frame-1" },
		});
		assert.equal(childInput.role, "vision_user_image");
		assert.match(childInput.sha256, /^[a-f0-9]{64}$/);
		await writeFile(
			path.join(store.runDirectory("thcad-test-one"), "visual-assessment.json"),
			JSON.stringify({ assessment: { verdict: "overview_only" } }),
		);
		const first = await store.snapshotArtifacts("thcad-test-one");
		const firstArtifact = first.files.find((item) => item.logical_path === "analysis/dimension-topology.json");
		assert.ok(firstArtifact);
		await store.finalizeParent("thcad-test-one", {
			status: "completed",
			finishedAtUtc: "2026-08-30T00:00:02.000Z",
			finalMessage: { role: "assistant", content: [{ type: "text", text: "结论一" }] },
		});

		await writeFile(source, JSON.stringify({ equation: "1710=825+885", generation: 200 }));
		await writeFile(state, JSON.stringify({
			analysis_id: "analysis-2",
			artifact_directory: "artifacts/sample",
			artifacts: { "9": "artifacts/sample/dimension-topology.json" },
		}));
		await startRun(store, "thcad-test-two");
		const second = await store.snapshotArtifacts("thcad-test-two");
		const secondArtifact = second.files.find((item) => item.logical_path === "analysis/dimension-topology.json");
		assert.ok(secondArtifact);
		assert.notEqual(secondArtifact.sha256, firstArtifact.sha256);

		const preserved = await readFile(path.join(reviews, firstArtifact.object_path), "utf8");
		assert.match(preserved, /"generation":1/);

		await startRun(store, "thcad-test-three");
		const third = await store.snapshotArtifacts("thcad-test-three");
		const thirdArtifact = third.files.find((item) => item.logical_path === "analysis/dimension-topology.json");
		assert.equal(thirdArtifact?.sha256, secondArtifact.sha256);
		assert.equal(third.unique_object_bytes_added, 0);

		const verification = await store.verifyRun("thcad-test-one");
		assert.equal(verification.ok, true, verification.problems.join("\n"));
		assert.ok(verification.bundle_files_checked >= 5);
		assert.ok(verification.artifact_objects_checked >= 2);

		const exportPath = path.join(root, "candidates.jsonl");
		const exported = await exportReviewCandidates(exportPath, store);
		assert.equal(exported.sample_count, 1);
		assert.equal(exported.training_eligible, false);
		const candidate = JSON.parse((await readFile(exportPath, "utf8")).trim()) as {
			source: string;
			review: { label: string; training_eligible: boolean };
			input: { parent_user_prompt: string; child_inputs: Array<{ role: string }> };
			output: { parent_final_text: string; visual_assessment: { assessment: { verdict: string } } };
		};
		assert.equal(candidate.source, "pi_thcad_visual_review");
		assert.deepEqual(candidate.review, {
			label: "unreviewed",
			training_eligible: false,
			contains_customer_data: true,
			requires_human_curation: true,
		});
		assert.equal(candidate.input.parent_user_prompt, "检查当前图");
		assert.equal(candidate.input.child_inputs[0]?.role, "vision_user_image");
		assert.equal(candidate.output.parent_final_text, "结论一");
		assert.equal(candidate.output.visual_assessment.assessment.verdict, "overview_only");

		await writeFile(path.join(store.runDirectory("thcad-test-one"), "evidence.md"), "# tampered\n");
		const tampered = await store.verifyRun("thcad-test-one");
		assert.equal(tampered.ok, false);
		assert.ok(tampered.problems.some((item) => item.includes("BUNDLE_")));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("review run ids cannot escape the local runs root", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-thcad-review-path-"));
	try {
		const store = new ThcadReviewStore({ root: path.join(root, "reviews"), bridgeRoot: path.join(root, "bridge") });
		assert.throws(() => store.runDirectory("../outside"), /INVALID_REVIEW_RUN_ID/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("review store snapshots all paired BOM images and topology in one immutable manifest", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-thcad-review-paired-"));
	try {
		const store = new ThcadReviewStore({ root: path.join(root, "reviews"), bridgeRoot: path.join(root, "bridge") });
		await startRun(store, "thcad-test-paired", "mechanical");
		const full = path.join(root, "full.png");
		const clean = path.join(root, "clean.png");
		const sidecar = path.join(root, "sidecar.json");
		await Promise.all([
			writeFile(full, Buffer.from("full-image")),
			writeFile(clean, Buffer.from("clean-image")),
			writeFile(sidecar, JSON.stringify({ group_id: "group-1" })),
		]);
		const entries = await store.snapshotChildInputs("thcad-test-paired", [
			{ source: full, logicalPath: "groups/group-1/component-full.png", role: "bom_component_full_image" },
			{ source: clean, logicalPath: "groups/group-1/component-clean.png", role: "bom_component_clean_image" },
			{ source: sidecar, logicalPath: "groups/group-1/evidence-sidecar.json", role: "bom_component_deterministic_sidecar" },
		]);
		assert.equal(entries.length, 3);
		assert.deepEqual(entries.map((item) => item.role), [
			"bom_component_full_image",
			"bom_component_clean_image",
			"bom_component_deterministic_sidecar",
		]);
		const manifest = JSON.parse(
			await readFile(path.join(store.runDirectory("thcad-test-paired"), "child-inputs.json"), "utf8"),
		) as { files: unknown[] };
		assert.equal(manifest.files.length, 3);
		await assert.rejects(
			store.snapshotChildInputs("thcad-test-paired", [
				{ source: full, logicalPath: "duplicate", role: "one" },
				{ source: clean, logicalPath: "duplicate", role: "two" },
			]),
			/DUPLICATE_CHILD_INPUT_LOGICAL_PATH/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("host evidence retains actual tool results when the child summary is wrong", () => {
	const evidence = buildEvidenceContent(
		"只读取 status",
		"artifacts/dangling-report.json",
		[{
			sequence: 1,
			tool_call_id: "call-1",
			tool_name: "thcad_session",
			args: { action: "status" },
			result: {
				role: "toolResult",
				content: [{ type: "text", text: JSON.stringify({
					ok: true,
					data: {
						active_document: { name: "sample.dwg", dbmod: 21 },
						capability_ids: Array.from({ length: 21 }, (_, index) => index + 1),
					},
				}) }],
				isError: false,
			},
		}],
	);
	assert.match(evidence, /宿主保全的实际工具轨迹/);
	assert.match(evidence, /sample\.dwg/);
	assert.match(evidence, /dbmod/);
	assert.match(evidence, /dangling-report\.json/);
});
