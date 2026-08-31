import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	buildTextIndex,
	normalizeSearchText,
	searchTextIndex,
	textIndexStatus,
} from "./text-index.ts";
import { repositoryRoot } from "./paths.ts";

test("text search normalization folds Unicode case and whitespace", () => {
	assert.equal(normalizeSearchText("  ＦＬＡＮＧＥ\n 法 兰  "), "flange 法 兰");
});

test("project text search applies source filters and a global result limit", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-text-search-"));
	try {
		await mkdir(path.join(root, "drawings"), { recursive: true });
		await writeFile(path.join(root, "drawings", "a.texts.jsonl"), [
			JSON.stringify({ source: "dbtext", handle: "A1", layer: "6文字层", text: "联管法兰对接处" }),
			JSON.stringify({ source: "bom_row", handle: "A2", layer: "图框层", text: "名称: 法兰", bom_item_number: 21, fields: { 名称: "法兰", 数量: "1" } }),
			JSON.stringify({ source: "bom_row", handle: "A3", layer: "图框层", text: "名称: 小法兰", bom_item_number: 26 }),
		].join("\n") + "\n");
		await writeFile(path.join(root, "manifest.json"), JSON.stringify({
			schema_version: 1,
			built_at_utc: "2026-08-30T00:00:00.000Z",
			drawing_count: 1,
			record_count: 3,
			drawings: [{
				drawing_ref: "client-data/sample.dwg",
				drawing_name: "sample.dwg",
				sha256: "a".repeat(64),
				size: 1,
				mtime_ms: 1,
				record_count: 3,
				records_file: "drawings/a.texts.jsonl",
				title_metadata: { title_blocks: [] },
				scanned_at_utc: "2026-08-30T00:00:00.000Z",
				open_dirty: false,
				open_dbmod: -1,
			}],
		}));

		const result = await searchTextIndex({ query: " 法兰 ", sources: ["bom_row"], limit: 1 }, { indexRoot: root });
		assert.equal(result.total_matched, 2);
		assert.equal(result.returned_count, 1);
		assert.equal(result.truncated, true);
		const drawings = result.drawings as Array<{ matches: Array<Record<string, unknown>> }>;
		assert.equal(drawings[0].matches[0].bom_item_number, 21);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("text index build scans changed DWGs once and skips unchanged SHA entries", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-text-build-"));
	const drawings = path.join(root, "input");
	const index = path.join(root, "index");
	await mkdir(drawings, { recursive: true });
	await writeFile(path.join(drawings, "sample.dwg"), "fixture-dwg-bytes");
	let scans = 0;
	const bridge = {
		async invoke(operation: "status" | "scan_texts", params: Record<string, unknown> = {}) {
			if (operation === "status") return { documents: [] };
			scans += 1;
			const files = params.files as string[];
			return {
				files: files.map((file) => ({
					source_path: file,
					record_count: 1,
					title_metadata: { title_blocks: [] },
					records: [{ source: "bom_row", text: "名称: 法兰", bom_item_number: 1 }],
					open_dirty: false,
					open_dbmod: -1,
				})),
				failures: [],
			};
		},
	};
	try {
		const first = await buildTextIndex({ bridge, indexRoot: index, drawingRoots: [drawings] });
		const second = await buildTextIndex({ bridge, indexRoot: index, drawingRoots: [drawings] });
		assert.equal(first.scanned_drawing_count, 1);
		assert.equal(second.scanned_drawing_count, 0);
		assert.equal(second.skipped_unchanged_count, 1);
		assert.equal(scans, 1);
		const manifest = JSON.parse(await readFile(path.join(index, "manifest.json"), "utf8"));
		assert.match(manifest.drawings[0].sha256, /^[a-f0-9]{64}$/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("text index build counts a reported scan failure once", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-text-failure-"));
	const drawings = path.join(root, "input");
	const index = path.join(root, "index");
	await mkdir(drawings, { recursive: true });
	const good = path.join(drawings, "good.dwg");
	const bad = path.join(drawings, "bad.dwg");
	await Promise.all([writeFile(good, "good"), writeFile(bad, "bad")]);
	const bridge = {
		async invoke(operation: "status" | "scan_texts") {
			if (operation === "status") return { documents: [] };
			return {
				files: [{
					source_path: good,
					title_metadata: {},
					records: [{ source: "dbtext", text: "ok" }],
				}],
				failures: [{ path: bad, code: "READ_FAILED", message: "fixture" }],
			};
		},
	};
	try {
		const result = await buildTextIndex({ bridge, indexRoot: index, drawingRoots: [drawings] });
		assert.equal(result.status, "partial");
		assert.equal(result.scanned_drawing_count, 1);
		assert.equal(result.failed_count, 1);
		assert.equal((result.failures as unknown[]).length, 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("partial rebuild retains last-good records for a drawing that fails to rescan", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-text-last-good-"));
	const drawings = path.join(root, "input");
	const index = path.join(root, "index");
	await mkdir(drawings, { recursive: true });
	const drawing = path.join(drawings, "sample.dwg");
	await writeFile(drawing, "version-one");
	let fail = false;
	const bridge = {
		async invoke(operation: "status" | "scan_texts") {
			if (operation === "status") return { documents: [] };
			if (fail) return { files: [], failures: [{ path: drawing, code: "READ_FAILED", message: "fixture" }] };
			return {
				files: [{ source_path: drawing, records: [{ source: "dbtext", text: "last good 法兰" }], title_metadata: {} }],
				failures: [],
			};
		},
	};
	try {
		await buildTextIndex({ bridge, indexRoot: index, drawingRoots: [drawings] });
		await writeFile(drawing, "version-two-that-changed");
		fail = true;
		const rebuilt = await buildTextIndex({ bridge, indexRoot: index, drawingRoots: [drawings] });
		assert.equal(rebuilt.status, "partial");
		assert.equal(rebuilt.retained_last_good_count, 1);
		assert.equal(rebuilt.drawing_count, 1);
		const search = await searchTextIndex({ query: "法兰" }, { indexRoot: index });
		assert.equal(search.total_matched, 1);
		const status = await textIndexStatus({ indexRoot: index, drawingRoots: [drawings] });
		assert.equal(status.stale_count, 1);
		assert.equal(status.fresh, false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("text-index status discovers new DWGs and counts one stale entry when its JSONL is missing", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-text-freshness-"));
	const drawings = path.join(root, "input");
	const index = path.join(root, "index");
	await Promise.all([mkdir(drawings, { recursive: true }), mkdir(path.join(index, "drawings"), { recursive: true })]);
	const indexed = path.join(drawings, "indexed.dwg");
	const unindexed = path.join(drawings, "new.dwg");
	await Promise.all([writeFile(indexed, "indexed"), writeFile(unindexed, "new")]);
	const info = await stat(indexed);
	await writeFile(path.join(index, "manifest.json"), JSON.stringify({
		schema_version: 1,
		built_at_utc: "2026-08-30T00:00:00.000Z",
		drawing_count: 1,
		record_count: 1,
		drawings: [{
			drawing_ref: indexed,
			drawing_name: "indexed.dwg",
			sha256: "a".repeat(64),
			size: info.size,
			mtime_ms: info.mtimeMs,
			record_count: 1,
			records_file: "drawings/missing.jsonl",
			title_metadata: {},
			scanned_at_utc: "2026-08-30T00:00:00.000Z",
			open_dirty: false,
			open_dbmod: -1,
		}],
	}));
	try {
		const status = await textIndexStatus({ indexRoot: index, drawingRoots: [drawings] });
		assert.equal(status.stale_count, 1);
		assert.equal(status.records_missing_count, 1);
		assert.equal(status.unindexed_count, 1);
		assert.equal(status.fresh, false);
		const search = await searchTextIndex({ query: "anything" }, { indexRoot: index });
		assert.equal(search.partial, true);
		assert.equal(search.unavailable_count, 1);
		assert.equal(search.total_matched, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("text index matches scan inventories by full drawing ref when basenames collide", async () => {
	const runtimeTests = path.join(repositoryRoot, ".pi", "runtime", "text-index-tests");
	await mkdir(runtimeTests, { recursive: true });
	const root = await mkdtemp(path.join(runtimeTests, "same-name-"));
	const customer = path.join(root, "customer");
	const workspace = path.join(root, "workspace");
	const index = path.join(root, "index");
	await Promise.all([mkdir(customer), mkdir(workspace)]);
	const first = path.join(customer, "shared.dwg");
	const second = path.join(workspace, "shared.dwg");
	await Promise.all([writeFile(first, "first"), writeFile(second, "second")]);
	const bridge = {
		async invoke(operation: "status" | "scan_texts") {
			if (operation === "status") return { documents: [] };
			return {
				files: [
					{ source_path: second, records: [{ source: "dbtext", text: "SECOND-DRAWING" }], title_metadata: {} },
					{ source_path: first, records: [{ source: "dbtext", text: "FIRST-DRAWING" }], title_metadata: {} },
				],
				failures: [],
			};
		},
	};
	try {
		const built = await buildTextIndex({ bridge, indexRoot: index, drawingRoots: [customer, workspace] });
		assert.equal(built.drawing_count, 2);
		const firstHit = await searchTextIndex({ query: "FIRST-DRAWING" }, { indexRoot: index });
		const secondHit = await searchTextIndex({ query: "SECOND-DRAWING" }, { indexRoot: index });
		assert.match(String((firstHit.drawings as Array<{ drawing: string }>)[0].drawing), /customer\/shared\.dwg$/u);
		assert.match(String((secondHit.drawings as Array<{ drawing: string }>)[0].drawing), /workspace\/shared\.dwg$/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
