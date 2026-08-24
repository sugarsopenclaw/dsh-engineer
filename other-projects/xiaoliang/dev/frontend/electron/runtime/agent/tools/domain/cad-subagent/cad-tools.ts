import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import fs from 'node:fs'

import type {
  CadApplicationFacade,
  CadBridgeBBox,
  CadBridgeDocument,
  CadBridgeDocumentSelector,
  CadBridgeDrawing,
  CadBridgeFirstLevelQuadrant,
  CadBridgePlotResult,
} from '../../../../cad/drivers/autocad-http/cad-application-facade'
import type { CadHttpRuntimeDiagnosis } from '../../../../cad/drivers/autocad-http/cad-http-runtime'
import type { MLightCadExtractor } from '../../../../cad/mlight/mlight-extraction-service'
import type { FactsBuildService } from '../../../../cad/facts/facts-build-service'
import {
  CAD_COM_ENTITIES_PRODUCER,
  CAD_MLIGHT_ENTITIES_PRODUCER,
  cleanupCadArtifactRun,
  createCadArtifactRunId,
  documentAsDrawing,
  drawingArtifactPaths,
  inspectEntitiesArtifact,
  inspectVisualArtifact,
  listArtifactInventories,
  listPreviewImages,
  promoteStagedEntities,
  promoteStagedVisual,
  resolveDocument,
  resolveProjectFile,
  resolveTrustedProjectRoot,
} from './artifact-store'
import { buildCadQueryTool, type CadQueryUsageContext } from './cad-query'
import { captureDetailDataset } from './detail-dataset'
import {
  buildMLightEntityIndex,
  drawingFromProjectPath,
  sourceFingerprint,
} from './entity-index'
import { describeFrameRejection } from './frame-sanity'
import { buildCadFactsTools } from './facts-tools'
import {
  blockReferenceCount,
  cadIndexCoverage,
  opaqueEntityCounts as filterOpaqueEntityCounts,
} from './index-coverage'
import { cadToolResult, type CadSubagentToolDetails } from './tool-result'
import {
  buildCadVisualIndex,
  type CadVisualIndexUsageContext,
} from './visual-index'
import { createCadVisualProducer } from './visual-contract'

interface BuildCadToolsOptions {
  projectRoot: string
  facade: CadApplicationFacade
  mlightExtractor?: MLightCadExtractor
  factsBuildService?: FactsBuildService
  cadQuery: CadQueryUsageContext
  visualIndex?: CadVisualIndexUsageContext
  clientRunId?: string
  childRunId?: string
  capabilities(signal?: AbortSignal): Promise<Record<string, unknown>>
  diagnose?(signal?: AbortSignal): Promise<CadHttpRuntimeDiagnosis>
}

interface RawDocumentSelector {
  name?: string
  index?: number
}

interface CadAppInput {
  action: 'status' | 'start' | 'restart' | 'list' | 'open' | 'switch'
  force?: boolean
  path?: string
  name?: string
  index?: number
}

interface CadArtifactsInput {
  action: 'status' | 'list'
  document?: RawDocumentSelector
  kind?: 'entities' | 'visual' | 'all'
}

interface CadExtractInput {
  action: 'run' | 'read'
  document?: RawDocumentSelector
  drawing_path?: string
  handles?: string[]
}

interface CadCaptureInput {
  action: 'detect_frames' | 'plot' | 'visual_overview' | 'visual_zoom'
  document?: RawDocumentSelector
  frame_id?: string
  bbox?: CadBridgeBBox
  quadrant?: string
  zoom_quadrants?: CadBridgeFirstLevelQuadrant[]
}

interface CadDetailInput {
  document?: RawDocumentSelector
  handles?: string[]
  window?: CadBridgeBBox
  padding_ratio?: number
}

const MIN_VALID_PLOT_INK_RATIO = 0.0015

const DocumentSelector = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  index: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
}, { additionalProperties: false })

const Point2 = Type.Array(Type.Number(), {
  minItems: 2,
  maxItems: 2,
  description: '[x, y] in drawing WCS',
})

const Window = Type.Object({
  min: Point2,
  max: Point2,
}, { additionalProperties: false })

const CadAppParameters = Type.Object({
  action: Type.Union([
    Type.Literal('status'),
    Type.Literal('start'),
    Type.Literal('restart'),
    Type.Literal('list'),
    Type.Literal('open'),
    Type.Literal('switch'),
  ]),
  force: Type.Optional(Type.Boolean()),
  path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  index: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
}, { additionalProperties: false })

const CadArtifactsParameters = Type.Object({
  action: Type.Union([Type.Literal('status'), Type.Literal('list')]),
  document: Type.Optional(DocumentSelector),
  kind: Type.Optional(Type.Union([
    Type.Literal('entities'),
    Type.Literal('visual'),
    Type.Literal('all'),
  ])),
}, { additionalProperties: false })

const CadExtractParameters = Type.Object({
  action: Type.Union([Type.Literal('run'), Type.Literal('read')]),
  document: Type.Optional(DocumentSelector),
  drawing_path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
  handles: Type.Optional(Type.Array(Type.String({
    minLength: 1,
    maxLength: 64,
    pattern: '^(?:0[xX])?[0-9A-Fa-f]+$',
  }), { minItems: 1, maxItems: 50 })),
}, { additionalProperties: false })

const CadCaptureParameters = Type.Object({
  action: Type.Union([
    Type.Literal('detect_frames'),
    Type.Literal('plot'),
    Type.Literal('visual_overview'),
    Type.Literal('visual_zoom'),
  ]),
  document: Type.Optional(DocumentSelector),
  frame_id: Type.Optional(Type.String({ pattern: '^frame-(?:[0-9]{2}|custom)$', maxLength: 32 })),
  bbox: Type.Optional(Window),
  quadrant: Type.Optional(Type.String({ pattern: '^q[1-4](?:/q[1-4])?$', maxLength: 5 })),
  zoom_quadrants: Type.Optional(Type.Array(Type.Union([
    Type.Literal('q1'),
    Type.Literal('q2'),
    Type.Literal('q3'),
    Type.Literal('q4'),
  ]), { minItems: 1, maxItems: 4 })),
}, { additionalProperties: false })

const CadDetailParameters = Type.Object({
  document: Type.Optional(DocumentSelector),
  handles: Type.Optional(Type.Array(Type.String({
    minLength: 1,
    maxLength: 64,
    pattern: '^(?:0[xX])?[0-9A-Fa-f]+$',
  }), { minItems: 1, maxItems: 8 })),
  window: Type.Optional(Window),
  padding_ratio: Type.Optional(Type.Number({ minimum: 0, maximum: 0.5, default: 0.15 })),
}, { additionalProperties: false })

const CadDoctorParameters = Type.Object({}, { additionalProperties: false })

function documentSelector(value: RawDocumentSelector | undefined): CadBridgeDocumentSelector | undefined {
  if (!value) return undefined
  if (value.name !== undefined && value.index !== undefined) {
    throw new Error('CAD document selector must use name or index, not both.')
  }
  if (value.name !== undefined) return { name: value.name }
  if (value.index !== undefined) return { index: value.index }
  throw new Error('CAD document selector must contain name or index.')
}

function safeDocuments(documents: readonly CadBridgeDocument[]) {
  return documents.map((document) => ({
    index: document.index,
    name: document.name,
    project_relative_path: document.project_relative_path,
    active: document.active,
    saved: document.saved,
    dbmod: document.dbmod,
    ...(document.project_relative_path === null ? { status: 'foreign_document' as const } : {}),
  }))
}

// AutoCAD DBMOD is a bitcode. Window (8) and view (16) changes do not alter
// drawing content, so they are safe for read-only persistent evidence. When
// DBMOD is available it is more precise than Document.Saved; fall back to the
// latter only for bridge versions that cannot read DBMOD.
const DBMOD_NON_CONTENT_MASK = 8 | 16

function dirtyDocument(document: CadBridgeDocument): boolean {
  if (document.dbmod !== null) {
    return (document.dbmod & ~DBMOD_NON_CONTENT_MASK) !== 0
  }
  return !document.saved
}

function sameDrawingPath(left: string | null, right: string): boolean {
  return left !== null && left.toLocaleLowerCase() === right.toLocaleLowerCase()
}

function extractionSummary(
  result: Awaited<ReturnType<CadApplicationFacade['runExtraction']>>,
  drawing: CadBridgeDrawing,
) {
  const paths = drawingArtifactPaths(drawing)
  const opaqueEntityCounts = filterOpaqueEntityCounts(result.summary.typeCounts)
  const opaqueEntityCount = Object.values(opaqueEntityCounts).reduce((sum, count) => sum + count, 0)
  // COM walks model space without descending into block definitions and publishes no block
  // inventory, so unlike MLightCAD it can only count the references pointing into unindexed
  // block contents rather than naming the definitions themselves.
  const unexpandedBlockReferenceCount = blockReferenceCount(result.summary.typeCounts)
  const coverage = cadIndexCoverage({
    sourceEntityCount: result.summary.sourceEntityCount,
    indexedEntityCount: result.summary.indexedEntityCount,
    omittedGeometryCount: result.summary.omittedGeometryCount,
    failedEntityCount: result.summary.failedEntityCount,
    opaqueEntityCount,
    unexpandedBlockCount: unexpandedBlockReferenceCount,
  })
  return {
    raw_path: paths.rawPath,
    readable_path: paths.readablePath,
    source_entity_count: result.summary.sourceEntityCount,
    indexed_entity_count: result.summary.indexedEntityCount,
    unindexed_entity_count: coverage.unindexedEntityCount,
    omitted_geometry_count: result.summary.omittedGeometryCount,
    failed_entity_count: result.summary.failedEntityCount,
    type_counts: result.summary.typeCounts,
    opaque_entity_counts: opaqueEntityCounts,
    opaque_entity_count: opaqueEntityCount,
    block_expansion: 'not_expanded' as const,
    unexpanded_block_references: unexpandedBlockReferenceCount,
    layer_count: result.summary.layerCount,
    backend: 'com',
    complete_index: coverage.completeIndex,
    include_geometry: true,
  }
}

async function resolveComDocumentForDrawing(
  facade: CadApplicationFacade,
  drawing: CadBridgeDrawing,
  selector: CadBridgeDocumentSelector | undefined,
  signal?: AbortSignal,
): Promise<CadBridgeDocument> {
  const status = await facade.status(signal)
  if (!status.running) await facade.start(signal)
  if (selector) {
    const selected = await resolveDocument(facade, selector, signal)
    if (!sameDrawingPath(selected.project_relative_path, drawing.project_relative_path)) {
      throw new Error('Selected AutoCAD document does not match drawing_path.')
    }
    return selected
  }
  let documents = await facade.listDocuments(signal)
  let selected = documents.find((item) => sameDrawingPath(item.project_relative_path, drawing.project_relative_path))
  if (!selected) {
    if (!drawing.project_relative_path.toLocaleLowerCase().endsWith('.dwg')) {
      throw new Error('AutoCAD COM fallback can only open project-local DWG files.')
    }
    await facade.openDocument(drawing.project_relative_path, signal)
    documents = await facade.listDocuments(signal)
    selected = documents.find((item) => sameDrawingPath(item.project_relative_path, drawing.project_relative_path))
  }
  if (!selected) throw new Error('AutoCAD did not open the requested project drawing.')
  return selected
}

function captureData(capture: CadBridgePlotResult) {
  return {
    drawing: capture.drawing,
    frame_id: capture.frameId,
    quadrant: capture.quadrant,
    bbox: capture.bbox,
    image_path: capture.imagePath,
    strategy: capture.strategy,
    width: capture.width,
    height: capture.height,
    pixel_count: capture.pixelCount,
    ink_ratio: capture.inkRatio,
    ink_ratio_criterion: {
      minimum: MIN_VALID_PLOT_INK_RATIO,
      status: capture.inkRatio >= MIN_VALID_PLOT_INK_RATIO ? 'has_visible_ink' : 'plot_empty',
      meaning: 'PLOT_EMPTY is rejected below this ratio; ink density is not an entity count.',
    },
    crop_box: capture.cropBox,
  }
}

function capabilitiesList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && /^[a-z]+\.[a-z_]+$/u.test(item))
    .slice(0, 100)
}

type CadDoctorRecommendedAction = 'none' | 'start' | 'restart' | 'report'

function diagnosisRecommendedAction(
  diagnosis: CadHttpRuntimeDiagnosis,
): CadDoctorRecommendedAction {
  if (!diagnosis.bridge.reachable) return 'report'
  if (diagnosis.autocad.state === 'busy') {
    const repeatedBusy = diagnosis.autocad.message.includes('cad_app action=restart')
    return diagnosis.bridge.state === 'healthy' && repeatedBusy ? 'restart' : 'report'
  }
  if (!diagnosis.autocad.running) {
    return diagnosis.autocad.state === 'not_running'
      && diagnosis.autocad.comRegistered === true
      ? 'start'
      : 'report'
  }
  return diagnosis.autocad.state === 'ready' || diagnosis.autocad.state === 'no_document'
    ? 'none'
    : 'report'
}

export function buildCadSubagentCadTools(
  options: BuildCadToolsOptions,
): AgentTool<any, CadSubagentToolDetails>[] {
  const projectRoot = resolveTrustedProjectRoot(options.projectRoot)
  // Repeatedly re-activating the same target without looking at the document list is how a
  // child burns its turns on a drawing that is not open. The cap covers open-by-path and
  // switch-by-index too, because the failure mode does not depend on how the target is named.
  let lastFailedActivation: string | null = null
  let failedActivationAttempts = 0

  const activationRetryExhausted = (key: string | null): boolean => (
    key !== null && key === lastFailedActivation && failedActivationAttempts >= 2
  )

  const recordActivationFailure = (key: string | null): void => {
    if (key === null) return
    if (key === lastFailedActivation) failedActivationAttempts += 1
    else {
      lastFailedActivation = key
      failedActivationAttempts = 1
    }
  }

  const clearActivationFailure = (): void => {
    lastFailedActivation = null
    failedActivationAttempts = 0
  }

  const retryExhaustedError = (): Error => new Error(
    'The same CAD document target already used its one immediate retry; run cad_app action=list before retrying.',
  )

  const switchFailure = async (
    operation: 'doc.open' | 'doc.switch',
    toolCallId: string,
    error: unknown,
    signal?: AbortSignal,
  ) => {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('CAD document activation was cancelled.')
    }
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 2_000)
    let documents: CadBridgeDocument[] = []
    let listError: string | null = null
    try {
      documents = await options.facade.listDocuments(signal)
    } catch (documentError) {
      listError = (documentError instanceof Error ? documentError.message : String(documentError)).slice(0, 2_000)
    }
    return cadToolResult(operation, toolCallId, {
      status: 'switch_failed',
      reason,
      document_count: documents.length,
      documents: safeDocuments(documents),
    }, [
      `CAD document activation failed: ${reason}`,
      ...(listError ? [`Open document inventory was also unavailable: ${listError}`] : []),
    ])
  }

  /**
   * AutoCAD documents are process-global, so the active drawing can belong to another
   * project. Reporting that as a status instead of throwing keeps the caller from reading
   * a foreign drawing's dimensions or budget as if they were this project's facts.
   */
  const foreignDocumentResult = async (
    operation: string,
    toolCallId: string,
    selected: CadBridgeDocument,
    signal?: AbortSignal,
  ) => {
    let documents: CadBridgeDocument[] = []
    let listError: string | null = null
    try {
      documents = await options.facade.listDocuments(signal)
    } catch (documentError) {
      listError = (documentError instanceof Error ? documentError.message : String(documentError)).slice(0, 2_000)
    }
    const projectDocuments = safeDocuments(documents).filter(
      (document) => document.project_relative_path !== null,
    )
    return cadToolResult(operation, toolCallId, {
      status: 'foreign_document',
      reason: 'The selected AutoCAD document is not saved inside this project.',
      document: { index: selected.index, name: selected.name, active: selected.active },
      project_documents: projectDocuments,
      documents: safeDocuments(documents),
    }, [
      `Selected AutoCAD document "${selected.name}" is outside this project; its dimensions, quantities and budget must not be used here.`,
      projectDocuments.length > 0
        ? 'Run cad_app action=switch or action=open against one of project_documents before reading facts.'
        : 'No project-local drawing is open; run cad_app action=open with a project-relative DWG path.',
      ...(listError ? [`Open document inventory was also unavailable: ${listError}`] : []),
    ])
  }

  const cadApp: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_app',
    label: 'CAD Application',
    description: [
      'Inspect, start, or restart AutoCAD and list, open, or switch project-local drawings.',
      'Restart is a bounded recovery action: unsaved changes block it unless force=true.',
      'This read-only child still cannot close/save individual documents or execute arbitrary commands.',
      'Use action=list before extraction or capture when the active drawing is uncertain.',
      'A failed open/switch returns status=switch_failed with the open document list; it is never a silent success.',
      'The same target may be retried once, after which action=list is required before retrying it again.',
      'Documents saved outside this project are listed with status=foreign_document and must not be read as project facts.',
    ].join('\n'),
    parameters: CadAppParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadAppInput
      if (input.action !== 'switch' && input.action !== 'open') clearActivationFailure()
      if (input.force !== undefined && input.action !== 'restart') {
        throw new Error('cad_app force is only valid with action=restart.')
      }
      if (input.action === 'status') {
        const status = await options.facade.status(signal)
        return cadToolResult('app.status', toolCallId, {
          running: status.running,
          supported: status.supported,
          ...(status.visible !== undefined ? { visible: status.visible } : {}),
          ...(status.version ? { version: status.version } : {}),
          document_count: status.document_count,
          documents: safeDocuments(status.documents),
        })
      }
      if (input.action === 'start') {
        const status = await options.facade.start(signal)
        return cadToolResult('app.start', toolCallId, {
          running: status.running,
          supported: status.supported,
          ...(status.visible !== undefined ? { visible: status.visible } : {}),
          ...(status.version ? { version: status.version } : {}),
          document_count: status.document_count,
          documents: safeDocuments(status.documents),
        })
      }
      if (input.action === 'restart') {
        const status = await options.facade.restart({ force: input.force }, signal)
        return cadToolResult('app.restart', toolCallId, {
          running: status.running,
          supported: status.supported,
          ...(status.visible !== undefined ? { visible: status.visible } : {}),
          ...(status.version ? { version: status.version } : {}),
          document_count: status.document_count,
          documents: safeDocuments(status.documents),
          restarted: status.restarted,
          forced: status.forced,
          quit_mode: status.quitMode,
        })
      }
      if (input.action === 'open') {
        if (!input.path) throw new Error('cad_app action=open requires a project-relative DWG path.')
        const activationKey = `open:${input.path.trim().toLocaleLowerCase()}`
        if (activationRetryExhausted(activationKey)) {
          return switchFailure('doc.open', toolCallId, retryExhaustedError(), signal)
        }
        try {
          const drawing = resolveProjectFile(projectRoot, input.path, { extensions: new Set(['.dwg']) })
          await options.facade.openDocument(drawing.relativePath, signal)
          const documents = await options.facade.listDocuments(signal)
          const safe = safeDocuments(documents)
          clearActivationFailure()
          return cadToolResult('doc.open', toolCallId, {
            status: 'opened',
            opened_path: drawing.relativePath,
            active_document: safe.find((document) => document.active) ?? null,
            documents: safe,
          })
        } catch (error) {
          recordActivationFailure(activationKey)
          return switchFailure('doc.open', toolCallId, error, signal)
        }
      }
      if (input.action === 'switch') {
        const selector = documentSelector({ name: input.name, index: input.index })
        if (!selector) throw new Error('cad_app action=switch requires name or index.')
        const activationKey = 'name' in selector
          ? `switch:name:${selector.name.trim().toLocaleLowerCase()}`
          : `switch:index:${selector.index}`
        if (activationRetryExhausted(activationKey)) {
          return switchFailure('doc.switch', toolCallId, retryExhaustedError(), signal)
        }
        try {
          await options.facade.switchDocument(selector, signal)
          const documents = await options.facade.listDocuments(signal)
          const safe = safeDocuments(documents)
          clearActivationFailure()
          return cadToolResult('doc.switch', toolCallId, {
            status: 'switched',
            active_document: safe.find((document) => document.active) ?? null,
            documents: safe,
          })
        } catch (error) {
          recordActivationFailure(activationKey)
          return switchFailure('doc.switch', toolCallId, error, signal)
        }
      }
      const documents = await options.facade.listDocuments(signal)
      return cadToolResult('doc.list', toolCallId, {
        document_count: documents.length,
        documents: safeDocuments(documents),
      })
    },
  }

  const cadArtifacts: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_artifacts',
    label: 'CAD Artifacts',
    description: [
      'List project-local CAD inventories or validate entity and visual artifacts for an open drawing.',
      'Entity and visual status=valid are reusable; loose preview images remain navigation-only artifacts.',
    ].join('\n'),
    parameters: CadArtifactsParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadArtifactsInput
      if (input.action === 'list') {
        const listed = await listArtifactInventories(projectRoot, signal)
        return cadToolResult('artifact.list', toolCallId, {
          inventories: listed.inventories,
          truncated: listed.truncated,
        }, listed.truncated ? ['CAD artifact inventory was truncated at 200 drawings.'] : [])
      }
      const selected = await resolveDocument(options.facade, documentSelector(input.document), signal)
      if (selected.status === 'foreign_document') {
        return foreignDocumentResult('artifact.inspect', toolCallId, selected, signal)
      }
      const drawing = documentAsDrawing(selected)
      const kind = input.kind ?? 'all'
      const [entities, visual, previews] = await Promise.all([
        kind === 'visual' ? null : inspectEntitiesArtifact(projectRoot, drawing, signal),
        kind === 'entities' ? null : inspectVisualArtifact(projectRoot, drawing, 'frame-01', signal),
        kind === 'entities' ? null : listPreviewImages(projectRoot, drawing, signal),
      ])
      const warnings: string[] = []
      if (dirtyDocument(selected)) {
        warnings.push('The selected AutoCAD document has unsaved object state; persistent artifacts may not represent it.')
      }
      if (previews?.truncated) warnings.push('Visual preview listing was truncated at 100 images.')
      const entityPaths = new Set(entities?.relativePaths ?? [])
      const visualPaths = new Set(visual?.relativePaths ?? [])
      return cadToolResult('artifact.status', toolCallId, {
        drawing,
        dirty: dirtyDocument(selected),
        entities: entities && {
          status: dirtyDocument(selected) ? 'dirty' : entities.status,
          reason: entities.reason,
          producer: entities.producer,
          ...(entityPaths.has(entities.manifestPath) ? { manifest_path: entities.manifestPath } : {}),
          ...(entityPaths.has(entities.rawPath) ? { raw_path: entities.rawPath } : {}),
          ...(entityPaths.has(entities.readablePath) ? { readable_path: entities.readablePath } : {}),
          summary: entities.summary,
        },
        visual: visual && {
          status: dirtyDocument(selected) ? 'dirty' : visual.status,
          reason: visual.reason,
          producer: visual.producer,
          frame_id: visual.frameId,
          ...(visualPaths.has(visual.manifestPath) ? { manifest_path: visual.manifestPath } : {}),
          ...(visualPaths.has(visual.visualIndexPath) ? { visual_index_path: visual.visualIndexPath } : {}),
          ...(visualPaths.has(visual.visualKnowledgePath)
            ? { visual_knowledge_path: visual.visualKnowledgePath }
            : {}),
          image_count: visual.imagePaths.length,
          image_paths: visual.imagePaths,
          summary: visual.summary,
          preview_image_paths: previews?.paths ?? [],
          previews_truncated: previews?.truncated ?? false,
        },
      }, warnings)
    },
  }

  const cadExtract: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_extract',
    label: 'CAD Entity Extraction',
    description: [
      'Build or reuse a complete trusted entity index for the selected drawing, or read authoritative fields by handle.',
      'action=run builds or reuses a file index first and automatically falls back to AutoCAD when needed.',
      'Pass drawing_path to index a project DWG/DXF without manually opening or selecting it; use cad_search for field-level local substring lookup and cad_query only for fuzzy or aggregate fallback.',
      'action=read calls the active AutoCAD document and should batch all known handles from the same target region.',
    ].join('\n'),
    parameters: CadExtractParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadExtractInput
      const selector = documentSelector(input.document)
      if (input.action === 'read') {
        if (input.drawing_path !== undefined) {
          throw new Error('cad_extract action=read uses document and does not accept drawing_path.')
        }
        if (!input.handles?.length) throw new Error('cad_extract action=read requires handles.')
        const result = selector
          ? await options.facade.readEntitiesInDocument(selector, input.handles, signal)
          : await options.facade.readEntities(input.handles, signal)
        return cadToolResult('extract.read', toolCallId, {
          document: result.document,
          entities: result.entities,
          errors: result.errors,
        }, result.errors.map((item) => `Handle ${item.handle} could not be read (${item.code}).`))
      }
      if (input.handles !== undefined) {
        throw new Error('cad_extract action=run does not accept handles.')
      }
      if (input.drawing_path !== undefined && selector) {
        throw new Error('cad_extract action=run accepts drawing_path or document, not both.')
      }
      const selectedDocument = input.drawing_path === undefined
        ? await resolveDocument(options.facade, selector, signal)
        : undefined
      if (selectedDocument?.status === 'foreign_document') {
        return foreignDocumentResult('extract.run', toolCallId, selectedDocument, signal)
      }
      if (selectedDocument && dirtyDocument(selectedDocument)) {
        throw new Error('Cannot publish a persistent entity index while the selected drawing has unsaved changes.')
      }
      const drawing = input.drawing_path !== undefined
        ? drawingFromProjectPath(projectRoot, input.drawing_path)
        : documentAsDrawing(selectedDocument as CadBridgeDocument)
      const existing = await inspectEntitiesArtifact(projectRoot, drawing, signal)
      if (existing.status === 'valid') {
        const factsWarnings: string[] = []
        if (options.factsBuildService) {
          try {
            const facts = await options.factsBuildService.ensureL1({
              projectRoot,
              drawing,
              ...(existing.producer?.name === CAD_MLIGHT_ENTITIES_PRODUCER.name
                ? { mlightIndexPath: existing.rawPath }
                : {}),
            })
            factsWarnings.push(...facts.warnings)
          } catch (error) {
            factsWarnings.push(
              `Four-layer facts were not built: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        return cadToolResult('extract.run', toolCallId, {
          drawing,
          summary: existing.summary ?? {},
          cache: {
            hit: true,
            status: existing.status,
            producer: existing.producer,
            manifest_path: existing.manifestPath,
          },
          raw_path: existing.rawPath,
          readable_path: existing.readablePath,
        }, factsWarnings)
      }
      const fallbackWarnings: string[] = []
      if (options.mlightExtractor) {
        try {
          const published = await buildMLightEntityIndex({
            projectRoot,
            drawing,
            extractor: options.mlightExtractor,
            ...(options.factsBuildService ? { factsBuildService: options.factsBuildService } : {}),
            ...(signal ? { signal } : {}),
          })
          return cadToolResult('extract.run', toolCallId, {
            drawing,
            summary: published.summary,
            cache: {
              hit: false,
              previous_status: existing.status,
              status: 'valid',
              producer: CAD_MLIGHT_ENTITIES_PRODUCER,
              manifest_path: published.manifestPath,
            },
            raw_path: published.rawPath,
            readable_path: published.readablePath,
          }, published.warnings)
        } catch {
          if (signal?.aborted) {
            throw signal.reason instanceof Error ? signal.reason : new Error('CAD extraction was cancelled.')
          }
          fallbackWarnings.push('File-side extraction was unavailable; the index was rebuilt with AutoCAD.')
        }
      }

      const before = await resolveComDocumentForDrawing(options.facade, drawing, selector, signal)
      if (dirtyDocument(before)) {
        throw new Error('Cannot publish a persistent entity index while the selected drawing has unsaved changes.')
      }
      const sourceBefore = await sourceFingerprint(projectRoot, drawing, signal)
      const artifactRunId = createCadArtifactRunId()
      try {
        const extracted = await options.facade.runExtraction({
          document: { index: before.index },
          includeGeometry: true,
          artifactRunId,
        }, signal)
        const after = await resolveComDocumentForDrawing(options.facade, drawing, undefined, signal)
        const sourceAfter = await sourceFingerprint(projectRoot, drawing, signal)
        if (
          dirtyDocument(after)
          || !sameDrawingPath(after.project_relative_path, drawing.project_relative_path)
          || !sameDrawingPath(extracted.drawing.project_relative_path, drawing.project_relative_path)
          || sourceBefore.size !== sourceAfter.size
          || sourceBefore.sha256 !== sourceAfter.sha256
        ) {
          throw new Error('Drawing identity or content changed during extraction; no trusted manifest was published.')
        }
        const expectedStageRoot = `.xiaoliang/cad/.staging/${artifactRunId}/entities`
        if (
          extracted.summary.rawPath !== `${expectedStageRoot}/entities.raw.jsonl`
          || extracted.summary.readablePath !== `${expectedStageRoot}/entities.readable.md`
        ) throw new Error('AutoCAD bridge returned an unexpected staging artifact path.')
        const summary = extractionSummary(extracted, drawing)
        const published = await promoteStagedEntities({
          projectRoot,
          drawing,
          artifactRunId,
          summary,
          producer: CAD_COM_ENTITIES_PRODUCER,
          sourceFingerprint: sourceBefore,
          signal,
        })
        const factsWarnings: string[] = []
        if (options.factsBuildService) {
          try {
            const facts = await options.factsBuildService.ensureL1({
              projectRoot,
              drawing,
              force: true,
            })
            factsWarnings.push(...facts.warnings)
          } catch (error) {
            factsWarnings.push(
              `Four-layer facts were not built: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        return cadToolResult('extract.run', toolCallId, {
          drawing,
          summary,
          cache: {
            hit: false,
            previous_status: existing.status,
            status: 'valid',
            producer: CAD_COM_ENTITIES_PRODUCER,
            manifest_path: published.manifestPath,
          },
          raw_path: published.rawPath,
          readable_path: published.readablePath,
        }, [...fallbackWarnings, ...extracted.warnings, ...factsWarnings])
      } finally {
        await cleanupCadArtifactRun(projectRoot, artifactRunId).catch(() => undefined)
      }
    },
  }

  const cadQuery = buildCadQueryTool(projectRoot, options.cadQuery)

  const cadCapture: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_capture',
    label: 'CAD Deterministic Capture',
    description: [
      'Detect drawing frames, plot one exact WCS region, or automatically build a persistent Qwen3.8-Max visual index.',
      'visual_overview captures full/q1-q4, lets the vision model select unclear quadrants, performs at most one qx/q1-q4 zoom pass, and caches the result.',
      'visual_zoom remains a raw navigation fallback; persistent automatic visual indexing never recurses beyond two levels.',
    ].join('\n'),
    parameters: CadCaptureParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadCaptureInput
      const selector = documentSelector(input.document)
      if (input.action === 'detect_frames') {
        const detected = await options.facade.detectFrames(selector, signal)
        const rejections = detected.frames
          .filter((frame) => frame.source !== 'extents')
          .map((frame) => describeFrameRejection(frame, detected.extents))
          .filter((rejection): rejection is string => rejection !== null)
        return cadToolResult('capture.detect_frames', toolCallId, {
          drawing: detected.drawing,
          extents: detected.extents,
          frames: detected.frames.map((frame) => ({
            frame_id: frame.frameId,
            bbox: frame.bbox,
            source: frame.source,
            confidence: frame.confidence,
            sanity: describeFrameRejection(frame, detected.extents) ?? 'plausible_sheet',
          })),
        }, [
          ...detected.warnings,
          ...rejections.map((rejection) => (
            `Frame candidate does not look like a sheet: ${rejection}. visual_overview will capture the drawing extents instead.`
          )),
        ])
      }
      if (input.action === 'plot') {
        if (input.zoom_quadrants !== undefined) {
          throw new Error('cad_capture action=plot does not accept zoom_quadrants.')
        }
        const captured = await options.facade.plotCapture({
          ...(selector ? { document: selector } : {}),
          ...(input.frame_id ? { frameId: input.frame_id } : {}),
          ...(input.bbox ? { bbox: input.bbox } : {}),
          ...(input.quadrant ? { quadrant: input.quadrant as CadBridgePlotResult['quadrant'] & string } : {}),
        }, signal)
        return cadToolResult('capture.plot', toolCallId, captureData(captured), captured.warnings)
      }
      if (input.action === 'visual_overview') {
        if (input.quadrant !== undefined || input.zoom_quadrants !== undefined) {
          throw new Error('visual_overview determines its own full and first-level quadrant captures.')
        }
        if (!options.visualIndex) {
          const visual = await options.facade.captureVisualSet({
            ...(selector ? { document: selector } : {}),
            ...(input.frame_id ? { frameId: input.frame_id } : {}),
            ...(input.bbox ? { bbox: input.bbox } : {}),
          }, signal)
          return cadToolResult('capture.visual_overview', toolCallId, {
            drawing: visual.drawing,
            frame_id: visual.frameId,
            bbox: visual.bbox,
            captures: visual.captures.map(captureData),
            cache: { hit: false, status: 'preview_only' },
            next_step: 'Managed visual-index context is unavailable; inspect these navigation previews directly.',
          }, [
            ...visual.warnings,
            'Managed visual-index context is unavailable, so no persistent visual index was published.',
          ])
        }
        if (input.bbox !== undefined) {
          throw new Error('Persistent visual_overview uses a detected frame and does not accept a custom bbox.')
        }
        const desiredFrameId = input.frame_id ?? 'frame-01'
        if (!/^frame-[0-9]{2}$/u.test(desiredFrameId)) {
          throw new Error('Persistent visual_overview requires frame-NN, not frame-custom.')
        }
        const selectedBefore = await resolveDocument(options.facade, selector, signal)
        if (selectedBefore.status === 'foreign_document') {
          return foreignDocumentResult('capture.visual_overview', toolCallId, selectedBefore, signal)
        }
        if (dirtyDocument(selectedBefore)) {
          throw new Error('Cannot publish a persistent visual index while the selected drawing has unsaved changes.')
        }
        const drawing = documentAsDrawing(selectedBefore)
        const existing = await inspectVisualArtifact(projectRoot, drawing, desiredFrameId, signal)
        if (existing.status === 'valid') {
          return cadToolResult('capture.visual_overview', toolCallId, {
            drawing,
            frame_id: existing.frameId,
            summary: existing.summary ?? {},
            visual_index_path: existing.visualIndexPath,
            visual_knowledge_path: existing.visualKnowledgePath,
            image_paths: existing.imagePaths,
            cache: {
              hit: true,
              status: existing.status,
              producer: existing.producer,
              manifest_path: existing.manifestPath,
            },
            next_step: 'Use visual_knowledge_path for macro navigation, then cad_query/cad_extract for authoritative facts.',
          })
        }
        const sourceBefore = await sourceFingerprint(projectRoot, drawing, signal)
        const artifactRunId = createCadArtifactRunId()
        try {
          const generated = await buildCadVisualIndex({
            facade: options.facade,
            projectRoot,
            artifactRunId,
            artifactDirectory: drawingArtifactPaths(drawing).artifactDirectory,
            document: { index: selectedBefore.index },
            frameId: desiredFrameId,
            usage: options.visualIndex,
            signal,
          })
          const selectedAfter = await resolveDocument(options.facade, { index: selectedBefore.index }, signal)
          const sourceAfter = await sourceFingerprint(projectRoot, drawing, signal)
          if (
            dirtyDocument(selectedAfter)
            || !sameDrawingPath(selectedAfter.project_relative_path, drawing.project_relative_path)
            || !sameDrawingPath(generated.drawing.project_relative_path, drawing.project_relative_path)
            || sourceBefore.size !== sourceAfter.size
            || sourceBefore.sha256 !== sourceAfter.sha256
          ) throw new Error('Drawing identity or content changed during visual indexing; no trusted manifest was published.')
          const summary = {
            frame_id: generated.frame_id,
            frame_source: generated.frame_source,
            model: generated.model,
            visual_index_path: generated.visual_index_path,
            visual_knowledge_path: generated.visual_knowledge_path,
            region_count: generated.region_count,
            zoom_region_count: generated.zoom_region_count,
            bbox: generated.bbox,
            image_paths: generated.image_paths,
            overview: generated.overview,
          }
          const producer = createCadVisualProducer(generated.frame_id)
          const published = await promoteStagedVisual({
            projectRoot,
            drawing,
            artifactRunId,
            summary,
            producer,
            sourceFingerprint: sourceBefore,
            signal,
          })
          return cadToolResult('capture.visual_overview', toolCallId, {
            drawing,
            frame_id: generated.frame_id,
            frame_source: generated.frame_source,
            bbox: generated.bbox,
            model: generated.model,
            overview: generated.overview,
            region_count: generated.region_count,
            zoom_region_count: generated.zoom_region_count,
            visual_index_path: published.visualIndexPath,
            visual_knowledge_path: published.visualKnowledgePath,
            image_paths: published.imagePaths,
            cache: {
              hit: false,
              previous_status: existing.status,
              status: 'valid',
              producer,
              manifest_path: published.manifestPath,
            },
            next_step: 'Use visual_knowledge_path for macro navigation, then cad_query/cad_extract for authoritative facts.',
          }, generated.warnings)
        } finally {
          await cleanupCadArtifactRun(projectRoot, artifactRunId).catch(() => undefined)
        }
      }
      if (!input.frame_id || !input.bbox || !input.zoom_quadrants?.length) {
        throw new Error('visual_zoom requires frame_id, bbox and zoom_quadrants from visual_overview.')
      }
      if (input.quadrant !== undefined) {
        throw new Error('visual_zoom uses zoom_quadrants and does not accept quadrant.')
      }
      const zoomed = await options.facade.captureVisualZooms({
        ...(selector ? { document: selector } : {}),
        frameId: input.frame_id,
        bbox: input.bbox,
        quadrants: input.zoom_quadrants,
      }, signal)
      return cadToolResult('capture.visual_zoom', toolCallId, {
        drawing: zoomed.drawing,
        frame_id: zoomed.frameId,
        bbox: zoomed.bbox,
        captures: zoomed.captures.map(captureData),
        terminal_depth: true,
      }, zoomed.warnings)
    },
  }

  const cadDetail: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_detail',
    label: 'CAD Detail Capture',
    description: [
      'Create one exact local detail image from up to eight handles and/or a WCS window.',
      'Use known same-region handles or a precise bbox; read the returned image_path to inspect it with the multimodal child.',
      'status=empty_window means a valid index found zero entities inside the window: re-anchor instead of describing it.',
      'The dataset field is an offline training sidecar; do not read or cite it.',
    ].join('\n'),
    parameters: CadDetailParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadDetailInput
      if (!input.handles?.length && !input.window) {
        throw new Error('cad_detail requires handles or window.')
      }
      const selector = documentSelector(input.document)
      const selected = await resolveDocument(options.facade, selector, signal)
      if (selected.status === 'foreign_document') {
        return foreignDocumentResult('capture.detail', toolCallId, selected, signal)
      }
      // A detail is plotted from the live AutoCAD document, so unsaved content must not
      // block the user-visible image. The optional offline dataset handles a dirty live
      // document by publishing metadata only instead of joining it to disk entities.
      const captured = await options.facade.captureDetail({
        document: { index: selected.index },
        ...(input.handles ? { handles: input.handles } : {}),
        ...(input.window ? { window: input.window } : {}),
        ...(input.padding_ratio !== undefined ? { paddingRatio: input.padding_ratio } : {}),
      }, signal)
      // captureDetailDataset already degrades every failure to a skipped outcome.
      const dataset = await captureDetailDataset({
        projectRoot,
        drawing: captured.drawing,
        imagePath: captured.imagePath,
        window: captured.bbox,
        anchors: captured.anchors,
        ...(input.handles ? { handles: input.handles } : {}),
        ...(input.padding_ratio !== undefined ? { paddingRatio: input.padding_ratio } : {}),
        channel: 'com_plot',
        ...(options.clientRunId ? { clientRunId: options.clientRunId } : {}),
        ...(options.childRunId ? { childRunId: options.childRunId } : {}),
        toolCallId,
        ...(signal ? { signal } : {}),
      })
      const emptyWindow = dataset.status === 'written'
        && dataset.indexStatus === 'valid'
        && dataset.entityCount === 0
      return cadToolResult('capture.detail', toolCallId, {
        ...(emptyWindow
          ? {
              status: 'empty_window',
              next_step: 'Run cad_app action=list and re-anchor the intended drawing or window before another detail capture.',
            }
          : {}),
        drawing: captured.drawing,
        window: captured.bbox,
        anchors: captured.anchors,
        missing_handles: captured.missingHandles,
        image_path: captured.imagePath,
        strategy: captured.strategy,
        width: captured.width,
        height: captured.height,
        pixel_count: captured.pixelCount,
        ink_ratio: captured.inkRatio,
        crop_box: captured.cropBox,
        dataset: {
          evidence_id: dataset.evidenceId,
          status: dataset.status,
          entity_count: dataset.entityCount,
          ...(dataset.entities ? { entities: dataset.entities } : {}),
          duration_ms: dataset.durationMs,
        },
      }, [
        ...captured.warnings,
        ...(dataset.warning ? [dataset.warning] : []),
        ...(emptyWindow
          ? ['The requested detail window contains zero entities in a valid index; the image is not successful detail evidence.']
          : []),
      ])
    },
  }

  const cadDoctor: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_doctor',
    label: 'CAD Diagnostics',
    description: 'Return a bounded, secret-free diagnosis of the project-bound bridge and AutoCAD capabilities.',
    parameters: CadDoctorParameters,
    execute: async (toolCallId, _raw, signal) => {
      if (options.diagnose) {
        const diagnosis = await options.diagnose(signal)
        return cadToolResult('cad.doctor', toolCallId, {
          recommended_action: diagnosisRecommendedAction(diagnosis),
          bridge: {
            state: diagnosis.bridge.state,
            reachable: diagnosis.bridge.reachable,
            project_bound: Boolean(diagnosis.bridge.projectRoot),
            protocol_version: diagnosis.bridge.protocolVersion,
            operations: diagnosis.bridge.operations,
            drawing_write_operations: diagnosis.bridge.drawingWriteOperations,
            stateful_operations: diagnosis.bridge.statefulOperations,
            active_leases: diagnosis.bridge.activeLeases,
            restart_count: diagnosis.bridge.restartCount,
            last_healthy_at: diagnosis.bridge.lastHealthyAt,
            last_error: diagnosis.bridge.lastError,
          },
          autocad: {
            state: diagnosis.autocad.state,
            installation: {
              full_installed: diagnosis.autocad.fullInstalled,
              lt_installed: diagnosis.autocad.ltInstalled,
              com_registered: diagnosis.autocad.comRegistered,
            },
            running: diagnosis.autocad.running,
            supported: diagnosis.autocad.supported,
            ...(diagnosis.autocad.visible !== null ? { visible: diagnosis.autocad.visible } : {}),
            ...(diagnosis.autocad.version ? { version: diagnosis.autocad.version } : {}),
            document_count: diagnosis.autocad.documentCount,
            documents: safeDocuments(diagnosis.autocad.documents),
            error_code: diagnosis.autocad.errorCode,
            message: diagnosis.autocad.message,
          },
          plot: {
            state: diagnosis.plot.state,
            ready: diagnosis.plot.ready,
            operation_available: diagnosis.plot.operationAvailable,
            active_document: diagnosis.plot.activeDocument,
            dependencies: diagnosis.plot.dependencies,
            configurations: diagnosis.plot.configurations,
            warnings: diagnosis.plot.warnings,
            message: diagnosis.plot.message,
          },
        })
      }
      const capabilities = await options.capabilities(signal)
      const status = await options.facade.status(signal)
      return cadToolResult('cad.doctor', toolCallId, {
        recommended_action: status.running
          ? 'none'
          : capabilitiesList(capabilities.operations).includes('app.start')
            ? 'start'
            : 'report',
        bridge: {
          reachable: true,
          project_bound: true,
          protocol_version: 1,
          operations: capabilitiesList(capabilities.operations),
          drawing_write_operations: capabilitiesList(capabilities.drawing_write_operations),
          stateful_operations: capabilitiesList(capabilities.stateful_operations),
        },
        autocad: {
          running: status.running,
          supported: status.supported,
          ...(status.visible !== undefined ? { visible: status.visible } : {}),
          ...(status.version ? { version: status.version } : {}),
          document_count: status.document_count,
          documents: safeDocuments(status.documents),
        },
      })
    },
  }

  return [
    cadApp,
    cadArtifacts,
    cadExtract,
    ...(options.factsBuildService
      ? buildCadFactsTools({ projectRoot, factsBuildService: options.factsBuildService })
      : []),
    cadQuery,
    cadCapture,
    cadDetail,
    cadDoctor,
  ]
}
