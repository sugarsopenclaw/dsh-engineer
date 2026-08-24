export interface PlanarBox {
  min: [number, number]
  max: [number, number]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads a `[x, y]`/`[x, y, z]` tuple, ignoring elevation. */
export function planarPoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const [x, y] = value
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
    ? [x, y]
    : null
}

/**
 * The coordinate system a record's box was authored in.
 *
 * Each owner scope is its own system: model space is the drawing's world space, every
 * layout measures in sheet millimetres, and a block definition is drawn around the
 * block's own origin. A record without an owner scope came from a backend that only ever
 * read model space, so it is world space by construction.
 */
export function recordSpace(record: Record<string, unknown>): string {
  const scope = record.owner_scope
  return typeof scope === 'string' && scope ? scope : 'model_space'
}

/**
 * Whether a record's box can be crossed against a world-space window.
 *
 * A chair inside a block definition is drawn around the block's origin, so crossing it
 * against a world window would answer for the origin instead of for any place the chair
 * was actually inserted. Sheet space fails the same way at a different scale: a layout's
 * boxes are paper millimetres, which would collapse into a corner of a metric site plan.
 */
export function isWorldSpaceRecord(record: Record<string, unknown>): boolean {
  return recordSpace(record) === 'model_space'
}

/**
 * Whether a record is something a reader sees on a sheet.
 *
 * Model space and layouts both show what the author placed in them. A block definition
 * shows nothing on its own: its contents appear once per reference pointing at it, so
 * counting them as sheet occurrences answers neither one nor the reference count.
 */
export function isSheetRecord(record: Record<string, unknown>): boolean {
  const space = recordSpace(record)
  return space === 'model_space' || space === 'paper_space'
}

/** Normalizes a serialized entity bbox without rejecting point- or line-like boxes. */
export function recordBox(record: Record<string, unknown>): PlanarBox | null {
  const bbox = record.bbox
  if (!isRecord(bbox)) return null
  const min = planarPoint(bbox.min)
  const max = planarPoint(bbox.max)
  if (!min || !max) return null
  return {
    min: [Math.min(min[0], max[0]), Math.min(min[1], max[1])],
    max: [Math.max(min[0], max[0]), Math.max(min[1], max[1])],
  }
}

export function unionBoxes(boxes: readonly PlanarBox[]): PlanarBox | null {
  const first = boxes[0]
  if (!first) return null
  const union: PlanarBox = {
    min: [...first.min] as [number, number],
    max: [...first.max] as [number, number],
  }
  for (const box of boxes.slice(1)) {
    union.min[0] = Math.min(union.min[0], box.min[0])
    union.min[1] = Math.min(union.min[1], box.min[1])
    union.max[0] = Math.max(union.max[0], box.max[0])
    union.max[1] = Math.max(union.max[1], box.max[1])
  }
  return union
}

/**
 * Grows a box by a ratio of its own size and keeps it non-degenerate.
 *
 * A zero-extent box is normal here: a point-like entity such as a single text insertion
 * has no width, and a render window with zero area is rejected downstream.
 */
export function padBox(box: PlanarBox, ratio: number, minimumSpan = 1): PlanarBox {
  const width = box.max[0] - box.min[0]
  const height = box.max[1] - box.min[1]
  const span = Math.max(width, height, minimumSpan)
  const padX = Math.max(width * ratio, span * ratio)
  const padY = Math.max(height * ratio, span * ratio)
  return {
    min: [box.min[0] - padX, box.min[1] - padY],
    max: [box.max[0] + padX, box.max[1] + padY],
  }
}

/** Inclusive AABB crossing, including boundary touches and zero-area entity boxes. */
export function intersects(left: PlanarBox, right: PlanarBox): boolean {
  return (
    left.min[0] <= right.max[0]
    && left.max[0] >= right.min[0]
    && left.min[1] <= right.max[1]
    && left.max[1] >= right.min[1]
  )
}
