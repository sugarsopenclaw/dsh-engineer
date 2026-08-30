import assert from "node:assert/strict";
import test from "node:test";

import { parseFrameOverviewPlot } from "./frame-overview.ts";
import { parseVisualOverviewAssessment } from "./visual-subagent-runner.ts";

const validAssessment = {
	schema_version: 1,
	verdict: "overview_only",
	image_is_cad: true,
	overall_structure_readable: true,
	major_labels_readable: true,
	small_annotations_readable: false,
	needs_detail_views: true,
	confidence: 0.94,
	observations: ["整图布局可辨"],
	issues: ["尺寸文字过小"],
	recommended_next_step: "按工程视图区生成局部图。",
} as const;

test("visual assessment accepts a fenced strict overview verdict", () => {
	const assessment = parseVisualOverviewAssessment(`\n\`\`\`json\n${JSON.stringify(validAssessment)}\n\`\`\`\n`);
	assert.equal(assessment.verdict, "overview_only");
	assert.equal(assessment.needs_detail_views, true);
	assert.equal(assessment.confidence, 0.94);
});

test("visual assessment rejects inconsistent or unbounded output", () => {
	assert.throws(
		() => parseVisualOverviewAssessment(JSON.stringify({
			...validAssessment,
			verdict: "unreadable",
			overall_structure_readable: true,
		})),
		/INVALID_VISUAL_ASSESSMENT: inconsistent verdict/,
	);
	assert.throws(
		() => parseVisualOverviewAssessment(JSON.stringify({
			...validAssessment,
			confidence: 1.1,
		})),
		/INVALID_VISUAL_ASSESSMENT: confidence/,
	);
});

test("frame overview parser enforces deterministic provenance and DBMOD", () => {
	const validPlot = {
		document_name: "sample.dwg",
		analysis_id: "analysis-1",
		source_capability: 2,
		frame_id: "frame-1",
		frame_bbox: [0, 0, 16120, 11480],
		plot_bbox: [-80.6, -57.4, 16200.6, 11537.4],
		image_ref: "visual/test/frame-overview.png",
		media_type: "image/png",
		bytes: 403855,
		sha256: "a".repeat(64),
		width: 1372,
		height: 798,
		pixel_count: 1094856,
		ink_ratio: 0.189357,
		content_bbox: [0, 0, 1371, 797],
		capture_strategy: "thcad_pngout_frame_window",
		color_mode: "current_model_space_display",
		dbmod_before: 21,
		dbmod_after: 21,
		dwg_modified: false,
		warnings: [],
	};
	const parsed = parseFrameOverviewPlot(validPlot);
	assert.equal(parsed.frame_id, "frame-1");
	assert.equal(parsed.dwg_modified, false);
	assert.throws(
		() => parseFrameOverviewPlot({ ...validPlot, dbmod_after: 22, dwg_modified: true }),
		/INVALID_PLOT_RESULT/,
	);
});
