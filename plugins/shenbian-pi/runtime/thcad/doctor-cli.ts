import { ThcadBridgeClient } from "./bridge-client.ts";

async function main(): Promise<void> {
	const status = await new ThcadBridgeClient().invoke("status", {}, { timeoutSeconds: 30 });
	process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}

void main().catch((error: unknown) => {
	const value = error as { code?: string; message?: string };
	process.stderr.write(`${value.code ?? "THCAD_DOCTOR_FAILED"}: ${value.message ?? String(error)}\n`);
	process.exitCode = 1;
});
