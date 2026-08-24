import fs from 'node:fs'
import path from 'node:path'

import type { CadBridgeDrawing } from '../../../../cad/drivers/autocad-http/cad-application-facade'
import type { MLightCadExtractor } from '../../../../cad/mlight/mlight-extraction-service'
import type { FactsBuildService } from '../../../../cad/facts/facts-build-service'
import {
  CAD_MLIGHT_ENTITIES_PRODUCER,
  cleanupCadArtifactRun,
  createCadArtifactRunId,
  drawingArtifactPaths,
  promoteStagedEntities,
  resolveProjectFile,
  sha256File,
  type CadSourceFingerprint,
} from './artifact-store'
import {
  blockExpansionFromSummary,
  cadIndexCoverage,
  opaqueEntityCounts as filterOpaqueEntityCounts,
  type CadBlockExpansion,
} from './index-coverage'

const DRAWING_EXTENSIONS: ReadonlySet<string> = new Set(['.dwg', '.dxf'])

export async function sourceFingerprint(
  projectRoot: string,
  drawing: Pick<CadBridgeDrawing, 'project_relative_path'>,
  signal?: AbortSignal,
): Promise<CadSourceFingerprint> {
  const source = resolveProjectFile(projectRoot, drawing.project_relative_path, {
    extensions: DRAWING_EXTENSIONS,
  })
  const stat = await fs.promises.stat(source.absolutePath)
  if (!stat.isFile()) throw new Error('CAD drawing source must be a regular file.')
  return { size: stat.size, sha256: await sha256File(source.absolutePath, signal) }
}

export function drawingFromProjectPath(projectRoot: string, value: string): CadBridgeDrawing {
  const drawing = resolveProjectFile(projectRoot, value, { extensions: DRAWING_EXTENSIONS })
  return {
    name: path.posix.basename(drawing.relativePath),
    project_relative_path: drawing.relativePath,
    saved: true,
    dbmod: 0,
  }
}

function summaryCount(value: unknown, label: string, maximum = 2_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`MLightCAD returned an invalid ${label}.`)
  }
  return value as number
}

function summaryTypeCounts(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('MLightCAD returned invalid entity type counts.')
  }
  const entries = Object.entries(value)
  if (entries.length > 10_000) throw new Error('MLightCAD returned too many entity type counts.')
  const counts: Record<string, number> = Object.create(null) as Record<string, number>
  for (const [key, count] of entries) {
    if (!key || key.length > 512) throw new Error('MLightCAD returned an invalid entity type name.')
    counts[key] = summaryCount(count, 'entity type count')
  }
  return counts
}

function optionalSummaryCounts(value: unknown, label: string): Record<string, number> {
  if (value === undefined) return Object.create(null) as Record<string, number>
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`MLightCAD returned invalid ${label}.`)
  }
  const entries = Object.entries(value)
  if (entries.length > 10_000) throw new Error(`MLightCAD returned too many ${label}.`)
  const counts: Record<string, number> = Object.create(null) as Record<string, number>
  for (const [key, count] of entries) {
    if (!key || key.length > 1_024) throw new Error(`MLightCAD returned an invalid ${label} key.`)
    counts[key] = summaryCount(count, label)
  }
  return counts
}

function optionalSummaryText(value: unknown, label: string): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string' || !value.trim() || value.length > 4_096) {
    throw new Error(`MLightCAD returned invalid ${label}.`)
  }
  return value.trim()
}

function summaryBlockInventory(value: unknown): Record<string, unknown>[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new Error('MLightCAD returned an invalid block inventory.')
  }
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('MLightCAD returned an invalid block inventory record.')
    }
    const record = item as Record<string, unknown>
    if (Object.keys(record).length > 64) {
      throw new Error('MLightCAD returned an oversized block inventory record.')
    }
    return { ...record }
  })
}

/**
 * Counts block definitions whose authored contents never reached the searchable index.
 * MLightCAD publishes a block inventory, so unlike the COM backend this can name the
 * definitions rather than only counting the references that point into them.
 */
function countUnexpandedAnnotationBlocks(
  blockExpansion: CadBlockExpansion,
  blockInventory: readonly Record<string, unknown>[],
): number {
  if (blockExpansion === 'expanded') return 0
  return blockInventory.filter((record) => (
    record.owner_scope === 'block_definition'
    && record.declared_entity_count !== 0
  )).length
}

export function mlightExtractionSummary(
  result: Record<string, unknown>,
  drawing: CadBridgeDrawing,
): Record<string, unknown> {
  const paths = drawingArtifactPaths(drawing)
  const indexedEntityCount = summaryCount(result.indexed_entity_count, 'indexed entity count')
  const sourceEntityCount = summaryCount(result.source_entity_count, 'source entity count')
  if (indexedEntityCount > sourceEntityCount) {
    throw new Error('MLightCAD indexed entity count exceeds the source entity count.')
  }
  const omittedGeometryCount = summaryCount(result.omitted_geometry_count, 'omitted geometry count')
  const failedEntityCount = summaryCount(result.failed_entity_count, 'failed entity count')
  const typeCounts = summaryTypeCounts(result.type_counts)
  const opaqueEntityCounts = result.opaque_entity_counts === undefined
    ? filterOpaqueEntityCounts(typeCounts)
    : optionalSummaryCounts(result.opaque_entity_counts, 'opaque entity count')
  const opaqueEntityCount = Object.values(opaqueEntityCounts).reduce((sum, count) => sum + count, 0)
  const captureSemantics = optionalSummaryText(result.capture_semantics, 'capture semantics')
  const captureScope = optionalSummaryText(result.capture_scope, 'capture scope')
  const blockInventory = summaryBlockInventory(result.block_inventory)
  const ownerScopeCounts = optionalSummaryCounts(result.owner_scope_counts, 'owner scope count')
  const ownerBlockCounts = optionalSummaryCounts(result.owner_block_counts, 'owner block count')
  const blockExpansion = blockExpansionFromSummary(result.block_references_expanded)
  const annotationBlocksUnexpanded = countUnexpandedAnnotationBlocks(blockExpansion, blockInventory)
  const coverage = cadIndexCoverage({
    sourceEntityCount,
    indexedEntityCount,
    omittedGeometryCount,
    failedEntityCount,
    opaqueEntityCount,
    unexpandedBlockCount: annotationBlocksUnexpanded,
  })
  const duration = (value: unknown): number | undefined => (
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3_600_000
      ? Math.round(value * 10) / 10
      : undefined
  )
  const parseDuration = duration(result.parse_duration_ms)
  const extractDuration = duration(result.extract_duration_ms)
  return {
    raw_path: paths.rawPath,
    readable_path: paths.readablePath,
    source_entity_count: sourceEntityCount,
    indexed_entity_count: indexedEntityCount,
    unindexed_entity_count: coverage.unindexedEntityCount,
    omitted_geometry_count: omittedGeometryCount,
    failed_entity_count: failedEntityCount,
    type_counts: typeCounts,
    opaque_entity_counts: opaqueEntityCounts,
    opaque_entity_count: opaqueEntityCount,
    ...(captureScope ? { capture_scope: captureScope } : {}),
    ...(captureSemantics ? { capture_semantics: captureSemantics } : {}),
    ...(result.block_record_count !== undefined
      ? { block_record_count: summaryCount(result.block_record_count, 'block record count', 100_000) }
      : {}),
    owner_scope_counts: ownerScopeCounts,
    owner_block_counts: ownerBlockCounts,
    block_inventory: blockInventory,
    block_expansion: blockExpansion,
    annotation_blocks_unexpanded: annotationBlocksUnexpanded,
    layer_count: summaryCount(result.layer_count, 'layer count', 100_000),
    ...(parseDuration !== undefined ? { parse_duration_ms: parseDuration } : {}),
    ...(extractDuration !== undefined ? { extract_duration_ms: extractDuration } : {}),
    backend: 'mlight',
    complete_index: coverage.completeIndex,
    include_geometry: true,
  }
}

export interface MLightEntityIndexResult {
  summary: Record<string, unknown>
  manifestPath: string
  rawPath: string
  readablePath: string
  warnings: string[]
}

/**
 * Runs a full MLightCAD entity extraction and publishes it as the drawing's persistent
 * index.
 *
 * Both CAD subagents go through here so the published artifact carries the same producer
 * fingerprint whichever agent asked for it: the fingerprint describes the parser that
 * produced the bytes, not the caller, so the analyst and the drafter share one cache
 * instead of invalidating each other's.
 *
 * The source is fingerprinted on both sides of the extraction because a drawing edited
 * mid-run would otherwise be published under the hash of content that was never indexed.
 */
export async function buildMLightEntityIndex(input: {
  projectRoot: string
  drawing: CadBridgeDrawing
  extractor: MLightCadExtractor
  factsBuildService?: FactsBuildService
  signal?: AbortSignal
}): Promise<MLightEntityIndexResult> {
  const { projectRoot, drawing, extractor, signal } = input
  const artifactRunId = createCadArtifactRunId()
  try {
    const sourceBefore = await sourceFingerprint(projectRoot, drawing, signal)
    const extracted = await extractor.extract({
      projectRoot,
      sourceRelativePath: drawing.project_relative_path,
      artifactRunId,
      // Database scope reaches layouts and block definitions. A drawing keeps most of its
      // annotation inside blocks — room names, door and window marks, legends — and model
      // space alone leaves all of that unsearchable. Consumers separate the spaces by
      // owner_scope, because only model space can answer a world-space window.
      filters: { includeGeometry: true, scope: 'database' },
      ...(signal ? { signal } : {}),
    })
    const expectedStageRoot = `.xiaoliang/cad/.staging/${artifactRunId}/entities`
    if (
      extracted.rawPath !== `${expectedStageRoot}/entities.raw.jsonl`
      || extracted.readablePath !== `${expectedStageRoot}/entities.readable.md`
    ) throw new Error('MLightCAD returned an unexpected staging artifact path.')
    const sourceAfter = await sourceFingerprint(projectRoot, drawing, signal)
    if (sourceBefore.size !== sourceAfter.size || sourceBefore.sha256 !== sourceAfter.sha256) {
      throw new Error('Drawing content changed during MLightCAD extraction.')
    }
    const summary = mlightExtractionSummary(extracted.summary, drawing)
    const published = await promoteStagedEntities({
      projectRoot,
      drawing,
      artifactRunId,
      summary,
      producer: CAD_MLIGHT_ENTITIES_PRODUCER,
      sourceFingerprint: sourceBefore,
      ...(signal ? { signal } : {}),
    })
    const factsWarnings: string[] = []
    if (input.factsBuildService) {
      try {
        const facts = await input.factsBuildService.ensureL1({
          projectRoot,
          drawing,
          mlightIndexPath: published.rawPath,
          force: true,
        })
        factsWarnings.push(...facts.warnings)
      } catch (error) {
        factsWarnings.push(
          `Four-layer facts were not built: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return {
      summary,
      manifestPath: published.manifestPath,
      rawPath: published.rawPath,
      readablePath: published.readablePath,
      warnings: [...extracted.warnings, ...factsWarnings],
    }
  } finally {
    await cleanupCadArtifactRun(projectRoot, artifactRunId).catch(() => undefined)
  }
}
