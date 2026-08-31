import { buildTextIndex, searchTextIndex, textIndexStatus } from "./text-index.ts";

const [action = "status", ...arguments_] = process.argv.slice(2);
let result: unknown;
if (action === "build") {
	result = await buildTextIndex();
} else if (action === "status") {
	result = await textIndexStatus();
} else if (action === "search") {
	const query = arguments_.join(" ").trim();
	if (!query) throw new Error("search requires a query");
	result = await searchTextIndex({ query, limit: 100 });
} else {
	throw new Error(`Unknown text-index action: ${action}`);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
