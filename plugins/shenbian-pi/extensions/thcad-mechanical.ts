import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { runThcadSubagent } from "../runtime/thcad/subagent-runner.ts";
import { ThcadBridgeClient } from "../runtime/thcad/bridge-client.ts";
import { bridgeRoot, toProjectRef } from "../runtime/thcad/paths.ts";
import {
	createReviewRunId,
	type ParentReviewContext,
	ThcadReviewStore,
} from "../runtime/thcad/review-store.ts";

let cadQueue: Promise<void> = Promise.resolve();

interface ActiveParentRun extends ParentReviewContext {
	runIds: Set<string>;
	lastMessages?: unknown[];
}

function serializeCadWork<T>(work: () => Promise<T>): Promise<T> {
	const result = cadQueue.then(work, work);
	cadQueue = result.then(() => undefined, () => undefined);
	return result;
}

export default function thcadMechanicalExtension(pi: ExtensionAPI): void {
	if (process.env.SHENBIAN_PI_ROLE === "thcad-mechanical") return;
	const reviewStore = new ThcadReviewStore();
	const finalizedRuns = new Set<string>();
	let activeParentRun: ActiveParentRun | undefined;

	const finalizeParentRun = async (
		status: "completed" | "interrupted",
		ctx: ExtensionContext,
	): Promise<void> => {
		const active = activeParentRun;
		activeParentRun = undefined;
		if (!active?.runIds.size) return;
		const finalMessage = [...(active.lastMessages ?? [])].reverse().find((message) => (
			Boolean(message)
			&& typeof message === "object"
			&& (message as { role?: unknown }).role === "assistant"
		));
		for (const runId of active.runIds) {
			if (finalizedRuns.has(runId)) continue;
			try {
				await reviewStore.finalizeParent(runId, {
					status,
					finishedAtUtc: new Date().toISOString(),
					model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : active.model,
					thinkingLevel: ctx.thinkingLevel ?? active.thinkingLevel,
					finalMessage,
					messageCount: active.lastMessages?.length,
					sessionId: ctx.sessionManager.getSessionId(),
					sessionFile: ctx.sessionManager.getSessionFile(),
				});
				finalizedRuns.add(runId);
			} catch (error) {
				ctx.ui.notify(`THCAD review bundle 收尾失败 [${runId}]：${String(error)}`, "warning");
			}
		}
	};

	pi.on("before_agent_start", async (event, ctx) => {
		if (activeParentRun?.runIds.size) await finalizeParentRun("interrupted", ctx);
		activeParentRun = {
			runIds: new Set<string>(),
			sessionId: ctx.sessionManager.getSessionId(),
			sessionFile: ctx.sessionManager.getSessionFile(),
			prompt: event.prompt,
			systemPrompt: event.systemPrompt,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			thinkingLevel: ctx.thinkingLevel,
			images: event.images,
		};
	});

	pi.on("agent_end", (event) => {
		if (activeParentRun) activeParentRun.lastMessages = event.messages;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		await finalizeParentRun("completed", ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await finalizeParentRun("interrupted", ctx);
	});

	pi.registerTool({
		name: "delegate_thcad_mechanical",
		label: "THCAD Mechanical Subagent",
		description: [
			"把一项自包含的沈变机械图纸取证任务委派给隔离的 THCAD 子 Agent。",
			"child 只使用当前 THCAD 和 .NET 01–20：实体、图框/分区、BOM、技术要求、图层、中心线、标注、尺寸链、图线、块实例、拓扑、视图、表达/身份、轮廓、接口、尺寸绑定、语义快照和跨图关系。",
			"task 必须写清目标、区域/构件/编号、需要的字段，以及用户是否明确要求在 THCAD 中选择/缩放定位。child 不继承父对话，也不形成最终用户答案。",
			"不要要求 child 创建、写入或只返回 evidence/artifact 路径；child 必须返回证据正文，evidence 文件和不可变 review bundle 由宿主创建。",
			"完成后只返回 host 写入的 evidence.md 相对路径和安全用量；必须先用 read 读取 evidence，再由主 Agent 区分确定事实、派生候选和限制并回答。",
		].join("\n"),
		promptSnippet: "Delegate deterministic THCAD mechanical evidence collection to an isolated child",
		promptGuidelines: [
			"Use delegate_thcad_mechanical for questions about the active THCAD drawing, its entities, annotations, dimensions, topology, views, interfaces, or cross-drawing relations.",
			"After delegate_thcad_mechanical completes, read its evidence_ref before answering; the child evidence is not the final business conclusion.",
			"Never instruct the child to create or return an evidence path. The host persists paths; the child must summarize actual tool evidence.",
		],
		parameters: Type.Object({
			task: Type.String({ minLength: 1, maxLength: 12_000 }),
		}, { additionalProperties: false }),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) throw new Error("SUBAGENT_CANCELLED");
			onUpdate?.({ content: [{ type: "text", text: "THCAD 机械子代理已排队…" }], details: { stage: "queued" } });
			const runId = createReviewRunId();
			activeParentRun?.runIds.add(runId);
			const result = await serializeCadWork(() => runThcadSubagent({
				runId,
				task: params.task.trim(),
				cwd: ctx.cwd,
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
				thinkingLevel: pi.getThinkingLevel(),
				signal,
				onProgress: (text) => onUpdate?.({ content: [{ type: "text", text }], details: { stage: "running" } }),
				parent: {
					sessionId: ctx.sessionManager.getSessionId(),
					sessionFile: ctx.sessionManager.getSessionFile(),
					toolCallId,
					prompt: activeParentRun?.prompt,
					systemPrompt: activeParentRun?.systemPrompt,
					model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
					thinkingLevel: ctx.thinkingLevel,
					images: activeParentRun?.images,
				},
			}));
			return {
				content: [{
					type: "text",
					text: [
						"THCAD mechanical evidence pack saved.",
						`Project-relative path: ${result.evidenceRef}`,
						`Immutable review bundle: ${result.reviewRef} (${result.reviewStatus})`,
						"Read this evidence file before answering. The child collected evidence and did not produce the user-facing conclusion.",
					].join("\n"),
				}],
				details: {
					child_run_id: result.runId,
					status: "completed",
					model: result.model,
					duration_ms: result.durationMs,
					tool_call_count: result.toolCallCount,
					turns: result.turns,
					usage: result.usage,
					review_status: result.reviewStatus,
					child_session_ref: result.childSessionRef,
					artifact_manifest_ref: result.artifactManifestRef,
					artifact_refs: [result.evidenceRef, result.reviewRef],
				},
				usage: result.usage,
			};
		},
	});

	pi.registerCommand("thcad-reviews", {
		description: "列出或校验本机 THCAD review bundle",
		handler: async (args, ctx) => {
			const [action, runId] = args.trim().split(/\s+/, 2);
			if (action === "verify" && runId) {
				const verification = await reviewStore.verifyRun(runId);
				ctx.ui.notify(
					verification.ok
						? `Review 校验通过：${runId} · bundle ${verification.bundle_files_checked} 文件 · CAS ${verification.artifact_objects_checked} 对象`
						: `Review 校验失败：${runId} · ${verification.problems.slice(0, 3).join("；")}`,
					verification.ok ? "info" : "error",
				);
				return;
			}
			const runs = await reviewStore.listRuns(5);
			if (!runs.length) {
				ctx.ui.notify("尚无 THCAD review bundle。", "info");
				return;
			}
			ctx.ui.notify(runs.map((run) => (
				`${run.review_complete ? "✓" : "…"} ${run.run_id} · child=${run.child_status ?? "?"} · artifact=${run.artifact_status ?? "?"}`
			)).join("\n"), "info");
		},
	});

	pi.registerCommand("thcad-doctor", {
		description: "检查 THCAD .NET Bridge 与活动图（只读）",
		handler: async (_args, ctx) => {
			const bridge = new ThcadBridgeClient();
			if (!(await bridge.isBuilt())) {
				ctx.ui.notify("Bridge 未构建；先运行 .\\scripts\\build-thcad-agent-bridge.ps1", "warning");
				return;
			}
			ctx.ui.notify(`Bridge 已构建；作业目录 ${toProjectRef(bridgeRoot)}，正在检查活动 THCAD…`, "info");
			try {
				const status = await bridge.invoke("status", {}, { timeoutSeconds: 30 });
				const active = status.active_document as Record<string, unknown> | undefined;
				ctx.ui.notify(
					`THCAD 已连接：${String(active?.name ?? "未知图纸")} · DBMOD=${String(active?.dbmod ?? "?")} · 01–20 Host 可用`,
					"info",
				);
			} catch (error) {
				const value = error as { code?: string; message?: string };
				ctx.ui.notify(`${value.code ?? "THCAD_DOCTOR_FAILED"}: ${value.message ?? String(error)}`, "error");
			}
		},
	});
}
