import path from "node:path";

import {
	VERSION,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const STATUS_KEY = "shenbian-runtime";
const WIDGET_KEY = "shenbian-scope";

function statusText(theme: Theme, label: string, active = false): string {
	const marker = theme.fg(active ? "accent" : "success", active ? "●" : "✓");
	return `${marker}${theme.fg("dim", ` 沈变 · ${label}`)}`;
}

function applyProductUi(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;

	ctx.ui.setTitle("沈变图纸审查 · Pi");
	ctx.ui.setHeader((_tui, theme) => ({
		render(width: number): string[] {
			const project = path.basename(ctx.cwd);
			const title = `${theme.fg("accent", "◆ 沈变图纸审查")} ${theme.fg("dim", `Pi v${VERSION}`)}`;
			const scope = theme.fg("muted", `项目 ${project} · 本地 Agent / THCAD 主循环`);
			const hint = theme.fg("dim", "输入 /shenbian-status 查看运行基线，/shenbian-ui 切换产品界面");
			return [
				"",
				truncateToWidth(title, width),
				truncateToWidth(scope, width),
				truncateToWidth(hint, width),
				"",
			];
		},
		invalidate() {},
	}));

	const theme = ctx.ui.theme;
	ctx.ui.setStatus(STATUS_KEY, statusText(theme, "就绪"));
	ctx.ui.setWidget(
		WIDGET_KEY,
		[
			theme.fg(
				"dim",
				"阶段：THCAD 机械子代理已接入 · /thcad-doctor 检查本机链路",
			),
		],
		{ placement: "belowEditor" },
	);
}

function clearProductUi(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;
	ctx.ui.setHeader(undefined);
	ctx.ui.setStatus(STATUS_KEY, undefined);
	ctx.ui.setWidget(WIDGET_KEY, undefined);
	ctx.ui.setTitle("Pi");
}

export default function shenbianTuiExtension(pi: ExtensionAPI): void {
	let enabled = true;
	let turnCount = 0;

	pi.on("session_start", (_event, ctx) => {
		turnCount = 0;
		if (enabled) applyProductUi(ctx);
	});

	pi.on("turn_start", (_event, ctx) => {
		if (!enabled || ctx.mode !== "tui") return;
		turnCount += 1;
		ctx.ui.setStatus(STATUS_KEY, statusText(ctx.ui.theme, `第 ${turnCount} 轮处理中`, true));
	});

	pi.on("turn_end", (_event, ctx) => {
		if (!enabled || ctx.mode !== "tui") return;
		ctx.ui.setStatus(STATUS_KEY, statusText(ctx.ui.theme, `第 ${turnCount} 轮完成`));
	});

	pi.on("session_shutdown", (_event, ctx) => {
		clearProductUi(ctx);
	});

	pi.registerCommand("shenbian-status", {
		description: "显示沈变 Pi 运行基线",
		handler: async (_args, ctx) => {
			const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "未选择";
			const session = ctx.sessionManager.getSessionFile() ? "已持久化" : "临时会话";
			const trust = ctx.isProjectTrusted() ? "已信任" : "未信任";
			ctx.ui.notify(
				`沈变 Pi v${VERSION} · ${model} · ${session} · 项目${trust}`,
				"info",
			);
		},
	});

	pi.registerCommand("shenbian-ui", {
		description: "切换沈变 TUI 与 Pi 原生界面",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				applyProductUi(ctx);
				ctx.ui.notify("沈变 TUI 已启用", "info");
			} else {
				clearProductUi(ctx);
				ctx.ui.notify("已恢复 Pi 原生界面", "info");
			}
		},
	});
}
