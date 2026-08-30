import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = path.resolve(moduleDirectory, "../../../..");
export const bridgeRoot = path.join(repositoryRoot, ".pi", "runtime", "thcad-bridge");
export const bridgeProject = path.join(
	repositoryRoot,
	"local-dev",
	"cad",
	"hosts",
	"thcad-dotnet-bridge",
	"ThcadAgentBridge.csproj",
);
export const bridgeDeploymentRoot = path.join(bridgeRoot, "deployments");
export const bridgeDeploymentPointer = path.join(bridgeRoot, "current-dll.txt");
const legacyBridgeDll = path.join(
	path.dirname(bridgeProject),
	"bin",
	"x64",
	"Release",
	"Shb.Thcad.AgentBridge.dll",
);
export const invokeBridgeScript = path.join(repositoryRoot, "scripts", "invoke-thcad-agent-bridge.ps1");
export const projectGraphScript = path.join(
	repositoryRoot,
	"local-dev",
	"cad",
	"core",
	"20-cross-drawing-interface-graph",
	"build-cross-drawing-interface-graph.ps1",
);
export const projectGraphRoot = path.join(bridgeRoot, "project-graph");
export const evidenceRoot = path.join(repositoryRoot, ".pi", "runtime", "thcad-evidence");
export const reviewRoot = path.join(repositoryRoot, ".pi", "runtime", "thcad-reviews");
export const reviewRunsRoot = path.join(reviewRoot, "runs");
export const reviewObjectsRoot = path.join(reviewRoot, "objects", "sha256");
export const reviewCacheRoot = path.join(reviewRoot, "cache");
export const reviewExportsRoot = path.join(reviewRoot, "exports");

async function existingFile(candidate: string): Promise<string | undefined> {
	try {
		if ((await stat(candidate)).isFile()) return candidate;
	} catch {
		// Missing and stale deployment pointers are treated as not built.
	}
	return undefined;
}

export async function resolveBridgeDll(): Promise<string | undefined> {
	try {
		const relativeDll = (await readFile(bridgeDeploymentPointer, "utf8")).trim();
		if (relativeDll) {
			const deployed = resolveInside(bridgeDeploymentRoot, relativeDll);
			const existing = await existingFile(deployed);
			if (existing) return existing;
		}
	} catch {
		// Fall through to the pre-versioned build path for an existing local checkout.
	}
	return existingFile(legacyBridgeDll);
}

export function toProjectRef(absolutePath: string): string {
	const resolved = path.resolve(absolutePath);
	const relative = path.relative(repositoryRoot, resolved);
	if (relative === "") return ".";
	if (relative.startsWith("..") || path.isAbsolute(relative)) return path.basename(resolved);
	return relative.split(path.sep).join("/");
}

export function resolveInside(root: string, relativePath: string): string {
	const resolvedRoot = path.resolve(root);
	const resolved = path.resolve(resolvedRoot, relativePath);
	const relation = path.relative(resolvedRoot, resolved);
	if (relation.startsWith("..") || path.isAbsolute(relation)) {
		throw new Error("PATH_OUTSIDE_BRIDGE_ROOT");
	}
	return resolved;
}
