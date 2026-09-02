import assert from "node:assert/strict";
import test from "node:test";

import {
	resolveThcadVisionModel,
	THCAD_DEEPSEEK_VISION_MODEL,
	THCAD_XAI_VISION_MODEL,
} from "./vision-model-routing.ts";

test("THCAD vision child follows the parent provider", () => {
	assert.equal(resolveThcadVisionModel("deepseek/deepseek-v4-flash"), THCAD_DEEPSEEK_VISION_MODEL);
	assert.equal(resolveThcadVisionModel("xai/grok-4.6"), THCAD_XAI_VISION_MODEL);
	assert.equal(resolveThcadVisionModel(), THCAD_DEEPSEEK_VISION_MODEL);
});
