import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
	bridgeRoot,
	invokeBridgeScript,
	repositoryRoot,
	resolveBridgeDll,
	toProjectRef,
} from "./paths.ts";

const execFileAsync = promisify(execFile);
const PROTOCOL_VERSION = 1;

export type BridgeOperation =
	| "status"
	| "extract_current"
	| "locate_handles"
	| "scan_texts"
	| "open_document"
	| "activate_document"
	| "close_document"
	| "save_document_as"
	| "save_document";

interface BridgeEnvelope {
	protocol_version: number;
	request_id: string;
	operation: string;
	ok: boolean;
	data?: Record<string, unknown>;
	error?: { code?: string; message?: string };
}

export class ThcadBridgeError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "ThcadBridgeError";
		this.code = code;
	}
}

function stableProcessError(error: unknown): ThcadBridgeError {
	const value = error as { message?: string; stderr?: string; code?: string };
	const text = `${value.stderr ?? ""}\n${value.message ?? ""}`.trim();
	const code = text.match(/\b([A-Z][A-Z0-9_]{2,})\s*:/)?.[1]
		?? (value.code === "ABORT_ERR" ? "SUBAGENT_CANCELLED" : "BRIDGE_CONTROL_FAILED");
	const safe = text
		.replaceAll(repositoryRoot, "<project>")
		.replace(/[A-Za-z]:\\[^\r\n]+/g, "<local-path>")
		.slice(0, 1500);
	return new ThcadBridgeError(code, safe || "THCAD bridge control failed.");
}

function sanitizeForModel(value: unknown, key = ""): unknown {
	if (Array.isArray(value)) return value.map((item) => sanitizeForModel(item));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
				childKey,
				sanitizeForModel(childValue, childKey),
			]),
		);
	}
	if (typeof value !== "string") return value;
	if (/^(path|database_filename|assembly|document_path)$/i.test(key) || path.isAbsolute(value)) {
		return toProjectRef(value);
	}
	return value.replaceAll("\\", "/");
}

export class ThcadBridgeClient {
	async isBuilt(): Promise<boolean> {
		return Boolean(await resolveBridgeDll());
	}

	async invoke(
		operation: BridgeOperation,
		params: Record<string, unknown> = {},
		options: { signal?: AbortSignal; timeoutSeconds?: number } = {},
	): Promise<Record<string, unknown>> {
		const bridgeDll = await resolveBridgeDll();
		if (!bridgeDll) {
			throw new ThcadBridgeError(
				"BRIDGE_NOT_BUILT",
				"Run .\\scripts\\build-thcad-agent-bridge.ps1 before using THCAD tools.",
			);
		}

		const requestId = `cad-${Date.now()}-${randomUUID()}`;
		const pendingDirectory = path.join(bridgeRoot, "pending");
		const responseDirectory = path.join(bridgeRoot, "responses");
		await Promise.all([mkdir(pendingDirectory, { recursive: true }), mkdir(responseDirectory, { recursive: true })]);

		const requestPath = path.join(pendingDirectory, `${requestId}.json`);
		const responsePath = path.join(responseDirectory, `${requestId}.json`);
		const temporaryPath = `${requestPath}.tmp-${randomUUID()}`;
		const request = {
			protocol_version: PROTOCOL_VERSION,
			request_id: requestId,
			operation,
			created_at_utc: new Date().toISOString(),
			params,
		};
		try {
			await writeFile(temporaryPath, `${JSON.stringify(request)}\n`, { encoding: "utf8", mode: 0o600 });
			await rename(temporaryPath, requestPath);
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined);
			throw error;
		}

		const timeoutSeconds = Math.max(1, Math.min(options.timeoutSeconds ?? 300, 1800));
		const powerShell = path.join(
			process.env.SystemRoot ?? "C:\\Windows",
			"System32",
			"WindowsPowerShell",
			"v1.0",
			"powershell.exe",
		);
		try {
			await execFileAsync(
				powerShell,
				[
					"-NoProfile",
					"-ExecutionPolicy",
					"Bypass",
					"-File",
					invokeBridgeScript,
					"-BridgeRoot",
					bridgeRoot,
					"-BridgeDll",
					bridgeDll,
					"-RequestId",
					requestId,
					"-TimeoutSeconds",
					String(timeoutSeconds),
				],
				{
					encoding: "utf8",
					maxBuffer: 2 * 1024 * 1024,
					timeout: (timeoutSeconds + 10) * 1000,
					windowsHide: true,
					signal: options.signal,
				},
			);
		} catch (error) {
			// Reclaim only this invocation's unclaimed request. If THCAD already
			// moved it to running, the exact request may finish once, but it cannot
			// be discovered and replayed by a later command.
			await rm(requestPath, { force: true }).catch(() => undefined);
			try {
				await access(responsePath);
			} catch {
				throw stableProcessError(error);
			}
		}

		let response: BridgeEnvelope;
		try {
			response = JSON.parse(
				await readFile(responsePath, "utf8"),
			) as BridgeEnvelope;
		} catch (error) {
			await rm(requestPath, { force: true }).catch(() => undefined);
			throw new ThcadBridgeError("INVALID_BRIDGE_RESPONSE", String(error));
		}

		if (response.protocol_version !== PROTOCOL_VERSION || response.request_id !== requestId) {
			throw new ThcadBridgeError("PROTOCOL_MISMATCH", "THCAD response identity or protocol mismatch.");
		}
		if (!response.ok) {
			throw new ThcadBridgeError(
				response.error?.code ?? "THCAD_OPERATION_FAILED",
				(response.error?.message ?? "THCAD operation failed.").slice(0, 1500),
			);
		}
		return sanitizeForModel(response.data ?? {}) as Record<string, unknown>;
	}
}
