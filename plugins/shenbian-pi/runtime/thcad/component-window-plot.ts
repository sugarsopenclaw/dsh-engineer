import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { Box2 } from "./bom-close-reading.ts";
import {
	bridgeRoot,
	plotWindowScript,
	rasterizeThcadPdfScript,
	repositoryRoot,
	resolveInside,
	toProjectRef,
} from "./paths.ts";

const execFileAsync = promisify(execFile);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type JsonRecord = Record<string, unknown>;

export interface ComponentWindowPlot {
	imagePath: string;
	imageRef: string;
	width: number;
	height: number;
	bytes: number;
	sha256: string;
	metadata: JsonRecord;
}

function stableError(error: unknown): Error {
	const value = error as { stderr?: string; stdout?: string; message?: string };
	const text = `${value.stderr ?? ""}\n${value.stdout ?? ""}\n${value.message ?? ""}`.trim();
	const safe = text
		.replaceAll(repositoryRoot, "<project>")
		.replace(/[A-Za-z]:\\[^\r\n]+/g, "<local-path>")
		.slice(0, 3000);
	return new Error(safe || "THCAD_COMPONENT_WINDOW_PLOT_FAILED");
}

function record(value: unknown): JsonRecord {
	return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export async function captureComponentWindowPlot(options: {
	documentName: string;
	analysisId: string;
	dbmod: number;
	bounds: Box2;
	targetPath: string;
	width: number;
	height: number;
	signal?: AbortSignal;
}): Promise<ComponentWindowPlot> {
	const [minX, minY, maxX, maxY] = options.bounds;
	if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
		throw new Error("INVALID_COMPONENT_PLOT_BOUNDS");
	}
	const powerShell = path.join(
		process.env.SystemRoot ?? "C:\\Windows",
		"System32",
		"WindowsPowerShell",
		"v1.0",
		"powershell.exe",
	);
	try {
		const requestId = `bom-${Date.now()}-${randomUUID()}`;
		const plotted = await execFileAsync(powerShell, [
			"-NoProfile",
			"-ExecutionPolicy", "Bypass",
			"-File", plotWindowScript,
			"-BridgeRoot", bridgeRoot,
			"-RequestId", requestId,
			"-ExpectedDocument", options.documentName,
			"-ExpectedAnalysisId", options.analysisId,
			"-ExpectedDbmod", String(options.dbmod),
			"-MinX", String(minX),
			"-MinY", String(minY),
			"-MaxX", String(maxX),
			"-MaxY", String(maxY),
		], {
			cwd: repositoryRoot,
			encoding: "utf8",
			windowsHide: true,
			maxBuffer: 2 * 1024 * 1024,
			timeout: 120_000,
			signal: options.signal,
		});
		const plot = record(JSON.parse(plotted.stdout));
		if (
			plot.capture_strategy !== "thcad_plot_set_window_to_plot_without_view_change"
			|| plot.analysis_id !== options.analysisId
			|| plot.document_name !== options.documentName
			|| Number(plot.dbmod_before) !== options.dbmod
			|| Number(plot.dbmod_after) !== options.dbmod
			|| plot.dwg_modified !== false
			|| plot.view_changed !== false
		) throw new Error("INVALID_COMPONENT_PLOT_RESULT");
		const pdfRef = typeof plot.pdf_ref === "string" ? plot.pdf_ref : "";
		const pdfPath = resolveInside(bridgeRoot, pdfRef);
		if (!(await stat(pdfPath)).isFile()) throw new Error("COMPONENT_PLOT_PDF_MISSING");

		const uv = process.env.SHENBIAN_UV_EXECUTABLE?.trim() || "uv";
		const rasterized = await execFileAsync(uv, [
			"run", "--script", rasterizeThcadPdfScript,
			"--source", pdfPath,
			"--target", path.resolve(options.targetPath),
			"--width", String(options.width),
			"--height", String(options.height),
		], {
			cwd: repositoryRoot,
			encoding: "utf8",
			windowsHide: true,
			maxBuffer: 2 * 1024 * 1024,
			timeout: 180_000,
			signal: options.signal,
		});
		const raster = record(JSON.parse(rasterized.stdout));
		const imagePath = path.resolve(options.targetPath);
		const image = await readFile(imagePath);
		if (
			image.length < 24
			|| !image.subarray(0, 8).equals(PNG_SIGNATURE)
			|| image.readUInt32BE(16) !== options.width
			|| image.readUInt32BE(20) !== options.height
		) throw new Error("INVALID_COMPONENT_PLOT_PNG");
		const sha256 = createHash("sha256").update(image).digest("hex");
		if (raster.sha256 !== sha256 || Number(raster.png_bytes) !== image.length) {
			throw new Error("COMPONENT_PLOT_PNG_HASH_MISMATCH");
		}
		return {
			imagePath,
			imageRef: toProjectRef(imagePath),
			width: options.width,
			height: options.height,
			bytes: image.length,
			sha256,
			metadata: { plot, raster },
		};
	} catch (error) {
		throw stableError(error);
	}
}
