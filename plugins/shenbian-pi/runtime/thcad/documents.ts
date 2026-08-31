import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { ThcadBridgeClient, ThcadBridgeError } from "./bridge-client.ts";
import {
	repositoryRoot,
	thcadWorkspaceRoot,
	toProjectRef,
} from "./paths.ts";

const clientDataRoot = path.join(repositoryRoot, "client-data");

export interface DrawingPathRoots {
	clientDataRoot?: string;
	workspaceRoot?: string;
}

export type ThcadAppAction = "status" | "list" | "open" | "activate" | "close" | "copy_to_workspace" | "save";

export interface ThcadAppRequest {
	action: ThcadAppAction;
	path?: string;
	name?: string;
	read_only?: boolean;
	discard_changes?: boolean;
	from_session?: boolean;
	target_name?: string;
}

function inside(root: string, candidate: string): boolean {
	const relation = path.relative(path.resolve(root), path.resolve(candidate));
	return relation === "" || (!relation.startsWith("..") && !path.isAbsolute(relation));
}

function resolveInputPath(value: string): string {
	return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repositoryRoot, value);
}

async function canonicalRoot(root: string): Promise<string> {
	await mkdir(root, { recursive: true });
	return realpath(root);
}

async function canonicalFuturePath(value: string): Promise<string> {
	let cursor = path.resolve(value);
	const missingParts: string[] = [];
	for (;;) {
		try {
			return path.join(await realpath(cursor), ...missingParts.reverse());
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = path.dirname(cursor);
			if (parent === cursor) throw new ThcadBridgeError("INVALID_PATH", "Could not resolve target path.");
			missingParts.push(path.basename(cursor));
			cursor = parent;
		}
	}
}

export async function assertReadableDrawingPath(value: string, roots: DrawingPathRoots = {}): Promise<{
	path: string;
	underClientData: boolean;
	underWorkspace: boolean;
}> {
	if (!value.trim()) throw new ThcadBridgeError("INVALID_ARGUMENT", "DWG path is required.");
	const requested = resolveInputPath(value.trim());
	if (path.extname(requested).toLowerCase() !== ".dwg") {
		throw new ThcadBridgeError("INVALID_ARGUMENT", "Only .dwg files are supported.");
	}
	await access(requested, fsConstants.R_OK);
	const [candidate, clientRoot, workspaceRoot] = await Promise.all([
		realpath(requested),
		realpath(roots.clientDataRoot ?? clientDataRoot),
		canonicalRoot(roots.workspaceRoot ?? thcadWorkspaceRoot),
	]);
	const underClientData = inside(clientRoot, candidate);
	const underWorkspace = inside(workspaceRoot, candidate);
	if (!underClientData && !underWorkspace) {
		throw new ThcadBridgeError(
			"PATH_OUTSIDE_ALLOWED_ROOTS",
			"Drawing must be under client-data or .pi/runtime/thcad-workspace.",
		);
	}
	return { path: candidate, underClientData, underWorkspace };
}

export async function assertWorkspaceTarget(
	value: string,
	requireExisting = false,
	roots: DrawingPathRoots = {},
): Promise<string> {
	const requested = resolveInputPath(value.trim());
	if (path.extname(requested).toLowerCase() !== ".dwg") {
		throw new ThcadBridgeError("INVALID_ARGUMENT", "Workspace target must be a .dwg file.");
	}
	const root = await canonicalRoot(roots.workspaceRoot ?? thcadWorkspaceRoot);
	const candidate = requireExisting ? await realpath(requested) : await canonicalFuturePath(requested);
	if (!inside(root, candidate)) {
		throw new ThcadBridgeError(
			"WRITE_OUTSIDE_WORKSPACE_REFUSED",
			"DWG writes are only allowed under .pi/runtime/thcad-workspace.",
		);
	}
	return candidate;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function documentsOf(status: Record<string, unknown>): Array<Record<string, unknown>> {
	return Array.isArray(status.documents) ? status.documents.map(record) : [];
}

function selectedOpenDocument(
	status: Record<string, unknown>,
	selector: { name?: string; path?: string },
): Record<string, unknown> {
	const expectedPath = selector.path ? resolveInputPath(selector.path) : undefined;
	const matches = documentsOf(status).filter((document) => {
		const documentPath = typeof document.path === "string" ? resolveInputPath(document.path) : "";
		const name = String(document.name ?? "");
		return (expectedPath && path.resolve(documentPath).toLowerCase() === path.resolve(expectedPath).toLowerCase())
			|| (selector.name && (name.toLowerCase() === selector.name.toLowerCase()
				|| String(document.path ?? "").toLowerCase() === selector.name.toLowerCase()));
	});
	if (matches.length !== 1) {
		throw new ThcadBridgeError(
			matches.length ? "AMBIGUOUS_DOCUMENT" : "DOCUMENT_NOT_OPEN",
			matches.length ? "Use an exact document path." : "No open document matches the selector.",
		);
	}
	return matches[0];
}

function safeTargetName(sourcePath: string, requested?: string): string {
	let name = requested?.trim() || `${path.basename(sourcePath, path.extname(sourcePath))}-working.dwg`;
	if (!path.extname(name)) name += ".dwg";
	if (name !== path.basename(name) || path.extname(name).toLowerCase() !== ".dwg") {
		throw new ThcadBridgeError("INVALID_TARGET_NAME", "target_name must be one DWG filename without directories.");
	}
	return name;
}

async function availableWorkspaceTarget(sourcePath: string, requested?: string): Promise<string> {
	await mkdir(thcadWorkspaceRoot, { recursive: true });
	const initial = safeTargetName(sourcePath, requested);
	const extension = path.extname(initial);
	const stem = path.basename(initial, extension);
	for (let suffix = 1; suffix <= 10_000; suffix += 1) {
		const name = suffix === 1 ? initial : `${stem}-${suffix}${extension}`;
		const candidate = await assertWorkspaceTarget(path.join(thcadWorkspaceRoot, name));
		try {
			await stat(candidate);
		} catch {
			return candidate;
		}
	}
	throw new ThcadBridgeError("WORKSPACE_NAME_EXHAUSTED", "Could not allocate a workspace drawing name.");
}

function bridgeSelector(input: ThcadAppRequest): Record<string, unknown> {
	if (input.path) return { path: resolveInputPath(input.path) };
	if (input.name) return { name: input.name };
	return {};
}

export async function executeThcadAppAction(
	input: ThcadAppRequest,
	options: { signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
	const bridge = new ThcadBridgeClient();
	if (input.action === "status" || input.action === "list") {
		const status = await bridge.invoke("status", {}, { signal: options.signal, timeoutSeconds: 30 });
		return input.action === "list"
			? { active_document: status.active_document, documents: status.documents }
			: status;
	}

	if (input.action === "open") {
		const source = await assertReadableDrawingPath(input.path ?? "");
		const readOnly = source.underClientData ? true : (input.read_only ?? false);
		return bridge.invoke("open_document", {
			path: source.path,
			read_only: readOnly,
		}, { signal: options.signal, timeoutSeconds: 90 });
	}

	if (input.action === "activate") {
		if (input.path) await assertReadableDrawingPath(input.path);
		return bridge.invoke("activate_document", bridgeSelector(input), {
			signal: options.signal,
			timeoutSeconds: 45,
		});
	}

	if (input.action === "close") {
		if (input.path) await assertReadableDrawingPath(input.path);
		return bridge.invoke("close_document", {
			...bridgeSelector(input),
			discard_changes: input.discard_changes ?? false,
		}, { signal: options.signal, timeoutSeconds: 45 });
	}

	if (input.action === "copy_to_workspace") {
		const status = await bridge.invoke("status", {}, { signal: options.signal, timeoutSeconds: 30 });
		let sourcePath: string;
		let openDocument: Record<string, unknown> | undefined;
		if (input.name || (!input.path && input.from_session)) {
			openDocument = input.name || input.path
				? selectedOpenDocument(status, { name: input.name, path: input.path })
				: record(status.active_document);
			sourcePath = resolveInputPath(String(openDocument.path ?? ""));
		} else {
			sourcePath = (await assertReadableDrawingPath(input.path ?? "")).path;
			openDocument = documentsOf(status).find((document) => (
				resolveInputPath(String(document.path ?? "")).toLowerCase() === sourcePath.toLowerCase()
			));
		}
		await assertReadableDrawingPath(sourcePath);
		const targetPath = await availableWorkspaceTarget(sourcePath, input.target_name);
		if (input.from_session) {
			if (!openDocument || !Object.keys(openDocument).length) {
				throw new ThcadBridgeError("DOCUMENT_NOT_OPEN", "from_session requires an open source document.");
			}
			const saved = await bridge.invoke("save_document_as", {
				path: sourcePath,
				target_path: targetPath,
			}, { signal: options.signal, timeoutSeconds: 120 });
			return {
				copy_mode: "session_state_save_as",
				target_path: toProjectRef(targetPath),
				source_dbmod: openDocument.dbmod,
				...saved,
			};
		}

		await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
		return {
			copy_mode: "saved_disk_state",
			source_path: toProjectRef(sourcePath),
			target_path: toProjectRef(targetPath),
			source_open: Boolean(openDocument),
			source_dbmod: openDocument?.dbmod ?? null,
		};
	}

	if (input.action === "save") {
		const status = await bridge.invoke("status", {}, { signal: options.signal, timeoutSeconds: 30 });
		const selected = input.name || input.path
			? selectedOpenDocument(status, { name: input.name, path: input.path })
			: record(status.active_document);
		const documentPath = await assertWorkspaceTarget(
			resolveInputPath(String(selected.path ?? "")),
			true,
		);
		return bridge.invoke("save_document", { path: documentPath }, {
			signal: options.signal,
			timeoutSeconds: 90,
		});
	}

	throw new ThcadBridgeError("UNSUPPORTED_ACTION", `Unsupported thcad_app action: ${input.action}`);
}
