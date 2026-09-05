# ACadSharp / THCAD entity comparison (local PoC)

This PoC reads the customer DWGs directly with ACadSharp, without starting AutoCAD or THCAD, and compares the result with the existing THCAD `entities.jsonl` files by DWG handle.

It deliberately enables the maximum read surface relevant to this experiment:

- strict reading (`Failsafe = false`);
- keep unknown entities and non-graphical objects;
- decode proxy graphics (`IgnoreProxyGraphics = false`).

From the repository root:

```powershell
dotnet run --project dev-test/acadsharp-compare/AcadSharpProbe.csproj
```

Optional positional arguments are: a DWG file or directory, the THCAD output root, and the output root.

```powershell
dotnet run --project dev-test/acadsharp-compare/AcadSharpProbe.csproj -- `
  client-data/transformer-design-drawings `
  dev-test/visualstudionetframework/out-thcad `
  dev-test/acadsharp-compare/out
```

Generated customer-derived output stays under `dev-test/acadsharp-compare/out/` and is ignored by git. The project defaults to ACadSharp 3.7.1; override `ACadSharpVersion` to reproduce another package version.

## What the comparison writes

For every drawing:

- `entities.jsonl`: generic metadata, type-specific public properties, XData, extension-dictionary keys, normalized comparable facts, and proxy graphics;
- `dictionary-entries.jsonl`: recursive named-object dictionary inventory;
- `acadsharp-report.json`: reader configuration, counts, warnings, and timing;
- `comparison.json`: handle/type crosswalk plus geometry, text, data-coverage, and bounding-box parity against THCAD;
- `notifications.jsonl`: every ACadSharp reader notification.

The output root also contains `aggregate.json` with the merged seven-drawing result.

## Current result

On the seven transformer drawings, stock ACadSharp 3.7.1 reads 91,626 entities. All 91,605 THCAD baseline handles are present; the 21 ACadSharp-only records are three `TH_WaterMark` proxy entities per drawing. All 450 THCAD professional entities align by handle and class name as proxy entities, and 3.7.1 decodes their presentation graphics.

Ordinary line, circle, arc, point, insert-position, DBText, and raw MText facts match after coordinate normalization. ACadSharp's derived plain MText, dimension measurement, and especially built-in bounding boxes require our own normalization and must not be treated as authoritative.

The detailed interpretation is in `docs/dev/2026-09-05-ACadSharp与THCAD全量实体对照.md`.

To reproduce the stock 3.4.9 comparison in a separate output directory:

```powershell
dotnet run --project dev-test/acadsharp-compare/AcadSharpProbe.csproj `
  -p:ACadSharpVersion=3.4.9 -- `
  client-data/transformer-design-drawings `
  dev-test/visualstudionetframework/out-thcad `
  dev-test/acadsharp-compare/out/stock-3.4.9
```

That version preserves the same entity/proxy handles but does not expose the public proxy-graphics API available in 3.7.1.
