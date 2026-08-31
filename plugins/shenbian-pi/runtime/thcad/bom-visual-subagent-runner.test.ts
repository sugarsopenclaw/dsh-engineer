import assert from "node:assert/strict";
import test from "node:test";

import { bomCloseReadingImageDimensions, prepareBomCloseReadingPlan } from "./bom-close-reading.ts";
import type { ThcadBridgeClient } from "./bridge-client.ts";
import {
	assistantResultText,
	parseBomGroupVisualUnderstanding,
} from "./bom-visual-subagent-runner.ts";

const validResult = {
	schema_version: 1,
	group_id: "serial-annotation-group-028",
	segment_understanding: "19/20/21 共同组成法兰、垫板和加强铁装配。",
	items: [19, 20, 21].map((item) => ({
		item_number: item,
		geometry_mapping: `序号 ${item} 对应几何`,
		current_projection: "当前为平面投影。",
		inferred_other_views: "剖面中表达 BOM 给定的高度与厚度。",
		assembly_role: "局部连接与加强。",
		mechanical_reasoning: "由 BOM、序号共同指向和图形关系推得。",
		evidence_refs: ["image:component-full", "image:component-clean", `bom:item:${item}`],
	})),
	assembly_relations: ["法兰、垫板与加强铁共同连接。"],
	transformer_domain_interpretation: ["该结构用于油箱局部管路接口。"],
	drawing_bom_discrepancies: [],
	extended_reasoning: "可继续核对剖面高度、板厚和螺栓孔。",
} as const;

test("BOM visual parser accepts engineering inference without a confidence field", () => {
	const parsed = parseBomGroupVisualUnderstanding(
		`\`\`\`json\n${JSON.stringify(validResult)}\n\`\`\``,
		"serial-annotation-group-028",
		[19, 20, 21],
	);
	assert.equal(parsed.items.length, 3);
	assert.deepEqual(parsed.items.map((item) => item.item_number), [19, 20, 21]);
	assert.equal("confidence" in parsed, false);
});

test("BOM visual parser requires exact serial-segment coverage", () => {
	assert.throws(
		() => parseBomGroupVisualUnderstanding(
			JSON.stringify({ ...validResult, items: validResult.items.slice(0, 2) }),
			"serial-annotation-group-028",
			[19, 20, 21],
		),
		/items must exactly cover the serial segment/,
	);
});

test("BOM visual parser repairs only a missing root closing brace", () => {
	const complete = JSON.stringify(validResult);
	const parsed = parseBomGroupVisualUnderstanding(
		complete.slice(0, -1),
		"serial-annotation-group-028",
		[19, 20, 21],
	);
	assert.equal(parsed.extended_reasoning, validResult.extended_reasoning);
	assert.throws(
		() => parseBomGroupVisualUnderstanding(complete.slice(0, -2), "serial-annotation-group-028", [19, 20, 21]),
		/incomplete JSON object|invalid JSON/,
	);
});

test("BOM visual child accepts a schema candidate emitted only in reasoning", () => {
	const candidate = JSON.stringify(validResult);
	assert.equal(assistantResultText({
		role: "assistant",
		content: [{ type: "thinking", thinking: candidate }],
	}), candidate);
	assert.deepEqual(
		parseBomGroupVisualUnderstanding(
			assistantResultText({ role: "assistant", content: [{ type: "thinking", thinking: candidate }] }),
			"serial-annotation-group-028",
			[19, 20, 21],
		).items.map((item) => item.item_number),
		[19, 20, 21],
	);
});

test("BOM visual child prefers final text over reasoning", () => {
	assert.equal(assistantResultText({
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "draft" },
			{ type: "text", text: "final" },
		],
	}), "final");
});

test("paired BOM renders use identical bounded dimensions", () => {
	assert.deepEqual(bomCloseReadingImageDimensions([0, 0, 600, 600]), { width: 2048, height: 2048 });
	assert.deepEqual(bomCloseReadingImageDimensions([0, 0, 1200, 600]), { width: 2048, height: 1024 });
});

test("BOM close reading rejects an active drawing that differs from expected_document", async () => {
	const bridge = {
		async invoke() {
			return {
				active_document: { name: "actual.dwg", path: "client-data/actual.dwg", dbmod: 0 },
				current_analysis: null,
			};
		},
	} as unknown as ThcadBridgeClient;
	await assert.rejects(
		prepareBomCloseReadingPlan({ expectedDocument: "client-data/expected.dwg", bridge }),
		(error: unknown) => (error as { code?: string }).code === "DOCUMENT_CHANGED",
	);
});
