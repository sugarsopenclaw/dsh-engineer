import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { reviewExportsRoot, toProjectRef } from "./paths.ts";
import { ThcadReviewStore } from "./review-store.ts";

type JsonRecord = Record<string, unknown>;

export interface ReviewCandidateExportResult {
	output_ref: string;
	sample_count: number;
	skipped_incomplete: number;
	review_label: "unreviewed";
	training_eligible: false;
}

async function optionalJson(target: string): Promise<JsonRecord | undefined> {
	try {
		return JSON.parse(await readFile(target, "utf8")) as JsonRecord;
	} catch {
		return undefined;
	}
}

async function optionalText(target: string): Promise<string | undefined> {
	try {
		return await readFile(target, "utf8");
	} catch {
		return undefined;
	}
}

function defaultOutputPath(): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return path.join(reviewExportsRoot, `thcad-training-candidates-${timestamp}.jsonl`);
}

export async function exportReviewCandidates(
	outputPath = defaultOutputPath(),
	store = new ThcadReviewStore(),
): Promise<ReviewCandidateExportResult> {
	const resolvedOutput = path.resolve(outputPath);
	try {
		await stat(resolvedOutput);
		throw new Error(`OUTPUT_EXISTS: ${resolvedOutput}`);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("OUTPUT_EXISTS:")) throw error;
	}

	const runs = await store.listRuns(100_000);
	const records: string[] = [];
	let skippedIncomplete = 0;
	for (const summary of runs.reverse()) {
		if (!summary.review_complete) {
			skippedIncomplete += 1;
			continue;
		}
		const runDirectory = store.runDirectory(summary.run_id);
		const request = await optionalJson(path.join(runDirectory, "request.json"));
		const child = await optionalJson(path.join(runDirectory, "child-result.json"));
		const artifacts = await optionalJson(path.join(runDirectory, "artifact-manifest.json"));
		const parent = await optionalJson(path.join(runDirectory, "parent-result.json"));
		const reviewManifestText = await optionalText(path.join(runDirectory, "review-manifest.json"));
		const evidence = await optionalText(path.join(runDirectory, "evidence.md"));
		if (!request || !parent || !reviewManifestText || !evidence) {
			skippedIncomplete += 1;
			continue;
		}
		const parentRequest = request.parent && typeof request.parent === "object"
			? request.parent as JsonRecord
			: {};
		const analysisState = artifacts?.analysis_state && typeof artifacts.analysis_state === "object"
			? artifacts.analysis_state as JsonRecord
			: {};
		records.push(JSON.stringify({
			schema_version: 1,
			sample_id: summary.run_id,
			source: "pi_thcad_mechanical_review",
			review: {
				label: "unreviewed",
				training_eligible: false,
				contains_customer_data: true,
				requires_human_curation: true,
			},
			input: {
				parent_user_prompt: parentRequest.prompt,
				parent_images: parentRequest.images,
				delegated_task: request.task,
			},
			output: {
				parent_final_text: parent.final_text,
				child_evidence: evidence,
			},
			execution: {
				parent_model: parent.model ?? parentRequest.model,
				child_model: child?.model,
				child_usage: child?.usage,
				analysis_id: artifacts?.analysis_id,
				document_name: analysisState.document_name,
				dbmod_before: analysisState.dbmod_before,
				dbmod_after: analysisState.dbmod_after,
				source_status: analysisState.source_status,
			},
			provenance: {
				run_ref: summary.run_ref,
				child_session_ref: toProjectRef(path.join(runDirectory, "child-session")),
				child_events_ref: toProjectRef(path.join(runDirectory, "child-events.jsonl")),
				artifact_manifest_ref: toProjectRef(path.join(runDirectory, "artifact-manifest.json")),
				parent_session_snapshot_ref: parent.session_snapshot_ref,
				review_manifest_sha256: createHash("sha256").update(reviewManifestText).digest("hex"),
			},
		}));
	}

	await mkdir(path.dirname(resolvedOutput), { recursive: true });
	const temporary = `${resolvedOutput}.tmp-${randomUUID()}`;
	await writeFile(temporary, records.length ? `${records.join("\n")}\n` : "", {
		encoding: "utf8",
		flag: "wx",
		mode: 0o600,
	});
	await rename(temporary, resolvedOutput);
	return {
		output_ref: toProjectRef(resolvedOutput),
		sample_count: records.length,
		skipped_incomplete: skippedIncomplete,
		review_label: "unreviewed",
		training_eligible: false,
	};
}
