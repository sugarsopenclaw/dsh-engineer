import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { serializeCadWork } from "../runtime/thcad/cad-queue.ts";
import { executeThcadAppAction } from "../runtime/thcad/documents.ts";
import {
	buildTextIndex,
	searchTextIndex,
	textIndexStatus,
} from "../runtime/thcad/text-index.ts";

function jsonText(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export default function thcadProjectExtension(pi: ExtensionAPI): void {
	if (process.env.SHENBIAN_PI_ROLE?.startsWith("thcad-")) return;

	pi.registerTool({
		name: "thcad_app",
		label: "THCAD Drawing Session",
		description: [
			"管理当前 THCAD 的图纸会话：状态/列表、打开、激活、关闭、复制到工作区和保存工作区副本。",
			"client-data 下的客户原图在本工具新打开时无论参数如何都强制只读；若用户早已将同一原图可写打开，open 明确报告冲突，分析时可改用 activate，编辑仍须先复制到工作区。任何复制或保存只允许落到 .pi/runtime/thcad-workspace。",
			"close 遇到 dirty 图纸时默认拒绝，只有用户明确允许丢弃修改后才传 discard_changes=true；本工具永不替用户隐式保存。",
			"copy_to_workspace 默认复制磁盘已保存版本；只有明确需要捕获当前会话态时才用 from_session=true，此时调用受保护的 save-as。",
		].join("\n"),
		promptSnippet: "Inspect or manage THCAD documents within strict client-data read-only and workspace-write boundaries",
		promptGuidelines: [
			"Use status/list before multi-drawing work, open client drawings read-only, then activate exactly one hit before calling drawing-specific tools.",
			"Never close a dirty drawing unless the user explicitly asked to discard its changes.",
			"Use copy_to_workspace before any future editing workflow; save only documents already inside the workspace.",
		],
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("status"),
				Type.Literal("list"),
				Type.Literal("open"),
				Type.Literal("activate"),
				Type.Literal("close"),
				Type.Literal("copy_to_workspace"),
				Type.Literal("save"),
			]),
			path: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
			name: Type.Optional(Type.String({ minLength: 1, maxLength: 260 })),
			read_only: Type.Optional(Type.Boolean()),
			discard_changes: Type.Optional(Type.Boolean()),
			from_session: Type.Optional(Type.Boolean()),
			target_name: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
		}, { additionalProperties: false }),
		async execute(_toolCallId, params, signal, onUpdate) {
			if (signal?.aborted) throw new Error("SUBAGENT_CANCELLED");
			onUpdate?.({ content: [{ type: "text", text: `THCAD 图纸会话操作 ${params.action} 已排队…` }], details: { stage: "queued" } });
			const result = await serializeCadWork(() => executeThcadAppAction(params, { signal }));
			return {
				content: [{ type: "text", text: jsonText(result) }],
				details: { action: params.action, result },
			};
		},
	});

	pi.registerTool({
		name: "thcad_project_texts",
		label: "THCAD Project Text Index",
		description: [
			"构建、检查或检索项目级 DWG 文字索引。索引来自 THCAD .NET side-DB，只读扫描客户图和工作区图，不打开编辑器窗口。",
			"build 以 sha256 增量更新；search 做 Unicode/大小写/空白归一化包含匹配，也可显式 regex，并可按 source/layer/drawing 过滤。",
			"命中按图分组，BOM 行直接带 item_number、代号、名称、数量等字段，可用于后续精读路由。",
			"审图路由配方：先 search 业务词（例如“法兰”）→ 从 bom_row 命中取得 drawing 和 bom_item_number → 用 thcad_app open/activate → 调 delegate_thcad_bom_close_reading(expected_document=drawing, item_numbers) → 跨图汇总各 Review 证据包。",
		].join("\n"),
		promptSnippet: "Build or search a bounded project-wide THCAD text/BOM index and route hits into drawing-specific review",
		promptGuidelines: [
			"For a project-level component review, build or check freshness first, then search the component term and prefer bom_row hits with item numbers.",
			"Do not dump the whole index into context; use bounded search filters and activate one drawing at a time before close reading.",
			"Treat an open_dirty_at_scan hit as disk-state text evidence; drawing-specific .NET refresh after activation is authoritative for the live session.",
		],
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("build"),
				Type.Literal("status"),
				Type.Literal("search"),
			]),
			query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
			regex: Type.Optional(Type.Boolean()),
			sources: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 30, uniqueItems: true })),
			layers: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 30, uniqueItems: true })),
			drawings: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 100, uniqueItems: true })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
		}, { additionalProperties: false }),
		async execute(_toolCallId, params, signal, onUpdate) {
			if (signal?.aborted) throw new Error("SUBAGENT_CANCELLED");
			let result: unknown;
			if (params.action === "build") {
				onUpdate?.({ content: [{ type: "text", text: "THCAD 项目文字索引正在增量构建…" }], details: { stage: "building" } });
				result = await serializeCadWork(() => buildTextIndex({ signal }));
			} else if (params.action === "status") {
				result = await textIndexStatus();
			} else {
				if (!params.query?.trim()) throw new Error("INVALID_QUERY: search action requires query");
				result = await searchTextIndex({
					query: params.query,
					regex: params.regex,
					sources: params.sources,
					layers: params.layers,
					drawings: params.drawings,
					limit: params.limit,
				});
			}
			return {
				content: [{ type: "text", text: jsonText(result) }],
				details: { action: params.action, result },
			};
		},
	});
}
