import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { ThcadArtifactStore } from "./thcad/artifact-store.ts";
import { ThcadBridgeClient } from "./thcad/bridge-client.ts";
import { catalogForModel } from "./thcad/capability-catalog.ts";
import { ThcadProjectGraph } from "./thcad/project-graph.ts";
import { toolFailure, toolSuccess } from "./thcad/tool-result.ts";

const sessionActions = ["status", "refresh_analysis", "locate_handles"] as const;
const analysisActions = ["catalog", "summary", "query"] as const;
const graphActions = ["build", "summary", "query"] as const;
const matchModes = ["all", "any"] as const;

export default function thcadChildExtension(pi: ExtensionAPI): void {
	const bridge = new ThcadBridgeClient();
	const artifacts = new ThcadArtifactStore();
	const projectGraph = new ThcadProjectGraph(artifacts);

	pi.registerTool({
		name: "thcad_session",
		label: "THCAD Session",
		description: [
			"访问已经运行的 THCAD 当前会话。status 读取活动图与现有分析；refresh_analysis 在 THCAD .NET 主线程完整运行 01–21；locate_handles 只设置选择集并可缩放。",
			"本工具不启动、关闭、保存或修改图纸。只有委派任务明确要求在 THCAD 中定位/显示时才调用 locate_handles。",
		].join("\n"),
		promptSnippet: "Read current THCAD status, refresh 01-21, or locate evidence handles",
		promptGuidelines: [
			"Use thcad_session status before refreshing; do not repeat refresh_analysis when current artifacts match the active drawing.",
			"Use thcad_session locate_handles only when the delegated task explicitly requests visible positioning in THCAD.",
		],
		parameters: Type.Object({
			action: StringEnum(sessionActions),
			expected_document: Type.Optional(Type.String({ maxLength: 260 })),
			handles: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 18 }), { minItems: 1, maxItems: 50 })),
			zoom: Type.Optional(Type.Boolean({ default: true })),
		}, { additionalProperties: false }),
		async execute(_toolCallId, params, signal, onUpdate) {
			try {
				if (params.action === "status") {
					return toolSuccess({ operation: "status", data: await bridge.invoke("status", {}, { signal, timeoutSeconds: 30 }) });
				}
				if (params.action === "refresh_analysis") {
					onUpdate?.({ content: [{ type: "text", text: "THCAD 正在运行 01–21，只读分析可能需要一些时间…" }], details: { stage: "extracting" } });
					return toolSuccess({
						operation: "refresh_analysis",
						data: await bridge.invoke(
							"extract_current",
							params.expected_document ? { expected_document: params.expected_document } : {},
							{ signal, timeoutSeconds: 1200 },
						),
					});
				}
				if (!params.handles?.length) throw new Error("INVALID_ARGUMENT: locate_handles requires handles");
				return toolSuccess({
					operation: "locate_handles",
					data: await bridge.invoke(
						"locate_handles",
						{
							handles: params.handles,
							zoom: params.zoom ?? true,
							...(params.expected_document ? { expected_document: params.expected_document } : {}),
						},
						{ signal, timeoutSeconds: 60 },
					),
				});
			} catch (error) {
				return toolFailure(error);
			}
		},
	});

	pi.registerTool({
		name: "thcad_analysis",
		label: "THCAD Analysis 01-21",
		description: [
			"读取 THCAD .NET 01–21 artifact。catalog 列能力；summary 返回报告计数和有界 Markdown；query 用 JSON path 或关键词返回有界证据。",
			"query 的 exact JSON path 优先；关键词搜索会返回命中路径、字面值和有界父对象。结果状态为 possible/ambiguous/unsupported_partial 时必须保留原口径。",
		].join("\n"),
		promptSnippet: "Catalog, summarize, and query deterministic THCAD analyses 01-21",
		promptGuidelines: [
			"Use thcad_analysis summary before broad queries, then query only the capability and fields needed by the delegated task.",
			"Cite thcad_analysis capability id, artifact_ref, JSON path, and handles; never upgrade candidates into proven engineering facts.",
		],
		parameters: Type.Object({
			action: StringEnum(analysisActions),
			capability: Type.Optional(Type.Integer({ minimum: 1, maximum: 21 })),
			json_path: Type.Optional(Type.String({ maxLength: 1000 })),
			terms: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: 8 })),
			match_mode: Type.Optional(StringEnum(matchModes)),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
			max_chars: Type.Optional(Type.Integer({ minimum: 1000, maximum: 50_000, default: 30_000 })),
		}, { additionalProperties: false }),
		async execute(_toolCallId, params) {
			try {
				if (params.action === "catalog") return toolSuccess({ capabilities: catalogForModel() });
				if (!params.capability) throw new Error("INVALID_ARGUMENT: capability is required for summary/query");
				if (params.action === "summary") {
					return toolSuccess(await artifacts.summary(params.capability, params.max_chars ?? 20_000));
				}
				return toolSuccess(await artifacts.query(params.capability, {
					jsonPath: params.json_path,
					terms: params.terms,
					matchMode: params.match_mode,
					limit: params.limit,
					maxChars: params.max_chars,
				}));
			} catch (error) {
				return toolFailure(error);
			}
		},
	});

	pi.registerTool({
		name: "thcad_project_graph",
		label: "THCAD Cross-Drawing Graph",
		description: "构建或查询 20 的多图项目关系图。只消费 Bridge artifact 根中已经抽取的 cross-drawing observation，不读取或修改 DWG。",
		promptSnippet: "Build or query capability 20 across already-extracted drawings",
		parameters: Type.Object({
			action: StringEnum(graphActions),
			json_path: Type.Optional(Type.String({ maxLength: 1000 })),
			terms: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: 8 })),
			match_mode: Type.Optional(StringEnum(matchModes)),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
			max_chars: Type.Optional(Type.Integer({ minimum: 1000, maximum: 50_000, default: 30_000 })),
		}, { additionalProperties: false }),
		async execute(_toolCallId, params, signal, onUpdate) {
			try {
				if (params.action === "build") {
					onUpdate?.({ content: [{ type: "text", text: "正在离线汇聚 capability 20 项目图…" }], details: { stage: "building_project_graph" } });
					return toolSuccess(await projectGraph.build(signal));
				}
				if (params.action === "summary") return toolSuccess(await projectGraph.summary());
				return toolSuccess(await projectGraph.query({
					jsonPath: params.json_path,
					terms: params.terms,
					matchMode: params.match_mode,
					limit: params.limit,
					maxChars: params.max_chars,
				}));
			} catch (error) {
				return toolFailure(error);
			}
		},
	});
}
