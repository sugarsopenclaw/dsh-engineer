/** Extract workbook values, formulas, styles and rendered sheets for curation. */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  throw new Error("usage: node extract_xlsx.mjs <input.xlsx> <output-dir>");
}

const inputPath = path.resolve(inputArg);
const outputDir = path.resolve(outputArg);
await fs.mkdir(outputDir, { recursive: true });

const inputBytes = await fs.readFile(inputPath);
const sourceSha256 = crypto.createHash("sha256").update(inputBytes).digest("hex");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

const summary = await workbook.inspect({
  kind: "workbook,sheet,table,drawing,definedName",
  include: "id,name,range,usedRange",
  maxChars: 20000,
  tableMaxRows: 30,
  tableMaxCols: 20,
  tableMaxCellChars: 500,
});
await fs.writeFile(path.join(outputDir, "workbook-summary.ndjson"), summary.ndjson, "utf8");

const manifest = {
  sourceName: path.basename(inputPath),
  sourceSha256,
  sheets: [],
};

for (const sheet of workbook.worksheets.items) {
  const safeName = sheet.name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  const usedRange = sheet.getUsedRange();
  const values = usedRange ? usedRange.values : [];
  const formulas = usedRange ? usedRange.formulas : [];
  const rowCount = Array.isArray(values) ? values.length : 0;
  const columnCount = rowCount
    ? Math.max(...values.map((row) => (Array.isArray(row) ? row.length : 0)))
    : 0;
  const a1Range = rowCount && columnCount ? `A1:${columnName(columnCount)}${rowCount}` : "A1";

  await fs.writeFile(
    path.join(outputDir, `${safeName}.values.json`),
    JSON.stringify({ sheetName: sheet.name, assumedRange: a1Range, values, formulas }, null, 2),
    "utf8",
  );

  const region = await workbook.inspect({
    kind: "region,formula",
    sheetId: sheet.name,
    range: a1Range,
    maxChars: 50000,
    options: { maxResults: 2000 },
  });
  await fs.writeFile(path.join(outputDir, `${safeName}.region.ndjson`), region.ndjson, "utf8");

  const styles = await workbook.inspect({
    kind: "computedStyle",
    sheetId: sheet.name,
    range: a1Range,
    maxChars: 50000,
    options: { maxResults: 2000 },
  });
  await fs.writeFile(path.join(outputDir, `${safeName}.styles.ndjson`), styles.ndjson, "utf8");

  const preview = await workbook.render({
    sheetName: sheet.name,
    autoCrop: "all",
    scale: 1.5,
    format: "png",
  });
  await fs.writeFile(
    path.join(outputDir, `${safeName}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );

  manifest.sheets.push({ name: sheet.name, a1Range, rowCount, columnCount });
}

await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

function columnName(count) {
  let value = count;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
