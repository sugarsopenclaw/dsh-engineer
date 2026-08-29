import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getCapability, type ThcadCapability } from "./capability-catalog.ts";
import { bridgeRoot, resolveInside, toProjectRef } from "./paths.ts";

const MAX_JSON_BYTES = 256 * 1024 * 1024;
const MAX_VISITED_VALUES = 2_000_000;

interface AnalysisState {
	analysis_id?: string;
	document_name?: string;
	document_path?: string;
	dbmod_after?: number;
	source_status?: string;
	report?: string;
	artifacts?: Record<string, string>;
}

export interface ArtifactQuery {
	jsonPath?: string;
	terms?: string[];
	matchMode?: "all" | "any";
	limit?: number;
	maxChars?: number;
}

function bounded(value: unknown, depth = 0): unknown {
	if (value === null || typeof value !== "object") {
		if (typeof value === "string" && value.length > 1000) return `${value.slice(0, 1000)}…`;
		return value;
	}
	if (depth >= 4) return Array.isArray(value) ? `[${value.length} items]` : "{…}";
	if (Array.isArray(value)) {
		const projected = value.slice(0, 8).map((item) => bounded(item, depth + 1));
		if (value.length > 8) projected.push(`… ${value.length - 8} more`);
		return projected;
	}
	const entries = Object.entries(value as Record<string, unknown>);
	const projected: Record<string, unknown> = {};
	for (const [key, child] of entries.slice(0, 30)) projected[key] = bounded(child, depth + 1);
	if (entries.length > 30) projected._truncated_keys = entries.length - 30;
	return projected;
}

function getAtPath(root: unknown, expression: string): unknown {
	const normalized = expression.trim().replace(/^\$\.?/, "").replace(/\[(\d+)\]/g, ".$1");
	if (!normalized) return root;
	let current = root;
	for (const segment of normalized.split(".").filter(Boolean)) {
		if (current === null || typeof current !== "object") {
			throw new Error(`JSON_PATH_NOT_FOUND: ${expression}`);
		}
		const record = current as Record<string, unknown>;
		if (!(segment in record)) throw new Error(`JSON_PATH_NOT_FOUND: ${expression}`);
		current = record[segment];
	}
	return current;
}

function searchJson(
	root: unknown,
	terms: string[],
	matchMode: "all" | "any",
	limit: number,
): { matches: unknown[]; visited: number; truncated: boolean } {
	const normalizedTerms = terms.map((term) => term.trim().toLocaleLowerCase()).filter(Boolean);
	const matches: unknown[] = [];
	let visited = 0;
	let truncated = false;

	const visit = (value: unknown, jsonPath: string, parent: unknown): void => {
		if (matches.length >= limit || visited >= MAX_VISITED_VALUES) {
			truncated = true;
			return;
		}
		visited += 1;
		if (value === null || typeof value !== "object") {
			const text = String(value).toLocaleLowerCase();
			const hit = matchMode === "all"
				? normalizedTerms.every((term) => text.includes(term))
				: normalizedTerms.some((term) => text.includes(term));
			if (hit) matches.push({ path: jsonPath, value: bounded(value), context: bounded(parent) });
			return;
		}
		if (Array.isArray(value)) {
			for (let index = 0; index < value.length; index += 1) {
				visit(value[index], `${jsonPath}[${index}]`, value[index]);
				if (matches.length >= limit || visited >= MAX_VISITED_VALUES) break;
			}
			return;
		}
		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			visit(child, `${jsonPath}.${key}`, value);
			if (matches.length >= limit || visited >= MAX_VISITED_VALUES) break;
		}
	};

	visit(root, "$", root);
	return { matches, visited, truncated };
}

function truncateSerialized(value: unknown, maxChars: number): { text: string; truncated: boolean } {
	const full = JSON.stringify(value, null, 2);
	if (full.length <= maxChars) return { text: full, truncated: false };
	return { text: `${full.slice(0, maxChars)}\n…`, truncated: true };
}

function matchesPrefixes(key: string, capability: ThcadCapability): boolean {
	return capability.reportPrefixes.some((prefix) => key.startsWith(prefix));
}

async function readUtf8Prefix(filePath: string, maxChars: number): Promise<{ text: string; truncated: boolean }> {
	const metadata = await stat(filePath);
	const maxBytes = Math.min(metadata.size, Math.max(maxChars * 4, 4096));
	const buffer = Buffer.alloc(maxBytes);
	const handle = await open(filePath, "r");
	try {
		const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
		const text = buffer.subarray(0, bytesRead).toString("utf8");
		return { text: text.slice(0, maxChars), truncated: metadata.size > bytesRead || text.length > maxChars };
	} finally {
		await handle.close();
	}
}

export class ThcadArtifactStore {
	private readonly root: string;

	constructor(root = bridgeRoot) {
		this.root = path.resolve(root);
	}

	async currentState(): Promise<AnalysisState> {
		const statePath = path.join(this.root, "state", "current-analysis.json");
		try {
			return JSON.parse(await readFile(statePath, "utf8")) as AnalysisState;
		} catch {
			throw new Error("ARTIFACT_MISSING: run thcad_session action=refresh_analysis first");
		}
	}

	private async artifactPath(capabilityId: number): Promise<{ state: AnalysisState; path: string; ref: string }> {
		const state = await this.currentState();
		const relative = state.artifacts?.[String(capabilityId)];
		if (!relative) throw new Error(`ARTIFACT_MISSING: capability ${capabilityId} was not published`);
		const artifactPath = resolveInside(this.root, relative);
		await stat(artifactPath);
		return { state, path: artifactPath, ref: toProjectRef(artifactPath) };
	}

	async summary(capabilityId: number, maxChars = 20_000): Promise<Record<string, unknown>> {
		const capability = getCapability(capabilityId);
		const { state, path: artifactPath, ref } = await this.artifactPath(capabilityId);
		const reportRelative = state.report;
		let reportSummary: Record<string, unknown> = {};
		if (reportRelative) {
			const report = JSON.parse(await readFile(resolveInside(this.root, reportRelative), "utf8")) as Record<string, unknown>;
			reportSummary = Object.fromEntries(
				Object.entries(report).filter(([key]) => matchesPrefixes(key, capability)),
			);
		}

		let markdown: string | undefined;
		let markdownTruncated = false;
		if (capability.markdown) {
			const markdownPath = path.join(path.dirname(artifactPath), capability.markdown);
			try {
				const excerpt = await readUtf8Prefix(markdownPath, maxChars);
				markdownTruncated = excerpt.truncated;
				markdown = excerpt.text;
			} catch {
				markdown = undefined;
			}
		}

		return {
			capability: { id: capability.id, name: capability.name, business_use: capability.businessUse },
			document: state.document_name,
			source_status: state.source_status,
			dbmod_after: state.dbmod_after,
			artifact_ref: ref,
			report_summary: reportSummary,
			...(markdown ? { markdown_excerpt: markdown, markdown_truncated: markdownTruncated } : {}),
		};
	}

	async query(capabilityId: number, query: ArtifactQuery): Promise<Record<string, unknown>> {
		const capability = getCapability(capabilityId);
		const { state, path: artifactPath, ref } = await this.artifactPath(capabilityId);
		const metadata = await stat(artifactPath);
		if (metadata.size > MAX_JSON_BYTES) {
			throw new Error(`ARTIFACT_TOO_LARGE: ${metadata.size} bytes exceeds ${MAX_JSON_BYTES}`);
		}
		const root = JSON.parse(await readFile(artifactPath, "utf8")) as unknown;
		const limit = Math.max(1, Math.min(query.limit ?? 20, 50));
		const maxChars = Math.max(1000, Math.min(query.maxChars ?? 30_000, 50_000));
		let result: unknown;
		let visited: number | undefined;
		let searchTruncated = false;

		if (query.jsonPath?.trim()) {
			result = { path: query.jsonPath, value: bounded(getAtPath(root, query.jsonPath)) };
		} else if (query.terms?.some((term) => term.trim())) {
			const searched = searchJson(root, query.terms, query.matchMode ?? "any", limit);
			result = searched.matches;
			visited = searched.visited;
			searchTruncated = searched.truncated;
		} else {
			throw new Error("INVALID_ARGUMENT: query requires json_path or non-empty terms");
		}

		const serialized = truncateSerialized(result, maxChars);
		return {
			capability: { id: capability.id, name: capability.name },
			document: state.document_name,
			source_status: state.source_status,
			artifact_ref: ref,
			result_json: serialized.text,
			result_truncated: serialized.truncated || searchTruncated,
			...(visited === undefined ? {} : { visited_values: visited }),
		};
	}

	async queryStandaloneJson(
		artifactPath: string,
		query: ArtifactQuery,
	): Promise<Record<string, unknown>> {
		const resolved = resolveInside(this.root, path.relative(this.root, artifactPath));
		const metadata = await stat(resolved);
		if (metadata.size > MAX_JSON_BYTES) throw new Error("ARTIFACT_TOO_LARGE");
		const root = JSON.parse(await readFile(resolved, "utf8")) as unknown;
		const limit = Math.max(1, Math.min(query.limit ?? 20, 50));
		const maxChars = Math.max(1000, Math.min(query.maxChars ?? 30_000, 50_000));
		let result: unknown;
		if (query.jsonPath?.trim()) {
			result = { path: query.jsonPath, value: bounded(getAtPath(root, query.jsonPath)) };
		} else if (query.terms?.some((term) => term.trim())) {
			result = searchJson(root, query.terms, query.matchMode ?? "any", limit).matches;
		} else {
			result = bounded(root);
		}
		const serialized = truncateSerialized(result, maxChars);
		return { artifact_ref: toProjectRef(resolved), result_json: serialized.text, result_truncated: serialized.truncated };
	}
}
