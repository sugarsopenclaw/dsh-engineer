import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ThcadBridgeClient, ThcadBridgeError } from "./bridge-client.ts";
import {
	bridgeRoot,
	plotFrameOverviewScript,
	repositoryRoot,
	resolveInside,
	toProjectRef,
} from "./paths.ts";

const execFileAsync = promisify(execFile);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_EDGE = 4096;
const MAX_IMAGE_PIXELS = 4096 * 4096;

export interface FrameOverviewPlot {
	document_name: string;
	analysis_id: string;
	source_capability: 2;
	frame_id: string;
	frame_bbox: [number, number, number, number];
	plot_bbox: [number, number, number, number];
	image_ref: string;
	media_type: "image/png";
	bytes: number;
	sha256: string;
	width: number;
	height: number;
	pixel_count: number;
	ink_ratio: number;
	content_bbox: [number, number, number, number];
	capture_strategy: "thcad_pngout_frame_window";
	color_mode: "current_model_space_display";
	dbmod_before: number;
	dbmod_after: number;
	dwg_modified: false;
	warnings: string[];
}

export interface CapturedFrameOverview {
	plot: FrameOverviewPlot;
	imagePath: string;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function stableError(error: unknown): ThcadBridgeError {
	if (error instanceof ThcadBridgeError) return error;
	const value = error as { stderr?: string; stdout?: string; message?: string; code?: string };
	const text = `${value.stderr ?? ""}\n${value.stdout ?? ""}\n${value.message ?? ""}`.trim();
	const code = text.match(/\b([A-Z][A-Z0-9_]{2,})\s*:/)?.[1]
		?? (value.code === "ABORT_ERR" ? "SUBAGENT_CANCELLED" : "THCAD_FRAME_PLOT_FAILED");
	const safe = text
		.replaceAll(repositoryRoot, "<project>")
		.replace(/[A-Za-z]:\\[^\r\n]+/g, "<local-path>")
		.slice(0, 2000);
	return new ThcadBridgeError(code, safe || "THCAD frame overview capture failed.");
}

function asTuple(value: unknown, field: string): [number, number, number, number] {
	if (!Array.isArray(value) || value.length !== 4) throw new Error(`INVALID_PLOT_RESULT: ${field}`);
	const numbers = value.map(Number);
	if (numbers.some((item) => !Number.isFinite(item))) throw new Error(`INVALID_PLOT_RESULT: ${field}`);
	return numbers as [number, number, number, number];
}

export function parseFrameOverviewPlot(value: unknown): FrameOverviewPlot {
	const raw = record(value);
	const string = (key: string): string => {
		if (typeof raw[key] !== "string" || !String(raw[key]).trim()) throw new Error(`INVALID_PLOT_RESULT: ${key}`);
		return String(raw[key]);
	};
	const number = (key: string): number => {
		const result = Number(raw[key]);
		if (!Number.isFinite(result)) throw new Error(`INVALID_PLOT_RESULT: ${key}`);
		return result;
	};
	const warnings = Array.isArray(raw.warnings)
		? raw.warnings.filter((item): item is string => typeof item === "string").slice(0, 100)
		: [];
	const plot: FrameOverviewPlot = {
		document_name: string("document_name"),
		analysis_id: string("analysis_id"),
		source_capability: 2,
		frame_id: string("frame_id"),
		frame_bbox: asTuple(raw.frame_bbox, "frame_bbox"),
		plot_bbox: asTuple(raw.plot_bbox, "plot_bbox"),
		image_ref: string("image_ref").replaceAll("\\", "/"),
		media_type: "image/png",
		bytes: number("bytes"),
		sha256: string("sha256").toLowerCase(),
		width: number("width"),
		height: number("height"),
		pixel_count: number("pixel_count"),
		ink_ratio: number("ink_ratio"),
		content_bbox: asTuple(raw.content_bbox, "content_bbox"),
		capture_strategy: "thcad_pngout_frame_window",
		color_mode: "current_model_space_display",
		dbmod_before: number("dbmod_before"),
		dbmod_after: number("dbmod_after"),
		dwg_modified: false,
		warnings,
	};
	if (
		raw.source_capability !== 2
		|| raw.media_type !== "image/png"
		|| raw.capture_strategy !== plot.capture_strategy
		|| raw.color_mode !== plot.color_mode
		|| raw.dwg_modified !== false
		|| plot.dbmod_before !== plot.dbmod_after
		|| !/^[a-f0-9]{64}$/.test(plot.sha256)
	) throw new Error("INVALID_PLOT_RESULT: provenance or DBMOD mismatch");
	return plot;
}

function analysisMatches(status: Record<string, unknown>): boolean {
	const active = record(status.active_document);
	const analysis = record(status.current_analysis);
	return typeof active.name === "string"
		&& typeof analysis.document_name === "string"
		&& active.name.toLocaleLowerCase() === analysis.document_name.toLocaleLowerCase()
		&& Number(active.dbmod) === Number(analysis.dbmod_after);
}

async function validatePng(plot: FrameOverviewPlot): Promise<string> {
	const imagePath = resolveInside(bridgeRoot, plot.image_ref);
	const metadata = await stat(imagePath);
	if (!metadata.isFile() || metadata.size < 24 || metadata.size > MAX_IMAGE_BYTES || metadata.size !== plot.bytes) {
		throw new Error("INVALID_PLOT_IMAGE: file size");
	}
	const image = await readFile(imagePath);
	if (!image.subarray(0, 8).equals(PNG_SIGNATURE) || image.toString("ascii", 12, 16) !== "IHDR") {
		throw new Error("INVALID_PLOT_IMAGE: signature");
	}
	const width = image.readUInt32BE(16);
	const height = image.readUInt32BE(20);
	if (
		width !== plot.width
		|| height !== plot.height
		|| width < 1
		|| height < 1
		|| width > MAX_IMAGE_EDGE
		|| height > MAX_IMAGE_EDGE
		|| width * height > MAX_IMAGE_PIXELS
	) throw new Error("INVALID_PLOT_IMAGE: dimensions");
	const digest = createHash("sha256").update(image).digest("hex");
	if (digest !== plot.sha256) throw new Error("INVALID_PLOT_IMAGE: sha256");
	return imagePath;
}

export async function captureFrameOverview(options: {
	frameId?: string;
	expectedDocument?: string;
	signal?: AbortSignal;
	onProgress?: (text: string) => void;
	bridge?: ThcadBridgeClient;
} = {}): Promise<CapturedFrameOverview> {
	const bridge = options.bridge ?? new ThcadBridgeClient();
	try {
		options.onProgress?.("正在核对活动图与 capability 02 图框代次…");
		let status = await bridge.invoke("status", {}, { signal: options.signal, timeoutSeconds: 30 });
		const active = record(status.active_document);
		const activeName = typeof active.name === "string" ? active.name : "";
		if (!activeName) throw new ThcadBridgeError("NO_ACTIVE_DOCUMENT", "THCAD status returned no active document.");
		if (
			options.expectedDocument
			&& options.expectedDocument.toLocaleLowerCase() !== activeName.toLocaleLowerCase()
		) throw new ThcadBridgeError("DOCUMENT_CHANGED", `Active document is ${activeName}.`);
		if (!analysisMatches(status)) {
			options.onProgress?.("现有 02 图框代次与活动图不一致，正在只读刷新 01–20…");
			await bridge.invoke(
				"extract_current",
				{ expected_document: activeName },
				{ signal: options.signal, timeoutSeconds: 1200 },
			);
			status = await bridge.invoke("status", {}, { signal: options.signal, timeoutSeconds: 30 });
			if (!analysisMatches(status)) throw new ThcadBridgeError("ANALYSIS_STALE", "Refreshed analysis still does not match the active drawing.");
		}

		options.onProgress?.("正在按 capability 02 图框生成 THCAD 视觉概览 PNG…");
		const requestId = `visual-${Date.now()}-${randomUUID()}`;
		const powerShell = path.join(
			process.env.SystemRoot ?? "C:\\Windows",
			"System32",
			"WindowsPowerShell",
			"v1.0",
			"powershell.exe",
		);
		const args = [
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			plotFrameOverviewScript,
			"-BridgeRoot",
			bridgeRoot,
			"-RequestId",
			requestId,
			"-ExpectedDocument",
			activeName,
		];
		if (options.frameId) args.push("-FrameId", options.frameId);
		const response = await execFileAsync(powerShell, args, {
			cwd: repositoryRoot,
			encoding: "utf8",
			windowsHide: true,
			maxBuffer: 2 * 1024 * 1024,
			timeout: 120_000,
			signal: options.signal,
		});
		const plot = parseFrameOverviewPlot(JSON.parse(response.stdout));
		const imagePath = await validatePng(plot);
		return { plot, imagePath };
	} catch (error) {
		throw stableError(error);
	}
}

export function frameOverviewRef(value: CapturedFrameOverview): string {
	return toProjectRef(value.imagePath);
}
