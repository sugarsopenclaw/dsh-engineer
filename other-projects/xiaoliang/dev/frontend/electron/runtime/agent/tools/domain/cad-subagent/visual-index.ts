import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type {
  CadApplicationFacade,
  CadBridgeBBox,
  CadBridgeDocumentSelector,
  CadBridgeDrawing,
  CadBridgePlotResult,
} from '../../../../cad/drivers/autocad-http/cad-application-facade'
import { buildManagedPiModel } from '../../../../llm/managed-model-factory'
import type { SubagentUsage } from '../../../subagents/contracts'
import { normalizeSubagentUsage } from '../../../subagents/safe-result-projector'
import {
  resolveProjectFile,
} from './artifact-store'
import {
  allRegionsBlank,
  hasEmptyPlotSignal,
  planFrameWindow,
  type CadFrameWindow,
  type CadFrameWindowSource,
} from './frame-sanity'
import {
  CAD_VISUAL_CAPTURE_MAX_PIXELS,
  CAD_VISUAL_FIRST_LEVEL_REGIONS,
  CAD_VISUAL_HIGH_RESOLUTION_IMAGES,
  CAD_VISUAL_MAX_IMAGE_BYTES,
  CAD_VISUAL_MODEL,
  CAD_VISUAL_QUADRANTS,
  type CadVisualOverview,
  type CadVisualQuadrant,
  type CadVisualRegionAssessment,
} from './visual-contract'

const VISUAL_MODEL_TIMEOUT_MS = 30 * 60 * 1_000
const GATEWAY_TIMEOUT_MS = VISUAL_MODEL_TIMEOUT_MS + 30_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_TEXT_LENGTH = 16_384

const VISION_SYSTEM_PROMPT = [
  '你是工程 CAD 图纸宏观索引器。图片依次带有明确 region_id。',
  // 截图管线可能在 AutoCAD 被遮挡、最小化或弹出模态框时产出黑屏/桌面图，缺了这条防线
  // 模型会照常描述并生成一份看似正常的索引。
  '第一步先确认每张图确实是 CAD 图纸画面，而不是桌面、空白、黑屏、最小化窗口、错误弹窗或无关页面。',
  '不是图纸画面时，该区域返回 legible=false、needs_zoom=false，summary 写明实际观察到的画面，并在 warnings 追加一条；不要描述看不见的内容。',
  '结合工程制图常识识别图名、图别、比例、平面/立面/剖面/节点、标高表、配筋表等宏观线索。',
  '只描述可见事实，不推导工程量，不把视觉读数当作权威尺寸；小字、密集标注或主体不完整时 needs_zoom=true。',
  '构件仅因象限边界被切开不算不清晰，不要仅因此设置 needs_zoom=true；在 summary 注明并添加“边界截断”label，相邻象限图可以联看。',
  'full 只用于整图概览和上下文，必须返回 needs_zoom=false；只允许 q1-q4 及后续子象限根据清晰度返回 needs_zoom=true。',
  '只返回一个 JSON 对象，不使用 Markdown。结构必须是：',
  '{"overview":{"title":string|null,"drawing_type":string|null,"scale":string|null,"summary":string,"visible_sections":string[]},"regions":[{"region_id":string,"legible":boolean,"needs_zoom":boolean,"summary":string,"labels":string[]}],"warnings":string[]}',
].join('\n')

interface CapturedRegion {
  region_id: string
  bbox: CadBridgeBBox
  staged_image_path: string
  image_path: string
}

interface VisionAssessment {
  overview: CadVisualOverview
  regions: CadVisualRegionAssessment[]
  warnings: string[]
}

export interface CadVisualIndexUsageContext {
  apiKey: string
  clientRunId: string
  childRunId: string
  recordUsage?(callIndex: number, usage: SubagentUsage): void
  fetchFn?: typeof fetch
}

export interface BuildCadVisualIndexOptions {
  facade: CadApplicationFacade
  projectRoot: string
  artifactRunId: string
  artifactDirectory: string
  document?: CadBridgeDocumentSelector
  frameId?: string
  usage: CadVisualIndexUsageContext
  signal?: AbortSignal
}

export interface CadVisualIndexResult {
  drawing: CadBridgeDrawing
  frame_id: string
  bbox: CadBridgeBBox
  frame_source: CadFrameWindowSource
  model: string
  visual_index_path: string
  visual_knowledge_path: string
  region_count: number
  zoom_region_count: number
  image_paths: string[]
  overview: CadVisualOverview
  warnings: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, field: string, maximum = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new Error(`Vision model field ${field} must be a bounded string.`)
  }
  return value
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null) return null
  const text = boundedString(value, field, 2_048).trim()
  return text || null
}

function boundedStringArray(value: unknown, field: string, maximumItems = 200): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`Vision model field ${field} must be a bounded string array.`)
  }
  return value.map((item, index) => boundedString(item, `${field}[${index}]`, 2_048))
}

function parseAssessment(value: unknown): VisionAssessment {
  if (!isRecord(value) || !isRecord(value.overview) || !Array.isArray(value.regions)) {
    throw new Error('Vision model returned an invalid visual-index object.')
  }
  if (value.regions.length > 64) throw new Error('Vision model returned too many visual regions.')
  const regions = value.regions.map((raw, index): CadVisualRegionAssessment => {
    if (
      !isRecord(raw)
      || typeof raw.region_id !== 'string'
      || raw.region_id.length > 16
      || typeof raw.legible !== 'boolean'
      || typeof raw.needs_zoom !== 'boolean'
    ) throw new Error(`Vision model returned an invalid region entry at index ${index}.`)
    return {
      region_id: raw.region_id,
      legible: raw.legible,
      needs_zoom: raw.needs_zoom,
      summary: boundedString(raw.summary, `regions[${index}].summary`),
      labels: boundedStringArray(raw.labels, `regions[${index}].labels`, 100),
    }
  })
  return {
    overview: {
      title: optionalString(value.overview.title, 'overview.title'),
      drawing_type: optionalString(value.overview.drawing_type, 'overview.drawing_type'),
      scale: optionalString(value.overview.scale, 'overview.scale'),
      summary: boundedString(value.overview.summary, 'overview.summary'),
      visible_sections: boundedStringArray(value.overview.visible_sections, 'overview.visible_sections'),
    },
    regions,
    warnings: boundedStringArray(value.warnings, 'warnings'),
  }
}

function completionText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) {
    throw new Error('Visual-index gateway returned no completion.')
  }
  const message = value.choices[0].message
  if (!isRecord(message) || typeof message.content !== 'string' || !message.content.trim()) {
    throw new Error('Visual-index gateway returned an empty completion.')
  }
  return message.content
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
}

function usageFromGateway(value: unknown): SubagentUsage {
  if (!isRecord(value) || !isRecord(value.usage)) return normalizeSubagentUsage({})
  const usage = value.usage
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : null
  const number = (candidate: unknown): number | undefined => (
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : undefined
  )
  const input = number(usage.prompt_tokens ?? usage.input)
  const output = number(usage.completion_tokens ?? usage.output)
  const cacheRead = number(promptDetails?.cached_tokens ?? usage.cache_read ?? usage.cacheRead)
  const cacheWrite = number(usage.cache_write ?? usage.cacheWrite)
  const total = number(usage.total_tokens ?? usage.total)
  return normalizeSubagentUsage({
    input,
    output,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    total: total ?? (
      typeof input === 'number' && typeof output === 'number'
        ? input + output
        : undefined
    ),
    cost: number(isRecord(usage.cost) ? usage.cost.total : usage.cost),
  })
}

async function validateAndReadPng(projectRoot: string, relativePath: string): Promise<Buffer> {
  const resolved = resolveProjectFile(projectRoot, relativePath)
  const stat = await fs.promises.stat(resolved.absolutePath)
  if (!stat.isFile() || stat.size < 24 || stat.size > CAD_VISUAL_MAX_IMAGE_BYTES) {
    throw new Error('CAD visual capture is empty or exceeds the image limit.')
  }
  const data = await fs.promises.readFile(resolved.absolutePath)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (!data.subarray(0, 8).equals(signature) || data.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('CAD visual capture is not a valid PNG.')
  }
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  if (
    width < 1
    || height < 1
    || width > 4_096
    || height > 4_096
    || width * height > CAD_VISUAL_CAPTURE_MAX_PIXELS
  ) throw new Error('CAD visual capture dimensions exceed the safety limit.')
  return data
}

async function assessRegions(
  regions: readonly CapturedRegion[],
  options: BuildCadVisualIndexOptions,
  callIndex: number,
): Promise<VisionAssessment> {
  const model = buildManagedPiModel('vision', 'visual_index')
  const apiKey = options.usage.apiKey.trim()
  if (!apiKey) throw new Error('CAD visual indexing requires a bound managed-model credential.')
  const content: Array<Record<string, unknown>> = [{
    type: 'text',
    text: `请按顺序分析 ${regions.map((region) => region.region_id).join(', ')}。每张图前的文字是其 region_id。`,
  }]
  for (const region of regions) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('CAD visual indexing was cancelled.')
    const data = await validateAndReadPng(options.projectRoot, region.staged_image_path)
    content.push({ type: 'text', text: `region_id=${region.region_id}` })
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${data.toString('base64')}` },
    })
  }

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new Error('CAD visual-index gateway request timed out.')),
    GATEWAY_TIMEOUT_MS,
  )
  const onAbort = (): void => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) onAbort()
  else options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await (options.usage.fetchFn ?? fetch)(
      `${model.baseUrl.replace(/\/+$/u, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Request-Id': `cad-visual-${randomUUID()}`,
          'X-Xiaoliang-Agent-Run-Id': options.usage.clientRunId,
        },
        body: JSON.stringify({
          model: model.id,
          messages: [
            { role: 'system', content: VISION_SYSTEM_PROMPT },
            { role: 'user', content },
          ],
          stream: false,
          enable_thinking: false,
          vl_high_resolution_images: CAD_VISUAL_HIGH_RESOLUTION_IMAGES,
          max_completion_tokens: model.maxTokens,
          response_format: { type: 'json_object' },
          xiaoliang_client_run_id: options.usage.clientRunId,
          xiaoliang_child_run_id: options.usage.childRunId,
          xiaoliang_call_purpose: 'visual_index',
        }),
        signal: controller.signal,
      },
    )
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`CAD visual-index gateway returned HTTP ${response.status}.`)
    }
    const responseText = await response.text()
    if (Buffer.byteLength(responseText, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('CAD visual-index gateway response exceeded the safety limit.')
    }
    let payload: unknown
    try {
      payload = JSON.parse(responseText)
    } catch {
      throw new Error('CAD visual-index gateway returned invalid JSON.')
    }
    options.usage.recordUsage?.(callIndex, usageFromGateway(payload))
    let assessmentPayload: unknown
    try {
      assessmentPayload = JSON.parse(completionText(payload))
    } catch {
      throw new Error('CAD visual-index model returned invalid JSON content.')
    }
    return parseAssessment(assessmentPayload)
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

function stableCapture(
  capture: CadBridgePlotResult,
  artifactRunId: string,
  artifactDirectory: string,
): CapturedRegion {
  const regionId = capture.quadrant ?? 'full'
  const stagingPrefix = `.xiaoliang/cad/.staging/${artifactRunId}/visual/`
  if (!capture.imagePath.startsWith(stagingPrefix)) {
    throw new Error('CAD bridge capture path did not match the requested staging run.')
  }
  return {
    region_id: regionId,
    bbox: capture.bbox,
    staged_image_path: capture.imagePath,
    image_path: `${artifactDirectory}/visual/${capture.imagePath.slice(stagingPrefix.length)}`,
  }
}

function normalizeRegions(
  captures: readonly CapturedRegion[],
  assessment: VisionAssessment,
  terminalDepth: boolean,
): CadVisualRegionAssessment[] {
  const requested = new Set(captures.map((capture) => capture.region_id))
  const assessed = new Map<string, CadVisualRegionAssessment>()
  for (const region of assessment.regions) {
    if (!requested.has(region.region_id) || assessed.has(region.region_id)) continue
    assessed.set(region.region_id, region)
  }
  return captures.map((capture) => {
    const fallback: CadVisualRegionAssessment = {
      region_id: capture.region_id,
      legible: false,
      needs_zoom: !terminalDepth && capture.region_id !== 'full',
      summary: '视觉模型未返回该区域。',
      labels: [],
    }
    const region = assessed.get(capture.region_id) ?? fallback
    return {
      ...region,
      region_id: capture.region_id,
      needs_zoom: terminalDepth || capture.region_id === 'full' ? false : region.needs_zoom,
    }
  })
}

async function atomicWrite(absolutePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true })
  const temporary = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.promises.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.promises.rename(temporary, absolutePath)
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined)
  }
}

function inline(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function renderKnowledge(index: {
  drawing: CadBridgeDrawing
  frame_id: string
  frame_source: CadFrameWindowSource
  model: string
  overview: CadVisualOverview
  regions: Array<CapturedRegion & CadVisualRegionAssessment>
  warnings: string[]
}): string {
  const lines = [
    '# CAD Visual Knowledge',
    '',
    `drawing: ${inline(index.drawing.name)}`,
    `frame_id: ${index.frame_id}`,
    `frame_source: ${index.frame_source}`,
    `model: ${inline(index.model)}`,
    `title: ${inline(index.overview.title ?? 'unknown')}`,
    `drawing_type: ${inline(index.overview.drawing_type ?? 'unknown')}`,
    `scale: ${inline(index.overview.scale ?? 'unknown')}`,
    `summary: ${inline(index.overview.summary)}`,
    `visible_sections: ${index.overview.visible_sections.map(inline).join(', ') || 'none'}`,
    '',
    '## Regions',
  ]
  for (const region of index.regions) {
    lines.push(
      `- region=${region.region_id} legible=${region.legible} needs_zoom=${region.needs_zoom} image=${region.image_path} bbox=${JSON.stringify(region.bbox)} summary=${inline(region.summary)} labels=${region.labels.map(inline).join(',')}`,
    )
  }
  if (index.warnings.length) {
    lines.push('', '## Warnings', ...index.warnings.map((warning) => `- ${inline(warning)}`))
  }
  return `${lines.join('\n')}\n`
}

export async function buildCadVisualIndex(
  options: BuildCadVisualIndexOptions,
): Promise<CadVisualIndexResult> {
  if (options.frameId !== undefined && !/^frame-[0-9]{2}$/u.test(options.frameId)) {
    throw new Error('Persistent CAD visual indexes require a detected frame id.')
  }
  const detection = await options.facade.detectFrames(options.document, options.signal)
  const plan = planFrameWindow(detection.frames, detection.extents, options.frameId ?? 'frame-01')
  const captureFirstLevel = async (window: CadFrameWindow): Promise<{
    window: CadFrameWindow
    set: Awaited<ReturnType<CadApplicationFacade['captureVisualSet']>>
    captures: CapturedRegion[]
  }> => {
    const set = await options.facade.captureVisualSet({
      ...(options.document ? { document: options.document } : {}),
      frameId: window.frameId,
      bbox: window.bbox,
      artifactRunId: options.artifactRunId,
    }, options.signal)
    if (!/^frame-[0-9]{2}$/u.test(set.frameId)) {
      throw new Error('CAD bridge selected a non-persistent custom frame.')
    }
    const captures = set.captures.map((capture) => (
      stableCapture(capture, options.artifactRunId, options.artifactDirectory)
    ))
    if (
      captures.length !== CAD_VISUAL_FIRST_LEVEL_REGIONS.length
      || captures.some((capture, index) => capture.region_id !== CAD_VISUAL_FIRST_LEVEL_REGIONS[index])
    ) throw new Error('CAD bridge did not return the deterministic full and q1-q4 capture set.')
    return { window, set, captures }
  }

  const frameWarnings = [...plan.primary.warnings]
  let pass = await captureFirstLevel(plan.primary)
  // An inkless plot means the window itself is wrong, so widen it before paying for a vision call.
  if (plan.fallback && hasEmptyPlotSignal(pass.set.warnings)) {
    frameWarnings.push(
      `Captures of the detected ${plan.primary.frameId} came back without ink, so the whole drawing extents were captured instead.`,
    )
    pass = await captureFirstLevel(plan.fallback)
  }
  let visionCall = 1
  let firstAssessment = await assessRegions(pass.captures, options, visionCall)
  let firstRegions = normalizeRegions(pass.captures, firstAssessment, false)
  if (plan.fallback && pass.window === plan.primary && allRegionsBlank(firstRegions)) {
    frameWarnings.push(
      `The vision model found every region of the detected ${plan.primary.frameId} blank, so the whole drawing extents were captured instead.`,
    )
    pass = await captureFirstLevel(plan.fallback)
    visionCall += 1
    firstAssessment = await assessRegions(pass.captures, options, visionCall)
    firstRegions = normalizeRegions(pass.captures, firstAssessment, false)
  }
  if (allRegionsBlank(firstRegions)) {
    throw new Error(
      'Every captured region is blank, so no visual index was published. '
      + `Window ${JSON.stringify(pass.set.bbox)} (${pass.window.source}) holds no readable drawing content: `
      + 'confirm the drawing is the intended sheet, or capture a known region with cad_capture action=plot before indexing.',
    )
  }
  const firstSet = pass.set
  const firstCaptures = pass.captures
  const frameSource = pass.window.source
  const zoomParents = firstRegions
    .filter((region): region is CadVisualRegionAssessment & { region_id: CadVisualQuadrant } => (
      region.needs_zoom
      && CAD_VISUAL_QUADRANTS.includes(region.region_id as CadVisualQuadrant)
    ))
    .map((region) => region.region_id)

  let nestedCaptures: CapturedRegion[] = []
  let nestedRegions: CadVisualRegionAssessment[] = []
  const warnings = [
    ...detection.warnings,
    ...frameWarnings,
    ...firstSet.warnings,
    ...firstAssessment.warnings,
  ]
  if (zoomParents.length) {
    const nestedSet = await options.facade.captureVisualZooms({
      ...(options.document ? { document: options.document } : {}),
      frameId: firstSet.frameId,
      bbox: firstSet.bbox,
      quadrants: zoomParents,
      artifactRunId: options.artifactRunId,
    }, options.signal)
    if (
      nestedSet.frameId !== firstSet.frameId
      || nestedSet.drawing.project_relative_path !== firstSet.drawing.project_relative_path
    ) throw new Error('CAD drawing or frame changed during second-level visual capture.')
    nestedCaptures = nestedSet.captures.map((capture) => (
      stableCapture(capture, options.artifactRunId, options.artifactDirectory)
    ))
    if (nestedCaptures.length !== zoomParents.length * 4) {
      throw new Error('CAD bridge returned an incomplete second-level visual capture set.')
    }
    visionCall += 1
    const nestedAssessment = await assessRegions(nestedCaptures, options, visionCall)
    nestedRegions = normalizeRegions(nestedCaptures, nestedAssessment, true)
    warnings.push(...nestedSet.warnings, ...nestedAssessment.warnings)
  }

  const captures = [...firstCaptures, ...nestedCaptures]
  const assessments = [...firstRegions, ...nestedRegions]
  const assessmentById = new Map(assessments.map((assessment) => [assessment.region_id, assessment]))
  const regions = captures.map((capture) => {
    const assessment = assessmentById.get(capture.region_id)
    if (!assessment) throw new Error(`Visual assessment is missing region ${capture.region_id}.`)
    return { ...capture, ...assessment }
  })
  const uniqueWarnings = [...new Set(warnings.map((warning) => inline(warning)).filter(Boolean))].slice(0, 200)
  const visualDirectory = `${options.artifactDirectory}/visual`
  const visualIndexPath = `${visualDirectory}/visual-index.json`
  const visualKnowledgePath = `${visualDirectory}/visual-knowledge.md`
  const stagingDirectory = `.xiaoliang/cad/.staging/${options.artifactRunId}/visual`
  const generatedAt = new Date().toISOString()
  const index = {
    schema_version: 1,
    drawing: {
      name: firstSet.drawing.name,
      project_relative_path: firstSet.drawing.project_relative_path,
    },
    frame_id: firstSet.frameId,
    frame_source: frameSource,
    bbox: firstSet.bbox,
    model: CAD_VISUAL_MODEL,
    generated_at: generatedAt,
    overview: firstAssessment.overview,
    regions: regions.map(({ staged_image_path: _stagedImagePath, ...region }) => region),
    warnings: uniqueWarnings,
  }
  const stagingRoot = resolveProjectFile(options.projectRoot, stagingDirectory)
  const directStagingRoot = path.resolve(
    stagingRoot.projectRoot,
    ...stagingRoot.relativePath.split('/'),
  )
  if (directStagingRoot.toLocaleLowerCase() !== stagingRoot.absolutePath.toLocaleLowerCase()) {
    throw new Error('CAD visual staging directory must not traverse a symbolic link.')
  }
  const stagingStat = await fs.promises.lstat(stagingRoot.absolutePath)
  if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink()) {
    throw new Error('CAD visual staging directory must be a regular directory.')
  }
  await atomicWrite(
    path.join(stagingRoot.absolutePath, 'visual-index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
  )
  await atomicWrite(path.join(stagingRoot.absolutePath, 'visual-knowledge.md'), renderKnowledge({
    drawing: firstSet.drawing,
    frame_id: firstSet.frameId,
    frame_source: frameSource,
    model: CAD_VISUAL_MODEL,
    overview: firstAssessment.overview,
    regions,
    warnings: uniqueWarnings,
  }))

  return {
    drawing: firstSet.drawing,
    frame_id: firstSet.frameId,
    bbox: firstSet.bbox,
    frame_source: frameSource,
    model: CAD_VISUAL_MODEL,
    visual_index_path: visualIndexPath,
    visual_knowledge_path: visualKnowledgePath,
    region_count: regions.length,
    zoom_region_count: nestedCaptures.length,
    image_paths: regions.map((region) => region.image_path),
    overview: firstAssessment.overview,
    warnings: uniqueWarnings,
  }
}
