import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { repositoryRoot, toProjectRef } from "./paths.ts";
import {
	createReviewRunId,
	type ParentReviewContext,
	ThcadReviewStore,
} from "./review-store.ts";

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

export interface ThcadSubagentResult {
	evidenceRef: string;
	runId: string;
	durationMs: number;
	toolCallCount: number;
	turns: number;
	usage: ChildUsage;
	model?: string;
	reviewRef: string;
	artifactManifestRef?: string;
	childSessionRef: string;
	reviewStatus: "complete" | "partial";
}

export interface RunThcadSubagentOptions {
	task: string;
	cwd: string;
	model?: string;
	thinkingLevel?: string;
	signal?: AbortSignal;
	onProgress?: (text: string) => void;
	runId?: string;
	parent?: ParentReviewContext;
}

export interface ChildToolTrace {
	sequence: number;
	tool_call_id: string;
	tool_name: string;
	args?: unknown;
	result?: unknown;
	is_error?: boolean;
}

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
const childExtension = path.resolve(runtimeDirectory, "../thcad-child-extension.ts");
const agentPromptFile = path.resolve(runtimeDirectory, "../../agents/thcad-mechanical.md");

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
		.filter((part): part is { type: string; text: string } => Boolean(part) && typeof part === "object" && (part as { type?: string }).type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function toolNames(message: Record<string, unknown>): string[] {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
	return message.content
		.filter((part) => Boolean(part) && typeof part === "object" && (part as { type?: string }).type === "toolCall")
		.map((part) => String((part as { name?: string }).name ?? "tool"));
}

function toolResultText(result: unknown): string {
	if (!result || typeof result !== "object") return "";
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: string; text: string } => (
			Boolean(part)
			&& typeof part === "object"
			&& (part as { type?: unknown }).type === "text"
			&& typeof (part as { text?: unknown }).text === "string"
		))
		.map((part) => part.text)
		.join("\n");
}

function safeEvidenceText(text: string): string {
	if (/data:[^;]+;base64,/i.test(text) || /[A-Za-z0-9+/]{4096,}={0,2}/.test(text)) {
		throw new Error("UNSAFE_CHILD_OUTPUT: binary-looking content was rejected");
	}
	const withoutRoot = text.replaceAll(repositoryRoot, "<project>");
	const withoutExternalAbsolutePaths = withoutRoot.replace(/[A-Za-z]:\\[^\r\n`]+/g, "<local-path>");
	return withoutExternalAbsolutePaths.length <= 50_000
		? withoutExternalAbsolutePaths
		: `${withoutExternalAbsolutePaths.slice(0, 50_000)}\n\n> 子代理正文超过 50,000 字符，宿主已截断。`;
}

export function buildEvidenceContent(
	task: string,
	childText: string,
	toolTrace: ChildToolTrace[],
): string {
	const safeTask = task.replaceAll(repositoryRoot, "<project>").slice(0, 12_000);
	const traceProjection = toolTrace.map((item) => ({
		sequence: item.sequence,
		tool_call_id: item.tool_call_id,
		tool_name: item.tool_name,
		args: item.args,
		is_error: item.is_error ?? false,
		result_text: toolResultText(item.result),
	}));
	const safeTrace = safeEvidenceText(JSON.stringify(traceProjection, null, 2)).slice(0, 30_000);
	const content = [
		"# THCAD Mechanical Evidence",
		"",
		"## 委派任务",
		"",
		safeTask,
		"",
		"## 宿主保全的实际工具轨迹",
		"",
		"以下内容由宿主从 child 原始事件确定性投影，不依赖 child 的最终总结。完整无截断轨迹见同一 run 的 `child-tool-trace.jsonl` 与原生 Session。",
		"",
		"```json",
		safeTrace,
		"```",
		"",
		"## 子代理证据正文",
		"",
		safeEvidenceText(childText),
		"",
	].join("\n");
	return content;
}

async function publishEvidence(
	store: ThcadReviewStore,
	runId: string,
	task: string,
	childText: string,
	toolTrace: ChildToolTrace[],
): Promise<string> {
	return store.writeEvidence(runId, buildEvidenceContent(task, childText, toolTrace));
}

export async function runThcadSubagent(options: RunThcadSubagentOptions): Promise<ThcadSubagentResult> {
	const systemPrompt = await readFile(agentPromptFile, "utf8");
	const reviewStore = new ThcadReviewStore();
	const runId = options.runId ?? createReviewRunId();
	await reviewStore.beginRun({
		runId,
		task: options.task,
		childSystemPrompt: systemPrompt,
		childModel: options.model,
		childThinkingLevel: options.thinkingLevel,
		cwd: options.cwd,
		parent: options.parent,
	});
	const runDirectory = reviewStore.runDirectory(runId);
	const childSessionDirectory = path.join(runDirectory, "child-session");
	const args = [
		"--mode", "json",
		"-p",
		"--session-dir", childSessionDirectory,
		"--session-id", runId,
		"--no-extensions",
		"-e", childExtension,
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--no-approve",
		"--tools", "thcad_session,thcad_analysis,thcad_project_graph",
		"--system-prompt", systemPrompt,
	];
	if (options.model) args.push("--model", options.model);
	if (options.thinkingLevel) args.push("--thinking", options.thinkingLevel);
	args.push(`Task:\n${options.task}`);

	const invocation = getPiInvocation(args);
	const started = Date.now();
	const startedAtUtc = new Date(started).toISOString();
	const usage: ChildUsage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	let turns = 0;
	let finalText = "";
	let stderr = "";
	let toolCallCount = 0;
	let model: string | undefined;
	let stopReason: string | undefined;
	let errorMessage: string | undefined;
	const toolTrace: ChildToolTrace[] = [];
	const toolTraceById = new Map<string, ChildToolTrace>();
	const childEvents = createWriteStream(path.join(runDirectory, "child-events.jsonl"), {
		flags: "wx",
		mode: 0o600,
	});
	const childStderr = createWriteStream(path.join(runDirectory, "child-stderr.log"), {
		flags: "wx",
		mode: 0o600,
	});
	await reviewStore.appendLifecycle(runId, "child_started", {
		model: options.model,
		thinking_level: options.thinkingLevel,
	});

	let exitCode: number;
	try {
		exitCode = await new Promise<number>((resolve, reject) => {
			const child = spawn(invocation.command, invocation.args, {
				cwd: options.cwd,
				env: { ...process.env, SHENBIAN_PI_ROLE: "thcad-mechanical" },
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			let buffer = "";
			let aborted = false;

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
				const names = toolNames(message);
				if (names.length) {
					toolCallCount += names.length;
					options.onProgress?.(`机械子代理调用：${names.join(", ")}`);
				}
				if (message.role === "assistant" && Array.isArray(message.content)) {
					for (const part of message.content) {
						if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "toolCall") continue;
						const call = part as { id?: unknown; name?: unknown; arguments?: unknown };
						const toolCallId = String(call.id ?? `unknown-${toolTrace.length + 1}`);
						const record: ChildToolTrace = {
							sequence: toolTrace.length + 1,
							tool_call_id: toolCallId,
							tool_name: String(call.name ?? "unknown"),
							args: call.arguments,
						};
						toolTrace.push(record);
						toolTraceById.set(toolCallId, record);
					}
				}
				if (message.role === "toolResult") {
					const toolCallId = String(message.toolCallId ?? "");
					const record = toolTraceById.get(toolCallId) ?? {
						sequence: toolTrace.length + 1,
						tool_call_id: toolCallId || `unknown-${toolTrace.length + 1}`,
						tool_name: String(message.toolName ?? "unknown"),
					};
					if (!toolTraceById.has(toolCallId)) toolTrace.push(record);
					record.result = message;
					record.is_error = Boolean(message.isError);
				}
				const text = assistantText(message);
				if (text) finalText = text;
				if (message.role === "assistant") {
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
				}
			};

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
				childEvents.end();
				childStderr.end();
				reject(error);
			});
			child.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				childEvents.end();
				childStderr.end();
				void Promise.all([finished(childEvents), finished(childStderr)]).then(() => {
					if (aborted) reject(new Error("SUBAGENT_CANCELLED: THCAD mechanical child was aborted"));
					else resolve(code ?? 1);
				}, reject);
			});

			const abort = () => {
				aborted = true;
				child.kill("SIGTERM");
			};
			if (options.signal?.aborted) abort();
			else options.signal?.addEventListener("abort", abort, { once: true });
		});
	} catch (error) {
		const durationMs = Date.now() - started;
		const diagnostic = String(error).replaceAll(repositoryRoot, "<project>").slice(0, 2000);
		const status = options.signal?.aborted ? "cancelled" : "failed";
		try {
			await reviewStore.recordChildResult(runId, {
				status,
				startedAtUtc,
				finishedAtUtc: new Date().toISOString(),
				durationMs,
				model,
				stopReason,
				toolCallCount,
				turns,
				usage,
				error: diagnostic,
			});
			await reviewStore.snapshotArtifacts(runId);
		} catch (reviewError) {
			await reviewStore.appendLifecycle(runId, "failure_capture_failed", { error: String(reviewError) });
		}
		throw new Error(`THCAD_SUBAGENT_FAILED [${runId}]: ${diagnostic}`);
	}

	const durationMs = Date.now() - started;
	const finishedAtUtc = new Date().toISOString();
	await writeFile(
		path.join(runDirectory, "child-tool-trace.jsonl"),
		toolTrace.length ? `${toolTrace.map((item) => JSON.stringify(item)).join("\n")}\n` : "",
		{ encoding: "utf8", flag: "wx", mode: 0o600 },
	);
	if (exitCode !== 0 || stopReason === "error" || stopReason === "aborted" || !finalText) {
		const diagnostic = (errorMessage || stderr || `child exit code ${exitCode}`)
			.replaceAll(repositoryRoot, "<project>")
			.slice(0, 2000);
		const status = stopReason === "aborted" ? "cancelled" : "failed";
		await reviewStore.recordChildResult(runId, {
			status,
			startedAtUtc,
			finishedAtUtc,
			durationMs,
			exitCode,
			model,
			stopReason,
			toolCallCount,
			turns,
			usage,
			error: diagnostic,
		});
		options.onProgress?.("正在冻结失败现场与现有 01–20 artifact…");
		try {
			await reviewStore.snapshotArtifacts(runId);
		} catch (error) {
			await reviewStore.appendLifecycle(runId, "artifact_snapshot_failed", { error: String(error) });
		}
		throw new Error(`THCAD_SUBAGENT_FAILED [${runId}]: ${diagnostic}`);
	}

	const evidenceRef = await publishEvidence(reviewStore, runId, options.task, finalText, toolTrace);
	await reviewStore.recordChildResult(runId, {
		status: "completed",
		startedAtUtc,
		finishedAtUtc,
		durationMs,
		exitCode,
		model,
		stopReason,
		toolCallCount,
		turns,
		usage,
	});
	options.onProgress?.("正在用 SHA-256 冻结本次 01–20 证据快照…");
	let artifactManifestRef: string | undefined;
	let reviewStatus: "complete" | "partial" = "partial";
	try {
		const artifactManifest = await reviewStore.snapshotArtifacts(runId);
		artifactManifestRef = toProjectRef(path.join(runDirectory, "artifact-manifest.json"));
		reviewStatus = artifactManifest.status === "complete" ? "complete" : "partial";
	} catch (error) {
		await reviewStore.appendLifecycle(runId, "artifact_snapshot_failed", { error: String(error) });
	}
	return {
		evidenceRef,
		runId,
		durationMs,
		toolCallCount,
		turns,
		usage,
		model,
		reviewRef: reviewStore.runRef(runId),
		artifactManifestRef,
		childSessionRef: toProjectRef(childSessionDirectory),
		reviewStatus,
	};
}
