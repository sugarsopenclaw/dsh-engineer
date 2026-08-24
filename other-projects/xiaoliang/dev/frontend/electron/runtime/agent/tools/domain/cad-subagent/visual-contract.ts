import { createHash } from 'node:crypto'

export const CAD_VISUAL_MODEL = 'qwen3.8-max'
export const CAD_VISUAL_PRODUCER_VERSION = 'visual-index-v2'
export const CAD_VISUAL_PROMPT_VERSION = 'macro-navigation-v3'
export const CAD_VISUAL_CAPTURE_MAX_PIXELS = 4_096 * 4_096
export const CAD_VISUAL_MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const CAD_VISUAL_HIGH_RESOLUTION_IMAGES = true
export const CAD_VISUAL_FIRST_LEVEL_REGIONS = ['full', 'q1', 'q2', 'q3', 'q4'] as const
export const CAD_VISUAL_QUADRANTS = ['q1', 'q2', 'q3', 'q4'] as const

export type CadVisualFirstLevelRegion = (typeof CAD_VISUAL_FIRST_LEVEL_REGIONS)[number]
export type CadVisualQuadrant = (typeof CAD_VISUAL_QUADRANTS)[number]

export interface CadVisualProducerDescriptor {
  name: string
  version: string
  fingerprint: string
}

export function createCadVisualProducer(frameId: string): CadVisualProducerDescriptor {
  if (!/^frame-[0-9]{2}$/u.test(frameId)) {
    throw new Error('Persistent CAD visual indexes require a detected frame id.')
  }
  return {
    name: 'cad_capture.visual_index',
    version: CAD_VISUAL_PRODUCER_VERSION,
    fingerprint: createHash('sha256')
      .update([
        'cad_capture.visual_index',
        CAD_VISUAL_PRODUCER_VERSION,
        CAD_VISUAL_PROMPT_VERSION,
        CAD_VISUAL_MODEL,
        `max_pixels=${CAD_VISUAL_CAPTURE_MAX_PIXELS}`,
        `high_resolution=${CAD_VISUAL_HIGH_RESOLUTION_IMAGES}`,
        `frame_id=${frameId}`,
        `first_level=${CAD_VISUAL_FIRST_LEVEL_REGIONS.join(',')}`,
        'max_depth=2',
      ].join('\u0000'), 'utf8')
      .digest('hex'),
  }
}

export interface CadVisualOverview {
  title: string | null
  drawing_type: string | null
  scale: string | null
  summary: string
  visible_sections: string[]
}

export interface CadVisualRegionAssessment {
  region_id: string
  legible: boolean
  needs_zoom: boolean
  summary: string
  labels: string[]
}

