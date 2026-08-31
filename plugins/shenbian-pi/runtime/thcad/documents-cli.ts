import { executeThcadAppAction, type ThcadAppRequest } from "./documents.ts";

const [action = "status", selector, option] = process.argv.slice(2);
const request: ThcadAppRequest = { action: action as ThcadAppRequest["action"] };
if (selector) {
	if (selector.toLowerCase().endsWith(".dwg") || selector.includes("/") || selector.includes("\\")) request.path = selector;
	else request.name = selector;
}
if (action === "open" && option === "read-only") request.read_only = true;
if (action === "close" && option === "discard") request.discard_changes = true;
if (action === "copy_to_workspace" && option === "from-session") request.from_session = true;
const result = await executeThcadAppAction(request);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
