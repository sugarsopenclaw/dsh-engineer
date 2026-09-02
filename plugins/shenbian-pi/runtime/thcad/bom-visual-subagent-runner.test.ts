import assert from "node:assert/strict";
import test from "node:test";

import { bomCloseReadingImageDimensions, prepareBomCloseReadingPlan } from "./bom-close-reading.ts";
import type { ThcadBridgeClient } from "./bridge-client.ts";
import {
	assistantResultText,
	parseBomGroupVisualUnderstanding,
} from "./bom-visual-subagent-runner.ts";

const validResult = {
	schema_version: 2,
	group_id: "serial-annotation-group-028",
	segment_observation: "序号 19/20/21 共同指向包含矩形轮廓、同心圆和成组孔的区域。",
	items: [19, 20, 21].map((item) => ({
		item_number: item,
		bom_facts: [`BOM 序号 ${item}`],
		visible_geometry: ["当前图中可见平面几何。"],
		bom_geometry_matches: [`序号 ${item} 的 BOM 数值与可见几何对应。`],
		not_observed: ["BOM 中的厚度未在当前图中直接观察到。"],
		evidence_refs: ["image:component-full", "image:component-clean", `bom:item:${item}`],
	})),
	visible_relations: ["三项由确定性序号拓扑共同指向同一区域。"],
	drawing_bom_discrepancies: [],
	unresolved_observations: ["当前图不能确认厚度方向形态。"],
} as const;

test("BOM visual parser accepts the fact-only v2 contract", () => {
	const parsed = parseBomGroupVisualUnderstanding(
		`\`\`\`json\n${JSON.stringify(validResult)}\n\`\`\``,
		"serial-annotation-group-028",
		[19, 20, 21],
	);
	assert.equal(parsed.items.length, 3);
	assert.deepEqual(parsed.items.map((item) => item.item_number), [19, 20, 21]);
	assert.equal("assembly_role" in parsed.items[0], false);
	assert.equal("mechanical_reasoning" in parsed.items[0], false);
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

test("BOM visual parser rejects the old inference contract", () => {
	assert.throws(
		() => parseBomGroupVisualUnderstanding(
			JSON.stringify({ ...validResult, schema_version: 1 }),
			"serial-annotation-group-028",
			[19, 20, 21],
		),
		/schema, group_id or items/,
	);
});

test("BOM visual parser repairs only a missing root closing brace", () => {
	const complete = JSON.stringify(validResult);
	const parsed = parseBomGroupVisualUnderstanding(
		complete.slice(0, -1),
		"serial-annotation-group-028",
		[19, 20, 21],
	);
	assert.deepEqual(parsed.unresolved_observations, validResult.unresolved_observations);
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
