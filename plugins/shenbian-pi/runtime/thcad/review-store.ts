import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	appendFile,
	copyFile,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
	bridgeRoot as defaultBridgeRoot,
	projectGraphRoot as defaultProjectGraphRoot,
	reviewCacheRoot as defaultCacheRoot,
	reviewObjectsRoot as defaultObjectsRoot,
	reviewRoot as defaultReviewRoot,
	reviewRunsRoot as defaultRunsRoot,
	repositoryRoot,
	resolveBridgeDll,
	resolveInside,
	toProjectRef,
} from "./paths.ts";

const REVIEW_SCHEMA_VERSION = 1;
const RUN_ID_PATTERN = /^thcad-[A-Za-z0-9._-]+$/;
const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;

export interface ParentReviewContext {
	sessionId?: string;
	sessionFile?: string;
	toolCallId?: string;
	prompt?: string;
	systemPrompt?: string;
	model?: string;
	thinkingLevel?: string;
	images?: Array<{ type?: string; data?: string; mimeType?: string }>;
}

export interface BeginReviewInput {
	runId: string;
	task: string;
	childSystemPrompt: string;
	childModel?: string;
	childThinkingLevel?: string;
	childRole?: "mechanical" | "vision";
	cwd: string;
	parent?: ParentReviewContext;
}

export interface ChildInputSnapshotEntry extends ArtifactSnapshotEntry {
	role: string;
	media_type?: string;
	metadata?: unknown;
}

export interface ChildReviewResult {
	status: "completed" | "failed" | "cancelled";
	startedAtUtc: string;
	finishedAtUtc: string;
	durationMs: number;
	exitCode?: number;
	model?: string;
	stopReason?: string;
	toolCallCount: number;
	turns: number;
	usage: unknown;
	error?: string;
}

export interface ArtifactSnapshotEntry {
	logical_path: string;
	source_ref: string;
	bytes: number;
	sha256: string;
	object_path: string;
	object_ref: string;
	source_fingerprint: string;
}

export interface ArtifactSnapshotManifest {
	schema_version: number;
	run_id: string;
	created_at_utc: string;
	status: "complete" | "partial" | "missing";
	analysis_id?: string;
	analysis_state?: JsonRecord;
	files: ArtifactSnapshotEntry[];
	total_bytes: number;
	unique_object_bytes_added: number;
	warnings: string[];
}

export interface ParentReviewResult {
	status: "completed" | "interrupted";
	finishedAtUtc: string;
	model?: string;
	thinkingLevel?: string;
	finalMessage?: unknown;
	messageCount?: number;
	sessionId?: string;
	sessionFile?: string;
}

export interface ReviewSummary {
	run_id: string;
	created_at_utc?: string;
	task?: string;
	child_status?: string;
	artifact_status?: string;
	parent_status?: string;
	review_status?: string;
	review_complete: boolean;
	run_ref: string;
}

export interface ReviewVerification {
	run_id: string;
	ok: boolean;
	bundle_files_checked: number;
	artifact_objects_checked: number;
	problems: string[];
}

interface StoredObject {
	bytes: number;
	sha256: string;
	objectPath: string;
	objectRef: string;
	sourceFingerprint: string;
	addedBytes: number;
}

function utcNow(): string {
	return new Date().toISOString();
}

function assertRunId(runId: string): void {
	if (!RUN_ID_PATTERN.test(runId)) throw new Error("INVALID_REVIEW_RUN_ID");
}

function normalizedRelative(from: string, target: string): string {
	return path.relative(from, target).split(path.sep).join("/");
}

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

async function sha256File(target: string): Promise<string> {
	const digest = createHash("sha256");
	for await (const chunk of createReadStream(target)) digest.update(chunk as Buffer);
	return digest.digest("hex");
}

async function readJson<T>(target: string): Promise<T> {
	return JSON.parse(await readFile(target, "utf8")) as T;
}

async function writeExclusive(target: string, content: string | Buffer): Promise<void> {
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, content, { flag: "wx", mode: 0o600 });
}

async function writeJsonExclusive(target: string, value: unknown): Promise<void> {
	await writeExclusive(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function packageVersion(target: string): Promise<string | undefined> {
	try {
		const value = await readJson<{ version?: unknown }>(target);
		return typeof value.version === "string" ? value.version : undefined;
	} catch {
		return undefined;
	}
}

async function regularFiles(root: string): Promise<string[]> {
	const result: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) await visit(absolute);
			else if (entry.isFile()) result.push(absolute);
		}
	};
	await visit(root);
	return result;
}

function assistantText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const value = message as { role?: unknown; content?: unknown };
	if (value.role !== "assistant" || !Array.isArray(value.content)) return "";
	return value.content
		.filter((part): part is { type: string; text: string } => (
			Boolean(part)
			&& typeof part === "object"
			&& (part as { type?: unknown }).type === "text"
			&& typeof (part as { text?: unknown }).text === "string"
		))
		.map((part) => part.text)
		.join("\n")
		.trim();
}

export function createReviewRunId(): string {
	return `thcad-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
}

export class ThcadReviewStore {
	readonly root: string;
	readonly runsRoot: string;
	readonly objectsRoot: string;
	readonly cacheRoot: string;
	readonly bridgeRoot: string;
	readonly projectGraphRoot: string;

	constructor(options: {
		root?: string;
		runsRoot?: string;
		objectsRoot?: string;
		cacheRoot?: string;
		bridgeRoot?: string;
		projectGraphRoot?: string;
	} = {}) {
		this.root = path.resolve(options.root ?? defaultReviewRoot);
		this.runsRoot = path.resolve(options.runsRoot ?? (options.root ? path.join(this.root, "runs") : defaultRunsRoot));
		this.objectsRoot = path.resolve(options.objectsRoot ?? (options.root ? path.join(this.root, "objects", "sha256") : defaultObjectsRoot));
		this.cacheRoot = path.resolve(options.cacheRoot ?? (options.root ? path.join(this.root, "cache") : defaultCacheRoot));
		this.bridgeRoot = path.resolve(options.bridgeRoot ?? defaultBridgeRoot);
		this.projectGraphRoot = path.resolve(options.projectGraphRoot ?? (
			options.bridgeRoot ? path.join(this.bridgeRoot, "project-graph") : defaultProjectGraphRoot
		));
	}

	runDirectory(runId: string): string {
		assertRunId(runId);
		return resolveInside(this.runsRoot, runId);
	}

	runRef(runId: string): string {
		return toProjectRef(this.runDirectory(runId));
	}

	async beginRun(input: BeginReviewInput): Promise<void> {
		assertRunId(input.runId);
		const runDirectory = this.runDirectory(input.runId);
		await mkdir(this.runsRoot, { recursive: true });
		await mkdir(runDirectory);

		const imageRecords: JsonRecord[] = [];
		for (let index = 0; index < (input.parent?.images?.length ?? 0); index += 1) {
			const image = input.parent?.images?.[index];
			if (!image?.data) {
				imageRecords.push({ index, mime_type: image?.mimeType, status: "metadata_only" });
				continue;
			}
			try {
				const base64 = image.data.replace(/^data:[^;]+;base64,/i, "");
				const bytes = Buffer.from(base64, "base64");
				const stored = await this.storeBuffer(bytes);
				imageRecords.push({
					index,
					mime_type: image.mimeType,
					bytes: stored.bytes,
					sha256: stored.sha256,
					object_path: normalizedRelative(this.root, stored.objectPath),
					object_ref: stored.objectRef,
				});
			} catch (error) {
				imageRecords.push({ index, mime_type: image.mimeType, status: "invalid", error: String(error) });
			}
		}
		const provenance = await this.collectProvenance();

		await writeExclusive(path.join(runDirectory, "child-system-prompt.md"), input.childSystemPrompt);
		if (input.parent?.systemPrompt) {
			await writeExclusive(path.join(runDirectory, "parent-system-prompt.md"), input.parent.systemPrompt);
		}
		await writeJsonExclusive(path.join(runDirectory, "request.json"), {
			schema_version: REVIEW_SCHEMA_VERSION,
			run_id: input.runId,
			created_at_utc: utcNow(),
			task: input.task,
			cwd_ref: toProjectRef(input.cwd),
			child: {
				role: input.childRole ?? "mechanical",
				model: input.childModel,
				thinking_level: input.childThinkingLevel,
				session_mode: "fresh_persisted",
			},
			provenance,
			parent: input.parent ? {
				session_id: input.parent.sessionId,
				session_file_ref: input.parent.sessionFile ? toProjectRef(input.parent.sessionFile) : undefined,
				tool_call_id: input.parent.toolCallId,
				prompt: input.parent.prompt,
				model: input.parent.model,
				thinking_level: input.parent.thinkingLevel,
				images: imageRecords,
			} : undefined,
		});
		await this.appendLifecycle(input.runId, "run_created");
	}

	private async collectProvenance(): Promise<JsonRecord> {
		let gitHead: string | undefined;
		let dirtyPaths: string[] = [];
		try {
			gitHead = (await execFileAsync("git", ["rev-parse", "HEAD"], {
				cwd: repositoryRoot,
				encoding: "utf8",
				windowsHide: true,
			})).stdout.trim();
			const status = (await execFileAsync("git", [
				"status",
				"--porcelain=v1",
				"--untracked-files=all",
				"--",
				"plugins/shenbian-pi",
				"local-dev/cad/adapters",
				"local-dev/cad/core",
				"local-dev/cad/hosts/thcad-dotnet-bridge",
				"scripts/build-thcad-agent-bridge.ps1",
				"scripts/invoke-thcad-agent-bridge.ps1",
				"scripts/thcad-review.ps1",
			], {
				cwd: repositoryRoot,
				encoding: "utf8",
				windowsHide: true,
				maxBuffer: 1024 * 1024,
			})).stdout;
			dirtyPaths = status.split(/\r?\n/).filter(Boolean);
		} catch {
			// A source archive or non-git deployment can still produce a valid review bundle.
		}

		let bridge: JsonRecord | undefined;
		try {
			const bridgeDll = await resolveBridgeDll();
			if (bridgeDll) {
				const metadata = await stat(bridgeDll);
				bridge = {
					ref: toProjectRef(bridgeDll),
					bytes: metadata.size,
					sha256: await sha256File(bridgeDll),
				};
			}
		} catch {
			// Bridge provenance is optional when the child fails before a deployment exists.
		}

		return {
			git_head: gitHead,
			integration_worktree_dirty: dirtyPaths.length > 0,
			integration_dirty_entries: dirtyPaths,
			pi_coding_agent_version: await packageVersion(path.join(repositoryRoot, "pi", "packages", "coding-agent", "package.json")),
			shenbian_pi_version: await packageVersion(path.join(repositoryRoot, "plugins", "shenbian-pi", "package.json")),
			node_version: process.version,
			platform: process.platform,
			arch: process.arch,
			bridge_deployment_pointer: bridge,
		};
	}

	async appendLifecycle(runId: string, event: string, details: JsonRecord = {}): Promise<void> {
		const target = path.join(this.runDirectory(runId), "lifecycle.jsonl");
		await appendFile(target, `${JSON.stringify({ at_utc: utcNow(), event, ...details })}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
	}

	async recordChildResult(runId: string, result: ChildReviewResult): Promise<void> {
		await writeJsonExclusive(path.join(this.runDirectory(runId), "child-result.json"), {
			schema_version: REVIEW_SCHEMA_VERSION,
			run_id: runId,
			...result,
		});
		await this.appendLifecycle(runId, `child_${result.status}`);
	}

	async writeEvidence(runId: string, content: string): Promise<string> {
		const target = path.join(this.runDirectory(runId), "evidence.md");
		await writeExclusive(target, content);
		return toProjectRef(target);
	}

	async snapshotChildInput(runId: string, input: {
		source: string;
		logicalPath: string;
		role: string;
		mediaType?: string;
		metadata?: unknown;
	}): Promise<ChildInputSnapshotEntry> {
		if (
			!input.logicalPath
			|| path.isAbsolute(input.logicalPath)
			|| input.logicalPath.split(/[\\/]/).includes("..")
		) throw new Error("INVALID_CHILD_INPUT_LOGICAL_PATH");
		const stored = await this.storeFile(input.source);
		const entry: ChildInputSnapshotEntry = {
			logical_path: input.logicalPath.replaceAll("\\", "/"),
			source_ref: toProjectRef(input.source),
			bytes: stored.bytes,
			sha256: stored.sha256,
			object_path: normalizedRelative(this.root, stored.objectPath),
			object_ref: stored.objectRef,
			source_fingerprint: stored.sourceFingerprint,
			role: input.role,
			media_type: input.mediaType,
			metadata: input.metadata,
		};
		await writeJsonExclusive(path.join(this.runDirectory(runId), "child-inputs.json"), {
			schema_version: REVIEW_SCHEMA_VERSION,
			run_id: runId,
			created_at_utc: utcNow(),
			files: [entry],
			unique_object_bytes_added: stored.addedBytes,
		});
		await this.appendLifecycle(runId, "child_input_snapshotted", {
			role: input.role,
			bytes: stored.bytes,
			sha256: stored.sha256,
			unique_object_bytes_added: stored.addedBytes,
		});
		return entry;
	}

	async snapshotArtifacts(runId: string): Promise<ArtifactSnapshotManifest> {
		const warnings: string[] = [];
		const files: ArtifactSnapshotEntry[] = [];
		let uniqueObjectBytesAdded = 0;
		const statePath = path.join(this.bridgeRoot, "state", "current-analysis.json");
		let stateRaw: string;
		let state: JsonRecord;
		try {
			stateRaw = await readFile(statePath, "utf8");
			state = JSON.parse(stateRaw) as JsonRecord;
		} catch (error) {
			const manifest: ArtifactSnapshotManifest = {
				schema_version: REVIEW_SCHEMA_VERSION,
				run_id: runId,
				created_at_utc: utcNow(),
				status: "missing",
				files: [],
				total_bytes: 0,
				unique_object_bytes_added: 0,
				warnings: [`CURRENT_ANALYSIS_MISSING: ${String(error)}`],
			};
			await writeJsonExclusive(path.join(this.runDirectory(runId), "artifact-manifest.json"), manifest);
			await this.appendLifecycle(runId, "artifact_snapshot_missing");
			return manifest;
		}

		const candidates: Array<{ source: string; logicalPath: string }> = [
			{ source: statePath, logicalPath: "analysis-state/current-analysis.json" },
		];
		const artifactDirectoryValue = typeof state.artifact_directory === "string" ? state.artifact_directory : "";
		if (artifactDirectoryValue) {
			try {
				const artifactDirectory = resolveInside(this.bridgeRoot, artifactDirectoryValue);
				for (const source of await regularFiles(artifactDirectory)) {
					candidates.push({
						source,
						logicalPath: `analysis/${normalizedRelative(artifactDirectory, source)}`,
					});
				}
			} catch (error) {
				warnings.push(`ARTIFACT_DIRECTORY_UNAVAILABLE: ${String(error)}`);
			}
		} else {
			warnings.push("ARTIFACT_DIRECTORY_MISSING");
		}

		const projectGraphPath = path.join(this.projectGraphRoot, "cross-drawing-interface-graph.json");
		try {
			if ((await stat(projectGraphPath)).isFile()) {
				candidates.push({ source: projectGraphPath, logicalPath: "project-graph/cross-drawing-interface-graph.json" });
			}
		} catch {
			// A project graph is optional.
		}

		for (const candidate of candidates) {
			try {
				const stored = await this.storeFile(candidate.source);
				uniqueObjectBytesAdded += stored.addedBytes;
				files.push({
					logical_path: candidate.logicalPath,
					source_ref: toProjectRef(candidate.source),
					bytes: stored.bytes,
					sha256: stored.sha256,
					object_path: normalizedRelative(this.root, stored.objectPath),
					object_ref: stored.objectRef,
					source_fingerprint: stored.sourceFingerprint,
				});
			} catch (error) {
				warnings.push(`SNAPSHOT_FILE_FAILED ${candidate.logicalPath}: ${String(error)}`);
			}
		}

		try {
			if ((await readFile(statePath, "utf8")) !== stateRaw) warnings.push("ANALYSIS_CHANGED_DURING_SNAPSHOT");
		} catch (error) {
			warnings.push(`ANALYSIS_STATE_RECHECK_FAILED: ${String(error)}`);
		}

		const manifest: ArtifactSnapshotManifest = {
			schema_version: REVIEW_SCHEMA_VERSION,
			run_id: runId,
			created_at_utc: utcNow(),
			status: warnings.length ? "partial" : "complete",
			analysis_id: typeof state.analysis_id === "string" ? state.analysis_id : undefined,
			analysis_state: state,
			files,
			total_bytes: files.reduce((sum, item) => sum + item.bytes, 0),
			unique_object_bytes_added: uniqueObjectBytesAdded,
			warnings,
		};
		await writeJsonExclusive(path.join(this.runDirectory(runId), "artifact-manifest.json"), manifest);
		await this.appendLifecycle(runId, `artifact_snapshot_${manifest.status}`, {
			file_count: files.length,
			total_bytes: manifest.total_bytes,
			unique_object_bytes_added: uniqueObjectBytesAdded,
		});
		return manifest;
	}

	async finalizeParent(runId: string, result: ParentReviewResult): Promise<void> {
		const runDirectory = this.runDirectory(runId);
		let parentSessionRef: string | undefined;
		let parentSessionSha256: string | undefined;
		let parentSessionBytes: number | undefined;
		if (result.sessionFile) {
			try {
				const target = path.join(runDirectory, "parent-session.jsonl");
				await copyFile(result.sessionFile, target);
				parentSessionSha256 = await sha256File(target);
				parentSessionBytes = (await stat(target)).size;
				parentSessionRef = toProjectRef(target);
			} catch (error) {
				await this.appendLifecycle(runId, "parent_session_snapshot_failed", { error: String(error) });
			}
		}

		await writeJsonExclusive(path.join(runDirectory, "parent-result.json"), {
			schema_version: REVIEW_SCHEMA_VERSION,
			run_id: runId,
			status: result.status,
			finished_at_utc: result.finishedAtUtc,
			model: result.model,
			thinking_level: result.thinkingLevel,
			session_id: result.sessionId,
			session_file_ref: result.sessionFile ? toProjectRef(result.sessionFile) : undefined,
			session_snapshot_ref: parentSessionRef,
			session_snapshot_sha256: parentSessionSha256,
			session_snapshot_bytes: parentSessionBytes,
			message_count: result.messageCount,
			final_message: result.finalMessage,
			final_text: assistantText(result.finalMessage),
		});
		await this.appendLifecycle(runId, `parent_${result.status}`);
		await this.finalizeManifest(runId, result.status === "completed");
	}

	async listRuns(limit = 20): Promise<ReviewSummary[]> {
		let entries;
		try {
			entries = await readdir(this.runsRoot, { withFileTypes: true });
		} catch {
			return [];
		}
		const summaries: ReviewSummary[] = [];
		for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
			if (summaries.length >= limit) break;
			const runDirectory = this.runDirectory(entry.name);
			try {
				const request = await readJson<JsonRecord>(path.join(runDirectory, "request.json"));
				const child = await this.readOptionalJson(path.join(runDirectory, "child-result.json"));
				const artifacts = await this.readOptionalJson(path.join(runDirectory, "artifact-manifest.json"));
				const parent = await this.readOptionalJson(path.join(runDirectory, "parent-result.json"));
				const review = await this.readOptionalJson(path.join(runDirectory, "review-manifest.json"));
				const complete = review?.status === "complete";
				summaries.push({
					run_id: entry.name,
					created_at_utc: typeof request.created_at_utc === "string" ? request.created_at_utc : undefined,
					task: typeof request.task === "string" ? request.task : undefined,
					child_status: typeof child?.status === "string" ? child.status : undefined,
					artifact_status: typeof artifacts?.status === "string" ? artifacts.status : undefined,
					parent_status: typeof parent?.status === "string" ? parent.status : undefined,
					review_status: typeof review?.status === "string" ? review.status : undefined,
					review_complete: complete,
					run_ref: toProjectRef(runDirectory),
				});
			} catch {
				// Ignore malformed directories; verification reports their details when addressed directly.
			}
		}
		return summaries;
	}

	async verifyRun(runId: string): Promise<ReviewVerification> {
		const problems: string[] = [];
		let bundleFilesChecked = 0;
		let artifactObjectsChecked = 0;
		const checkedObjects = new Set<string>();
		const runDirectory = this.runDirectory(runId);
		let reviewManifest: JsonRecord;
		try {
			reviewManifest = await readJson<JsonRecord>(path.join(runDirectory, "review-manifest.json"));
		} catch (error) {
			return {
				run_id: runId,
				ok: false,
				bundle_files_checked: 0,
				artifact_objects_checked: 0,
				problems: [`REVIEW_MANIFEST_MISSING: ${String(error)}`],
			};
		}

		const bundleFiles = Array.isArray(reviewManifest.files) ? reviewManifest.files : [];
		for (const raw of bundleFiles) {
			if (!raw || typeof raw !== "object") continue;
			const item = raw as JsonRecord;
			try {
				const target = resolveInside(runDirectory, String(item.path ?? ""));
				const metadata = await stat(target);
				const digest = await sha256File(target);
				bundleFilesChecked += 1;
				if (metadata.size !== Number(item.bytes)) problems.push(`BUNDLE_SIZE_MISMATCH: ${String(item.path)}`);
				if (digest !== item.sha256) problems.push(`BUNDLE_HASH_MISMATCH: ${String(item.path)}`);
			} catch (error) {
				problems.push(`BUNDLE_FILE_FAILED ${String(item.path)}: ${String(error)}`);
			}
		}

		try {
			const artifacts = await readJson<ArtifactSnapshotManifest>(path.join(runDirectory, "artifact-manifest.json"));
			for (const item of artifacts.files) {
				if (checkedObjects.has(item.sha256)) continue;
				checkedObjects.add(item.sha256);
				try {
					const objectPath = resolveInside(this.root, item.object_path);
					const metadata = await stat(objectPath);
					const digest = await sha256File(objectPath);
					artifactObjectsChecked += 1;
					if (metadata.size !== item.bytes) problems.push(`OBJECT_SIZE_MISMATCH: ${item.sha256}`);
					if (digest !== item.sha256) problems.push(`OBJECT_HASH_MISMATCH: ${item.sha256}`);
				} catch (error) {
					problems.push(`OBJECT_FAILED ${item.sha256}: ${String(error)}`);
				}
			}
		} catch (error) {
			problems.push(`ARTIFACT_MANIFEST_FAILED: ${String(error)}`);
		}

		try {
			const request = await readJson<JsonRecord>(path.join(runDirectory, "request.json"));
			const parent = request.parent && typeof request.parent === "object" ? request.parent as JsonRecord : {};
			const images = Array.isArray(parent.images) ? parent.images : [];
			for (const raw of images) {
				if (!raw || typeof raw !== "object") continue;
				const item = raw as JsonRecord;
				const digest = typeof item.sha256 === "string" ? item.sha256 : "";
				if (!digest || checkedObjects.has(digest) || typeof item.object_path !== "string") continue;
				checkedObjects.add(digest);
				try {
					const objectPath = resolveInside(this.root, item.object_path);
					const metadata = await stat(objectPath);
					const actual = await sha256File(objectPath);
					artifactObjectsChecked += 1;
					if (metadata.size !== Number(item.bytes)) problems.push(`IMAGE_OBJECT_SIZE_MISMATCH: ${digest}`);
					if (actual !== digest) problems.push(`IMAGE_OBJECT_HASH_MISMATCH: ${digest}`);
				} catch (error) {
					problems.push(`IMAGE_OBJECT_FAILED ${digest}: ${String(error)}`);
				}
			}
		} catch (error) {
			problems.push(`REQUEST_IMAGE_MANIFEST_FAILED: ${String(error)}`);
		}

		try {
			const inputs = await this.readOptionalJson(path.join(runDirectory, "child-inputs.json"));
			const files = Array.isArray(inputs?.files) ? inputs.files : [];
			for (const raw of files) {
				if (!raw || typeof raw !== "object") continue;
				const item = raw as JsonRecord;
				const digest = typeof item.sha256 === "string" ? item.sha256 : "";
				if (!digest || checkedObjects.has(digest) || typeof item.object_path !== "string") continue;
				checkedObjects.add(digest);
				try {
					const objectPath = resolveInside(this.root, item.object_path);
					const metadata = await stat(objectPath);
					const actual = await sha256File(objectPath);
					artifactObjectsChecked += 1;
					if (metadata.size !== Number(item.bytes)) problems.push(`CHILD_INPUT_SIZE_MISMATCH: ${digest}`);
					if (actual !== digest) problems.push(`CHILD_INPUT_HASH_MISMATCH: ${digest}`);
				} catch (error) {
					problems.push(`CHILD_INPUT_FAILED ${digest}: ${String(error)}`);
				}
			}
		} catch (error) {
			problems.push(`CHILD_INPUT_MANIFEST_FAILED: ${String(error)}`);
		}

		return {
			run_id: runId,
			ok: problems.length === 0,
			bundle_files_checked: bundleFilesChecked,
			artifact_objects_checked: artifactObjectsChecked,
			problems,
		};
	}

	private async finalizeManifest(runId: string, parentCompleted: boolean): Promise<void> {
		const runDirectory = this.runDirectory(runId);
		const child = await this.readOptionalJson(path.join(runDirectory, "child-result.json"));
		const artifacts = await this.readOptionalJson(path.join(runDirectory, "artifact-manifest.json"));
		const complete = parentCompleted && child?.status === "completed" && artifacts?.status === "complete";
		await this.appendLifecycle(runId, `review_${complete ? "complete" : "partial"}`);
		const files = [];
		for (const target of await regularFiles(runDirectory)) {
			const relative = normalizedRelative(runDirectory, target);
			if (relative === "review-manifest.json") continue;
			const metadata = await stat(target);
			files.push({ path: relative, bytes: metadata.size, sha256: await sha256File(target) });
		}
		await writeJsonExclusive(path.join(runDirectory, "review-manifest.json"), {
			schema_version: REVIEW_SCHEMA_VERSION,
			run_id: runId,
			finalized_at_utc: utcNow(),
			status: complete ? "complete" : "partial",
			training_review: {
				label: "unreviewed",
				training_eligible: false,
				note: "Raw local review data; human curation, authorization and redaction are required before training.",
			},
			files,
		});
	}

	private async storeBuffer(content: Buffer): Promise<StoredObject> {
		const sha256 = createHash("sha256").update(content).digest("hex");
		const target = path.join(this.objectsRoot, sha256.slice(0, 2), sha256);
		let addedBytes = 0;
		if (!(await this.exists(target))) {
			await mkdir(path.dirname(target), { recursive: true });
			try {
				await writeFile(target, content, { flag: "wx", mode: 0o600 });
				addedBytes = content.length;
			} catch (error) {
				if (errorCode(error) !== "EEXIST") throw error;
			}
		}
		return {
			bytes: content.length,
			sha256,
			objectPath: target,
			objectRef: toProjectRef(target),
			sourceFingerprint: `buffer:${sha256}`,
			addedBytes,
		};
	}

	private async storeFile(source: string): Promise<StoredObject> {
		const resolved = path.resolve(source);
		const before = await stat(resolved);
		if (!before.isFile()) throw new Error("SNAPSHOT_SOURCE_NOT_FILE");
		const sourceFingerprint = createHash("sha256")
			.update(JSON.stringify({
				path: resolved.toLocaleLowerCase(),
				size: before.size,
				mtime_ms: before.mtimeMs,
				ctime_ms: before.ctimeMs,
			}))
			.digest("hex");
		const cachePath = path.join(this.cacheRoot, `${sourceFingerprint}.json`);
		try {
			const cached = await readJson<{ bytes: number; sha256: string; object_path: string }>(cachePath);
			const objectPath = resolveInside(this.root, cached.object_path);
			if (cached.bytes === before.size && (await stat(objectPath)).size === before.size) {
				return {
					bytes: cached.bytes,
					sha256: cached.sha256,
					objectPath,
					objectRef: toProjectRef(objectPath),
					sourceFingerprint,
					addedBytes: 0,
				};
			}
		} catch {
			// Cache misses are expected for a new source generation.
		}

		await mkdir(path.join(this.root, "tmp"), { recursive: true });
		const temporary = path.join(this.root, "tmp", `object-${randomUUID()}`);
		await copyFile(resolved, temporary);
		const after = await stat(resolved);
		if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
			await rm(temporary, { force: true });
			throw new Error("SNAPSHOT_SOURCE_CHANGED_DURING_COPY");
		}
		const sha256 = await sha256File(temporary);
		const target = path.join(this.objectsRoot, sha256.slice(0, 2), sha256);
		let addedBytes = 0;
		await mkdir(path.dirname(target), { recursive: true });
		if (await this.exists(target)) {
			await rm(temporary, { force: true });
		} else {
			try {
				await rename(temporary, target);
				addedBytes = before.size;
			} catch (error) {
				if (errorCode(error) !== "EEXIST") throw error;
				await rm(temporary, { force: true });
			}
		}
		const cacheRecord = {
			bytes: before.size,
			sha256,
			object_path: normalizedRelative(this.root, target),
		};
		await mkdir(this.cacheRoot, { recursive: true });
		try {
			await writeJsonExclusive(cachePath, cacheRecord);
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
		}
		return {
			bytes: before.size,
			sha256,
			objectPath: target,
			objectRef: toProjectRef(target),
			sourceFingerprint,
			addedBytes,
		};
	}

	private async readOptionalJson(target: string): Promise<JsonRecord | undefined> {
		try {
			return await readJson<JsonRecord>(target);
		} catch {
			return undefined;
		}
	}

	private async exists(target: string): Promise<boolean> {
		try {
			await stat(target);
			return true;
		} catch {
			return false;
		}
	}
}
