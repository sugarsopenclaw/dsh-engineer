# Frustum Box Protocol

This reference is intentionally stricter than a formula note. It defines the intermediate geometry contract that must exist before generating calculation code from screenshots.

## Subtype Gate

Route to `foundation.frustum_box` when all are true:

- Component text suggests independent foundation: `DJP`, `DJp`, `D_Jp`, `独立基础`, `锥形独立基础`.
- Plan screenshot shows an outer rectangular footing and diagonal slope/transition lines toward a smaller upper platform or center area.
- Section/practice screenshot shows a lower straight segment `h1` and an upper tapered segment `h2`, or an equivalent `h1/h2` label.
- A concrete volume target is requested. Rebar-only screenshots are not enough.

Return `needs_review` when the drawing only shows a stepped foundation, cup foundation, pile cap, slab, beam, or a generic prism.

## Canonical Parameters

All dimensions are in millimeters.

| Parameter | Meaning | Preferred evidence |
| --- | --- | --- |
| `bottom_length` | Overall lower footing length in X direction | Largest plan dimension on X axis |
| `bottom_width` | Overall lower footing width in Y direction | Largest plan dimension on Y axis |
| `top_length` | Upper face length of the frustum in X direction | Slope termination/platform chain on plan; section as support |
| `top_width` | Upper face width of the frustum in Y direction | Slope termination/platform chain on plan; section as support |
| `h_box` | Height of the lower cuboid part, equal to `h1` | Section vertical label or `DJPxx,h1/h2` after confirmation |
| `h_frustum` | Height of the tapered part, equal to `h2` | Section vertical label or `DJPxx,h1/h2` after confirmation |

Rejected aliases:

- `box_length`, `box_width`: do not use in the lower cuboid formula.
- `column_length`, `column_width`, center purple block, column rebar dimensions: not frustum top dimensions unless the screenshot explicitly labels the frustum upper face there.
- Cover sizes such as `50`, `100`, `>=150`: not footing volume dimensions unless the target quantity is cushion or protection layer.

## Screenshot Extraction Rules

1. Target lock:
   - Extract the component ID first, such as `DJP09`.
   - Bind dimensions to the closest plan/section view of that ID.
   - Do not borrow dimensions from a neighboring component or detail.

2. Height parsing:
   - Pattern `DJP09,300/600` usually maps to `h_box=300`, `h_frustum=600`.
   - Confirm with section text like `D_JpXX,h1/h2` or visible `h1`/`h2` markers.
   - If the two values conflict, keep both in `geometry_facts` and mark `missing_or_ambiguous`.

3. Bottom dimensions:
   - Use the largest overall green dimension lines around the outer footing rectangle.
   - For square examples such as a visible `4300` in both axes, set both bottom dimensions only if both axis labels or symmetry evidence exist.

4. Top dimensions:
   - Identify the rectangle where sloped faces terminate at the upper face of the frustum.
   - If plan chains show margins and a middle platform, use chain arithmetic:
     `top_length = bottom_length - left_slope_run - right_slope_run`
     `top_width = bottom_width - lower_slope_run - upper_slope_run`
   - If the upper face is represented by multiple contiguous segments, sum the full upper platform chain, not only the center column/core segment.
   - If only a column/core size is visible, do not treat it as `top_length/top_width` without explicit top-face evidence.

5. Construction-method text:
   - Keep rebar data in `geometry_facts.construction_notes`.
   - It may support target identity but must not enter the concrete volume formula.

## Required Cross-Checks

Every generated algorithm must include these checks before computing:

```text
bottom_length > 0
bottom_width > 0
top_length > 0
top_width > 0
h_box >= 0
h_frustum > 0
top_length <= bottom_length
top_width <= bottom_width
```

When dimension chains are available:

```text
abs((left_slope_run + top_length + right_slope_run) - bottom_length) <= tolerance
abs((lower_slope_run + top_width + upper_slope_run) - bottom_width) <= tolerance
```

Use a tolerance of 2 mm for OCR/CAD screenshot extraction unless project policy provides another tolerance.

## Algorithm Pseudocode

```python
def calculate_frustum_box_volume(params):
    required = [
        "bottom_length",
        "bottom_width",
        "top_length",
        "top_width",
        "h_box",
        "h_frustum",
    ]
    for key in required:
        if key not in params or params[key] is None:
            raise MissingParameter(key)

    bottom_length = mm(params["bottom_length"])
    bottom_width = mm(params["bottom_width"])
    top_length = mm(params["top_length"])
    top_width = mm(params["top_width"])
    h_box = mm(params["h_box"])
    h_frustum = mm(params["h_frustum"])

    assert bottom_length > 0 and bottom_width > 0
    assert top_length > 0 and top_width > 0
    assert h_box >= 0 and h_frustum > 0
    assert top_length <= bottom_length
    assert top_width <= bottom_width

    s_bottom = bottom_length * bottom_width
    s_top = top_length * top_width

    volume_box_mm3 = s_bottom * h_box
    volume_frustum_mm3 = (
        h_frustum / 3.0
        * (s_bottom + s_top + sqrt(s_bottom * s_top))
    )

    return round((volume_box_mm3 + volume_frustum_mm3) / 1_000_000_000, 2)
```

## JSON Template

```json
{
  "route": {
    "subtype_code": "foundation.frustum_box",
    "confidence": 0.0,
    "evidence": []
  },
  "geometry_facts": {
    "target_component_id": null,
    "texts": [],
    "plan_dimensions": [],
    "section_dimensions": [],
    "construction_notes": []
  },
  "resolved_params": {
    "bottom_length": {"value_mm": null, "evidence": null, "confidence": 0.0},
    "bottom_width": {"value_mm": null, "evidence": null, "confidence": 0.0},
    "top_length": {"value_mm": null, "evidence": null, "confidence": 0.0},
    "top_width": {"value_mm": null, "evidence": null, "confidence": 0.0},
    "h_box": {"value_mm": null, "evidence": null, "confidence": 0.0},
    "h_frustum": {"value_mm": null, "evidence": null, "confidence": 0.0}
  },
  "cross_checks": [],
  "algorithm_pseudocode": null,
  "missing_or_ambiguous": []
}
```

## Validation Command

After parameters are resolved, validate and compute with:

```bash
python scripts/validate_frustum_box_params.py params.json
```

The validator is a reference oracle for this skill. Generated calculator code should match its result for the same parameters.
