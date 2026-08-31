import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertReadableDrawingPath, assertWorkspaceTarget } from "./documents.ts";

test("document path guard accepts client drawings and forces writes into workspace", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-document-guard-"));
	const clientRoot = path.join(root, "client-data");
	const workspaceRoot = path.join(root, "workspace");
	await Promise.all([mkdir(clientRoot), mkdir(workspaceRoot)]);
	const drawing = path.join(clientRoot, "sample.dwg");
	await writeFile(drawing, "fixture");
	try {
		const readable = await assertReadableDrawingPath(drawing, { clientDataRoot: clientRoot, workspaceRoot });
		assert.equal(readable.underClientData, true);
		assert.equal(readable.underWorkspace, false);

		const target = await assertWorkspaceTarget(path.join(workspaceRoot, "guard-test.dwg"), false, { workspaceRoot });
		assert.equal(path.dirname(target), await realpath(workspaceRoot));
		await assert.rejects(
			assertWorkspaceTarget(path.join(clientRoot, "forbidden.dwg"), false, { workspaceRoot }),
			(error: unknown) => (error as { code?: string }).code === "WRITE_OUTSIDE_WORKSPACE_REFUSED",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("document path guard rejects non-DWG targets and paths outside allowed roots", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "shenbian-document-reject-"));
	const clientRoot = path.join(root, "client-data");
	const workspaceRoot = path.join(root, "workspace");
	await Promise.all([mkdir(clientRoot), mkdir(workspaceRoot)]);
	const outside = path.join(root, "outside.dwg");
	await writeFile(outside, "fixture");
	try {
		await assert.rejects(
			assertWorkspaceTarget(path.join(workspaceRoot, "not-a-drawing.txt"), false, { workspaceRoot }),
			(error: unknown) => (error as { code?: string }).code === "INVALID_ARGUMENT",
		);
		await assert.rejects(assertReadableDrawingPath(outside, { clientDataRoot: clientRoot, workspaceRoot }));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
