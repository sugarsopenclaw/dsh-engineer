const DEFAULT_DEEPSEEK_VISION_MODEL = "deepseek/deepseek-v4-flash-vision-exp";
const DEFAULT_XAI_VISION_MODEL = "xai/grok-4.6";

export const THCAD_DEEPSEEK_VISION_MODEL = process.env.SHENBIAN_THCAD_DEEPSEEK_VISION_MODEL?.trim()
	|| DEFAULT_DEEPSEEK_VISION_MODEL;

export const THCAD_XAI_VISION_MODEL = process.env.SHENBIAN_THCAD_XAI_VISION_MODEL?.trim()
	|| DEFAULT_XAI_VISION_MODEL;

export function resolveThcadVisionModel(parentModel?: string): string {
	const provider = parentModel?.trim().split("/", 1)[0]?.toLocaleLowerCase();
	if (provider === "xai") return THCAD_XAI_VISION_MODEL;
	return THCAD_DEEPSEEK_VISION_MODEL;
}
