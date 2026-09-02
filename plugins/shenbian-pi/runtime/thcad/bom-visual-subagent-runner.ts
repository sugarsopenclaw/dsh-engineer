import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import {
	prepareBomCloseReadingPlan,
	bomCloseReadingImageDimensions,
	renderBomCloseReadingGroup,
	type BomCloseReadingGroupPlan,
	type BomCloseReadingPlan,
	type RenderedBomCloseReadingGroup,
} from "./bom-close-reading.ts";
import { captureComponentWindowPlot } from "./component-window-plot.ts";
import { repositoryRoot, toProjectRef } from "./paths.ts";
import {
	createReviewRunId,
	type ChildInputSnapshotRequest,
	type ParentReviewContext,
	ThcadReviewStore,
} from "./review-store.ts";
import {
	TopologySemanticsRecorder,
	type TopologySemanticSyncResult,
} from "./topology-semantics.ts";
import { resolveThcadVisionModel } from "./vision-model-routing.ts";

export const THCAD_BOM_VISION_THINKING = process.env.SHENBIAN_THCAD_VISION_THINKING?.trim()
	|| "high";
const CHILD_TIMEOUT_MS = 15 * 60 * 1000;
const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
const agentPromptFile = path.resolve(runtimeDirectory, "../../agents/thcad-bom-close-reading.md");

interface ChildUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface BomItemVisualUnderstanding {
	item_number: number;
	bom_facts: string[];
	visible_geometry: string[];
	bom_geometry_matches: string[];
	not_observed: string[];
	evidence_refs: string[];
}

export interface BomGroupVisualUnderstanding {
	schema_version: 2;
	group_id: string;
	segment_observation: string;
	items: BomItemVisualUnderstanding[];
	visible_relations: string[];
	drawing_bom_discrepancies: string[];
	unresolved_observations: string[];
}

export interface BomCloseReadingGroupResult {
	group_id: string;
	item_numbers: number[];
	status: "completed" | "failed";
	result?: BomGroupVisualUnderstanding;
	error?: string;
	full_image_ref: string;
	clean_image_ref: string;
	sidecar_ref: string;
	child_session_ref: string;
	model?: string;
	duration_ms: number;
	turns: number;
	usage: ChildUsage;
}

export interface ThcadBomCloseReadingResult {
	runId: string;
	evidenceRef: string;
	reviewRef: string;
	batchResultRef: string;
	coverageRef: string;
	artifactManifestRef?: string;
	reviewStatus: "complete" | "partial";
	model: string;
	durationMs: number;
	turns: number;
	usage: ChildUsage;
	plan: BomCloseReadingPlan;
	groups: BomCloseReadingGroupResult[];
	semanticSync: TopologySemanticSyncResult;
}

export interface RunThcadBomCloseReadingOptions {
	cwd: string;
	itemNumbers?: number[];
	expectedDocument?: string;
	signal?: AbortSignal;
	onProgress?: (text: string) => void;
	runId?: string;
	parent?: ParentReviewContext;
}

function emptyUsage(): ChildUsage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function addUsage(target: ChildUsage, source: ChildUsage): void {
	target.input += source.input;
	target.output += source.output;
	target.cacheRead += source.cacheRead;
	target.cacheWrite += source.cacheWrite;
	target.totalTokens += source.totalTokens;
	target.cost.input += source.cost.input;
	target.cost.output += source.cost.output;
	target.cost.cacheRead += source.cost.cacheRead;
	target.cost.cacheWrite += source.cost.cacheWrite;
	target.cost.total += source.cost.total;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && path.isAbsolute(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const executable = path.basename(process.execPath).toLocaleLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(executable)) return { command: process.execPath, args };
	return { command: "pi", args };
}

export function assistantResultText(message: Record<string, unknown>): string {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return "";
	const text = message.content
		.filter((part): part is { type: string; text: string } => (
			Boolean(part)
			&& typeof part === "object"
			&& (part as { type?: unknown }).type === "text"
			&& typeof (part as { text?: unknown }).text === "string"
		))
		.map((part) => part.text)
		.join("\n")
		.trim();
	if (text) return text;

	// DeepSeek vision can occasionally finish with a complete, schema-valid JSON
	// object in the reasoning part and omit a separate text part. Treat that as
	// the candidate result only when no final text exists; the strict schema
	// parser below remains the authority on whether it is usable.
	return message.content
		.filter((part): part is { type: string; thinking: string } => (
			Boolean(part)
			&& typeof part === "object"
			&& (part as { type?: unknown }).type === "thinking"
			&& typeof (part as { thinking?: unknown }).thinking === "string"
		))
		.map((part) => part.thinking)
		.join("\n")
		.trim();
}

function safeText(value: string, maximum = 50_000): string {
	if (/data:[^;]+;base64,/i.test(value) || /[A-Za-z0-9+/]{4096,}={0,2}/.test(value)) {
		return "[binary-looking child output omitted]";
	}
	const safe = value
		.replaceAll(repositoryRoot, "<project>")
		.replace(/[A-Za-z]:\\[^\r\n`]+/g, "<local-path>");
	return safe.length <= maximum ? safe : `${safe.slice(0, maximum)}\n[truncated]`;
}

function jsonObjectText(text: string): string {
	const trimmed = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
	const start = trimmed.indexOf("{");
	if (start < 0) throw new Error("INVALID_BOM_VISUAL_RESULT: no JSON object");
	const expectedClosers: string[] = [];
	let inString = false;
	let escaped = false;
	for (let index = start; index < trimmed.length; index += 1) {
		const character = trimmed[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === "\"") inString = false;
			continue;
		}
		if (character === "\"") {
			inString = true;
			continue;
		}
		if (character === "{") expectedClosers.push("}");
		else if (character === "[") expectedClosers.push("]");
		else if (character === "}" || character === "]") {
			if (expectedClosers.pop() !== character) {
				throw new Error("INVALID_BOM_VISUAL_RESULT: mismatched JSON delimiters");
			}
			if (!expectedClosers.length) return trimmed.slice(start, index + 1);
		}
	}
	// Some vision responses contain every required field and close the final
	// string/array, but omit only the root object's last brace. Repair exactly
	// that one token; all other truncation still reaches strict JSON/schema
	// validation and fails.
	if (!inString && expectedClosers.length === 1 && expectedClosers[0] === "}") {
		return `${trimmed.slice(start)}}`;
	}
	throw new Error("INVALID_BOM_VISUAL_RESULT: incomplete JSON object");
}

function boundedString(value: unknown, field: string, maximum = 20_000): string {
	if (typeof value !== "string" || !value.trim() || value.length > maximum) {
		throw new Error(`INVALID_BOM_VISUAL_RESULT: ${field}`);
	}
	return value;
}

function boundedStrings(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.length > 200) throw new Error(`INVALID_BOM_VISUAL_RESULT: ${field}`);
	return value.map((item, index) => boundedString(item, `${field}[${index}]`, 5000));
}

export function parseBomGroupVisualUnderstanding(
	text: string,
	groupId: string,
	expectedItemNumbers: readonly number[],
): BomGroupVisualUnderstanding {
	let value: unknown;
	try {
		value = JSON.parse(jsonObjectText(text));
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("INVALID_BOM_VISUAL_RESULT")) throw error;
		throw new Error("INVALID_BOM_VISUAL_RESULT: invalid JSON");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("INVALID_BOM_VISUAL_RESULT: object required");
	}
	const raw = value as Record<string, unknown>;
	if (raw.schema_version !== 2 || raw.group_id !== groupId || !Array.isArray(raw.items)) {
		throw new Error("INVALID_BOM_VISUAL_RESULT: schema, group_id or items");
	}
	const expected = [...new Set(expectedItemNumbers)].sort((left, right) => left - right);
	const items = raw.items.map((value, index): BomItemVisualUnderstanding => {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`INVALID_BOM_VISUAL_RESULT: items[${index}]`);
		}
		const item = value as Record<string, unknown>;
		const itemNumber = Number(item.item_number);
		if (!Number.isInteger(itemNumber)) throw new Error(`INVALID_BOM_VISUAL_RESULT: items[${index}].item_number`);
		return {
			item_number: itemNumber,
			bom_facts: boundedStrings(item.bom_facts, `items[${index}].bom_facts`),
			visible_geometry: boundedStrings(item.visible_geometry, `items[${index}].visible_geometry`),
			bom_geometry_matches: boundedStrings(item.bom_geometry_matches, `items[${index}].bom_geometry_matches`),
			not_observed: boundedStrings(item.not_observed, `items[${index}].not_observed`),
			evidence_refs: boundedStrings(item.evidence_refs, `items[${index}].evidence_refs`),
		};
	});
	const actual = [...new Set(items.map((item) => item.item_number))].sort((left, right) => left - right);
	if (actual.join(",") !== expected.join(",") || actual.length !== items.length) {
		throw new Error("INVALID_BOM_VISUAL_RESULT: items must exactly cover the serial segment");
	}
	return {
		schema_version: 2,
		group_id: groupId,
		segment_observation: boundedString(raw.segment_observation, "segment_observation"),
		items,
		visible_relations: boundedStrings(raw.visible_relations, "visible_relations"),
		drawing_bom_discrepancies: boundedStrings(raw.drawing_bom_discrepancies, "drawing_bom_discrepancies"),
		unresolved_observations: boundedStrings(raw.unresolved_observations, "unresolved_observations"),
	};
}

function promptForGroup(plan: BomCloseReadingGroupPlan): string {
	const selectedTopology = plan.clean_occurrences.map((item) => ({
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
	}));
	return [
		"请精读本次 user 消息中的两张图。第一张是完整构件窗口，第二张是同窗口的去干扰图。",
		"下面 JSON 是 .NET 04/08/11/13/21 组合得到的确定性证据。serial_group.item_numbers 已确定共同指向 target_point 处的构件；BOM 信息作为业务准则。",
		JSON.stringify({
			group_id: plan.group_id,
			serial_group: plan.serial_group,
			bom_items: plan.bom_items,
			target_point: plan.target_point,
			view_region: plan.view_region,
			anchor: plan.anchor,
			component_bounds: plan.component_bounds,
			render_bounds: plan.render_bounds,
			geometry_summary: plan.geometry_summary,
			bom_instance_coverage: plan.bom_instance_coverage,
			selected_component_topology: selectedTopology,
			cleaning_evidence: plan.removed_occurrences,
		}),
		"只提取可复核事实：当前图中未直接表达的 BOM 维度写入 not_observed；不得补充用途、设计意图、其他视图形态或变压器领域知识。",
		"只返回系统提示规定的 JSON 对象。",
	].join("\n");
}

interface SpawnResult {
	text: string;
	stderr: string;
	exitCode: number;
	model: string;
	stopReason?: string;
	errorMessage?: string;
	turns: number;
	usage: ChildUsage;
}

async function spawnVisionChild(input: {
	cwd: string;
	runId: string;
	group: BomCloseReadingGroupPlan;
	rendered: RenderedBomCloseReadingGroup;
	groupDirectory: string;
	visionModel: string;
	signal?: AbortSignal;
}): Promise<SpawnResult> {
	const childSessionDirectory = path.join(input.groupDirectory, "child-session");
	const childEventsPath = path.join(input.groupDirectory, "child-events.jsonl");
	const childStderrPath = path.join(input.groupDirectory, "child-stderr.log");
	await mkdir(childSessionDirectory, { recursive: true });
	await Promise.all([
		writeFile(childEventsPath, "", { flag: "wx", mode: 0o600 }),
		writeFile(childStderrPath, "", { flag: "wx", mode: 0o600 }),
	]);
	const prompt = promptForGroup(input.group);
	await writeFile(path.join(input.groupDirectory, "vision-prompt.md"), prompt, { flag: "wx", mode: 0o600 });
	const args = [
		"--mode", "json",
		"-p",
		"--session-dir", childSessionDirectory,
		"--session-id", `${input.runId}-${input.group.group_id}`,
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--no-approve",
		"--no-tools",
		"--model", input.visionModel,
		"--thinking", THCAD_BOM_VISION_THINKING,
		"--system-prompt", agentPromptFile,
		"--",
		`@${input.rendered.full_image_path}`,
		`@${input.rendered.clean_image_path}`,
		`@${path.join(input.groupDirectory, "vision-prompt.md")}`,
	];
	const invocation = getPiInvocation(args);
	let text = "";
	let stderr = "";
	let model = input.visionModel;
	let stopReason: string | undefined;
	let errorMessage: string | undefined;
	let turns = 0;
	const usage = emptyUsage();
	const childEvents = createWriteStream(childEventsPath, { flags: "a", mode: 0o600 });
	const childStderr = createWriteStream(childStderrPath, { flags: "a", mode: 0o600 });
	const exitCode = await new Promise<number>((resolve, reject) => {
		const child = spawn(invocation.command, invocation.args, {
			cwd: input.cwd,
			env: { ...process.env, SHENBIAN_PI_ROLE: "thcad-bom-close-reading" },
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let buffer = "";
		let aborted = false;
		let settled = false;
		const processLine = (line: string): void => {
			if (!line.trim()) return;
			let event: Record<string, unknown>;
			try { event = JSON.parse(line) as Record<string, unknown>; } catch { return; }
			if (event.type !== "message_end" || !event.message || typeof event.message !== "object") return;
			const message = event.message as Record<string, unknown>;
			const currentText = assistantResultText(message);
			if (currentText) text = currentText;
			if (message.role !== "assistant") return;
			turns += 1;
			const raw = message.usage as Record<string, unknown> | undefined;
			const currentUsage = emptyUsage();
			currentUsage.input = Number(raw?.input ?? 0);
			currentUsage.output = Number(raw?.output ?? 0);
			currentUsage.cacheRead = Number(raw?.cacheRead ?? 0);
			currentUsage.cacheWrite = Number(raw?.cacheWrite ?? 0);
			currentUsage.totalTokens = Number(raw?.totalTokens
				?? currentUsage.input + currentUsage.output + currentUsage.cacheRead + currentUsage.cacheWrite);
			const rawCost = raw?.cost as Record<string, unknown> | undefined;
			currentUsage.cost.input = Number(rawCost?.input ?? 0);
			currentUsage.cost.output = Number(rawCost?.output ?? 0);
			currentUsage.cost.cacheRead = Number(rawCost?.cacheRead ?? 0);
			currentUsage.cost.cacheWrite = Number(rawCost?.cacheWrite ?? 0);
			currentUsage.cost.total = Number(rawCost?.total ?? 0);
			addUsage(usage, currentUsage);
			model = typeof message.model === "string" ? message.model : model;
			stopReason = typeof message.stopReason === "string" ? message.stopReason : stopReason;
			errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : errorMessage;
		};
		const abort = (): void => {
			if (settled) return;
			aborted = true;
			child.kill("SIGTERM");
		};
		const timeout = setTimeout(abort, CHILD_TIMEOUT_MS);
		child.stdout.on("data", (chunk) => {
			childEvents.write(chunk);
			buffer += chunk.toString();
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";
			for (const line of lines) processLine(line);
		});
		child.stderr.on("data", (chunk) => {
			childStderr.write(chunk);
			stderr = `${stderr}${chunk.toString()}`.slice(-12_000);
		});
		child.on("error", (error) => {
			settled = true;
			clearTimeout(timeout);
			childEvents.end();
			childStderr.end();
			reject(error);
		});
		child.on("close", (code) => {
			settled = true;
			clearTimeout(timeout);
			if (buffer.trim()) processLine(buffer);
			childEvents.end();
			childStderr.end();
			void Promise.all([finished(childEvents), finished(childStderr)]).then(() => {
				if (aborted) reject(new Error("SUBAGENT_CANCELLED: BOM visual child timed out or was aborted"));
				else resolve(code ?? 1);
			}, reject);
		});
		if (input.signal?.aborted) abort();
		else input.signal?.addEventListener("abort", abort, { once: true });
	});
	return { text, stderr, exitCode, model, stopReason, errorMessage, turns, usage };
}

function evidenceContent(
	task: string,
	plan: BomCloseReadingPlan,
	groups: readonly BomCloseReadingGroupResult[],
): string {
	return [
		"# THCAD BOM 构件视觉精读证据",
		"",
		"## 任务",
		"",
		task,
		"",
		"## 确定性批次与覆盖",
		"",
		"以下内容由宿主组合 capability 04/08/11/13/21 得到：",
		"",
		"```json",
		JSON.stringify({
			document_name: plan.document_name,
			analysis_id: plan.analysis_id,
			dbmod: plan.dbmod,
			source_status: plan.source_status,
			artifact_refs: plan.artifact_refs,
			coverage: plan.coverage,
		}, null, 2),
		"```",
		"",
		"## 各序号段视觉理解",
		"",
		...groups.flatMap((group) => [
			`### ${group.group_id} · 序号 ${group.item_numbers.join("/")}`,
			"",
			`运行状态：${group.status}；完整图：${group.full_image_ref}；去干扰图：${group.clean_image_ref}；拓扑边车：${group.sidecar_ref}`,
			"",
			group.result ? `\`\`\`json\n${JSON.stringify(group.result, null, 2)}\n\`\`\`` : `失败：${group.error ?? "unknown"}`,
			"",
		]),
		">边界：本文件只交付 BOM、序号段、指向点、图元世界坐标、清理清单及视觉可复核事实；用途、设计意图与机械/变压器推理由主 Agent 结合用户问题完成。",
		"",
	].join("\n");
}

export async function runThcadBomCloseReadingSubagent(
	options: RunThcadBomCloseReadingOptions,
): Promise<ThcadBomCloseReadingResult> {
	const systemPrompt = await readFile(agentPromptFile, "utf8");
	const store = new ThcadReviewStore();
	const runId = options.runId ?? createReviewRunId();
	const visionModel = resolveThcadVisionModel(options.parent?.model);
	const scopeText = options.itemNumbers?.length ? `BOM 序号 ${options.itemNumbers.join("/")}` : "全部有图面序号的 BOM";
	const task = `按序号段精读${scopeText}，组合 BOM、共同指向、完整图、去干扰图和选中态拓扑，形成构件理解。`;
	await store.beginRun({
		runId,
		task,
		childSystemPrompt: systemPrompt,
		childModel: visionModel,
		childThinkingLevel: THCAD_BOM_VISION_THINKING,
		childRole: "bom_close_reading",
		cwd: options.cwd,
		parent: options.parent,
	});
	const runDirectory = store.runDirectory(runId);
	const groupsRoot = path.join(runDirectory, "groups");
	await mkdir(groupsRoot, { recursive: true });
	const started = Date.now();
	const startedAtUtc = new Date(started).toISOString();
	const totalUsage = emptyUsage();
	let totalTurns = 0;
	let plan: BomCloseReadingPlan;
	try {
		plan = await prepareBomCloseReadingPlan({
			itemNumbers: options.itemNumbers,
			expectedDocument: options.expectedDocument,
			signal: options.signal,
			onProgress: options.onProgress,
		});
		if (!plan.groups.length) throw new Error("BOM_CLOSE_READING_NO_RESOLVED_GROUPS");
		await writeFile(path.join(runDirectory, "batch-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, {
			flag: "wx",
			mode: 0o600,
		});
	} catch (error) {
		const diagnostic = safeText(String(error), 3000);
		await store.writeEvidence(runId, `# THCAD BOM 构件视觉精读证据\n\n确定性准备失败：${diagnostic}\n`);
		await store.recordChildResult(runId, {
			status: options.signal?.aborted ? "cancelled" : "failed",
			startedAtUtc,
			finishedAtUtc: new Date().toISOString(),
			durationMs: Date.now() - started,
			model: visionModel,
			toolCallCount: 0,
			turns: 0,
			usage: totalUsage,
			error: diagnostic,
		});
		await store.snapshotArtifacts(runId).catch(() => undefined);
		throw new Error(`THCAD_BOM_CLOSE_READING_FAILED [${runId}]: ${diagnostic}`);
	}

	options.onProgress?.(`已确定 ${plan.groups.length} 个序号段，正在生成成对的完整/去干扰图和拓扑边车…`);
	const renderedGroups: Array<{ plan: BomCloseReadingGroupPlan; rendered: RenderedBomCloseReadingGroup }> = [];
	const snapshotRequests: ChildInputSnapshotRequest[] = [];
	for (const group of plan.groups) {
		const dimensions = bomCloseReadingImageDimensions(group.render_bounds);
		const nativeCapture = await captureComponentWindowPlot({
			documentName: plan.document_name,
			analysisId: plan.analysis_id,
			dbmod: plan.dbmod,
			bounds: group.render_bounds,
			targetPath: path.join(groupsRoot, group.group_id, ".native", "component-full.png"),
			width: dimensions.width,
			height: dimensions.height,
			signal: options.signal,
		});
		const rendered = await renderBomCloseReadingGroup(group, groupsRoot, {
			fullCapture: nativeCapture,
		});
		renderedGroups.push({ plan: group, rendered });
		const prefix = `groups/${group.group_id}`;
		snapshotRequests.push(
			{
				source: rendered.full_image_path,
				logicalPath: `${prefix}/component-full.png`,
				role: "bom_component_full_image",
				mediaType: "image/png",
				metadata: { group_id: group.group_id, item_numbers: group.serial_group.item_numbers },
			},
			{
				source: rendered.clean_image_path,
				logicalPath: `${prefix}/component-clean.png`,
				role: "bom_component_clean_image",
				mediaType: "image/png",
				metadata: { group_id: group.group_id, item_numbers: group.serial_group.item_numbers },
			},
			{
				source: rendered.sidecar_path,
				logicalPath: `${prefix}/evidence-sidecar.json`,
				role: "bom_component_deterministic_sidecar",
				mediaType: "application/json",
				metadata: { group_id: group.group_id, item_numbers: group.serial_group.item_numbers },
			},
		);
	}
	await store.snapshotChildInputs(runId, snapshotRequests);

	const groupResults: BomCloseReadingGroupResult[] = [];
	for (let index = 0; index < renderedGroups.length; index += 1) {
		if (options.signal?.aborted) throw new Error("SUBAGENT_CANCELLED");
		const current = renderedGroups[index];
		options.onProgress?.(`正在精读序号段 ${index + 1}/${renderedGroups.length}：${current.plan.serial_group.item_numbers.join("/")}…`);
		const groupStarted = Date.now();
		let childUsage = emptyUsage();
		let turns = 0;
		let model = visionModel;
		try {
			await store.appendLifecycle(runId, "bom_group_child_started", {
				group_id: current.plan.group_id,
				item_numbers: current.plan.serial_group.item_numbers,
				model: visionModel,
				thinking_level: THCAD_BOM_VISION_THINKING,
			});
			const child = await spawnVisionChild({
				cwd: options.cwd,
				runId,
				group: current.plan,
				rendered: current.rendered,
				groupDirectory: current.rendered.directory,
				visionModel,
				signal: options.signal,
			});
			childUsage = child.usage;
			turns = child.turns;
			model = child.model;
			addUsage(totalUsage, childUsage);
			totalTurns += turns;
			if (child.exitCode !== 0 || child.stopReason === "error" || child.stopReason === "aborted" || !child.text) {
				throw new Error(child.errorMessage || child.stderr || `child exit code ${child.exitCode}`);
			}
			const result = parseBomGroupVisualUnderstanding(
				child.text,
				current.plan.group_id,
				current.plan.serial_group.item_numbers,
			);
			await writeFile(
				path.join(current.rendered.directory, "vision-result.json"),
				`${JSON.stringify({
					schema_version: 1,
					group_id: current.plan.group_id,
					model,
					full_image_sha256: current.rendered.full_image_sha256,
					clean_image_sha256: current.rendered.clean_image_sha256,
					result,
					raw_final_text: child.text,
				}, null, 2)}\n`,
				{ flag: "wx", mode: 0o600 },
			);
			groupResults.push({
				group_id: current.plan.group_id,
				item_numbers: current.plan.serial_group.item_numbers,
				status: "completed",
				result,
				full_image_ref: current.rendered.full_image_ref,
				clean_image_ref: current.rendered.clean_image_ref,
				sidecar_ref: current.rendered.sidecar_ref,
				child_session_ref: toProjectRef(path.join(current.rendered.directory, "child-session")),
				model,
				duration_ms: Date.now() - groupStarted,
				turns,
				usage: childUsage,
			});
			await store.appendLifecycle(runId, "bom_group_child_completed", {
				group_id: current.plan.group_id,
				item_numbers: current.plan.serial_group.item_numbers,
			});
		} catch (error) {
			if (options.signal?.aborted) throw error;
			const diagnostic = safeText(String(error), 3000);
			groupResults.push({
				group_id: current.plan.group_id,
				item_numbers: current.plan.serial_group.item_numbers,
				status: "failed",
				error: diagnostic,
				full_image_ref: current.rendered.full_image_ref,
				clean_image_ref: current.rendered.clean_image_ref,
				sidecar_ref: current.rendered.sidecar_ref,
				child_session_ref: toProjectRef(path.join(current.rendered.directory, "child-session")),
				model,
				duration_ms: Date.now() - groupStarted,
				turns,
				usage: childUsage,
			});
			await store.appendLifecycle(runId, "bom_group_child_failed", {
				group_id: current.plan.group_id,
				error: diagnostic,
			});
		}
	}

	const completed = groupResults.filter((group) => group.status === "completed");
	const failed = groupResults.filter((group) => group.status === "failed");
	const batchResultPath = path.join(runDirectory, "bom-understanding.jsonl");
	await writeFile(
		batchResultPath,
		completed.map((group) => JSON.stringify(group.result)).join("\n") + (completed.length ? "\n" : ""),
		{ flag: "wx", mode: 0o600 },
	);
	const coveragePath = path.join(runDirectory, "coverage.json");
	await writeFile(coveragePath, `${JSON.stringify({
		schema_version: 1,
		document_name: plan.document_name,
		analysis_id: plan.analysis_id,
		requested_item_numbers: options.itemNumbers ?? null,
		plan_coverage: plan.coverage,
		attempted_group_count: groupResults.length,
		completed_group_count: completed.length,
		failed_group_count: failed.length,
		completed_item_numbers: [...new Set(completed.flatMap((group) => group.item_numbers))].sort((a, b) => a - b),
		failed_groups: failed.map((group) => ({ group_id: group.group_id, item_numbers: group.item_numbers, error: group.error })),
	}, null, 2)}\n`, { flag: "wx", mode: 0o600 });
	const evidenceRef = await store.writeEvidence(runId, evidenceContent(task, plan, groupResults));
	const topologyRecorder = new TopologySemanticsRecorder();
	const semanticSync: TopologySemanticSyncResult = {
		run_id: runId,
		sent: 0,
		already_synced: 0,
		pending: 0,
		errors: [],
	};
	for (const completedGroup of completed) {
		const source = renderedGroups.find((item) => item.plan.group_id === completedGroup.group_id);
		if (!source || !completedGroup.result) continue;
		try {
			const sync = await topologyRecorder.recordVisualGroup({
				runId,
				plan,
				group: source.plan,
				rendered: source.rendered,
				visualResult: completedGroup.result as unknown as Record<string, unknown>,
				model: completedGroup.model,
				childSessionRef: completedGroup.child_session_ref,
			});
			semanticSync.sent += sync.sent;
			semanticSync.already_synced += sync.already_synced;
			semanticSync.pending = sync.pending;
			semanticSync.errors.push(...sync.errors);
		} catch (error) {
			semanticSync.errors.push(`${completedGroup.group_id}: ${String(error)}`);
			await store.appendLifecycle(runId, "topology_semantics_record_failed", {
				group_id: completedGroup.group_id,
				error: String(error),
			});
		}
	}
	const durationMs = Date.now() - started;
	await store.recordChildResult(runId, {
		status: failed.length ? "failed" : "completed",
		startedAtUtc,
		finishedAtUtc: new Date().toISOString(),
		durationMs,
		model: visionModel,
		toolCallCount: 0,
		turns: totalTurns,
		usage: totalUsage,
		error: failed.length ? `${failed.length} BOM visual group(s) failed; see coverage.json` : undefined,
	});
	options.onProgress?.("正在冻结两张图、BOM/拓扑输入、全部子会话和当前 01–21 证据代次…");
	let artifactManifestRef: string | undefined;
	let reviewStatus: "complete" | "partial" = "partial";
	try {
		const manifest = await store.snapshotArtifacts(runId);
		artifactManifestRef = toProjectRef(path.join(runDirectory, "artifact-manifest.json"));
		reviewStatus = manifest.status === "complete" && failed.length === 0 ? "complete" : "partial";
	} catch (error) {
		await store.appendLifecycle(runId, "artifact_snapshot_failed", { error: String(error) });
	}
	if (!completed.length) {
		throw new Error(`THCAD_BOM_CLOSE_READING_FAILED [${runId}]: all ${failed.length} visual groups failed`);
	}
	return {
		runId,
		evidenceRef,
		reviewRef: store.runRef(runId),
		batchResultRef: toProjectRef(batchResultPath),
		coverageRef: toProjectRef(coveragePath),
		artifactManifestRef,
		reviewStatus,
		model: visionModel,
		durationMs,
		turns: totalTurns,
		usage: totalUsage,
		plan,
		groups: groupResults,
		semanticSync,
	};
}
