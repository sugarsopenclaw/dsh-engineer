import { exportReviewCandidates } from "./review-dataset.ts";
import { ThcadReviewStore } from "./review-store.ts";

async function main(): Promise<void> {
	const [action = "list", argument] = process.argv.slice(2);
	const store = new ThcadReviewStore();
	if (action === "list") {
		const limit = Math.max(1, Math.min(Number(argument ?? 20) || 20, 200));
		process.stdout.write(`${JSON.stringify(await store.listRuns(limit), null, 2)}\n`);
		return;
	}
	if (action === "verify") {
		if (!argument) throw new Error("Usage: thcad-review verify <run-id>");
		const result = await store.verifyRun(argument);
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		if (!result.ok) process.exitCode = 1;
		return;
	}
	if (action === "export-candidates") {
		const result = await exportReviewCandidates(argument, store);
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	throw new Error("Usage: thcad-review <list [limit] | verify <run-id> | export-candidates [output.jsonl]>");
}

void main().catch((error) => {
	process.stderr.write(`${String(error)}\n`);
	process.exitCode = 1;
});
