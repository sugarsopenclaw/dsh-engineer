import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { runThcadSubagent } from "../runtime/thcad/subagent-runner.ts";
import { runThcadVisualOverviewSubagent } from "../runtime/thcad/visual-subagent-runner.ts";
import { runThcadBomCloseReadingSubagent } from "../runtime/thcad/bom-visual-subagent-runner.ts";
import { ThcadBridgeClient } from "../runtime/thcad/bridge-client.ts";
import { serializeCadWork } from "../runtime/thcad/cad-queue.ts";
import { bridgeRoot, toProjectRef } from "../runtime/thcad/paths.ts";
import { textIndexStatus } from "../runtime/thcad/text-index.ts";
import {
	assistantText,
	createReviewRunId,
	type ParentReviewContext,
	ThcadReviewStore,
} from "../runtime/thcad/review-store.ts";
import { TopologySemanticsRecorder } from "../runtime/thcad/topology-semantics.ts";

interface ActiveParentRun extends ParentReviewContext {
	runIds: Set<string>;
	lastMessages?: unknown[];
}

export default function thcadMechanicalExtension(pi: ExtensionAPI): void {
	if (process.env.SHENBIAN_PI_ROLE?.startsWith("thcad-")) return;
	const reviewStore = new ThcadReviewStore();
	const topologyRecorder = new TopologySemanticsRecorder();
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
				const finalText = assistantText(finalMessage);
				if (finalText) {
					const sync = await topologyRecorder.recordParentInterpretation({
						runId,
						content: finalText,
						finalMessage,
						model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : active.model,
						thinkingLevel: ctx.thinkingLevel ?? active.thinkingLevel,
						sessionRef: ctx.sessionManager.getSessionFile()
							? toProjectRef(ctx.sessionManager.getSessionFile() as string)
							: undefined,
					});
					if (sync.errors.length) {
						ctx.ui.notify(
							`拓扑语义后端暂未同步 [${runId}]；本地 outbox 已保留，可用 /thcad-semantic-sync 重放。`,
							"warning",
						);
					}
				}
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
			"child 只使用当前 THCAD 和 .NET 01–21：实体、图框/分区、BOM、技术要求、图层、中心线、标注、尺寸链、图线、块实例、拓扑、视图、表达/身份、轮廓、接口、尺寸绑定、语义快照、跨图关系和 BOM 实例覆盖。",
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

	pi.registerTool({
		name: "delegate_thcad_visual_overview",
		label: "THCAD Visual Overview Subagent",
		description: [
			"按当前 THCAD 的 capability 02 确定性图框生成一张整图 PNG，并委派给隔离的 DeepSeek 视觉子 Agent 判断宏观清晰度。",
			"本工具只回答图像是否足以做整图概览/导航、是否需要后续局部出图；不读取精确尺寸，不形成审图结论。",
			"出图通道只附着 thcad.exe，保存并恢复视图、布局与 DBMOD；视觉 child 无任何工具、无父上下文，固定使用 deepseek-v4-flash-vision-exp。",
			"完成后先读取 host 写入的 evidence.md，再把确定性出图元数据与视觉候选判断分开表达。",
		].join("\n"),
		promptSnippet: "Plot a capability-02 frame and delegate one-image legibility assessment to DeepSeek vision",
		promptGuidelines: [
			"Use delegate_thcad_visual_overview when the user asks for a visual overview or whether the whole THCAD sheet is visually readable.",
			"Treat its legibility assessment as model-derived evidence, while frame bbox, DBMOD, image hash and dimensions are deterministic host facts.",
			"Do not claim that an overview_only image can support exact dimension, BOM, or technical-requirement reading; request later detail captures instead.",
		],
		parameters: Type.Object({
			frame_id: Type.Optional(Type.String({ pattern: "^frame-[1-9][0-9]*$", maxLength: 32 })),
		}, { additionalProperties: false }),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) throw new Error("SUBAGENT_CANCELLED");
			onUpdate?.({ content: [{ type: "text", text: "THCAD 视觉概览子代理已排队…" }], details: { stage: "queued" } });
			const runId = createReviewRunId();
			activeParentRun?.runIds.add(runId);
			const result = await serializeCadWork(() => runThcadVisualOverviewSubagent({
				runId,
				cwd: ctx.cwd,
				frameId: params.frame_id,
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
						"THCAD visual overview evidence pack saved.",
						`Verdict: ${result.assessment.verdict} (confidence=${result.assessment.confidence})`,
						`Overview image: ${result.imageRef}`,
						`Evidence: ${result.evidenceRef}`,
						`Immutable review bundle: ${result.reviewRef} (${result.reviewStatus})`,
						"Read the evidence before answering; keep deterministic plot facts separate from the vision-model assessment.",
					].join("\n"),
				}],
				details: {
					child_run_id: result.runId,
					status: "completed",
					model: result.model,
					duration_ms: result.durationMs,
					turns: result.turns,
					usage: result.usage,
					verdict: result.assessment.verdict,
					confidence: result.assessment.confidence,
					needs_detail_views: result.assessment.needs_detail_views,
					review_status: result.reviewStatus,
					child_session_ref: result.childSessionRef,
					artifact_manifest_ref: result.artifactManifestRef,
					artifact_refs: [result.imageRef, result.evidenceRef, result.reviewRef],
				},
				usage: result.usage,
			};
		},
	});

	pi.registerTool({
		name: "delegate_thcad_bom_close_reading",
		label: "THCAD BOM Component Close Reading",
		description: [
			"按 capability 04 确定性序号段，对 BOM 指向的局部构件做视觉精读。",
			"宿主内部一次性组合 04 BOM/序号段、08 去标注证据、11 块实例世界坐标图元、13 工程视图和 21 同定义实例覆盖；每个序号段同时生成完整图、去干扰图和选中态拓扑。",
			"序号段中的所有 BOM 项已确定共同指向目标；视觉 child 以 BOM 为业务准则，结合机械制图和变压器常识推理当前/其他投影、装配关系与构件作用。",
			"item_numbers 省略时处理当前图中全部可解析 BOM 序号段；指定时只跑包含这些序号的段，便于现场验证。",
			"从项目文字检索跨图路由时传 expected_document；宿主会在刷新和出图前核对活动图，避免同名图或漏激活导致精读错图。该字段不改变 Agent 自主选择检索与审图步骤。",
			"完成后先读 evidence.md；完整输入、两张图、提示词、子会话、原始输出、覆盖账本和 01–21 证据代次均保存在 review bundle，并登记到拓扑语义后端；后端暂不可用时由本地 outbox 保留。",
		].join("\n"),
		promptSnippet: "Close-read BOM components from deterministic serial segments, paired local renders and topology",
		promptGuidelines: [
			"Use delegate_thcad_bom_close_reading when the user asks what BOM-numbered components are, how jointly pointed serial balloons form one assembly segment, or requests visual understanding of all BOM items.",
			"Omit item_numbers for an all-BOM batch. Supply item_numbers only for an explicit subset or a focused test; one member selects its whole connected serial segment.",
			"When routing a project-search hit, pass its drawing ref as expected_document so the delegated run fails fast if another drawing is active.",
			"After completion, read evidence_ref before answering. Keep deterministic BOM/serial/geometry evidence distinct from the vision model's mechanical interpretation, without inventing confidence downgrades.",
		],
		parameters: Type.Object({
			expected_document: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
			item_numbers: Type.Optional(Type.Array(
				Type.Integer({ minimum: 1, maximum: 1_000_000 }),
				{ minItems: 1, maxItems: 500, uniqueItems: true },
			)),
		}, { additionalProperties: false }),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) throw new Error("SUBAGENT_CANCELLED");
			onUpdate?.({ content: [{ type: "text", text: "THCAD BOM 构件精读已排队…" }], details: { stage: "queued" } });
			const runId = createReviewRunId();
			activeParentRun?.runIds.add(runId);
			const result = await serializeCadWork(() => runThcadBomCloseReadingSubagent({
				runId,
				cwd: ctx.cwd,
				itemNumbers: params.item_numbers,
				expectedDocument: params.expected_document,
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
			const completed = result.groups.filter((group) => group.status === "completed").length;
			const failed = result.groups.length - completed;
			return {
				content: [{
					type: "text",
					text: [
						"THCAD BOM component close-reading evidence pack saved.",
						`Segments: ${completed}/${result.groups.length} completed${failed ? `, ${failed} failed` : ""}.`,
						`Evidence: ${result.evidenceRef}`,
						`Structured results: ${result.batchResultRef}`,
						`Coverage ledger: ${result.coverageRef}`,
						`Immutable review bundle: ${result.reviewRef} (${result.reviewStatus})`,
						"Read the evidence before answering; BOM/serial/topology are deterministic inputs and component interpretation is model-derived.",
					].join("\n"),
				}],
				details: {
					child_run_id: result.runId,
					status: failed ? "partial" : "completed",
					model: result.model,
					duration_ms: result.durationMs,
					turns: result.turns,
					usage: result.usage,
					segment_count: result.groups.length,
					completed_segment_count: completed,
					failed_segment_count: failed,
					review_status: result.reviewStatus,
					artifact_manifest_ref: result.artifactManifestRef,
					artifact_refs: [result.evidenceRef, result.batchResultRef, result.coverageRef, result.reviewRef],
					semantic_sync: result.semanticSync,
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

	pi.registerCommand("thcad-semantic-sync", {
		description: "重放本机 THCAD 拓扑语义 outbox 到 backend",
		handler: async (_args, ctx) => {
			const results = await topologyRecorder.flushPending();
			const sent = results.reduce((sum, item) => sum + item.sent, 0);
			const pending = results.reduce((sum, item) => sum + item.pending, 0);
			const errors = results.flatMap((item) => item.errors);
			ctx.ui.notify(
				errors.length
					? `拓扑语义同步：发送 ${sent}，仍待处理 ${pending}；${errors[0]}`
					: `拓扑语义同步完成：发送 ${sent}，待处理 ${pending}。`,
				errors.length ? "warning" : "info",
			);
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
				const { status, index } = await serializeCadWork(async () => ({
					status: await bridge.invoke("status", {}, { timeoutSeconds: 30 }),
					index: await textIndexStatus(),
				}));
				const active = status.active_document as Record<string, unknown> | undefined;
				const indexState = !index.exists
					? "未构建"
					: index.fresh
						? `${index.drawing_count} 图/已新鲜`
						: `${index.drawing_count} 图/${index.stale_count} 过期/${index.missing_count} 源缺失/${index.unindexed_count} 未索引`;
				ctx.ui.notify(
					`THCAD 已连接：${String(active?.name ?? "未知图纸")} · DBMOD=${String(active?.dbmod ?? "?")} · 01–21 Host 可用 · 文字索引${indexState}`,
					"info",
				);
			} catch (error) {
				const value = error as { code?: string; message?: string };
				ctx.ui.notify(`${value.code ?? "THCAD_DOCTOR_FAILED"}: ${value.message ?? String(error)}`, "error");
			}
		},
	});
}
