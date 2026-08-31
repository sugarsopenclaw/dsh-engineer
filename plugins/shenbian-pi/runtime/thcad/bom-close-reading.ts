import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { ThcadBridgeClient, ThcadBridgeError } from "./bridge-client.ts";
import { bridgeRoot, resolveInside, toProjectRef } from "./paths.ts";

type JsonRecord = Record<string, unknown>;
type Point2 = [number, number];
export type Box2 = [number, number, number, number];

const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const IMAGE_LONG_SIDE = 2048;
const IMAGE_MARGIN = 54;
const MAX_RENDER_OCCURRENCES = 20_000;

export interface BomItemInput {
	item_number: number;
	part_number: string;
	name: string;
	quantity: string;
	material: string;
	unit_weight: string;
	total_weight: string;
	remark: string;
	row_id: string;
	row_handle: string;
}

export interface SerialGroupInput {
	id: string;
	group_type: string;
	item_numbers: number[];
	annotation_handles: string[];
	target_status: string;
	target_point: Point2 | null;
	members: JsonRecord[];
	internal_links: JsonRecord[];
	derivation: string;
}

export interface RenderOccurrence {
	occurrence_id: string;
	source_handle: string;
	runtime_class: string;
	geometry_kind: string;
	semantic_role: string;
	layer: string;
	linetype: string;
	color_rgb: [number, number, number];
	closed: boolean;
	path: Point2[];
	bounds: Box2;
	length: number;
}

export interface BomCloseReadingGroupPlan {
	group_id: string;
	serial_group: SerialGroupInput;
	bom_items: BomItemInput[];
	target_point: Point2;
	view_region: null | {
		region_id: string;
		region_kind: string;
		region_subtype: string;
		bounds: Box2;
		label_texts: string[];
	};
	anchor: {
		occurrence_id: string;
		source_handle: string;
		distance: number;
		owner_prefix: string | null;
	};
	component_bounds: Box2;
	render_bounds: Box2;
	full_occurrences: RenderOccurrence[];
	clean_occurrences: RenderOccurrence[];
	removed_occurrences: Array<{
		occurrence_id: string;
		source_handle: string;
		semantic_role: string;
		reason: string;
	}>;
	geometry_summary: JsonRecord;
	bom_instance_coverage: JsonRecord | null;
}

export interface BomCloseReadingCoverage {
	document_name: string;
	analysis_id: string;
	dbmod: number;
	bom_row_count: number;
	annotated_item_count: number;
	serial_group_count: number;
	selected_group_count: number;
	selected_item_numbers: number[];
	items_without_annotations: number[];
	groups_without_resolved_target: Array<{ group_id: string; item_numbers: number[]; target_status: string }>;
	groups_without_geometry_anchor: Array<{ group_id: string; item_numbers: number[] }>;
}

export interface BomCloseReadingPlan {
	schema_version: 1;
	document_name: string;
	document_ref: string;
	analysis_id: string;
	dbmod: number;
	source_status: string;
	artifact_refs: Record<string, string>;
	groups: BomCloseReadingGroupPlan[];
	coverage: BomCloseReadingCoverage;
}

export interface RenderedBomCloseReadingGroup {
	group_id: string;
	directory: string;
	full_image_path: string;
	full_image_ref: string;
	clean_image_path: string;
	clean_image_ref: string;
	sidecar_path: string;
	sidecar_ref: string;
	full_image_sha256: string;
	clean_image_sha256: string;
	width: number;
	height: number;
}

function record(value: unknown): JsonRecord {
	return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function finite(value: unknown): number | null {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function point2(value: unknown): Point2 | null {
	if (!Array.isArray(value) || value.length < 2) return null;
	const x = finite(value[0]);
	const y = finite(value[1]);
	return x === null || y === null ? null : [x, y];
}

function box2(value: unknown): Box2 | null {
	if (!Array.isArray(value) || value.length < 4) return null;
	const numbers = value.slice(0, 4).map(finite);
	if (numbers.some((item) => item === null)) return null;
	const [minX, minY, maxX, maxY] = numbers as number[];
	if (maxX < minX || maxY < minY) return null;
	return [minX, minY, maxX, maxY];
}

function intersects(left: Box2, right: Box2): boolean {
	return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function containsPoint(box: Box2, point: Point2): boolean {
	return point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];
}

function unionBoxes(values: readonly Box2[]): Box2 | null {
	if (!values.length) return null;
	let [minX, minY, maxX, maxY] = values[0];
	for (const value of values.slice(1)) {
		minX = Math.min(minX, value[0]);
		minY = Math.min(minY, value[1]);
		maxX = Math.max(maxX, value[2]);
		maxY = Math.max(maxY, value[3]);
	}
	return [minX, minY, maxX, maxY];
}

function padBox(value: Box2, padding: number): Box2 {
	return [value[0] - padding, value[1] - padding, value[2] + padding, value[3] + padding];
}

function clampBox(value: Box2, limit: Box2): Box2 {
	const result: Box2 = [
		Math.max(value[0], limit[0]),
		Math.max(value[1], limit[1]),
		Math.min(value[2], limit[2]),
		Math.min(value[3], limit[3]),
	];
	return result[2] > result[0] && result[3] > result[1] ? result : value;
}

function boxArea(value: Box2): number {
	return Math.max(0, value[2] - value[0]) * Math.max(0, value[3] - value[1]);
}

function distance(left: Point2, right: Point2): number {
	return Math.hypot(right[0] - left[0], right[1] - left[1]);
}

function distanceToSegment(point: Point2, start: Point2, end: Point2): number {
	const dx = end[0] - start[0];
	const dy = end[1] - start[1];
	const denominator = dx * dx + dy * dy;
	if (denominator <= 1e-18) return distance(point, start);
	const parameter = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denominator));
	return distance(point, [start[0] + parameter * dx, start[1] + parameter * dy]);
}

function pathDistance(point: Point2, pathPoints: readonly Point2[]): number {
	let best = Number.POSITIVE_INFINITY;
	for (let index = 1; index < pathPoints.length; index += 1) {
		best = Math.min(best, distanceToSegment(point, pathPoints[index - 1], pathPoints[index]));
	}
	return best;
}

function pathLength(pathPoints: readonly Point2[]): number {
	let total = 0;
	for (let index = 1; index < pathPoints.length; index += 1) total += distance(pathPoints[index - 1], pathPoints[index]);
	return total;
}

function ownerPrefix(occurrenceId: string): string | null {
	const entity = occurrenceId.lastIndexOf("/ent:");
	if (entity < 0) return null;
	const prefix = occurrenceId.slice(0, entity);
	return prefix.includes("/ref:") ? prefix : null;
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

async function readJsonArtifact(state: JsonRecord, capabilityId: number): Promise<{ value: JsonRecord; ref: string }> {
	const artifacts = record(state.artifacts);
	const relative = stringField(artifacts[String(capabilityId)]);
	if (!relative) throw new Error(`ARTIFACT_MISSING: capability ${capabilityId}`);
	const target = resolveInside(bridgeRoot, relative);
	const metadata = await stat(target);
	if (!metadata.isFile() || metadata.size > MAX_ARTIFACT_BYTES) throw new Error(`ARTIFACT_INVALID: capability ${capabilityId}`);
	return { value: JSON.parse(await readFile(target, "utf8")) as JsonRecord, ref: toProjectRef(target) };
}

function documentKey(value: string): string {
	const safe = path.isAbsolute(value) ? toProjectRef(value) : value;
	return safe.replaceAll("\\", "/").replace(/^\.\//u, "").toLocaleLowerCase();
}

function assertExpectedActiveDocument(status: JsonRecord, expectedDocument?: string): void {
	const expected = expectedDocument?.trim();
	if (!expected) return;
	const active = record(status.active_document);
	const expectedKey = documentKey(expected);
	const expectsPath = expected.includes("/") || expected.includes("\\") || path.isAbsolute(expected);
	const matches = expectsPath
		? typeof active.path === "string" && documentKey(active.path) === expectedKey
		: typeof active.name === "string" && documentKey(active.name) === expectedKey;
	if (!matches) {
		throw new ThcadBridgeError(
			"DOCUMENT_CHANGED",
			`Active THCAD drawing is ${path.basename(String(active.name ?? active.path ?? "unknown"))}, expected ${path.basename(expected)}.`,
		);
	}
}

function analysisMatches(status: JsonRecord): boolean {
	const active = record(status.active_document);
	const analysis = record(status.current_analysis);
	const namesMatch = typeof active.name === "string"
		&& typeof analysis.document_name === "string"
		&& documentKey(active.name) === documentKey(analysis.document_name);
	const pathsMatch = typeof active.path === "string" && typeof analysis.document_path === "string"
		? documentKey(active.path) === documentKey(analysis.document_path)
		: namesMatch;
	return namesMatch && pathsMatch && Number(active.dbmod) === Number(analysis.dbmod_after);
}

async function ensureCurrentAnalysis(
	bridge: ThcadBridgeClient,
	options: { signal?: AbortSignal; onProgress?: (text: string) => void; expectedDocument?: string },
): Promise<JsonRecord> {
	let status = await bridge.invoke("status", {}, { signal: options.signal, timeoutSeconds: 30 });
	assertExpectedActiveDocument(status, options.expectedDocument);
	if (!analysisMatches(status)) {
		const active = record(status.active_document);
		const name = stringField(active.name);
		if (!name) throw new ThcadBridgeError("NO_ACTIVE_DOCUMENT", "THCAD status returned no active document.");
		options.onProgress?.("当前 04/08/11/13 证据代次与活动图不一致，正在只读刷新 01–21…");
		await bridge.invoke("extract_current", { expected_document: name }, { signal: options.signal, timeoutSeconds: 1200 });
		status = await bridge.invoke("status", {}, { signal: options.signal, timeoutSeconds: 30 });
		assertExpectedActiveDocument(status, options.expectedDocument);
		if (!analysisMatches(status)) throw new ThcadBridgeError("ANALYSIS_STALE", "Refreshed analysis does not match the active drawing.");
	}
	return record(status.current_analysis);
}

function bomRows(document: JsonRecord): BomItemInput[] {
	const result: BomItemInput[] = [];
	for (const tableValue of Array.isArray(document.tables) ? document.tables : []) {
		const table = record(tableValue);
		for (const rowValue of Array.isArray(table.rows) ? table.rows : []) {
			const row = record(rowValue);
			const itemNumber = finite(row.item_number);
			if (itemNumber === null || !Number.isInteger(itemNumber)) continue;
			const values = record(row.values);
			const evidence = record(row.evidence);
			result.push({
				item_number: itemNumber,
				part_number: stringField(values.part_number),
				name: stringField(values.name),
				quantity: stringField(values.quantity),
				material: stringField(values.material),
				unit_weight: stringField(values.unit_weight),
				total_weight: stringField(values.total_weight),
				remark: stringField(values.remark),
				row_id: stringField(row.id),
				row_handle: stringField(evidence.row_block_handle),
			});
		}
	}
	return result;
}

function parseSerialGroup(value: unknown): SerialGroupInput | null {
	const group = record(value);
	const target = point2(group.target_point);
	const itemNumbers = (Array.isArray(group.item_numbers) ? group.item_numbers : [])
		.map(finite)
		.filter((item): item is number => item !== null && Number.isInteger(item));
	if (!stringField(group.id) || !itemNumbers.length) return null;
	return {
		id: stringField(group.id),
		group_type: stringField(group.group_type) || (itemNumbers.length > 1 ? "connected_serial_run" : "single_serial"),
		item_numbers: itemNumbers,
		annotation_handles: strings(group.annotation_handles),
		target_status: stringField(group.target_status),
		target_point: target,
		members: (Array.isArray(group.members) ? group.members : []).map(record),
		internal_links: (Array.isArray(group.internal_links) ? group.internal_links : []).map(record),
		derivation: stringField(group.derivation),
	};
}

function serialGroups(document: JsonRecord): SerialGroupInput[] {
	const result: SerialGroupInput[] = [];
	for (const tableValue of Array.isArray(document.tables) ? document.tables : []) {
		const table = record(tableValue);
		for (const groupValue of Array.isArray(table.serial_annotation_groups) ? table.serial_annotation_groups : []) {
			const group = parseSerialGroup(groupValue);
			if (group) result.push(group);
		}
	}
	return result;
}

function coverageSegments(document: JsonRecord): Map<string, JsonRecord> {
	const result = new Map<string, JsonRecord>();
	for (const value of Array.isArray(document.segments) ? document.segments : []) {
		const segment = record(value);
		const sourceGroupId = stringField(segment.source_group_id);
		if (sourceGroupId) result.set(sourceGroupId, segment);
	}
	return result;
}

function allAnnotatedItems(document: JsonRecord): Set<number> {
	const result = new Set<number>();
	for (const tableValue of Array.isArray(document.tables) ? document.tables : []) {
		const table = record(tableValue);
		for (const rowValue of Array.isArray(table.rows) ? table.rows : []) {
			const row = record(rowValue);
			const item = finite(row.item_number);
			if (item !== null && Array.isArray(row.annotations) && row.annotations.length) result.add(item);
		}
	}
	return result;
}

function colorRgb(value: unknown): [number, number, number] {
	const style = record(value);
	const color = record(style.color);
	const rgb = Array.isArray(color.rgb) ? color.rgb.map(finite) : [];
	if (rgb.length >= 3 && rgb.slice(0, 3).every((item) => item !== null)) {
		return rgb.slice(0, 3).map((item) => Math.max(0, Math.min(255, Math.round(item as number)))) as [number, number, number];
	}
	return [235, 235, 235];
}

function occurrence(value: unknown): RenderOccurrence | null {
	const raw = record(value);
	const worldPath = Array.isArray(raw.world_path) ? raw.world_path.map(point2).filter((item): item is Point2 => item !== null) : [];
	const bounds = box2(raw.bounds);
	if (!bounds || worldPath.length < 2 || raw.visible === false || record(raw.effective_style).layer_suppressed === true) return null;
	const style = record(raw.effective_style);
	return {
		occurrence_id: stringField(raw.occurrence_id),
		source_handle: stringField(raw.source_handle),
		runtime_class: stringField(raw.runtime_class),
		geometry_kind: stringField(raw.geometry_kind),
		semantic_role: stringField(raw.semantic_role) || "unclassified",
		layer: stringField(style.layer),
		linetype: stringField(style.linetype),
		color_rgb: colorRgb(style),
		closed: raw.closed === true,
		path: worldPath,
		bounds,
		length: pathLength(worldPath),
	};
}

function viewRegion(value: unknown): BomCloseReadingGroupPlan["view_region"] {
	const raw = record(value);
	const bounds = box2(raw.bounds);
	const kind = stringField(raw.region_kind);
	if (!bounds || !kind) return null;
	return {
		region_id: stringField(raw.region_id),
		region_kind: kind,
		region_subtype: stringField(raw.region_subtype),
		bounds,
		label_texts: strings(raw.label_texts),
	};
}

function chooseViewRegion(document: JsonRecord, target: Point2): BomCloseReadingGroupPlan["view_region"] {
	const candidates = (Array.isArray(document.regions) ? document.regions : [])
		.map(viewRegion)
		.filter((item): item is NonNullable<BomCloseReadingGroupPlan["view_region"]> => item !== null)
		.filter((item) => containsPoint(item.bounds, target))
		.filter((item) => item.region_kind !== "sheet_structure_region")
		.sort((left, right) => boxArea(left.bounds) - boxArea(right.bounds));
	return candidates[0] ?? null;
}

function bomScale(items: readonly BomItemInput[]): number {
	const values: number[] = [];
	for (const item of items) {
		for (const match of item.name.matchAll(/(?:^|[^0-9.])([0-9]+(?:\.[0-9]+)?)/gu)) {
			const value = Number(match[1]);
			if (Number.isFinite(value) && value >= 2 && value <= 100_000) values.push(value);
		}
	}
	return values.length ? Math.max(...values) : 200;
}

function annotationRemovalHandles(document: JsonRecord): Set<string> {
	return new Set(strings(document.removal_candidate_handles).map((item) => item.toLocaleUpperCase()));
}

function cleanDecision(
	item: RenderOccurrence,
	owner: string | null,
	componentBounds: Box2,
	localScale: number,
	annotationHandles: Set<string>,
): { keep: boolean; reason?: string } {
	if (annotationHandles.has(item.source_handle.toLocaleUpperCase())) return { keep: false, reason: "capability_08_annotation" };
	if (item.semantic_role === "annotation_geometry" || item.geometry_kind === "dimension") {
		return { keep: false, reason: "annotation_geometry" };
	}
	if (owner && item.occurrence_id.startsWith(`${owner}/`)) return { keep: true };
	if (!intersects(item.bounds, componentBounds)) return { keep: false, reason: "outside_target_component" };
	if (item.semantic_role === "section_hatching") return { keep: false, reason: "external_section_hatching" };
	const width = item.bounds[2] - item.bounds[0];
	const height = item.bounds[3] - item.bounds[1];
	if (Math.max(width, height) > localScale * 2.5) return { keep: false, reason: "long_crossing_context_line" };
	return { keep: true };
}

function roundedHistogram(values: number[], precision: number): JsonRecord {
	const counts = new Map<string, number>();
	for (const value of values) {
		const key = value.toFixed(precision);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return Object.fromEntries([...counts.entries()]
		.sort((left, right) => Number(left[0]) - Number(right[0]))
		.slice(0, 200));
}

function geometrySummary(values: readonly RenderOccurrence[], owner: string | null): JsonRecord {
	const roleCounts = new Map<string, number>();
	const classCounts = new Map<string, number>();
	const lengths: number[] = [];
	const circleDiameters: number[] = [];
	for (const value of values) {
		roleCounts.set(value.semantic_role, (roleCounts.get(value.semantic_role) ?? 0) + 1);
		classCounts.set(value.runtime_class, (classCounts.get(value.runtime_class) ?? 0) + 1);
		if (value.geometry_kind === "line" && value.path.length === 2) lengths.push(value.length);
		if (value.geometry_kind === "circle" && value.closed) {
			const width = value.bounds[2] - value.bounds[0];
			const height = value.bounds[3] - value.bounds[1];
			if (Math.abs(width - height) <= Math.max(width, height) * 0.03) circleDiameters.push((width + height) / 2);
		}
	}
	return {
		occurrence_count: values.length,
		owner_prefix: owner,
		role_counts: Object.fromEntries([...roleCounts.entries()].sort()),
		runtime_class_counts: Object.fromEntries([...classCounts.entries()].sort()),
		exact_line_length_histogram: roundedHistogram(lengths, 3),
		circle_diameter_histogram: roundedHistogram(circleDiameters, 3),
	};
}

function planGroup(input: {
	group: SerialGroupInput;
	rowsByItem: Map<number, BomItemInput[]>;
	occurrences: RenderOccurrence[];
	viewDocument: JsonRecord;
	annotationHandles: Set<string>;
	coverageSegment: JsonRecord | null;
}): BomCloseReadingGroupPlan | null {
	const target = input.group.target_point;
	if (!target) return null;
	const items = input.group.item_numbers.flatMap((item) => input.rowsByItem.get(item) ?? []);
	let nearest: RenderOccurrence | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const item of input.occurrences) {
		const current = pathDistance(target, item.path);
		if (current < nearestDistance) {
			nearest = item;
			nearestDistance = current;
		}
	}
	if (!nearest) return null;
	const owner = ownerPrefix(nearest.occurrence_id);
	const localScale = bomScale(items);
	const ownerOccurrences = owner
		? input.occurrences.filter((item) => item.occurrence_id.startsWith(`${owner}/`))
		: [];
	const seedBounds = unionBoxes(ownerOccurrences.map((item) => item.bounds))
		?? padBox(nearest.bounds, Math.max(localScale * 0.65, 30));
	const maximumExtent = Math.max(seedBounds[2] - seedBounds[0], seedBounds[3] - seedBounds[1], localScale);
	const componentBounds = seedBounds;
	const region = chooseViewRegion(input.viewDocument, target);
	let renderBounds = padBox(componentBounds, Math.max(maximumExtent * 0.15, localScale * 0.10, 12));
	if (region) renderBounds = clampBox(renderBounds, region.bounds);
	const full = input.occurrences.filter((item) => intersects(item.bounds, renderBounds)).slice(0, MAX_RENDER_OCCURRENCES);
	const clean: RenderOccurrence[] = [];
	const removed: BomCloseReadingGroupPlan["removed_occurrences"] = [];
	for (const item of full) {
		const decision = cleanDecision(item, owner, componentBounds, maximumExtent, input.annotationHandles);
		if (decision.keep) clean.push(item);
		else removed.push({
			occurrence_id: item.occurrence_id,
			source_handle: item.source_handle,
			semantic_role: item.semantic_role,
			reason: decision.reason ?? "filtered",
		});
	}
	return {
		group_id: input.group.id,
		serial_group: input.group,
		bom_items: items,
		target_point: target,
		view_region: region,
		anchor: {
			occurrence_id: nearest.occurrence_id,
			source_handle: nearest.source_handle,
			distance: nearestDistance,
			owner_prefix: owner,
		},
		component_bounds: componentBounds,
		render_bounds: renderBounds,
		full_occurrences: full,
		clean_occurrences: clean,
		removed_occurrences: removed,
		geometry_summary: geometrySummary(clean, owner),
		bom_instance_coverage: input.coverageSegment,
	};
}

export async function prepareBomCloseReadingPlan(options: {
	itemNumbers?: number[];
	expectedDocument?: string;
	signal?: AbortSignal;
	onProgress?: (text: string) => void;
	bridge?: ThcadBridgeClient;
} = {}): Promise<BomCloseReadingPlan> {
	const bridge = options.bridge ?? new ThcadBridgeClient();
	const state = await ensureCurrentAnalysis(bridge, options);
	options.onProgress?.("正在组合 04 序号段、08 标注、11 世界坐标图元、13 工程视图区和 21 实例覆盖…");
	const [bomArtifact, annotationArtifact, occurrenceArtifact, viewArtifact, coverageArtifact] = await Promise.all([
		readJsonArtifact(state, 4),
		readJsonArtifact(state, 8),
		readJsonArtifact(state, 11),
		readJsonArtifact(state, 13),
		readJsonArtifact(state, 21),
	]);
	const rows = bomRows(bomArtifact.value);
	const groups = serialGroups(bomArtifact.value);
	if (!groups.length && rows.length) {
		throw new Error("SERIAL_GROUPS_MISSING: rebuild the THCAD bridge and refresh analysis so capability 04 emits serial_annotation_groups");
	}
	const requested = new Set((options.itemNumbers ?? []).filter((item) => Number.isInteger(item) && item > 0));
	const selectedGroups = requested.size
		? groups.filter((group) => group.item_numbers.some((item) => requested.has(item)))
		: groups;
	const rowsByItem = new Map<number, BomItemInput[]>();
	for (const row of rows) rowsByItem.set(row.item_number, [...(rowsByItem.get(row.item_number) ?? []), row]);
	const occurrences = (Array.isArray(occurrenceArtifact.value.occurrences) ? occurrenceArtifact.value.occurrences : [])
		.map(occurrence)
		.filter((item): item is RenderOccurrence => item !== null);
	const annotationHandles = annotationRemovalHandles(annotationArtifact.value);
	const coverageByGroup = coverageSegments(coverageArtifact.value);
	const planned: BomCloseReadingGroupPlan[] = [];
	const groupsWithoutTarget: BomCloseReadingCoverage["groups_without_resolved_target"] = [];
	const groupsWithoutGeometry: BomCloseReadingCoverage["groups_without_geometry_anchor"] = [];
	for (const group of selectedGroups) {
		if (!group.target_point || group.target_status !== "resolved_shared_target") {
			groupsWithoutTarget.push({ group_id: group.id, item_numbers: group.item_numbers, target_status: group.target_status });
			continue;
		}
		const value = planGroup({
			group,
			rowsByItem,
			occurrences,
			viewDocument: viewArtifact.value,
			annotationHandles,
			coverageSegment: coverageByGroup.get(group.id) ?? null,
		});
		if (value) planned.push(value);
		else groupsWithoutGeometry.push({ group_id: group.id, item_numbers: group.item_numbers });
	}
	const annotated = allAnnotatedItems(bomArtifact.value);
	const selectedItems = [...new Set(planned.flatMap((group) => group.serial_group.item_numbers))].sort((a, b) => a - b);
	return {
		schema_version: 1,
		document_name: stringField(state.document_name),
		document_ref: stringField(state.document_path)
			? toProjectRef(stringField(state.document_path))
			: stringField(state.document_name),
		analysis_id: stringField(state.analysis_id),
		dbmod: Number(state.dbmod_after),
		source_status: stringField(state.source_status),
		artifact_refs: {
			capability_04: bomArtifact.ref,
			capability_08: annotationArtifact.ref,
			capability_11: occurrenceArtifact.ref,
			capability_13: viewArtifact.ref,
			capability_21: coverageArtifact.ref,
		},
		groups: planned,
		coverage: {
			document_name: stringField(state.document_name),
			analysis_id: stringField(state.analysis_id),
			dbmod: Number(state.dbmod_after),
			bom_row_count: rows.length,
			annotated_item_count: annotated.size,
			serial_group_count: groups.length,
			selected_group_count: planned.length,
			selected_item_numbers: selectedItems,
			items_without_annotations: rows.map((row) => row.item_number).filter((item) => !annotated.has(item)),
			groups_without_resolved_target: groupsWithoutTarget,
			groups_without_geometry_anchor: groupsWithoutGeometry,
		},
	};
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(value: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of value) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const name = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
	return Buffer.concat([length, name, data, checksum]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
	const scanline = width * 4;
	const raw = Buffer.alloc((scanline + 1) * height);
	for (let y = 0; y < height; y += 1) {
		raw[y * (scanline + 1)] = 0;
		rgba.copy(raw, y * (scanline + 1) + 1, y * scanline, (y + 1) * scanline);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	header[10] = 0;
	header[11] = 0;
	header[12] = 0;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(raw, { level: 9 })),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

function setPixel(buffer: Buffer, width: number, height: number, x: number, y: number, rgb: [number, number, number], alpha = 1): void {
	if (x < 0 || y < 0 || x >= width || y >= height) return;
	const offset = (y * width + x) * 4;
	const inverse = 1 - alpha;
	buffer[offset] = Math.round(buffer[offset] * inverse + rgb[0] * alpha);
	buffer[offset + 1] = Math.round(buffer[offset + 1] * inverse + rgb[1] * alpha);
	buffer[offset + 2] = Math.round(buffer[offset + 2] * inverse + rgb[2] * alpha);
	buffer[offset + 3] = 255;
}

function brush(buffer: Buffer, width: number, height: number, x: number, y: number, radius: number, rgb: [number, number, number]): void {
	const size = Math.max(0, Math.ceil(radius));
	for (let dy = -size; dy <= size; dy += 1) {
		for (let dx = -size; dx <= size; dx += 1) {
			const metric = Math.hypot(dx, dy);
			if (metric > radius + 0.8) continue;
			setPixel(buffer, width, height, x + dx, y + dy, rgb, metric <= radius ? 1 : Math.max(0, radius + 0.8 - metric));
		}
	}
}

function dashPattern(linetype: string, role: string): number[] | null {
	const normalized = `${linetype} ${role}`.toLocaleLowerCase();
	if (normalized.includes("center") || normalized.includes("中心")) return [14, 7, 3, 7];
	if (normalized.includes("hidden") || normalized.includes("虚线")) return [9, 6];
	if (normalized.includes("divide") || normalized.includes("double_chain") || /\bk\b/u.test(normalized)) return [16, 6, 3, 6, 3, 6];
	return null;
}

function drawSegment(
	buffer: Buffer,
	width: number,
	height: number,
	start: Point2,
	end: Point2,
	rgb: [number, number, number],
	radius: number,
	pattern: number[] | null,
): void {
	const dx = end[0] - start[0];
	const dy = end[1] - start[1];
	const length = Math.hypot(dx, dy);
	if (length < 0.01) {
		brush(buffer, width, height, Math.round(start[0]), Math.round(start[1]), radius, rgb);
		return;
	}
	const steps = Math.max(1, Math.ceil(length * 1.25));
	const cycle = pattern?.reduce((sum, item) => sum + item, 0) ?? 0;
	for (let step = 0; step <= steps; step += 1) {
		const travelled = length * step / steps;
		if (pattern && cycle > 0) {
			let cursor = travelled % cycle;
			let draw = true;
			for (const part of pattern) {
				if (cursor <= part) break;
				cursor -= part;
				draw = !draw;
			}
			if (!draw) continue;
		}
		brush(
			buffer,
			width,
			height,
			Math.round(start[0] + dx * step / steps),
			Math.round(start[1] + dy * step / steps),
			radius,
			rgb,
		);
	}
}

function renderPng(values: readonly RenderOccurrence[], bounds: Box2): { png: Buffer; width: number; height: number; inkRatio: number } {
	const worldWidth = Math.max(bounds[2] - bounds[0], 1e-6);
	const worldHeight = Math.max(bounds[3] - bounds[1], 1e-6);
	const { width, height } = bomCloseReadingImageDimensions(bounds);
	const pixels = Buffer.alloc(width * height * 4);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels[offset] = 22;
		pixels[offset + 1] = 24;
		pixels[offset + 2] = 28;
		pixels[offset + 3] = 255;
	}
	const scale = Math.min((width - IMAGE_MARGIN * 2) / worldWidth, (height - IMAGE_MARGIN * 2) / worldHeight);
	const usedWidth = worldWidth * scale;
	const usedHeight = worldHeight * scale;
	const offsetX = (width - usedWidth) / 2;
	const offsetY = (height - usedHeight) / 2;
	const transform = (point: Point2): Point2 => [
		offsetX + (point[0] - bounds[0]) * scale,
		height - offsetY - (point[1] - bounds[1]) * scale,
	];
	let segmentCount = 0;
	for (const value of values) {
		const points = value.path.map(transform);
		const radius = value.semantic_role === "visible_contour" ? 1.25 : value.semantic_role === "center_reference" ? 0.72 : 0.9;
		const pattern = dashPattern(value.linetype, value.semantic_role);
		for (let index = 1; index < points.length; index += 1) {
			drawSegment(pixels, width, height, points[index - 1], points[index], value.color_rgb, radius, pattern);
			segmentCount += 1;
		}
		if (value.closed && points.length > 2 && distance(points[0], points[points.length - 1]) > 0.5) {
			drawSegment(pixels, width, height, points[points.length - 1], points[0], value.color_rgb, radius, pattern);
			segmentCount += 1;
		}
	}
	if (!segmentCount) throw new Error("BOM_DETAIL_RENDER_EMPTY");
	let ink = 0;
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (Math.abs(pixels[offset] - 22) + Math.abs(pixels[offset + 1] - 24) + Math.abs(pixels[offset + 2] - 28) > 24) ink += 1;
	}
	return { png: encodePng(width, height, pixels), width, height, inkRatio: ink / (width * height) };
}

export function bomCloseReadingImageDimensions(bounds: Box2): { width: number; height: number } {
	const worldWidth = Math.max(bounds[2] - bounds[0], 1e-6);
	const worldHeight = Math.max(bounds[3] - bounds[1], 1e-6);
	const aspect = worldWidth / worldHeight;
	return {
		width: aspect >= 1 ? IMAGE_LONG_SIDE : Math.max(768, Math.round(IMAGE_LONG_SIDE * aspect)),
		height: aspect >= 1 ? Math.max(768, Math.round(IMAGE_LONG_SIDE / aspect)) : IMAGE_LONG_SIDE,
	};
}

function safeGroupSlug(groupId: string): string {
	const slug = groupId.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
	if (!slug || slug.length > 100) throw new Error("INVALID_BOM_GROUP_ID");
	return slug;
}

export async function renderBomCloseReadingGroup(
	plan: BomCloseReadingGroupPlan,
	outputRoot: string,
	options: {
		fullCapture?: {
			imagePath: string;
			width: number;
			height: number;
			sha256: string;
			metadata: JsonRecord;
		};
	} = {},
): Promise<RenderedBomCloseReadingGroup> {
	const directory = path.join(outputRoot, safeGroupSlug(plan.group_id));
	await mkdir(directory, { recursive: true });
	const clean = renderPng(plan.clean_occurrences, plan.render_bounds);
	const full = options.fullCapture
		? {
			png: await readFile(options.fullCapture.imagePath),
			width: options.fullCapture.width,
			height: options.fullCapture.height,
			inkRatio: Number(record(record(options.fullCapture.metadata).raster).ink_ratio ?? 0),
		}
		: renderPng(plan.full_occurrences, plan.render_bounds);
	if (full.width !== clean.width || full.height !== clean.height) throw new Error("BOM_DETAIL_RENDER_SIZE_MISMATCH");
	if (options.fullCapture && createHash("sha256").update(full.png).digest("hex") !== options.fullCapture.sha256) {
		throw new Error("BOM_DETAIL_NATIVE_PLOT_HASH_MISMATCH");
	}
	const fullImagePath = path.join(directory, "component-full.png");
	const cleanImagePath = path.join(directory, "component-clean.png");
	const sidecarPath = path.join(directory, "evidence-sidecar.json");
	await Promise.all([
		writeFile(fullImagePath, full.png, { flag: "wx", mode: 0o600 }),
		writeFile(cleanImagePath, clean.png, { flag: "wx", mode: 0o600 }),
		writeFile(sidecarPath, `${JSON.stringify({
			schema_version: 1,
			group_id: plan.group_id,
			serial_group: plan.serial_group,
			bom_items: plan.bom_items,
			target_point: plan.target_point,
			view_region: plan.view_region,
			anchor: plan.anchor,
			component_bounds: plan.component_bounds,
			render_bounds: plan.render_bounds,
			full_render: {
				strategy: options.fullCapture
					? "thcad_plot_set_window_to_plot_without_view_change"
					: "capability_11_world_path_full_render",
				width: full.width,
				height: full.height,
				ink_ratio: full.inkRatio,
				occurrence_count: plan.full_occurrences.length,
				native_plot: options.fullCapture?.metadata,
			},
			clean_render: {
				strategy: "target_owner_plus_crossing_semantic_render",
				width: clean.width,
				height: clean.height,
				ink_ratio: clean.inkRatio,
				occurrence_count: plan.clean_occurrences.length,
				removed_occurrences: plan.removed_occurrences,
			},
			kept_occurrences: plan.clean_occurrences.map((item) => ({
				occurrence_id: item.occurrence_id,
				source_handle: item.source_handle,
				runtime_class: item.runtime_class,
				geometry_kind: item.geometry_kind,
				semantic_role: item.semantic_role,
				layer: item.layer,
				linetype: item.linetype,
				color_rgb: item.color_rgb,
				bounds: item.bounds,
				length: item.length,
			})),
			geometry_summary: plan.geometry_summary,
			bom_instance_coverage: plan.bom_instance_coverage,
			mutation_status: "read_only_no_dwg_or_view_change",
		}, null, 2)}\n`, { flag: "wx", mode: 0o600 }),
	]);
	return {
		group_id: plan.group_id,
		directory,
		full_image_path: fullImagePath,
		full_image_ref: toProjectRef(fullImagePath),
		clean_image_path: cleanImagePath,
		clean_image_ref: toProjectRef(cleanImagePath),
		sidecar_path: sidecarPath,
		sidecar_ref: toProjectRef(sidecarPath),
		full_image_sha256: createHash("sha256").update(full.png).digest("hex"),
		clean_image_sha256: createHash("sha256").update(clean.png).digest("hex"),
		width: full.width,
		height: full.height,
	};
}
