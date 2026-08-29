import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { runThcadSubagent } from "../runtime/thcad/subagent-runner.ts";
import { ThcadBridgeClient } from "../runtime/thcad/bridge-client.ts";
import { bridgeRoot, toProjectRef } from "../runtime/thcad/paths.ts";

let cadQueue: Promise<void> = Promise.resolve();

function serializeCadWork<T>(work: () => Promise<T>): Promise<T> {
	const result = cadQueue.then(work, work);
	cadQueue = result.then(() => undefined, () => undefined);
	return result;
}

export default function thcadMechanicalExtension(pi: ExtensionAPI): void {
	if (process.env.SHENBIAN_PI_ROLE === "thcad-mechanical") return;

	pi.registerTool({
		name: "delegate_thcad_mechanical",
		label: "THCAD Mechanical Subagent",
		description: [
			"把一项自包含的沈变机械图纸取证任务委派给隔离的 THCAD 子 Agent。",
			"child 只使用当前 THCAD 和 .NET 01–20：实体、图框/分区、BOM、技术要求、图层、中心线、标注、尺寸链、图线、块实例、拓扑、视图、表达/身份、轮廓、接口、尺寸绑定、语义快照和跨图关系。",
			"task 必须写清目标、区域/构件/编号、需要的字段，以及用户是否明确要求在 THCAD 中选择/缩放定位。child 不继承父对话，也不形成最终用户答案。",
			"完成后只返回 host 写入的 evidence.md 相对路径和安全用量；必须先用 read 读取 evidence，再由主 Agent 区分确定事实、派生候选和限制并回答。",
		].join("\n"),
		promptSnippet: "Delegate deterministic THCAD mechanical evidence collection to an isolated child",
		promptGuidelines: [
			"Use delegate_thcad_mechanical for questions about the active THCAD drawing, its entities, annotations, dimensions, topology, views, interfaces, or cross-drawing relations.",
			"After delegate_thcad_mechanical completes, read its evidence_ref before answering; the child evidence is not the final business conclusion.",
		],
		parameters: Type.Object({
			task: Type.String({ minLength: 1, maxLength: 12_000 }),
		}, { additionalProperties: false }),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) throw new Error("SUBAGENT_CANCELLED");
			onUpdate?.({ content: [{ type: "text", text: "THCAD 机械子代理已排队…" }], details: { stage: "queued" } });
			const result = await serializeCadWork(() => runThcadSubagent({
				task: params.task.trim(),
				cwd: ctx.cwd,
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
				thinkingLevel: pi.getThinkingLevel(),
				signal,
				onProgress: (text) => onUpdate?.({ content: [{ type: "text", text }], details: { stage: "running" } }),
			}));
			return {
				content: [{
					type: "text",
					text: [
						"THCAD mechanical evidence pack saved.",
						`Project-relative path: ${result.evidenceRef}`,
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
					artifact_refs: [result.evidenceRef],
				},
				usage: result.usage,
			};
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
