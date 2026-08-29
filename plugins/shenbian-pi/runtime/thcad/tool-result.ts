export function toolText(value: unknown): string {
	const text = JSON.stringify(value, null, 2);
	return text.length <= 50_000 ? text : `${text.slice(0, 50_000)}\n… tool result truncated`;
}

export function toolFailure(error: unknown): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
	const value = error as { code?: string; message?: string };
	const message = (value.message ?? String(error)).slice(0, 2000);
	const code = value.code ?? message.match(/^([A-Z][A-Z0-9_]+):/)?.[1] ?? "THCAD_TOOL_FAILED";
	return {
		content: [{ type: "text", text: toolText({ ok: false, error: { code, message } }) }],
		details: { ok: false, error_code: code },
	};
}
export function toolSuccess(value: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text: toolText({ ok: true, ...value }) }],
		details: { ok: true, ...value },
	};
}
