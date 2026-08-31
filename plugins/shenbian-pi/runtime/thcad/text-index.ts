import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import { ThcadBridgeClient, ThcadBridgeError } from "./bridge-client.ts";
import {
	repositoryRoot,
	textIndexRoot,
	thcadWorkspaceRoot,
	toProjectRef,
	transformerDrawingRoot,
} from "./paths.ts";

const MANIFEST_SCHEMA_VERSION = 1;

interface ScanClient {
	invoke(
		operation: "status" | "scan_texts",
		params?: Record<string, unknown>,
		options?: { signal?: AbortSignal; timeoutSeconds?: number },
	): Promise<Record<string, unknown>>;
}

export interface TextIndexEntry {
	drawing_ref: string;
	drawing_name: string;
	sha256: string;
	size: number;
	mtime_ms: number;
	record_count: number;
	records_file: string;
	title_metadata: unknown;
	scanned_at_utc: string;
	open_dirty: boolean;
	open_dbmod: number;
	open_dbmod_known?: boolean;
	last_scan_error?: {
		code: string;
		message: string;
		failed_at_utc: string;
	};
}

export interface TextIndexManifest {
	schema_version: number;
	built_at_utc: string;
	drawing_count: number;
	record_count: number;
	drawings: TextIndexEntry[];
}

export interface TextSearchRequest {
	query: string;
	regex?: boolean;
	sources?: string[];
	layers?: string[];
	drawings?: string[];
	limit?: number;
}

export function normalizeSearchText(value: string): string {
	return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

async function atomicWrite(file: string, content: string): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
	await rename(temporary, file);
}

async function exists(file: string): Promise<boolean> {
	try {
		return (await stat(file)).isFile();
	} catch {
		return false;
	}
}

async function hashFile(file: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = createReadStream(file);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("error", reject);
		stream.on("end", () => resolve(hash.digest("hex")));
	});
}

async function listDwgs(roots: string[]): Promise<string[]> {
	const files: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		let entries;
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const candidate = path.join(directory, entry.name);
			if (entry.isDirectory()) await visit(candidate);
			else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".dwg") files.push(path.resolve(candidate));
		}
	};
	for (const root of roots) await visit(root);
	return [...new Set(files.map((file) => file.toLowerCase()))]
		.map((lower) => files.find((file) => file.toLowerCase() === lower)!)
		.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

async function readManifest(root: string): Promise<TextIndexManifest | undefined> {
	try {
		const value = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as TextIndexManifest;
		if (value.schema_version !== MANIFEST_SCHEMA_VERSION || !Array.isArray(value.drawings)) return undefined;
		return value;
	} catch {
		return undefined;
	}
}

function recordsFileFor(drawingRef: string): string {
	const suffix = createHash("sha256").update(drawingRef).digest("hex").slice(0, 12);
	const stem = path.basename(drawingRef, path.extname(drawingRef)).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 100);
	return `drawings/${stem}-${suffix}.texts.jsonl`;
}

function pathFromRef(reference: string): string {
	return path.isAbsolute(reference) ? path.resolve(reference) : path.resolve(repositoryRoot, reference);
}

function drawingIdentity(reference: string): string {
	if (!reference.trim()) return "";
	const safeReference = path.isAbsolute(reference)
		? toProjectRef(path.resolve(reference))
		: reference;
	return safeReference.replaceAll("\\", "/").replace(/^\.\//u, "").toLocaleLowerCase();
}

function openDbmods(status: Record<string, unknown>): Map<string, number> {
	const result = new Map<string, number>();
	for (const value of Array.isArray(status.documents) ? status.documents : []) {
		const document = record(value);
		if (typeof document.path !== "string") continue;
		result.set(pathFromRef(document.path).toLowerCase(), Number(document.dbmod ?? -1));
	}
	return result;
}

export async function buildTextIndex(options: {
	signal?: AbortSignal;
	bridge?: ScanClient;
	indexRoot?: string;
	drawingRoots?: string[];
} = {}): Promise<Record<string, unknown>> {
	const root = options.indexRoot ?? textIndexRoot;
	const drawingRoots = options.drawingRoots ?? [transformerDrawingRoot, thcadWorkspaceRoot];
	const bridge = options.bridge ?? new ThcadBridgeClient();
	await mkdir(path.join(root, "drawings"), { recursive: true });
	const [prior, drawingFiles, bridgeStatus] = await Promise.all([
		readManifest(root),
		listDwgs(drawingRoots),
		bridge.invoke("status", {}, { signal: options.signal, timeoutSeconds: 30 }),
	]);
	const priorByRef = new Map((prior?.drawings ?? []).map((entry) => [entry.drawing_ref.toLowerCase(), entry]));
	const openDocuments = openDbmods(bridgeStatus);
	const nextEntries = new Map<string, TextIndexEntry>();
	const changed: Array<{ file: string; ref: string; sha256: string; size: number; mtimeMs: number }> = [];
	let skipped = 0;

	for (const file of drawingFiles) {
		if (options.signal?.aborted) throw new ThcadBridgeError("SUBAGENT_CANCELLED", "Text-index build cancelled.");
		const info = await stat(file);
		const drawingRef = toProjectRef(file);
		const previous = priorByRef.get(drawingRef.toLowerCase());
		const sha256 = previous && previous.size === info.size && previous.mtime_ms === info.mtimeMs
			? previous.sha256
			: await hashFile(file);
		const recordsFile = previous?.records_file ?? recordsFileFor(drawingRef);
		if (previous?.sha256 === sha256 && await exists(path.join(root, recordsFile))) {
			const isOpen = openDocuments.has(file.toLowerCase());
			const dbmod = openDocuments.get(file.toLowerCase()) ?? -1;
			nextEntries.set(drawingRef.toLowerCase(), {
				...previous,
				size: info.size,
				mtime_ms: info.mtimeMs,
				open_dirty: isOpen && dbmod !== 0,
				open_dbmod: dbmod,
				open_dbmod_known: !isOpen || dbmod >= 0,
				last_scan_error: undefined,
			});
			skipped += 1;
		} else {
			changed.push({ file, ref: drawingRef, sha256, size: info.size, mtimeMs: info.mtimeMs });
		}
	}

	const failures: unknown[] = [];
	let successfulScans = 0;
	let retainedLastGood = 0;
	for (let offset = 0; offset < changed.length; offset += 128) {
		const batch = changed.slice(offset, offset + 128);
		const response = await bridge.invoke("scan_texts", {
			files: batch.map((item) => item.file),
		}, { signal: options.signal, timeoutSeconds: 900 });
		const inventories = Array.isArray(response.files) ? response.files.map(record) : [];
		const responseFailures = Array.isArray(response.failures) ? response.failures.map(record) : [];
		failures.push(...responseFailures);
		for (let index = 0; index < batch.length; index += 1) {
			const source = batch[index];
			const sourceIdentity = drawingIdentity(source.ref);
			const inventory = inventories.find((candidate) => (
				drawingIdentity(String(candidate.source_path ?? "")) === sourceIdentity
			));
			if (!inventory) {
				const reported = responseFailures.find((failure) => {
					const failedPath = String(failure.path ?? failure.drawing_ref ?? "");
					return drawingIdentity(failedPath) === sourceIdentity;
				});
				const failure = reported ?? { drawing_ref: source.ref, code: "SCAN_RESULT_MISSING", message: "THCAD returned no inventory for this drawing." };
				if (!reported) failures.push(failure);
				const previous = priorByRef.get(source.ref.toLowerCase());
				if (previous && await exists(path.join(root, previous.records_file))) {
					nextEntries.set(source.ref.toLowerCase(), {
						...previous,
						last_scan_error: {
							code: String(failure.code ?? "SCAN_FAILED").slice(0, 100),
							message: String(failure.message ?? "Drawing scan failed; retained last-good index data.").slice(0, 1_000),
							failed_at_utc: new Date().toISOString(),
						},
					});
					retainedLastGood += 1;
				}
				continue;
			}
			const records = Array.isArray(inventory.records) ? inventory.records : [];
			const recordsFile = recordsFileFor(source.ref);
			await atomicWrite(
				path.join(root, recordsFile),
				records.map((item) => JSON.stringify(item)).join("\n") + (records.length ? "\n" : ""),
			);
			const inventoryOpen = Boolean(inventory.open);
			const inventoryDbmod = Number(inventory.open_dbmod ?? -1);
			nextEntries.set(source.ref.toLowerCase(), {
				drawing_ref: source.ref,
				drawing_name: path.basename(source.file),
				sha256: source.sha256,
				size: source.size,
				mtime_ms: source.mtimeMs,
				record_count: records.length,
				records_file: recordsFile,
				title_metadata: inventory.title_metadata ?? null,
				scanned_at_utc: String(inventory.scanned_at_utc ?? new Date().toISOString()),
				open_dirty: inventoryOpen && inventoryDbmod !== 0,
				open_dbmod: inventoryDbmod,
				open_dbmod_known: Boolean(inventory.open_dbmod_known ?? (!inventoryOpen || inventoryDbmod >= 0)),
			});
			successfulScans += 1;
		}
	}

	const drawings = [...nextEntries.values()].sort((left, right) => left.drawing_ref.localeCompare(right.drawing_ref, "zh-CN"));
	const manifest: TextIndexManifest = {
		schema_version: MANIFEST_SCHEMA_VERSION,
		built_at_utc: new Date().toISOString(),
		drawing_count: drawings.length,
		record_count: drawings.reduce((sum, entry) => sum + entry.record_count, 0),
		drawings,
	};
	await atomicWrite(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	const failedDrawings = changed.length - successfulScans;
	return {
		status: failedDrawings ? "partial" : "complete",
		manifest_ref: toProjectRef(path.join(root, "manifest.json")),
		drawing_count: manifest.drawing_count,
		record_count: manifest.record_count,
		scanned_drawing_count: successfulScans,
		skipped_unchanged_count: skipped,
		retained_last_good_count: retainedLastGood,
		failed_count: failedDrawings,
		failures,
	};
}

function stringSet(values?: string[]): Set<string> | undefined {
	if (!values?.length) return undefined;
	return new Set(values.map(normalizeSearchText).filter(Boolean));
}

function trimmedFields(value: unknown): Record<string, string> | undefined {
	const fields = record(value);
	const entries = Object.entries(fields).slice(0, 40).map(([key, item]) => [key.slice(0, 100), String(item ?? "").slice(0, 500)]);
	return entries.length ? Object.fromEntries(entries) : undefined;
}

function slimHit(entry: TextIndexEntry, raw: Record<string, unknown>): Record<string, unknown> {
	return {
		drawing: entry.drawing_ref,
		source: String(raw.source ?? ""),
		handle: String(raw.handle ?? ""),
		owner_handle: String(raw.owner_handle ?? ""),
		owner_scope: String(raw.owner_scope ?? ""),
		owner_block_name: String(raw.owner_block_name ?? ""),
		layer: String(raw.layer ?? ""),
		position: Array.isArray(raw.position) ? raw.position.slice(0, 3) : null,
		text: String(raw.text ?? "").slice(0, 1_000),
		bom_item_number: Number.isInteger(raw.bom_item_number) ? raw.bom_item_number : null,
		fields: trimmedFields(raw.fields),
	};
}

function slimTitleMetadata(value: unknown): Record<string, unknown> {
	const metadata = record(value);
	const summary = Object.fromEntries(
		Object.entries(record(metadata.summary_info))
			.filter(([, item]) => String(item ?? "").trim())
			.map(([key, item]) => [key, String(item).slice(0, 500)]),
	);
	const preferred = ["产品型号", "图样名称", "图样代号", "比例", "第几页", "共几页"];
	const titleBlocks = (Array.isArray(metadata.title_blocks) ? metadata.title_blocks : []).slice(0, 5).map((value_) => {
		const block = record(value_);
		const fields = record(block.fields);
		return {
			handle: String(block.handle ?? ""),
			fields: Object.fromEntries(preferred.filter((key) => key in fields).map((key) => [key, String(fields[key] ?? "").slice(0, 500)])),
		};
	});
	return { summary_info: summary, title_blocks: titleBlocks };
}

export async function searchTextIndex(
	request: TextSearchRequest,
	options: { indexRoot?: string } = {},
): Promise<Record<string, unknown>> {
	const root = options.indexRoot ?? textIndexRoot;
	const manifest = await readManifest(root);
	if (!manifest) throw new ThcadBridgeError("TEXT_INDEX_NOT_BUILT", "Run thcad_project_texts build first.");
	const query = request.query.trim();
	if (!query || query.length > 500) throw new ThcadBridgeError("INVALID_QUERY", "query must contain 1–500 characters.");
	const limit = Math.max(1, Math.min(request.limit ?? 50, 200));
	const sourceFilter = stringSet(request.sources);
	const layerFilter = stringSet(request.layers);
	const drawingFilter = stringSet(request.drawings);
	let expression: RegExp | undefined;
	if (request.regex) {
		if (query.length > 200) throw new ThcadBridgeError("INVALID_REGEX", "Regex queries are limited to 200 characters.");
		try {
			expression = new RegExp(query, "iu");
		} catch (error) {
			throw new ThcadBridgeError("INVALID_REGEX", String(error));
		}
	}
	const normalizedQuery = normalizeSearchText(query);
	const grouped = new Map<string, { entry: TextIndexEntry; matches: Record<string, unknown>[]; matched: number }>();
	const unavailableDrawings: Array<{ drawing: string; code: string }> = [];
	let totalMatched = 0;
	let returned = 0;

	for (const entry of manifest.drawings) {
		const drawingKeys = [entry.drawing_ref, entry.drawing_name].map(normalizeSearchText);
		if (drawingFilter && !drawingKeys.some((value) => drawingFilter.has(value))) continue;
		const recordsPath = path.join(root, entry.records_file);
		if (!await exists(recordsPath)) {
			unavailableDrawings.push({ drawing: entry.drawing_ref, code: "INDEX_RECORDS_MISSING" });
			continue;
		}
		try {
			const stream = createReadStream(recordsPath, { encoding: "utf8" });
			const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
			for await (const line of lines) {
				if (!line.trim()) continue;
				let raw: Record<string, unknown>;
				try {
					raw = record(JSON.parse(line));
				} catch {
					continue;
				}
				if (sourceFilter && !sourceFilter.has(normalizeSearchText(String(raw.source ?? "")))) continue;
				if (layerFilter && !layerFilter.has(normalizeSearchText(String(raw.layer ?? "")))) continue;
				const text = String(raw.text ?? "");
				const matches = expression ? expression.test(text) : normalizeSearchText(text).includes(normalizedQuery);
				if (!matches) continue;
				totalMatched += 1;
				let group = grouped.get(entry.drawing_ref);
				if (!group) {
					group = { entry, matches: [], matched: 0 };
					grouped.set(entry.drawing_ref, group);
				}
				group.matched += 1;
				if (returned < limit) {
					group.matches.push(slimHit(entry, raw));
					returned += 1;
				}
			}
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code ?? "INDEX_RECORDS_UNREADABLE";
			unavailableDrawings.push({ drawing: entry.drawing_ref, code: String(code).slice(0, 100) });
		}
	}

	const drawings = [...grouped.values()].map((group) => ({
		drawing: group.entry.drawing_ref,
		drawing_name: group.entry.drawing_name,
		sha256: group.entry.sha256,
		open_dirty_at_scan: group.entry.open_dirty,
		last_scan_error: group.entry.last_scan_error,
		title_metadata: slimTitleMetadata(group.entry.title_metadata),
		matched_count: group.matched,
		matches: group.matches,
	}));
	return {
		query,
		match_mode: request.regex ? "regex" : "normalized_contains",
		total_matched: totalMatched,
		returned_count: drawings.reduce((sum, group) => sum + group.matches.length, 0),
		truncated: totalMatched > limit,
		drawings,
		partial: unavailableDrawings.length > 0,
		unavailable_count: unavailableDrawings.length,
		unavailable_drawings: unavailableDrawings,
		manifest_built_at_utc: manifest.built_at_utc,
	};
}

export async function textIndexStatus(options: { indexRoot?: string; drawingRoots?: string[] } = {}): Promise<{
	exists: boolean;
	fresh: boolean;
	drawing_count: number;
	record_count: number;
	stale_count: number;
	missing_count: number;
	records_missing_count: number;
	unindexed_count: number;
	unindexed_drawings: string[];
	built_at_utc?: string;
	manifest_ref?: string;
}> {
	const root = options.indexRoot ?? textIndexRoot;
	const manifest = await readManifest(root);
	if (!manifest) return {
		exists: false,
		fresh: false,
		drawing_count: 0,
		record_count: 0,
		stale_count: 0,
		missing_count: 0,
		records_missing_count: 0,
		unindexed_count: 0,
		unindexed_drawings: [],
	};
	const drawingRoots = options.drawingRoots ?? [transformerDrawingRoot, thcadWorkspaceRoot];
	const currentFiles = await listDwgs(drawingRoots);
	const currentByIdentity = new Map(currentFiles.map((file) => [drawingIdentity(file), file]));
	const indexedIdentities = new Set(manifest.drawings.map((entry) => drawingIdentity(entry.drawing_ref)));
	const unindexedDrawings = currentFiles
		.filter((file) => !indexedIdentities.has(drawingIdentity(file)))
		.map(toProjectRef);
	let stale = 0;
	let missing = 0;
	let recordsMissing = 0;
	for (const entry of manifest.drawings) {
		let entryStale = false;
		try {
			const sourcePath = currentByIdentity.get(drawingIdentity(entry.drawing_ref)) ?? pathFromRef(entry.drawing_ref);
			const info = await stat(sourcePath);
			if (info.size !== entry.size || info.mtimeMs !== entry.mtime_ms) entryStale = true;
		} catch {
			missing += 1;
			continue;
		}
		if (!await exists(path.join(root, entry.records_file))) {
			recordsMissing += 1;
			entryStale = true;
		}
		if (entryStale) stale += 1;
	}
	const fresh = stale === 0 && missing === 0 && unindexedDrawings.length === 0;
	return {
		exists: true,
		fresh,
		drawing_count: manifest.drawing_count,
		record_count: manifest.record_count,
		stale_count: stale,
		missing_count: missing,
		records_missing_count: recordsMissing,
		unindexed_count: unindexedDrawings.length,
		unindexed_drawings: unindexedDrawings.slice(0, 100),
		built_at_utc: manifest.built_at_utc,
		manifest_ref: toProjectRef(path.join(root, "manifest.json")),
	};
}
