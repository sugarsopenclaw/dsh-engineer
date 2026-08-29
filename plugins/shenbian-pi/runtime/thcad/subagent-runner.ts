import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evidenceRoot, repositoryRoot, toProjectRef } from "./paths.ts";

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
}

export interface RunThcadSubagentOptions {
	task: string;
	cwd: string;
	model?: string;
	thinkingLevel?: string;
	signal?: AbortSignal;
	onProgress?: (text: string) => void;
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

async function publishEvidence(task: string, childText: string): Promise<{ runId: string; evidenceRef: string }> {
	const runId = `thcad-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
	const directory = path.join(evidenceRoot, runId);
	const target = path.join(directory, "evidence.md");
	const temporary = `${target}.tmp-${randomUUID()}`;
	await mkdir(directory, { recursive: true });
	const safeTask = task.replaceAll(repositoryRoot, "<project>").slice(0, 12_000);
	const content = [
		"# THCAD Mechanical Evidence",
		"",
		"## 委派任务",
		"",
		safeTask,
		"",
		safeEvidenceText(childText),
		"",
	].join("\n");
	await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
	await rename(temporary, target);
	return { runId, evidenceRef: toProjectRef(target) };
}

export async function runThcadSubagent(options: RunThcadSubagentOptions): Promise<ThcadSubagentResult> {
	const systemPrompt = await readFile(agentPromptFile, "utf8");
	const args = [
		"--mode", "json",
		"-p",
		"--no-session",
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

	const exitCode = await new Promise<number>((resolve, reject) => {
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
			buffer += chunk.toString();
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";
			for (const line of lines) processLine(line);
		});
		child.stderr.on("data", (chunk) => {
			stderr = `${stderr}${chunk.toString()}`.slice(-8000);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (buffer.trim()) processLine(buffer);
			if (aborted) reject(new Error("SUBAGENT_CANCELLED: THCAD mechanical child was aborted"));
			else resolve(code ?? 1);
		});

		const abort = () => {
			aborted = true;
			child.kill("SIGTERM");
		};
		if (options.signal?.aborted) abort();
		else options.signal?.addEventListener("abort", abort, { once: true });
	});

	if (exitCode !== 0 || stopReason === "error" || stopReason === "aborted" || !finalText) {
		const diagnostic = (errorMessage || stderr || `child exit code ${exitCode}`)
			.replaceAll(repositoryRoot, "<project>")
			.slice(0, 2000);
		throw new Error(`THCAD_SUBAGENT_FAILED: ${diagnostic}`);
	}

	const published = await publishEvidence(options.task, finalText);
	return {
		...published,
		durationMs: Date.now() - started,
		toolCallCount,
		turns,
		usage,
		model,
	};
}
