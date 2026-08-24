# Screenshot Example Notes

These notes describe the provided teaching screenshots and are not a substitute for OCR evidence in production.

## Image 1: Section / Practice Screenshot

Observed cues:

- Title resembles `锥形独立基础(D_Jp)做法示意`.
- Template label resembles `D_JpXX,h1/h2`.
- Vertical markers show cushion or bottom protection around `100`, then `h1`, then `h2`.
- The upper taper line and lower rectangular body match cuboid-plus-frustum geometry.
- Text includes construction-method notes and reinforcement notes. These support context but do not enter concrete volume.
- Cover values such as `50` and notes such as `>=150` are not footing concrete dimensions.

Extraction guidance:

- Treat `h1` as `h_box`.
- Treat `h2` as `h_frustum`.
- Exclude cushion thickness unless the user explicitly asks to calculate cushion volume.

## Image 2: Plan Screenshot

Observed cues:

- Component label resembles `DJP09,300/600`, likely target ID plus `h1/h2`.
- Reinforcement note resembles `B: X&Y: 16@200`; keep this as construction evidence only.
- Outer plan dimension shows `4300` on at least one axis and likely the same on the other axis for this square example.
- Center block appears as the column/core area. It is not automatically the frustum upper face.
- Diagonal lines from outer corners toward the center indicate sloped faces.

Extraction guidance:

- Resolve `bottom_length` and `bottom_width` from overall outer dimensions.
- Resolve `top_length` and `top_width` from the frustum upper platform, using chain arithmetic if the plan provides left/right and lower/upper slope runs.
- Do not use the center core label alone as the frustum top face unless another dimension or section mark proves that the sloped face terminates there.
- If OCR reads inconsistent chain dimensions, return ambiguity instead of forcing a result.

## Expected Model Behavior

For these screenshots, a good agent response should:

1. Classify the route as `foundation.frustum_box`.
2. Extract `h_box=300` and `h_frustum=600` only after noting the `DJP09,300/600` and section `h1/h2` convention.
3. Extract the overall base footprint from the `4300` plan dimensions.
4. Pause on `top_length/top_width` if the screenshot evidence does not unambiguously separate upper frustum platform size from column/core size.
5. Ignore rebar text and cover notes for volume.
