import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
	BomCloseReadingGroupPlan,
	BomCloseReadingPlan,
	RenderOccurrence,
	RenderedBomCloseReadingGroup,
} from "./bom-close-reading.ts";
import { reviewRunsRoot, toProjectRef } from "./paths.ts";

type JsonRecord = Record<string, unknown>;

const KNOWLEDGE_SCOPE = "shenbian-transformer";
const FINGERPRINT_SCHEMA_VERSION = "thcad-local-selection-v1";
const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 12_000;

export interface TopologyFingerprintPayload {
	fingerprint_schema_version: string;
	scope_kind: string;
	graph_hash: string;
	shape_hash: string;
	metric_hash: string;
	invariances: string[];
	feature_summary: JsonRecord;
	canonical_payload: JsonRecord;
}

export interface TopologySemanticSyncResult {
	run_id: string;
	sent: number;
	already_synced: number;
	pending: number;
	errors: string[];
}

interface OutboxEnvelope {
	schema_version: 1;
	record_key: string;
	record_kind: "observation" | "description";
	endpoint: string;
	created_at_utc: string;
	payload: JsonRecord;
}

interface VisualGroupRecordInput {
	runId: string;
	plan: BomCloseReadingPlan;
	group: BomCloseReadingGroupPlan;
	rendered: RenderedBomCloseReadingGroup;
	visualResult: JsonRecord;
	model?: string;
	childSessionRef?: string;
}

interface ParentInterpretationInput {
	runId: string;
	content: string;
	finalMessage?: unknown;
	model?: string;
	thinkingLevel?: string;
	sessionRef?: string;
}

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value as JsonRecord)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, canonicalValue(item)]));
	}
	return value;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalValue(value));
}

function sha256(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

async function fileSha256(target: string): Promise<string> {
	return createHash("sha256").update(await readFile(target)).digest("hex");
}

function rounded(value: number, digits = 6): number {
	if (!Number.isFinite(value)) return 0;
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function histogram(values: readonly string[]): JsonRecord {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

class DisjointSet {
	private readonly parents: number[] = [];

	add(): number {
		const index = this.parents.length;
		this.parents.push(index);
		return index;
	}

	find(index: number): number {
		let root = index;
		while (this.parents[root] !== root) root = this.parents[root];
		while (this.parents[index] !== index) {
			const parent = this.parents[index];
			this.parents[index] = root;
			index = parent;
		}
		return root;
	}

	union(left: number, right: number): void {
		const leftRoot = this.find(left);
		const rightRoot = this.find(right);
		if (leftRoot !== rightRoot) this.parents[rightRoot] = leftRoot;
	}

	rootCount(): number {
		return new Set(this.parents.map((_value, index) => this.find(index))).size;
	}
}

function graphPayload(occurrences: readonly RenderOccurrence[], scale: number): JsonRecord {
	const tolerance = Math.max(scale * 1e-6, 1e-8);
	const vertices = new Map<string, { index: number; degree: number }>();
	const sets = new DisjointSet();
	let edgeCount = 0;
	const keyFor = (point: readonly number[]): string => (
		`${Math.round(point[0] / tolerance)},${Math.round(point[1] / tolerance)}`
	);
	const vertex = (point: readonly number[]): { index: number; degree: number } => {
		const key = keyFor(point);
		let current = vertices.get(key);
		if (!current) {
			current = { index: sets.add(), degree: 0 };
			vertices.set(key, current);
		}
		return current;
	};
	for (const occurrence of occurrences) {
		for (let index = 1; index < occurrence.path.length; index += 1) {
			const left = vertex(occurrence.path[index - 1]);
			const right = vertex(occurrence.path[index]);
			left.degree += 1;
			right.degree += 1;
			sets.union(left.index, right.index);
			edgeCount += 1;
		}
		if (occurrence.closed && occurrence.path.length > 2) {
			const first = occurrence.path[0];
			const last = occurrence.path[occurrence.path.length - 1];
			if (keyFor(first) !== keyFor(last)) {
				const left = vertex(last);
				const right = vertex(first);
				left.degree += 1;
				right.degree += 1;
				sets.union(left.index, right.index);
				edgeCount += 1;
			}
		}
	}
	const componentCount = vertices.size ? sets.rootCount() : occurrences.length;
	const cycleRank = Math.max(0, edgeCount - vertices.size + componentCount);
	return {
		vertex_count: vertices.size,
		edge_count: edgeCount,
		component_count: componentCount,
		cycle_rank: cycleRank,
		closed_occurrence_count: occurrences.filter((item) => item.closed).length,
		degree_histogram: histogram([...vertices.values()].map((item) => String(item.degree))),
		geometry_kind_counts: histogram(occurrences.map((item) => item.geometry_kind)),
	};
}

function turnAngles(occurrence: RenderOccurrence): number[] {
	const result: number[] = [];
	for (let index = 2; index < occurrence.path.length; index += 1) {
		const first = occurrence.path[index - 2];
		const middle = occurrence.path[index - 1];
		const last = occurrence.path[index];
		const leftX = middle[0] - first[0];
		const leftY = middle[1] - first[1];
		const rightX = last[0] - middle[0];
		const rightY = last[1] - middle[1];
		const denominator = Math.hypot(leftX, leftY) * Math.hypot(rightX, rightY);
		if (denominator <= 1e-12) continue;
		const cosine = Math.max(-1, Math.min(1, (leftX * rightX + leftY * rightY) / denominator));
		result.push(rounded(Math.acos(cosine), 5));
	}
	return result.sort((left, right) => left - right);
}

function shapePayload(
	occurrences: readonly RenderOccurrence[],
	bounds: readonly [number, number, number, number],
): JsonRecord {
	const width = Math.max(bounds[2] - bounds[0], 1e-9);
	const height = Math.max(bounds[3] - bounds[1], 1e-9);
	const scale = Math.max(width, height);
	const centerX = (bounds[0] + bounds[2]) / 2;
	const centerY = (bounds[1] + bounds[3]) / 2;
	const descriptors = occurrences.map((item) => {
		const itemWidth = Math.max(0, item.bounds[2] - item.bounds[0]);
		const itemHeight = Math.max(0, item.bounds[3] - item.bounds[1]);
		const itemCenterX = (item.bounds[0] + item.bounds[2]) / 2;
		const itemCenterY = (item.bounds[1] + item.bounds[3]) / 2;
		return {
			geometry_kind: item.geometry_kind,
			closed: item.closed,
			path_point_count: item.path.length,
			normalized_length: rounded(item.length / scale),
			normalized_extents: [
				rounded(Math.min(itemWidth, itemHeight) / scale),
				rounded(Math.max(itemWidth, itemHeight) / scale),
			],
			normalized_radial_center: rounded(Math.hypot(itemCenterX - centerX, itemCenterY - centerY) / scale),
			turn_angles: turnAngles(item),
		};
	});
	return {
		aspect_ratio_folded: rounded(Math.min(width, height) / Math.max(width, height)),
		occurrences: descriptors.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
	};
}

function metricPayload(
	occurrences: readonly RenderOccurrence[],
	bounds: readonly [number, number, number, number],
): JsonRecord {
	return {
		component_extents: [
			rounded(Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]), 3),
			rounded(Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]), 3),
		],
		occurrence_metrics: occurrences.map((item) => ({
			geometry_kind: item.geometry_kind,
			closed: item.closed,
			length: rounded(item.length, 3),
			extents: [
				rounded(Math.min(item.bounds[2] - item.bounds[0], item.bounds[3] - item.bounds[1]), 3),
				rounded(Math.max(item.bounds[2] - item.bounds[0], item.bounds[3] - item.bounds[1]), 3),
			],
		})).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
	};
}

export function buildTopologyFingerprint(group: BomCloseReadingGroupPlan): TopologyFingerprintPayload {
	const scale = Math.max(
		group.component_bounds[2] - group.component_bounds[0],
		group.component_bounds[3] - group.component_bounds[1],
		1e-9,
	);
	const graph = graphPayload(group.clean_occurrences, scale);
	const shape = shapePayload(group.clean_occurrences, group.component_bounds);
	const metric = metricPayload(group.clean_occurrences, group.component_bounds);
	return {
		fingerprint_schema_version: FINGERPRINT_SCHEMA_VERSION,
		scope_kind: "bom_target_component",
		graph_hash: sha256(graph),
		shape_hash: sha256({ graph, shape }),
		metric_hash: sha256({ graph, metric }),
		invariances: ["translation", "rotation", "reflection", "uniform_scale"],
		feature_summary: {
			occurrence_count: group.clean_occurrences.length,
			removed_occurrence_count: group.removed_occurrences.length,
			component_width: rounded(group.component_bounds[2] - group.component_bounds[0], 3),
			component_height: rounded(group.component_bounds[3] - group.component_bounds[1], 3),
			...graph,
			geometry_summary: group.geometry_summary,
		},
		canonical_payload: { graph, shape, metric },
	};
}

function selectedOccurrences(group: BomCloseReadingGroupPlan): JsonRecord[] {
	return [...group.clean_occurrences]
		.sort((left, right) => left.occurrence_id.localeCompare(right.occurrence_id))
		.map((item) => ({
			occurrence_id: item.occurrence_id,
			source_handle: item.source_handle,
			runtime_class: item.runtime_class,
			geometry_kind: item.geometry_kind,
			semantic_role: item.semantic_role,
			layer: item.layer,
			linetype: item.linetype,
			color_rgb: item.color_rgb,
			closed: item.closed,
			path: item.path,
			bounds: item.bounds,
			length: item.length,
		}));
}

function safeName(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 80) || "record";
}

function errorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

export class TopologySemanticsRecorder {
	readonly baseUrl: string;
	readonly runsRoot: string;
	readonly syncRoot: string;
	private readonly fetcher: typeof fetch;

	constructor(options: {
		baseUrl?: string;
		runsRoot?: string;
		syncRoot?: string;
		fetcher?: typeof fetch;
	} = {}) {
		this.baseUrl = (options.baseUrl
			?? process.env.SHENBIAN_BACKEND_BASE_URL?.trim()
			?? DEFAULT_BACKEND_BASE_URL).replace(/\/+$/u, "");
		this.runsRoot = path.resolve(options.runsRoot ?? reviewRunsRoot);
		this.syncRoot = path.resolve(options.syncRoot ?? path.join(path.dirname(this.runsRoot), "semantic-sync"));
		this.fetcher = options.fetcher ?? fetch;
	}

	private runDirectory(runId: string): string {
		if (!/^thcad-[A-Za-z0-9._-]+$/u.test(runId)) throw new Error("INVALID_REVIEW_RUN_ID");
		return path.join(this.runsRoot, runId);
	}

	private async enqueue(runId: string, sequence: number, envelope: OutboxEnvelope): Promise<void> {
		const outbox = path.join(this.runDirectory(runId), "topology-semantics-outbox");
		await mkdir(outbox, { recursive: true });
		const digest = sha256({
			record_key: envelope.record_key,
			record_kind: envelope.record_kind,
			endpoint: envelope.endpoint,
		});
		const target = path.join(
			outbox,
			`${String(sequence).padStart(3, "0")}-${safeName(envelope.record_key)}-${digest.slice(0, 12)}.json`,
		);
		const content = `${JSON.stringify(envelope, null, 2)}\n`;
		try {
			await writeFile(target, content, { flag: "wx", mode: 0o600 });
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
			const existing = JSON.parse(await readFile(target, "utf8")) as OutboxEnvelope;
			if (canonicalJson({
				record_key: existing.record_key,
				record_kind: existing.record_kind,
				endpoint: existing.endpoint,
				payload: existing.payload,
			}) !== canonicalJson({
				record_key: envelope.record_key,
				record_kind: envelope.record_kind,
				endpoint: envelope.endpoint,
				payload: envelope.payload,
			})) throw new Error("TOPOLOGY_OUTBOX_RECORD_CONFLICT");
		}
	}

	async recordVisualGroup(input: VisualGroupRecordInput): Promise<TopologySemanticSyncResult> {
		const ingestionKey = `${input.runId}/${input.group.group_id}`;
		const sidecarMetadata = await stat(input.rendered.sidecar_path);
		const observation: JsonRecord = {
			schema_version: "1.0",
			knowledge_scope: KNOWLEDGE_SCOPE,
			ingestion_key: ingestionKey,
			workflow_kind: "bom_close_reading",
			review_run_id: input.runId,
			group_id: input.group.group_id,
			drawing: {
				document_name: input.plan.document_name,
				document_ref: input.plan.document_ref,
				analysis_id: input.plan.analysis_id,
				dbmod: input.plan.dbmod,
				source_status: input.plan.source_status,
			},
			topology: buildTopologyFingerprint(input.group),
			selection: {
				target_point: input.group.target_point,
				anchor: input.group.anchor,
				component_bounds: input.group.component_bounds,
				render_bounds: input.group.render_bounds,
				view_region: input.group.view_region,
				selected_occurrences: selectedOccurrences(input.group),
				removed_occurrences: input.group.removed_occurrences,
			},
			plots: [
				{
					role: "component_full",
					artifact_ref: input.rendered.full_image_ref,
					media_type: "image/png",
					sha256: input.rendered.full_image_sha256,
					metadata: { width: input.rendered.width, height: input.rendered.height },
				},
				{
					role: "component_clean",
					artifact_ref: input.rendered.clean_image_ref,
					media_type: "image/png",
					sha256: input.rendered.clean_image_sha256,
					metadata: { width: input.rendered.width, height: input.rendered.height },
				},
				{
					role: "deterministic_sidecar",
					artifact_ref: input.rendered.sidecar_ref,
					media_type: "application/json",
					sha256: await fileSha256(input.rendered.sidecar_path),
					bytes: sidecarMetadata.size,
				},
			],
			bom_context: {
				item_numbers: input.group.serial_group.item_numbers,
				serial_group: input.group.serial_group,
				items: input.group.bom_items,
			},
			capability_evidence: {
				artifact_refs: input.plan.artifact_refs,
				capability_21: input.group.bom_instance_coverage,
				geometry_summary: input.group.geometry_summary,
			},
			artifact_refs: [
				...Object.values(input.plan.artifact_refs),
				input.rendered.full_image_ref,
				input.rendered.clean_image_ref,
				input.rendered.sidecar_ref,
			],
			provenance: {
				producer: "@shenbian/pi",
				workflow: "delegate_thcad_bom_close_reading",
				mutation_status: "read_only_no_dwg_or_view_change",
			},
		};
		await this.enqueue(input.runId, 10, {
			schema_version: 1,
			record_key: ingestionKey,
			record_kind: "observation",
			endpoint: "/api/v1/topology-semantics/observations",
			created_at_utc: new Date().toISOString(),
			payload: observation,
		});

		const descriptionKey = `${input.runId}/vision/${input.group.group_id}`;
		await this.enqueue(input.runId, 20, {
			schema_version: 1,
			record_key: descriptionKey,
			record_kind: "description",
			endpoint: "/api/v1/topology-semantics/descriptions",
			created_at_utc: new Date().toISOString(),
			payload: {
				schema_version: "1.0",
				knowledge_scope: KNOWLEDGE_SCOPE,
				description_key: descriptionKey,
				description_kind: "vision_component_observation",
				content_md: JSON.stringify(input.visualResult, null, 2),
				structured_content: input.visualResult,
				source_kind: "vision_model",
				model_provenance: {
					model: input.model,
					role: "thcad-bom-close-reading",
					prompt_ref: toProjectRef(path.join(input.rendered.directory, "vision-prompt.md")),
					session_ref: input.childSessionRef,
					raw_output_ref: toProjectRef(path.join(input.rendered.directory, "vision-result.json")),
				},
				evidence_refs: [
					input.rendered.full_image_ref,
					input.rendered.clean_image_ref,
					input.rendered.sidecar_ref,
				],
				observation_keys: [ingestionKey],
				relation_kind: "describes",
				link_context: {
					item_numbers: input.group.serial_group.item_numbers,
					view_region: input.group.view_region,
				},
			},
		});
		return this.flushRun(input.runId);
	}

	private async observationKeys(runId: string): Promise<string[]> {
		const directory = path.join(this.runDirectory(runId), "topology-semantics-outbox");
		let entries: string[];
		try {
			entries = (await readdir(directory)).filter((item) => item.endsWith(".json") && !item.endsWith(".receipt.json"));
		} catch {
			return [];
		}
		const keys: string[] = [];
		for (const entry of entries.sort()) {
			const envelope = JSON.parse(await readFile(path.join(directory, entry), "utf8")) as OutboxEnvelope;
			if (envelope.record_kind === "observation") keys.push(envelope.record_key);
		}
		return [...new Set(keys)];
	}

	async recordParentInterpretation(input: ParentInterpretationInput): Promise<TopologySemanticSyncResult> {
		const observationKeys = await this.observationKeys(input.runId);
		if (!observationKeys.length || !input.content.trim()) return this.flushRun(input.runId);
		const descriptionKey = `${input.runId}/parent-final`;
		await this.enqueue(input.runId, 90, {
			schema_version: 1,
			record_key: descriptionKey,
			record_kind: "description",
			endpoint: "/api/v1/topology-semantics/descriptions",
			created_at_utc: new Date().toISOString(),
			payload: {
				schema_version: "1.0",
				knowledge_scope: KNOWLEDGE_SCOPE,
				description_key: descriptionKey,
				description_kind: "main_model_final_interpretation",
				content_md: input.content,
				structured_content: { final_message: input.finalMessage },
				source_kind: "main_model",
				model_provenance: {
					model: input.model,
					role: "shenbian-parent-agent",
					thinking_level: input.thinkingLevel,
					prompt_ref: toProjectRef(path.join(this.runDirectory(input.runId), "request.json")),
					session_ref: input.sessionRef,
					raw_output_ref: toProjectRef(path.join(this.runDirectory(input.runId), "parent-result.json")),
				},
				evidence_refs: [toProjectRef(this.runDirectory(input.runId))],
				observation_keys: observationKeys,
				relation_kind: "interprets",
				link_context: { review_run_id: input.runId },
			},
		});
		return this.flushRun(input.runId);
	}

	async flushRun(runId: string): Promise<TopologySemanticSyncResult> {
		const directory = path.join(this.runDirectory(runId), "topology-semantics-outbox");
		let entries: string[];
		try {
			entries = (await readdir(directory))
				.filter((item) => item.endsWith(".json") && !item.endsWith(".receipt.json"))
				.sort();
		} catch {
			return { run_id: runId, sent: 0, already_synced: 0, pending: 0, errors: [] };
		}
		let sent = 0;
		let alreadySynced = 0;
		const errors: string[] = [];
		const runSyncDirectory = path.join(this.syncRoot, runId);
		await mkdir(runSyncDirectory, { recursive: true });
		for (const entry of entries) {
			const target = path.join(directory, entry);
			const receipt = path.join(runSyncDirectory, `${entry.slice(0, -5)}.receipt.json`);
			try {
				if ((await stat(receipt)).isFile()) {
					alreadySynced += 1;
					continue;
				}
			} catch {
				// Missing receipt means the immutable request still needs delivery.
			}
			const envelope = JSON.parse(await readFile(target, "utf8")) as OutboxEnvelope;
			try {
				const response = await this.fetcher(`${this.baseUrl}${envelope.endpoint}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(envelope.payload),
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});
				const body = await response.text();
				if (!response.ok) throw new Error(`HTTP_${response.status}: ${body.slice(0, 1000)}`);
				await writeFile(receipt, `${JSON.stringify({
					schema_version: 1,
					record_key: envelope.record_key,
					synced_at_utc: new Date().toISOString(),
					status: response.status,
					response: body ? JSON.parse(body) : null,
				}, null, 2)}\n`, { flag: "wx", mode: 0o600 });
				sent += 1;
			} catch (error) {
				errors.push(`${entry}: ${String(error)}`);
				break;
			}
		}
		const pending = entries.length - sent - alreadySynced;
		await appendFile(path.join(runSyncDirectory, "sync-events.jsonl"), `${JSON.stringify({
			at_utc: new Date().toISOString(),
			event: errors.length ? "topology_semantics_sync_pending" : "topology_semantics_synced",
			sent,
			already_synced: alreadySynced,
			pending,
			errors,
		})}\n`, { encoding: "utf8", mode: 0o600 });
		return { run_id: runId, sent, already_synced: alreadySynced, pending, errors };
	}

	async flushPending(): Promise<TopologySemanticSyncResult[]> {
		let entries: string[];
		try {
			entries = (await readdir(this.runsRoot, { withFileTypes: true }))
				.filter((item) => item.isDirectory() && item.name.startsWith("thcad-"))
				.map((item) => item.name)
				.sort();
		} catch {
			return [];
		}
		const results: TopologySemanticSyncResult[] = [];
		for (const runId of entries) results.push(await this.flushRun(runId));
		return results;
	}
}
