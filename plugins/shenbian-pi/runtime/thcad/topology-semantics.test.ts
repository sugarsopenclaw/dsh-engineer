import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
	BomCloseReadingGroupPlan,
	BomCloseReadingPlan,
	Box2,
	RenderOccurrence,
	RenderedBomCloseReadingGroup,
} from "./bom-close-reading.ts";
import {
	buildTopologyFingerprint,
	TopologySemanticsRecorder,
} from "./topology-semantics.ts";

function bounds(points: Array<[number, number]>): Box2 {
	return [
		Math.min(...points.map((item) => item[0])),
		Math.min(...points.map((item) => item[1])),
		Math.max(...points.map((item) => item[0])),
		Math.max(...points.map((item) => item[1])),
	];
}

function length(points: Array<[number, number]>): number {
	let result = 0;
	for (let index = 1; index < points.length; index += 1) {
		result += Math.hypot(
			points[index][0] - points[index - 1][0],
			points[index][1] - points[index - 1][1],
		);
	}
	return result;
}

function occurrence(id: string, points: Array<[number, number]>, closed = false): RenderOccurrence {
	return {
		occurrence_id: id,
		source_handle: id,
		runtime_class: closed ? "Polyline" : "Line",
		geometry_kind: closed ? "polyline" : "line",
		semantic_role: "object_contour",
		layer: "0",
		linetype: "Continuous",
		color_rgb: [255, 255, 255],
		closed,
		path: points,
		bounds: bounds(points),
		length: length(points),
	};
}

function group(
	transform: (point: [number, number]) => [number, number] = (point) => point,
): BomCloseReadingGroupPlan {
	const source = [
		occurrence("outline", [[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]], true),
		occurrence("cross-a", [[0, 10], [10, 10]]),
		occurrence("cross-b", [[5, 0], [5, 20]]),
	];
	const occurrences = source.map((item) => {
		const points = item.path.map(transform);
		return occurrence(item.occurrence_id, points, item.closed);
	});
	const componentBounds = bounds([
		transform([0, 0]),
		transform([10, 0]),
		transform([10, 20]),
		transform([0, 20]),
	]);
	return {
		group_id: "serial-annotation-group-028",
		serial_group: {
			id: "serial-annotation-group-028",
			group_type: "connected_serial_run",
			item_numbers: [19, 20, 21],
			annotation_handles: ["6D83"],
			target_status: "resolved_shared_target",
			target_point: transform([5, 10]),
			members: [],
			internal_links: [],
			derivation: "fixture",
		},
		bom_items: [19, 20, 21].map((item) => ({
			item_number: item,
			part_number: `part-${item}`,
			name: item === 21 ? "法兰" : "加强件",
			quantity: "1",
			material: "Q235",
			unit_weight: "",
			total_weight: "",
			remark: "",
			row_id: `row-${item}`,
			row_handle: `handle-${item}`,
		})),
		target_point: transform([5, 10]),
		view_region: {
			region_id: "view-1",
			region_kind: "engineering_view_candidate",
			region_subtype: "orthographic",
			bounds: componentBounds,
			label_texts: [],
		},
		anchor: {
			occurrence_id: "root/ref:1/ent:2",
			source_handle: "2",
			distance: 0,
			owner_prefix: "root/ref:1",
		},
		component_bounds: componentBounds,
		render_bounds: componentBounds,
		full_occurrences: occurrences,
		clean_occurrences: occurrences,
		removed_occurrences: [],
		geometry_summary: { occurrence_count: occurrences.length },
		bom_instance_coverage: {
			status: "computed",
			target_definition: { handle: "30A03", name: "A$C6960DF88" },
			coverage_counts: { definition_instance_count: 1, pointed: 1 },
		},
	};
}

function plan(currentGroup: BomCloseReadingGroupPlan): BomCloseReadingPlan {
	return {
		schema_version: 1,
		document_name: "fixture.dwg",
		document_ref: "client-data/fixture.dwg",
		analysis_id: "analysis-1",
		dbmod: 21,
		source_status: "dirty_current_session",
		artifact_refs: {
			capability_04: "artifact-04.json",
			capability_08: "artifact-08.json",
			capability_11: "artifact-11.json",
			capability_13: "artifact-13.json",
			capability_21: "artifact-21.json",
		},
		groups: [currentGroup],
		coverage: {
			document_name: "fixture.dwg",
			analysis_id: "analysis-1",
			dbmod: 21,
			bom_row_count: 3,
			annotated_item_count: 3,
			serial_group_count: 1,
			selected_group_count: 1,
			selected_item_numbers: [19, 20, 21],
			items_without_annotations: [],
			groups_without_resolved_target: [],
			groups_without_geometry_anchor: [],
		},
	};
}

async function rendered(root: string): Promise<RenderedBomCloseReadingGroup> {
	const directory = path.join(root, "group");
	await mkdir(directory, { recursive: true });
	const full = Buffer.from("full-image");
	const clean = Buffer.from("clean-image");
	const sidecar = Buffer.from(JSON.stringify({ topology: "fixture" }));
	const fullPath = path.join(directory, "component-full.png");
	const cleanPath = path.join(directory, "component-clean.png");
	const sidecarPath = path.join(directory, "evidence-sidecar.json");
	await Promise.all([
		writeFile(fullPath, full),
		writeFile(cleanPath, clean),
		writeFile(sidecarPath, sidecar),
		writeFile(path.join(directory, "vision-prompt.md"), "prompt"),
		writeFile(path.join(directory, "vision-result.json"), "{}"),
	]);
	return {
		group_id: "serial-annotation-group-028",
		directory,
		full_image_path: fullPath,
		full_image_ref: "review/full.png",
		clean_image_path: cleanPath,
		clean_image_ref: "review/clean.png",
		sidecar_path: sidecarPath,
		sidecar_ref: "review/evidence-sidecar.json",
		full_image_sha256: createHash("sha256").update(full).digest("hex"),
		clean_image_sha256: createHash("sha256").update(clean).digest("hex"),
		width: 2048,
		height: 2048,
	};
}

test("topology fingerprint keeps shape under translation, rotation, reflection and scale", () => {
	const original = buildTopologyFingerprint(group());
	const transformed = buildTopologyFingerprint(group(([x, y]) => [100 - 2 * y, 50 - 2 * x]));
	assert.equal(transformed.graph_hash, original.graph_hash);
	assert.equal(transformed.shape_hash, original.shape_hash);
	assert.notEqual(transformed.metric_hash, original.metric_hash);

	const changed = group();
	changed.clean_occurrences = changed.clean_occurrences.slice(0, 2);
	assert.notEqual(buildTopologyFingerprint(changed).graph_hash, original.graph_hash);
});

test("outbox records BOM/21, paired plots, vision and parent semantics in delivery order", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-topology-"));
	const runsRoot = path.join(root, "runs");
	const runId = "thcad-fixture-run";
	const runDirectory = path.join(runsRoot, runId);
	await mkdir(runDirectory, { recursive: true });
	await writeFile(path.join(runDirectory, "lifecycle.jsonl"), "");
	const currentGroup = group();
	const currentRendered = await rendered(runDirectory);
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
	const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({
			url: String(input),
			body: JSON.parse(String(init?.body)) as Record<string, unknown>,
		});
		return Response.json({ ok: true });
	}) as typeof fetch;
	try {
		const recorder = new TopologySemanticsRecorder({ runsRoot, fetcher });
		const sync = await recorder.recordVisualGroup({
			runId,
			plan: plan(currentGroup),
			group: currentGroup,
			rendered: currentRendered,
			visualResult: { segment_understanding: "19/20/21 构成法兰加强装配" },
			model: "deepseek/vision",
			childSessionRef: "review/child-session",
		});
		assert.equal(sync.sent, 2);
		assert.deepEqual(calls.map((item) => item.url.split("/api/v1")[1]), [
			"/topology-semantics/observations",
			"/topology-semantics/descriptions",
		]);
		const observation = calls[0].body;
		assert.deepEqual((observation.bom_context as Record<string, unknown>).item_numbers, [19, 20, 21]);
		assert.equal(
			((observation.capability_evidence as Record<string, unknown>).capability_21 as Record<string, unknown>).status,
			"computed",
		);
		assert.deepEqual(
			(observation.plots as Array<Record<string, unknown>>).map((item) => item.role),
			["component_full", "component_clean", "deterministic_sidecar"],
		);

		await recorder.recordParentInterpretation({
			runId,
			content: "最终解释：这是法兰、板与加强铁组成的局部连接结构。",
			finalMessage: { role: "assistant", content: [{ type: "text", text: "最终解释" }] },
			model: "deepseek/main",
			sessionRef: "parent-session.jsonl",
		});
		assert.equal(calls.length, 3);
		assert.deepEqual(calls[2].body.observation_keys, [`${runId}/${currentGroup.group_id}`]);

		const repeated = await recorder.recordVisualGroup({
			runId,
			plan: plan(currentGroup),
			group: currentGroup,
			rendered: currentRendered,
			visualResult: { segment_understanding: "19/20/21 构成法兰加强装配" },
			model: "deepseek/vision",
			childSessionRef: "review/child-session",
		});
		assert.equal(repeated.already_synced, 3);
		assert.equal(calls.length, 3);
		await assert.rejects(
			recorder.recordVisualGroup({
				runId,
				plan: plan(currentGroup),
				group: currentGroup,
				rendered: currentRendered,
				visualResult: { segment_understanding: "同一键下被改写的解释" },
				model: "deepseek/vision",
				childSessionRef: "review/child-session",
			}),
			/TOPOLOGY_OUTBOX_RECORD_CONFLICT/,
		);

		const outbox = path.join(runDirectory, "topology-semantics-outbox");
		const files = await readdir(outbox);
		const receipts = await readdir(path.join(recorder.syncRoot, runId));
		assert.equal(receipts.filter((item) => item.endsWith(".receipt.json")).length, 3);
		const observationFile = files.find((item) => item.startsWith("010-"));
		assert.ok(observationFile);
		const stored = JSON.parse(await readFile(path.join(outbox, observationFile), "utf8"));
		assert.equal(stored.payload.drawing.document_ref, "client-data/fixture.dwg");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("backend failure leaves an immutable replayable outbox", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-topology-pending-"));
	const runsRoot = path.join(root, "runs");
	const runId = "thcad-pending-run";
	const runDirectory = path.join(runsRoot, runId);
	await mkdir(runDirectory, { recursive: true });
	await writeFile(path.join(runDirectory, "lifecycle.jsonl"), "");
	const currentGroup = group();
	try {
		const recorder = new TopologySemanticsRecorder({
			runsRoot,
			fetcher: (async () => {
				throw new Error("backend offline");
			}) as typeof fetch,
		});
		const sync = await recorder.recordVisualGroup({
			runId,
			plan: plan(currentGroup),
			group: currentGroup,
			rendered: await rendered(runDirectory),
			visualResult: { segment_understanding: "fixture" },
		});
		assert.equal(sync.sent, 0);
		assert.equal(sync.pending, 2);
		assert.equal(sync.errors.length, 1);
		const files = await readdir(path.join(runDirectory, "topology-semantics-outbox"));
		assert.equal(files.filter((item) => item.endsWith(".json")).length, 2);
		const receipts = await readdir(path.join(recorder.syncRoot, runId));
		assert.equal(receipts.filter((item) => item.endsWith(".receipt.json")).length, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
