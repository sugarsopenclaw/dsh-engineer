import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ThcadArtifactStore, type ArtifactQuery } from "./artifact-store.ts";
import { bridgeRoot, projectGraphRoot, projectGraphScript } from "./paths.ts";

const execFileAsync = promisify(execFile);

export class ThcadProjectGraph {
	private readonly artifacts: ThcadArtifactStore;

	constructor(artifacts = new ThcadArtifactStore()) {
		this.artifacts = artifacts;
	}

	private get jsonPath(): string {
		return path.join(projectGraphRoot, "cross-drawing-interface-graph.json");
	}

	async build(signal?: AbortSignal): Promise<Record<string, unknown>> {
		await mkdir(projectGraphRoot, { recursive: true });
		try {
			const result = await execFileAsync(
				"pwsh.exe",
				[
					"-NoProfile",
					"-File",
					projectGraphScript,
					"-InputRoot",
					path.join(bridgeRoot, "artifacts"),
					"-OutputDirectory",
					projectGraphRoot,
				],
				{ encoding: "utf8", maxBuffer: 2 * 1024 * 1024, windowsHide: true, signal, timeout: 180_000 },
			);
			return {
				status: "built",
				build_summary: result.stdout.trim().split(/\r?\n/).slice(-3).join("\n"),
				...(await this.summary()),
			};
		} catch (error) {
			const value = error as { stderr?: string; message?: string };
			throw new Error(`PROJECT_GRAPH_BUILD_FAILED: ${(value.stderr ?? value.message ?? String(error)).slice(0, 1500)}`);
		}
	}

	async summary(): Promise<Record<string, unknown>> {
		return this.artifacts.queryStandaloneJson(this.jsonPath, { maxChars: 30_000 });
	}

	async query(query: ArtifactQuery): Promise<Record<string, unknown>> {
		return this.artifacts.queryStandaloneJson(this.jsonPath, query);
	}
}
