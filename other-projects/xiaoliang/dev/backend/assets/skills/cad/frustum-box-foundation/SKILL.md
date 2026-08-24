---
name: frustum-box-foundation
description: 识别并计算由下部矩形体与上部矩形截头体组成的锥形独立基础；当 CAD 证据包含 DJP/DJp、h1/h2、平面尺寸链或剖面做法时使用。
---

# 锥形独立基础截头体算量

Use this skill when screenshots show a tapered independent foundation: plan view with an outer rectangular footing, a smaller upper platform/column area, diagonal slope lines, and a section or note using `h1/h2`, `DJP`, `DJp`, `D_Jp`, or `锥形独立基础`.

## Workflow

1. Lock the target component ID before reading dimensions. Keep only screenshot text and dimensions spatially tied to that component.
2. Classify the subtype as `foundation.frustum_box` only if the evidence supports a lower cuboid plus an upper rectangular frustum. Otherwise return `needs_review`.
3. Build the geometry fact table first. Do not calculate directly from raw OCR.
4. Resolve the six canonical parameters:
   `bottom_length`, `bottom_width`, `top_length`, `top_width`, `h_box`, `h_frustum`.
5. Run the cross-checks in [references/frustum-box-protocol.md](references/frustum-box-protocol.md).
6. Generate algorithm code only after all required parameters are resolved with evidence.

## Critical Rules

- `bottom_length * bottom_width * h_box` is the lower cuboid volume. Do not use `box_length` or `box_width` for this formula.
- `top_length` and `top_width` mean the upper face of the frustum, not the column core, purple center block, rebar note, cover size, or stirrup spacing.
- `DJP09,300/600`-style labels may mean `h1/h2`; accept this only after cross-checking the section/practice screenshot or vertical height labels.
- Rebar text such as `B: X&Y: 16@200` and cover notes are construction-method evidence, not concrete volume dimensions.
- If any required parameter is missing or ambiguous, stop and ask for confirmation. Never invent a default value.

## Output Contract

Return a JSON object with:

- `route`: subtype, confidence, and routing evidence.
- `geometry_facts`: visible dimensions, texts, and their roles.
- `resolved_params`: the six canonical parameters with value, unit, evidence, and confidence.
- `cross_checks`: pass/fail checks for dimension chains and heights.
- `algorithm_pseudocode`: formula-ready pseudocode.
- `missing_or_ambiguous`: unresolved items that block calculation.

For the full parameter protocol, pseudocode, and validation command, read [references/frustum-box-protocol.md](references/frustum-box-protocol.md).
