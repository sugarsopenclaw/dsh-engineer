import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { captureFrameOverview, frameOverviewRef, type FrameOverviewPlot } from "./frame-overview.ts";
import { repositoryRoot, toProjectRef } from "./paths.ts";
import {
	createReviewRunId,
	type ParentReviewContext,
	ThcadReviewStore,
} from "./review-store.ts";

export const THCAD_VISUAL_MODEL = "deepseek/deepseek-v4-flash-vision-exp";
export const THCAD_VISUAL_THINKING = "low";
const CHILD_TIMEOUT_MS = 10 * 60 * 1000;
const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
const agentPromptFile = path.resolve(runtimeDirectory, "../../agents/thcad-visual-overview.md");

interface ChildUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type VisualOverviewVerdict = "readable_overview" | "overview_only" | "unreadable";

export interface VisualOverviewAssessment {
	schema_version: 1;
	verdict: VisualOverviewVerdict;
	image_is_cad: boolean;
	overall_structure_readable: boolean;
	major_labels_readable: boolean;
	small_annotations_readable: boolean;
	needs_detail_views: boolean;
	confidence: number;
	observations: string[];
	issues: string[];
	recommended_next_step: string;
}

export interface ThcadVisualOverviewResult {
	runId: string;
	evidenceRef: string;
	reviewRef: string;
	imageRef: string;
	childSessionRef: string;
	artifactManifestRef?: string;
	reviewStatus: "complete" | "partial";
	model: string;
	durationMs: number;
	turns: number;
	usage: ChildUsage;
	plot: FrameOverviewPlot;
	assessment: VisualOverviewAssessment;
}

export interface RunThcadVisualOverviewOptions {
	cwd: string;
	frameId?: string;
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

function assistantText(message: Record<string, unknown>): string {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return "";
	return message.content
		.filter((part): part is { type: string; text: string } => (
			Boolean(part)
			&& typeof part === "object"
			&& (part as { type?: unknown }).type === "text"
			&& typeof (part as { text?: unknown }).text === "string"
		))
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function boundedString(value: unknown, field: string, maximum = 16_000): string {
	if (typeof value !== "string" || value.length > maximum) {
		throw new Error(`INVALID_VISUAL_ASSESSMENT: ${field}`);
	}
	return value;
}

function boundedStrings(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.length > 100) throw new Error(`INVALID_VISUAL_ASSESSMENT: ${field}`);
	return value.map((item, index) => boundedString(item, `${field}[${index}]`, 2000));
}

function jsonObjectText(text: string): string {
	const trimmed = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("INVALID_VISUAL_ASSESSMENT: no JSON object");
	return trimmed.slice(start, end + 1);
}

export function parseVisualOverviewAssessment(text: string): VisualOverviewAssessment {
	let value: unknown;
	try {
		value = JSON.parse(jsonObjectText(text));
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("INVALID_VISUAL_ASSESSMENT")) throw error;
		throw new Error("INVALID_VISUAL_ASSESSMENT: invalid JSON");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("INVALID_VISUAL_ASSESSMENT: object required");
	}
	const raw = value as Record<string, unknown>;
	const verdicts: VisualOverviewVerdict[] = ["readable_overview", "overview_only", "unreadable"];
	if (raw.schema_version !== 1 || !verdicts.includes(raw.verdict as VisualOverviewVerdict)) {
		throw new Error("INVALID_VISUAL_ASSESSMENT: schema or verdict");
	}
	for (const key of [
		"image_is_cad",
		"overall_structure_readable",
		"major_labels_readable",
		"small_annotations_readable",
		"needs_detail_views",
	]) {
		if (typeof raw[key] !== "boolean") throw new Error(`INVALID_VISUAL_ASSESSMENT: ${key}`);
	}
	const confidence = Number(raw.confidence);
	if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
		throw new Error("INVALID_VISUAL_ASSESSMENT: confidence");
	}
	const assessment: VisualOverviewAssessment = {
		schema_version: 1,
		verdict: raw.verdict as VisualOverviewVerdict,
		image_is_cad: raw.image_is_cad as boolean,
		overall_structure_readable: raw.overall_structure_readable as boolean,
		major_labels_readable: raw.major_labels_readable as boolean,
		small_annotations_readable: raw.small_annotations_readable as boolean,
		needs_detail_views: raw.needs_detail_views as boolean,
		confidence,
		observations: boundedStrings(raw.observations, "observations"),
		issues: boundedStrings(raw.issues, "issues"),
		recommended_next_step: boundedString(raw.recommended_next_step, "recommended_next_step", 4000),
	};
	if (
		(assessment.verdict === "unreadable" && assessment.overall_structure_readable)
		|| (assessment.verdict === "readable_overview" && !assessment.overall_structure_readable)
		|| (!assessment.image_is_cad && assessment.verdict !== "unreadable")
	) throw new Error("INVALID_VISUAL_ASSESSMENT: inconsistent verdict");
	return assessment;
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

function evidenceContent(
	task: string,
	plot: FrameOverviewPlot,
	assessment: VisualOverviewAssessment,
	rawText: string,
): string {
	return [
		"# THCAD Visual Overview Evidence",
		"",
		"## 任务",
		"",
		task,
		"",
		"## 确定性出图来源",
		"",
		"以下元数据由宿主从 capability 02、THCAD PNGOUT 和文件校验得到，不是视觉模型推断。",
		"",
		"```json",
		JSON.stringify(plot, null, 2),
		"```",
		"",
		"## 视觉模型清晰度判断",
		"",
		"```json",
		JSON.stringify(assessment, null, 2),
		"```",
		"",
		"## 子代理原始最终正文",
		"",
		safeText(rawText),
		"",
		"> 边界：该判断用于决定整图是否足以做宏观导航；尺寸、明细和技术要求仍应依赖确定性实体或后续局部出图。",
		"",
	].join("\n");
}

export async function runThcadVisualOverviewSubagent(
	options: RunThcadVisualOverviewOptions,
): Promise<ThcadVisualOverviewResult> {
	const systemPrompt = await readFile(agentPromptFile, "utf8");
	const store = new ThcadReviewStore();
	const runId = options.runId ?? createReviewRunId();
	const task = `按 capability 02 ${options.frameId ? `图框 ${options.frameId}` : "最外层图框"} 生成一张整图概览，并只判断宏观清晰度。`;
	await store.beginRun({
		runId,
		task,
		childSystemPrompt: systemPrompt,
		childModel: THCAD_VISUAL_MODEL,
		childThinkingLevel: THCAD_VISUAL_THINKING,
		childRole: "vision",
		cwd: options.cwd,
		parent: options.parent,
	});
	const runDirectory = store.runDirectory(runId);
	const childSessionDirectory = path.join(runDirectory, "child-session");
	const childEventsPath = path.join(runDirectory, "child-events.jsonl");
	const childStderrPath = path.join(runDirectory, "child-stderr.log");
	const childToolTracePath = path.join(runDirectory, "child-tool-trace.jsonl");
	await Promise.all([
		writeFile(childEventsPath, "", { flag: "wx", mode: 0o600 }),
		writeFile(childStderrPath, "", { flag: "wx", mode: 0o600 }),
		writeFile(childToolTracePath, "", { flag: "wx", mode: 0o600 }),
	]);

	const started = Date.now();
	const startedAtUtc = new Date(started).toISOString();
	const usage = emptyUsage();
	let capture: Awaited<ReturnType<typeof captureFrameOverview>>;
	try {
		capture = await captureFrameOverview({
			frameId: options.frameId,
			signal: options.signal,
			onProgress: options.onProgress,
		});
		await store.snapshotChildInput(runId, {
			source: capture.imagePath,
			logicalPath: "visual/frame-overview.png",
			role: "vision_user_image",
			mediaType: "image/png",
			metadata: capture.plot,
		});
	} catch (error) {
		const diagnostic = safeText(String(error), 2000);
		await store.writeEvidence(runId, `# THCAD Visual Overview Evidence\n\n出图失败：${diagnostic}\n`);
		await store.recordChildResult(runId, {
			status: options.signal?.aborted ? "cancelled" : "failed",
			startedAtUtc,
			finishedAtUtc: new Date().toISOString(),
			durationMs: Date.now() - started,
			model: THCAD_VISUAL_MODEL,
			toolCallCount: 0,
			turns: 0,
			usage,
			error: diagnostic,
		});
		await store.snapshotArtifacts(runId).catch(async (snapshotError) => {
			await store.appendLifecycle(runId, "artifact_snapshot_failed", { error: String(snapshotError) });
		});
		throw new Error(`THCAD_VISUAL_SUBAGENT_FAILED [${runId}]: ${diagnostic}`);
	}

	options.onProgress?.(`图框 PNG 已生成（${capture.plot.width}×${capture.plot.height}），正在调用 DeepSeek 视觉子代理…`);
	const prompt = [
		"请判断随本条 user 消息提供的唯一一张 THCAD 图纸概览是否足以进行宏观导航。",
		"宿主已确定性验证的元数据如下；不要把它扩写成图纸业务结论：",
		JSON.stringify({
			document_name: capture.plot.document_name,
			analysis_id: capture.plot.analysis_id,
			frame_id: capture.plot.frame_id,
			frame_bbox: capture.plot.frame_bbox,
			image_width: capture.plot.width,
			image_height: capture.plot.height,
			ink_ratio: capture.plot.ink_ratio,
			capture_strategy: capture.plot.capture_strategy,
		}),
		"只返回系统提示规定的 JSON 对象。",
	].join("\n");
	const args = [
		"--mode", "json",
		"-p",
		"--session-dir", childSessionDirectory,
		"--session-id", runId,
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--no-approve",
		"--no-tools",
		"--model", THCAD_VISUAL_MODEL,
		"--thinking", THCAD_VISUAL_THINKING,
		"--system-prompt", systemPrompt,
		"--",
		`@${capture.imagePath}`,
		prompt,
	];
	const invocation = getPiInvocation(args);
	let finalText = "";
	let stderr = "";
	let turns = 0;
	let model = THCAD_VISUAL_MODEL;
	let stopReason: string | undefined;
	let errorMessage: string | undefined;
	const childEvents = createWriteStream(childEventsPath, { flags: "a", mode: 0o600 });
	const childStderr = createWriteStream(childStderrPath, { flags: "a", mode: 0o600 });
	await store.appendLifecycle(runId, "child_started", {
		model: THCAD_VISUAL_MODEL,
		thinking_level: THCAD_VISUAL_THINKING,
		input_sha256: capture.plot.sha256,
	});

	let exitCode: number;
	try {
		exitCode = await new Promise<number>((resolve, reject) => {
			const child = spawn(invocation.command, invocation.args, {
				cwd: options.cwd,
				env: { ...process.env, SHENBIAN_PI_ROLE: "thcad-vision" },
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
				try {
					event = JSON.parse(line) as Record<string, unknown>;
				} catch {
					return;
				}
				if (event.type !== "message_end" || !event.message || typeof event.message !== "object") return;
				const message = event.message as Record<string, unknown>;
				const text = assistantText(message);
				if (text) finalText = text;
				if (message.role !== "assistant") return;
				turns += 1;
				const raw = message.usage as Record<string, unknown> | undefined;
				const input = Number(raw?.input ?? 0);
				const output = Number(raw?.output ?? 0);
				const cacheRead = Number(raw?.cacheRead ?? 0);
				const cacheWrite = Number(raw?.cacheWrite ?? 0);
				usage.input += input;
				usage.output += output;
				usage.cacheRead += cacheRead;
				usage.cacheWrite += cacheWrite;
				usage.totalTokens += Number(raw?.totalTokens ?? input + output + cacheRead + cacheWrite);
				const rawCost = raw?.cost as Record<string, unknown> | undefined;
				usage.cost.input += Number(rawCost?.input ?? 0);
				usage.cost.output += Number(rawCost?.output ?? 0);
				usage.cost.cacheRead += Number(rawCost?.cacheRead ?? 0);
				usage.cost.cacheWrite += Number(rawCost?.cacheWrite ?? 0);
				usage.cost.total += Number(rawCost?.total ?? 0);
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
				stderr = `${stderr}${chunk.toString()}`.slice(-8000);
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
					if (aborted) reject(new Error("SUBAGENT_CANCELLED: THCAD visual child timed out or was aborted"));
					else resolve(code ?? 1);
				}, reject);
			});
			if (options.signal?.aborted) abort();
			else options.signal?.addEventListener("abort", abort, { once: true });
		});
	} catch (error) {
		const diagnostic = safeText(String(error), 2000);
		await store.writeEvidence(runId, `# THCAD Visual Overview Evidence\n\n视觉子代理失败：${diagnostic}\n\n\`\`\`json\n${JSON.stringify(capture.plot, null, 2)}\n\`\`\`\n`);
		await store.recordChildResult(runId, {
			status: options.signal?.aborted ? "cancelled" : "failed",
			startedAtUtc,
			finishedAtUtc: new Date().toISOString(),
			durationMs: Date.now() - started,
			model,
			stopReason,
			toolCallCount: 0,
			turns,
			usage,
			error: diagnostic,
		});
		await store.snapshotArtifacts(runId).catch(async (snapshotError) => {
			await store.appendLifecycle(runId, "artifact_snapshot_failed", { error: String(snapshotError) });
		});
		throw new Error(`THCAD_VISUAL_SUBAGENT_FAILED [${runId}]: ${diagnostic}`);
	}

	if (exitCode !== 0 || stopReason === "error" || stopReason === "aborted" || !finalText) {
		const diagnostic = safeText(errorMessage || stderr || `child exit code ${exitCode}`, 2000);
		await store.writeEvidence(runId, `# THCAD Visual Overview Evidence\n\n视觉子代理失败：${diagnostic}\n`);
		await store.recordChildResult(runId, {
			status: stopReason === "aborted" ? "cancelled" : "failed",
			startedAtUtc,
			finishedAtUtc: new Date().toISOString(),
			durationMs: Date.now() - started,
			exitCode,
			model,
			stopReason,
			toolCallCount: 0,
			turns,
			usage,
			error: diagnostic,
		});
		await store.snapshotArtifacts(runId).catch(() => undefined);
		throw new Error(`THCAD_VISUAL_SUBAGENT_FAILED [${runId}]: ${diagnostic}`);
	}

	let assessment: VisualOverviewAssessment;
	try {
		assessment = parseVisualOverviewAssessment(finalText);
	} catch (error) {
		const diagnostic = safeText(String(error), 2000);
		await store.writeEvidence(runId, `# THCAD Visual Overview Evidence\n\n视觉子代理返回无法验证：${diagnostic}\n\n${safeText(finalText)}\n`);
		await store.recordChildResult(runId, {
			status: "failed",
			startedAtUtc,
			finishedAtUtc: new Date().toISOString(),
			durationMs: Date.now() - started,
			exitCode,
			model,
			stopReason,
			toolCallCount: 0,
			turns,
			usage,
			error: diagnostic,
		});
		await store.snapshotArtifacts(runId).catch(() => undefined);
		throw new Error(`THCAD_VISUAL_SUBAGENT_FAILED [${runId}]: ${diagnostic}`);
	}

	await writeFile(
		path.join(runDirectory, "visual-assessment.json"),
		`${JSON.stringify({
			schema_version: 1,
			run_id: runId,
			model,
			image_sha256: capture.plot.sha256,
			plot: capture.plot,
			assessment,
		}, null, 2)}\n`,
		{ encoding: "utf8", flag: "wx", mode: 0o600 },
	);
	const evidenceRef = await store.writeEvidence(runId, evidenceContent(task, capture.plot, assessment, finalText));
	const durationMs = Date.now() - started;
	await store.recordChildResult(runId, {
		status: "completed",
		startedAtUtc,
		finishedAtUtc: new Date().toISOString(),
		durationMs,
		exitCode,
		model,
		stopReason,
		toolCallCount: 0,
		turns,
		usage,
	});
	options.onProgress?.("正在冻结视觉输入和当前 01–20 证据代次…");
	let artifactManifestRef: string | undefined;
	let reviewStatus: "complete" | "partial" = "partial";
	try {
		const manifest = await store.snapshotArtifacts(runId);
		artifactManifestRef = toProjectRef(path.join(runDirectory, "artifact-manifest.json"));
		reviewStatus = manifest.status === "complete" ? "complete" : "partial";
	} catch (error) {
		await store.appendLifecycle(runId, "artifact_snapshot_failed", { error: String(error) });
	}
	return {
		runId,
		evidenceRef,
		reviewRef: store.runRef(runId),
		imageRef: frameOverviewRef(capture),
		childSessionRef: toProjectRef(childSessionDirectory),
		artifactManifestRef,
		reviewStatus,
		model,
		durationMs,
		turns,
		usage,
		plot: capture.plot,
		assessment,
	};
}
