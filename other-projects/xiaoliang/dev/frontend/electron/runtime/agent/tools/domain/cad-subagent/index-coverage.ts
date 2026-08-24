/**
 * One definition of "the entity index covers this drawing" for both extraction backends.
 *
 * MLightCAD and AutoCAD COM index authored top-level entities only, so an index is complete
 * only when nothing was skipped, failed, opaque, or hidden inside an unexpanded block. The
 * two summaries compute their inputs separately because they see different metadata, but the
 * verdict itself lives here so the backends can never drift into disagreeing about it.
 */

export const OPAQUE_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'ole2frame',
  'proxyentity',
  'acad_proxy_entity',
  'acad_proxy_object',
])

export const BLOCK_REFERENCE_TYPES: ReadonlySet<string> = new Set(['block_reference', 'insert'])

export type CadBlockExpansion = 'expanded' | 'not_expanded'

export function opaqueEntityCounts(
  typeCounts: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(typeCounts).filter(([type]) => OPAQUE_ENTITY_TYPES.has(type.toLocaleLowerCase())),
  )
}

export function blockReferenceCount(typeCounts: Readonly<Record<string, number>>): number {
  return Object.entries(typeCounts)
    .filter(([type]) => BLOCK_REFERENCE_TYPES.has(type.toLocaleLowerCase()))
    .reduce((sum, [, count]) => sum + count, 0)
}

/**
 * Neither backend expands block references today. Absence of an explicit upstream claim
 * therefore means "not expanded" rather than "complete": this is read from a structured
 * flag instead of prose so that rewording a capture-semantics sentence can never silently
 * mark an index complete.
 */
export function blockExpansionFromSummary(value: unknown): CadBlockExpansion {
  return value === true ? 'expanded' : 'not_expanded'
}

export interface CadIndexCoverageInput {
  sourceEntityCount: number
  indexedEntityCount: number
  omittedGeometryCount: number
  failedEntityCount: number
  opaqueEntityCount: number
  /** Entities the backend knows it did not descend into, however it counts them. */
  unexpandedBlockCount: number
}

export interface CadIndexCoverageVerdict {
  unindexedEntityCount: number
  completeIndex: boolean
}

export function cadIndexCoverage(input: CadIndexCoverageInput): CadIndexCoverageVerdict {
  const unindexedEntityCount = input.sourceEntityCount - input.indexedEntityCount
  if (unindexedEntityCount < 0) {
    throw new Error('CAD indexed entity count exceeds the source entity count.')
  }
  return {
    unindexedEntityCount,
    completeIndex: unindexedEntityCount === 0
      && input.failedEntityCount === 0
      && input.omittedGeometryCount === 0
      && input.opaqueEntityCount === 0
      && input.unexpandedBlockCount === 0,
  }
}
