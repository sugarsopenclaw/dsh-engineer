import type { CadBridgeBBox, CadBridgeFrame } from '../../../../cad/drivers/autocad-http/cad-application-facade'
import type { CadVisualRegionAssessment } from './visual-contract'

/**
 * Frame detection is a heuristic over closed polylines, block names and layer names, so a stray
 * 335x540 rectangle on a title-block layer can win over the real sheet border. Indexing that
 * rectangle produced five blank captures and a published-but-useless visual index, so a candidate
 * now has to look like a sheet next to the drawing extents before it is worth capturing.
 */
export const MIN_FRAME_AREA_RATIO = 0.02
export const MAX_FRAME_ASPECT_RATIO = 8
export const MIN_FRAME_SIDE = 1

export type CadFrameWindowSource = 'detected' | 'extents_fallback'

export interface CadFrameWindow {
  frameId: string
  bbox: CadBridgeBBox
  source: CadFrameWindowSource
  warnings: string[]
}

export interface CadFrameWindowPlan {
  primary: CadFrameWindow
  /** Present only when the primary window is a detected frame that can still fall back. */
  fallback: CadFrameWindow | null
}

function width(bbox: CadBridgeBBox): number {
  return bbox.max[0] - bbox.min[0]
}

function height(bbox: CadBridgeBBox): number {
  return bbox.max[1] - bbox.min[1]
}

function area(bbox: CadBridgeBBox): number {
  return width(bbox) * height(bbox)
}

function round(value: number): string {
  return Number.isFinite(value) ? value.toFixed(Math.abs(value) < 10 ? 3 : 0) : 'unknown'
}

/**
 * Returns why the candidate cannot be a drawing sheet, or null when it is plausible.
 */
export function describeFrameRejection(
  frame: CadBridgeFrame,
  extents: CadBridgeBBox | null,
): string | null {
  const frameWidth = width(frame.bbox)
  const frameHeight = height(frame.bbox)
  if (!(frameWidth >= MIN_FRAME_SIDE) || !(frameHeight >= MIN_FRAME_SIDE)) {
    return `${frame.frameId} is ${round(frameWidth)}x${round(frameHeight)} drawing units, too small to be a sheet`
  }
  const aspect = Math.max(frameWidth, frameHeight) / Math.min(frameWidth, frameHeight)
  if (aspect > MAX_FRAME_ASPECT_RATIO) {
    return `${frame.frameId} is a ${round(aspect)}:1 strip, not a sheet`
  }
  if (!extents || area(extents) <= 0) return null
  const ratio = area(frame.bbox) / area(extents)
  if (ratio < MIN_FRAME_AREA_RATIO) {
    return `${frame.frameId} covers ${(ratio * 100).toFixed(2)}% of the drawing extents `
      + `(${round(frameWidth)}x${round(frameHeight)} inside ${round(width(extents))}x${round(height(extents))}), `
      + 'so it is a detail rectangle rather than the sheet border'
  }
  return null
}

/**
 * Picks the window to capture for a persistent visual index.
 *
 * The chosen window keeps the requested frame id even when it falls back to the extents, because
 * the artifact layout and cache are keyed by that id; `source` records what was really captured.
 */
export function planFrameWindow(
  frames: readonly CadBridgeFrame[],
  extents: CadBridgeBBox | null,
  frameId: string,
): CadFrameWindowPlan {
  const extentsWindow = extents && area(extents) > 0
    ? { frameId, bbox: extents, source: 'extents_fallback' as const, warnings: [] }
    : null
  const requested = frames.find((frame) => frame.frameId === frameId)
  if (!requested) {
    const available = frames.map((frame) => frame.frameId).join(', ') || 'none'
    if (!extentsWindow) {
      throw new Error(`Frame ${frameId} was not detected (available: ${available}) and the drawing reported no extents.`)
    }
    return {
      primary: {
        ...extentsWindow,
        warnings: [
          `Frame ${frameId} was not detected (available: ${available}); captured the whole drawing extents instead.`,
        ],
      },
      fallback: null,
    }
  }
  if (requested.source === 'extents') {
    return {
      primary: { frameId, bbox: requested.bbox, source: 'extents_fallback', warnings: [] },
      fallback: null,
    }
  }
  const rejection = describeFrameRejection(requested, extents)
  if (!rejection) {
    return {
      primary: { frameId, bbox: requested.bbox, source: 'detected', warnings: [] },
      fallback: extentsWindow,
    }
  }
  if (!extentsWindow) {
    return {
      primary: {
        frameId,
        bbox: requested.bbox,
        source: 'detected',
        warnings: [`Frame sanity check failed (${rejection}) but the drawing reported no extents to fall back to.`],
      },
      fallback: null,
    }
  }
  return {
    primary: {
      ...extentsWindow,
      warnings: [`Frame sanity check rejected the detected frame: ${rejection}. Captured the whole drawing extents instead.`],
    },
    fallback: null,
  }
}

/** A plot that produced no ink is reported per strategy; treat it as a reason to widen the window. */
export function hasEmptyPlotSignal(warnings: readonly string[]): boolean {
  return warnings.some((warning) => warning.includes('PLOT_EMPTY'))
}

/**
 * True when the vision model saw nothing worth indexing anywhere: no region was legible and none
 * was even worth zooming into. Dense-but-small content comes back as needs_zoom instead.
 */
export function allRegionsBlank(regions: readonly CadVisualRegionAssessment[]): boolean {
  if (!regions.length) return true
  return regions.every((region) => !region.legible && !region.needs_zoom)
}
