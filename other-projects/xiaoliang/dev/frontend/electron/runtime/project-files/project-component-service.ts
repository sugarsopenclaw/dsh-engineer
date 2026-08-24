import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ProjectComponentAnchors,
  ProjectComponentEvidence,
  ProjectComponentFilter,
  ProjectComponentIdentity,
  ProjectComponentImageResult,
  ProjectComponentPatch,
  ProjectComponentQuantities,
  ProjectComponentRecord,
  ProjectComponentRelation,
  ProjectComponentSaveInput,
  ProjectComponentSaveItemResult,
  ProjectComponentSemantics,
  ProjectComponentStatus,
  ProjectComponentSummary,
} from '../../../src/shared/local-agent'
import { getProjectSummary } from '../conversations/conversation-repository'

const COMPONENT_SCHEMA_VERSION = 'xiaoliang-component-v1' as const
const COMPONENT_ROOT_SEGMENTS = ['.xiaoliang', 'components', 'records'] as const
const MAX_COMPONENT_RECORDS = 10_000
const MAX_COMPONENT_RECORD_BYTES = 2 * 1024 * 1024
const MAX_COMPONENT_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_SAVE_BATCH = 200
const MAX_CONFIRM_BATCH = 500
const MAX_SOURCE_HANDLES = 1_000
const MAX_DIMENSIONS = 200
const MAX_QUANTITY_ITEMS = 1_000
const MAX_EVIDENCE_IMAGES = 100
const MAX_EVIDENCE_TEXT_ITEMS = 1_000
const MAX_RELATIONS = 500
const COMPONENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SOURCE_KEY_PATTERN = /^[0-9a-f]{64}$/
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/
const componentMutationTails = new Map<string, Promise<void>>()

interface ComponentEditableData {
  identity: ProjectComponentIdentity
  anchors: ProjectComponentAnchors
  quantities: ProjectComponentQuantities
  semantics: ProjectComponentSemantics
  evidence: ProjectComponentEvidence
  relations?: ProjectComponentRelation[]
}

interface ProjectComponentRoot {
  projectId: string
  projectRootRealPath: string
  recordsRootPath: string
  recordsRootRealPath: string | null
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('操作已取消。')
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} 必须是对象。`)
  }
  return value
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const allowedSet = new Set(allowed)
  const unsupported = Object.keys(value).filter((key) => !allowedSet.has(key))
  if (unsupported.length > 0) {
    throw new Error(`${label} 包含不支持的字段：${unsupported.join('、')}。`)
  }
}

function normalizeRequiredString(value: unknown, label: string, maxLength = 2_000) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} 不能为空。`)
  }
  const normalized = value.trim()
  if (normalized.length > maxLength) {
    throw new Error(`${label} 不能超过 ${maxLength} 个字符。`)
  }
  return normalized
}

function normalizeOptionalString(value: unknown, label: string, maxLength = 2_000) {
  if (value === undefined || value === null || value === '') return undefined
  return normalizeRequiredString(value, label, maxLength)
}

function normalizeStringArray(value: unknown, label: string, maxItems: number, maxLength = 2_000) {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    throw new Error(`${label} 必须是数组。`)
  }
  if (value.length > maxItems) {
    throw new Error(`${label} 不能超过 ${maxItems} 项。`)
  }
  const seen = new Set<string>()
  const result: string[] = []
  for (const [index, item] of value.entries()) {
    const normalized = normalizeRequiredString(item, `${label}[${index}]`, maxLength)
    const key = normalized.toLocaleLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(normalized)
    }
  }
  return result.length > 0 ? result : undefined
}

function normalizeProjectRelativePath(value: unknown, label: string) {
  const rawPath = normalizeRequiredString(value, label, 1_000).replace(/\\/g, '/')
  const normalized = rawPath.replace(/^\.\//, '').replace(/^\/+/, '')
  if (path.isAbsolute(rawPath) || WINDOWS_ABSOLUTE_PATH_PATTERN.test(rawPath)) {
    throw new Error(`${label} 必须是项目内相对路径。`)
  }
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0) {
    throw new Error(`${label} 不能为空。`)
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.includes('\0')) {
      throw new Error(`${label} 包含不安全的路径片段。`)
    }
  }
  return segments.join('/')
}

function normalizeIdentity(value: unknown): ProjectComponentIdentity {
  const input = requireObject(value, 'identity')
  assertAllowedKeys(
    input,
    ['component_type', 'component_subtype', 'semantic_name', 'discipline', 'aliases'],
    'identity',
  )
  const componentSubtype = normalizeOptionalString(input.component_subtype, 'identity.component_subtype', 200)
  const semanticName = normalizeOptionalString(input.semantic_name, 'identity.semantic_name', 300)
  const discipline = normalizeOptionalString(input.discipline, 'identity.discipline', 100)
  const aliases = normalizeStringArray(input.aliases, 'identity.aliases', 100, 300)
  return {
    component_type: normalizeRequiredString(input.component_type, 'identity.component_type', 200),
    ...(componentSubtype ? { component_subtype: componentSubtype } : {}),
    ...(semanticName ? { semantic_name: semanticName } : {}),
    ...(discipline ? { discipline } : {}),
    ...(aliases ? { aliases } : {}),
  }
}

function normalizeAnchors(value: unknown): ProjectComponentAnchors {
  const input = requireObject(value, 'anchors')
  assertAllowedKeys(input, ['drawing_relpath', 'layout_name', 'source_handles', 'bbox'], 'anchors')
  if (!Array.isArray(input.source_handles) || input.source_handles.length === 0) {
    throw new Error('anchors.source_handles 至少需要一个 CAD handle。')
  }
  if (input.source_handles.length > MAX_SOURCE_HANDLES) {
    throw new Error(`anchors.source_handles 不能超过 ${MAX_SOURCE_HANDLES} 项。`)
  }

  const handles: ProjectComponentAnchors['source_handles'] = []
  const seenHandles = new Set<string>()
  input.source_handles.forEach((rawHandle, index) => {
    const handleInput = requireObject(rawHandle, `anchors.source_handles[${index}]`)
    assertAllowedKeys(handleInput, ['handle', 'role'], `anchors.source_handles[${index}]`)
    const handle = normalizeRequiredString(handleInput.handle, `anchors.source_handles[${index}].handle`, 100)
    const role = normalizeOptionalString(handleInput.role, `anchors.source_handles[${index}].role`, 100)
    const dedupeKey = handle.toLocaleUpperCase()
    if (!seenHandles.has(dedupeKey)) {
      seenHandles.add(dedupeKey)
      handles.push({ handle, ...(role ? { role } : {}) })
    }
  })

  let bbox: number[] | undefined
  if (input.bbox !== undefined && input.bbox !== null) {
    if (!Array.isArray(input.bbox) || input.bbox.length < 4 || input.bbox.length > 12) {
      throw new Error('anchors.bbox 必须是包含 4 至 12 个有限数字的数组。')
    }
    bbox = input.bbox.map((item, index) => {
      if (typeof item !== 'number' || !Number.isFinite(item)) {
        throw new Error(`anchors.bbox[${index}] 必须是有限数字。`)
      }
      return item
    })
  }

  const layoutName = normalizeOptionalString(input.layout_name, 'anchors.layout_name', 300)
  return {
    drawing_relpath: normalizeProjectRelativePath(input.drawing_relpath, 'anchors.drawing_relpath'),
    ...(layoutName ? { layout_name: layoutName } : {}),
    source_handles: handles,
    ...(bbox ? { bbox } : {}),
  }
}

function normalizeQuantities(value: unknown): ProjectComponentQuantities {
  if (value === undefined || value === null) return {}
  const input = requireObject(value, 'quantities')
  assertAllowedKeys(input, ['unit', 'dimensions', 'items'], 'quantities')
  const unit = normalizeOptionalString(input.unit, 'quantities.unit', 100)

  let dimensions: Record<string, number | string> | undefined
  if (input.dimensions !== undefined && input.dimensions !== null) {
    const rawDimensions = requireObject(input.dimensions, 'quantities.dimensions')
    const entries = Object.entries(rawDimensions)
    if (entries.length > MAX_DIMENSIONS) {
      throw new Error(`quantities.dimensions 不能超过 ${MAX_DIMENSIONS} 项。`)
    }
    dimensions = {}
    entries.forEach(([rawKey, rawValue]) => {
      const key = normalizeRequiredString(rawKey, 'quantities.dimensions 的字段名', 200)
      if (typeof rawValue === 'number') {
        if (!Number.isFinite(rawValue)) {
          throw new Error(`quantities.dimensions.${key} 必须是有限数字或字符串。`)
        }
        dimensions![key] = rawValue
        return
      }
      dimensions![key] = normalizeRequiredString(rawValue, `quantities.dimensions.${key}`, 500)
    })
    if (entries.length === 0) dimensions = undefined
  }

  let items: ProjectComponentQuantities['items']
  if (input.items !== undefined && input.items !== null) {
    if (!Array.isArray(input.items)) {
      throw new Error('quantities.items 必须是数组。')
    }
    if (input.items.length > MAX_QUANTITY_ITEMS) {
      throw new Error(`quantities.items 不能超过 ${MAX_QUANTITY_ITEMS} 项。`)
    }
    items = input.items.map((rawItem, index) => {
      const item = requireObject(rawItem, `quantities.items[${index}]`)
      assertAllowedKeys(item, ['name', 'value', 'unit', 'formula', 'basis'], `quantities.items[${index}]`)
      if (typeof item.value !== 'number' || !Number.isFinite(item.value)) {
        throw new Error(`quantities.items[${index}].value 必须是有限数字。`)
      }
      const formula = normalizeOptionalString(item.formula, `quantities.items[${index}].formula`, 2_000)
      const basis = normalizeOptionalString(item.basis, `quantities.items[${index}].basis`, 4_000)
      return {
        name: normalizeRequiredString(item.name, `quantities.items[${index}].name`, 300),
        value: item.value,
        unit: normalizeRequiredString(item.unit, `quantities.items[${index}].unit`, 100),
        ...(formula ? { formula } : {}),
        ...(basis ? { basis } : {}),
      }
    })
    if (items.length === 0) items = undefined
  }

  return {
    ...(unit ? { unit } : {}),
    ...(dimensions ? { dimensions } : {}),
    ...(items ? { items } : {}),
  }
}

function normalizeSemantics(value: unknown): ProjectComponentSemantics {
  const input = requireObject(value, 'semantics')
  assertAllowedKeys(input, ['description', 'notes'], 'semantics')
  const notes = normalizeStringArray(input.notes, 'semantics.notes', 500, 4_000)
  return {
    description: normalizeRequiredString(input.description, 'semantics.description', 50_000),
    ...(notes ? { notes } : {}),
  }
}

function normalizeEvidence(value: unknown): ProjectComponentEvidence {
  if (value === undefined || value === null) return {}
  const input = requireObject(value, 'evidence')
  assertAllowedKeys(input, ['evidence_pack', 'images', 'text'], 'evidence')
  const evidencePack = input.evidence_pack === undefined || input.evidence_pack === null || input.evidence_pack === ''
    ? undefined
    : normalizeProjectRelativePath(input.evidence_pack, 'evidence.evidence_pack')

  let images: ProjectComponentEvidence['images']
  if (input.images !== undefined && input.images !== null) {
    if (!Array.isArray(input.images)) {
      throw new Error('evidence.images 必须是数组。')
    }
    if (input.images.length > MAX_EVIDENCE_IMAGES) {
      throw new Error(`evidence.images 不能超过 ${MAX_EVIDENCE_IMAGES} 项。`)
    }
    images = input.images.map((rawImage, index) => {
      const image = requireObject(rawImage, `evidence.images[${index}]`)
      assertAllowedKeys(image, ['path', 'note'], `evidence.images[${index}]`)
      const note = normalizeOptionalString(image.note, `evidence.images[${index}].note`, 4_000)
      return {
        path: normalizeProjectRelativePath(image.path, `evidence.images[${index}].path`),
        ...(note ? { note } : {}),
      }
    })
    if (images.length === 0) images = undefined
  }

  let text: ProjectComponentEvidence['text']
  if (input.text !== undefined && input.text !== null) {
    if (!Array.isArray(input.text)) {
      throw new Error('evidence.text 必须是数组。')
    }
    if (input.text.length > MAX_EVIDENCE_TEXT_ITEMS) {
      throw new Error(`evidence.text 不能超过 ${MAX_EVIDENCE_TEXT_ITEMS} 项。`)
    }
    text = input.text.map((rawText, index) => {
      const textItem = requireObject(rawText, `evidence.text[${index}]`)
      assertAllowedKeys(textItem, ['handle', 'text', 'role'], `evidence.text[${index}]`)
      const handle = normalizeOptionalString(textItem.handle, `evidence.text[${index}].handle`, 100)
      const role = normalizeOptionalString(textItem.role, `evidence.text[${index}].role`, 100)
      return {
        ...(handle ? { handle } : {}),
        text: normalizeRequiredString(textItem.text, `evidence.text[${index}].text`, 20_000),
        ...(role ? { role } : {}),
      }
    })
    if (text.length === 0) text = undefined
  }

  return {
    ...(evidencePack ? { evidence_pack: evidencePack } : {}),
    ...(images ? { images } : {}),
    ...(text ? { text } : {}),
  }
}

function normalizeRelations(value: unknown): ProjectComponentRelation[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    throw new Error('relations 必须是数组。')
  }
  if (value.length > MAX_RELATIONS) {
    throw new Error(`relations 不能超过 ${MAX_RELATIONS} 项。`)
  }
  const relations = value.map((rawRelation, index) => {
    const relation = requireObject(rawRelation, `relations[${index}]`)
    assertAllowedKeys(relation, ['type', 'target_component_id', 'target_handle'], `relations[${index}]`)
    const targetComponentId = normalizeOptionalString(
      relation.target_component_id,
      `relations[${index}].target_component_id`,
      100,
    )
    if (targetComponentId && !COMPONENT_ID_PATTERN.test(targetComponentId)) {
      throw new Error(`relations[${index}].target_component_id 不是有效构件 ID。`)
    }
    const targetHandle = normalizeOptionalString(relation.target_handle, `relations[${index}].target_handle`, 100)
    return {
      type: normalizeRequiredString(relation.type, `relations[${index}].type`, 200),
      ...(targetComponentId ? { target_component_id: targetComponentId } : {}),
      ...(targetHandle ? { target_handle: targetHandle } : {}),
    }
  })
  return relations.length > 0 ? relations : undefined
}

function normalizeEditableData(value: unknown): ComponentEditableData {
  const input = requireObject(value, '构件数据')
  assertAllowedKeys(
    input,
    ['identity', 'anchors', 'quantities', 'semantics', 'evidence', 'relations'],
    '构件数据',
  )
  const relations = normalizeRelations(input.relations)
  return {
    identity: normalizeIdentity(input.identity),
    anchors: normalizeAnchors(input.anchors),
    quantities: normalizeQuantities(input.quantities),
    semantics: normalizeSemantics(input.semantics),
    evidence: normalizeEvidence(input.evidence),
    ...(relations ? { relations } : {}),
  }
}

function sourceKeyFor(data: Pick<ComponentEditableData, 'identity' | 'anchors'>) {
  const stableInput = {
    drawing_relpath: data.anchors.drawing_relpath.toLowerCase(),
    layout_name: data.anchors.layout_name?.toLowerCase() || '',
    component_type: data.identity.component_type.toLowerCase(),
    source_handles: data.anchors.source_handles
      .map((item) => item.handle.toUpperCase())
      .sort(),
  }
  return createHash('sha256').update(JSON.stringify(stableInput), 'utf8').digest('hex')
}

function normalizeTimestamp(value: unknown, label: string) {
  const timestamp = normalizeRequiredString(value, label, 100)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`${label} 不是有效时间。`)
  }
  return timestamp
}

function normalizeStoredRecord(value: unknown, expectedComponentId?: string): ProjectComponentRecord {
  const input = requireObject(value, '构件记录')
  if (input.schema_version !== COMPONENT_SCHEMA_VERSION) {
    throw new Error(`不支持的构件 schema_version：${String(input.schema_version || '缺失')}。`)
  }
  const componentId = normalizeRequiredString(input.component_id, 'component_id', 100)
  if (!COMPONENT_ID_PATTERN.test(componentId) || (expectedComponentId && componentId !== expectedComponentId)) {
    throw new Error('component_id 无效或与文件名不一致。')
  }
  if (input.status !== 'draft' && input.status !== 'confirmed') {
    throw new Error('status 必须是 draft 或 confirmed。')
  }
  const sourceKey = normalizeRequiredString(input.source_key, 'source_key', 100).toLocaleLowerCase()
  if (!SOURCE_KEY_PATTERN.test(sourceKey)) {
    throw new Error('source_key 格式无效。')
  }
  const data = normalizeEditableData({
    identity: input.identity,
    anchors: input.anchors,
    quantities: input.quantities,
    semantics: input.semantics,
    evidence: input.evidence,
    relations: input.relations,
  })
  if (sourceKeyFor(data) !== sourceKey) {
    throw new Error('source_key 与构件锚点不一致。')
  }

  const provenanceInput = requireObject(input.provenance, 'provenance')
  if (provenanceInput.created_by !== 'agent' && provenanceInput.created_by !== 'user') {
    throw new Error('provenance.created_by 必须是 agent 或 user。')
  }
  const runId = normalizeOptionalString(provenanceInput.run_id, 'provenance.run_id', 300)
  const confirmedAt = normalizeOptionalString(provenanceInput.confirmed_at, 'provenance.confirmed_at', 100)
  if (confirmedAt && Number.isNaN(Date.parse(confirmedAt))) {
    throw new Error('provenance.confirmed_at 不是有效时间。')
  }
  if (input.status === 'confirmed' && !confirmedAt) {
    throw new Error('confirmed 构件缺少 provenance.confirmed_at。')
  }

  return {
    schema_version: COMPONENT_SCHEMA_VERSION,
    component_id: componentId,
    source_key: sourceKey,
    status: input.status,
    ...data,
    provenance: {
      created_by: provenanceInput.created_by,
      ...(runId ? { run_id: runId } : {}),
      ...(confirmedAt ? { confirmed_at: confirmedAt } : {}),
      created_at: normalizeTimestamp(provenanceInput.created_at, 'provenance.created_at'),
      updated_at: normalizeTimestamp(provenanceInput.updated_at, 'provenance.updated_at'),
    },
  }
}

function toSummary(record: ProjectComponentRecord): ProjectComponentSummary {
  return {
    component_id: record.component_id,
    source_key: record.source_key,
    status: record.status,
    component_type: record.identity.component_type,
    ...(record.identity.component_subtype ? { component_subtype: record.identity.component_subtype } : {}),
    ...(record.identity.semantic_name ? { semantic_name: record.identity.semantic_name } : {}),
    ...(record.identity.discipline ? { discipline: record.identity.discipline } : {}),
    drawing_relpath: record.anchors.drawing_relpath,
    ...(record.anchors.layout_name ? { layout_name: record.anchors.layout_name } : {}),
    source_handle_count: record.anchors.source_handles.length,
    quantity_item_count: record.quantities.items?.length ?? 0,
    updated_at: record.provenance.updated_at,
    ...(record.provenance.confirmed_at ? { confirmed_at: record.provenance.confirmed_at } : {}),
  }
}

function matchesFilter(record: ProjectComponentRecord, filter?: ProjectComponentFilter) {
  if (!filter) return true
  if (filter.status && record.status !== filter.status) return false

  const componentType = filter.component_type?.trim().toLocaleLowerCase()
  if (componentType && record.identity.component_type.toLocaleLowerCase() !== componentType) return false

  const drawingPath = filter.drawing_relpath?.trim().replace(/\\/g, '/').toLocaleLowerCase()
  if (drawingPath && !record.anchors.drawing_relpath.toLocaleLowerCase().includes(drawingPath)) return false

  const keyword = filter.keyword?.trim().toLocaleLowerCase()
  if (!keyword) return true
  const haystack = [
    record.component_id,
    record.identity.component_type,
    record.identity.component_subtype,
    record.identity.semantic_name,
    record.identity.discipline,
    ...(record.identity.aliases ?? []),
    record.anchors.drawing_relpath,
    record.anchors.layout_name,
    ...record.anchors.source_handles.flatMap((item) => [item.handle, item.role]),
    record.semantics.description,
    ...(record.semantics.notes ?? []),
    ...(record.quantities.items ?? []).flatMap((item) => [item.name, item.unit, item.formula, item.basis]),
  ].filter((item): item is string => typeof item === 'string')
  return haystack.some((item) => item.toLocaleLowerCase().includes(keyword))
}

function isPathInsideRoot(rootPath: string, targetPath: string) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function validateComponentId(componentId: string) {
  const normalized = componentId.trim()
  if (!COMPONENT_ID_PATTERN.test(normalized)) {
    throw new Error('构件 ID 格式无效。')
  }
  return normalized
}

async function resolveProjectComponentRoot(projectId: string, create: boolean): Promise<ProjectComponentRoot> {
  const normalizedProjectId = normalizeRequiredString(projectId, 'projectId', 200)
  const project = getProjectSummary(normalizedProjectId)
  if (!project) {
    throw new Error(`未找到项目：${normalizedProjectId}。`)
  }
  const rootPath = project.rootPath?.trim()
  if (!rootPath) {
    throw new Error('当前项目尚未绑定本地资料目录。请先在项目工作台绑定项目目录。')
  }
  const rootStat = await fs.promises.stat(rootPath).catch(() => null)
  if (!rootStat?.isDirectory()) {
    throw new Error('项目资料目录不可访问或不是文件夹。')
  }
  const projectRootRealPath = await fs.promises.realpath(rootPath)
  const recordsRootPath = path.join(projectRootRealPath, ...COMPONENT_ROOT_SEGMENTS)
  if (create) {
    await fs.promises.mkdir(recordsRootPath, { recursive: true })
  }

  let recordsRootRealPath: string | null = null
  try {
    const recordsStat = await fs.promises.stat(recordsRootPath)
    if (!recordsStat.isDirectory()) {
      throw new Error('.xiaoliang/components/records 已存在但不是文件夹。')
    }
    recordsRootRealPath = await fs.promises.realpath(recordsRootPath)
    if (!isPathInsideRoot(projectRootRealPath, recordsRootRealPath)) {
      throw new Error('构件记录目录指向项目目录之外，已拒绝访问。')
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (!create && code === 'ENOENT') {
      recordsRootRealPath = null
    } else {
      throw error
    }
  }

  return {
    projectId: project.id,
    projectRootRealPath,
    recordsRootPath,
    recordsRootRealPath,
  }
}

async function readRecordFile(
  recordsRootRealPath: string,
  componentId: string,
  signal?: AbortSignal,
): Promise<ProjectComponentRecord> {
  throwIfAborted(signal)
  const targetPath = path.join(recordsRootRealPath, `${validateComponentId(componentId)}.json`)
  const targetRealPath = await fs.promises.realpath(targetPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new Error(`未找到构件：${componentId}。`)
    throw error
  })
  if (!isPathInsideRoot(recordsRootRealPath, targetRealPath)) {
    throw new Error('构件记录文件指向记录目录之外，已拒绝读取。')
  }
  const stat = await fs.promises.stat(targetRealPath)
  if (!stat.isFile()) {
    throw new Error(`构件记录不是文件：${componentId}。`)
  }
  if (stat.size > MAX_COMPONENT_RECORD_BYTES) {
    throw new Error(`构件记录超过 ${Math.round(MAX_COMPONENT_RECORD_BYTES / 1024 / 1024)}MB，已拒绝读取。`)
  }
  const raw = await fs.promises.readFile(targetRealPath, 'utf8')
  throwIfAborted(signal)
  try {
    return normalizeStoredRecord(JSON.parse(raw), componentId)
  } catch (error) {
    throw new Error(`构件记录 ${componentId} 无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function scanRecords(
  root: ProjectComponentRoot,
  signal?: AbortSignal,
  strict = false,
) {
  if (!root.recordsRootRealPath) return []
  const entries = await fs.promises.readdir(root.recordsRootRealPath, { withFileTypes: true })
  const recordEntries = entries.filter((entry) => entry.isFile() && COMPONENT_ID_PATTERN.test(path.parse(entry.name).name) && path.extname(entry.name).toLocaleLowerCase() === '.json')
  if (recordEntries.length > MAX_COMPONENT_RECORDS) {
    throw new Error(`项目构件超过 ${MAX_COMPONENT_RECORDS} 条，已达到 v1 扫描上限；请迁移到索引存储后再继续。`)
  }

  const records: ProjectComponentRecord[] = []
  for (const entry of recordEntries) {
    throwIfAborted(signal)
    const componentId = path.parse(entry.name).name
    try {
      records.push(await readRecordFile(root.recordsRootRealPath, componentId, signal))
    } catch (error) {
      if (strict) {
        throw new Error(`构件库包含无效记录 ${entry.name}：${error instanceof Error ? error.message : String(error)}`)
      }
      console.warn('[project-components] skipped invalid record', entry.name, error)
    }
  }
  return records
}

async function atomicWriteRecord(recordsRootRealPath: string, record: ProjectComponentRecord) {
  const serialized = `${JSON.stringify(record, null, 2)}\n`
  const sizeBytes = Buffer.byteLength(serialized, 'utf8')
  if (sizeBytes > MAX_COMPONENT_RECORD_BYTES) {
    throw new Error(`单个构件记录超过 ${Math.round(MAX_COMPONENT_RECORD_BYTES / 1024 / 1024)}MB，已拒绝写入。请将图片和大段原始证据保留为项目相对路径。`)
  }

  const targetPath = path.join(recordsRootRealPath, `${validateComponentId(record.component_id)}.json`)
  const existingStat = await fs.promises.lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (existingStat?.isSymbolicLink() || (existingStat && !existingStat.isFile())) {
    throw new Error('构件记录目标不是普通文件，已拒绝覆盖。')
  }

  const tempPath = path.join(
    recordsRootRealPath,
    `.tmp-xiaoliang-component-${process.pid}-${Date.now()}-${randomUUID()}.json`,
  )
  try {
    await fs.promises.writeFile(tempPath, serialized, { encoding: 'utf8', flag: 'wx' })
    await fs.promises.rename(tempPath, targetPath)
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function mergePatch(record: ProjectComponentRecord, patch: ProjectComponentPatch): ComponentEditableData {
  const rawPatch = requireObject(patch, 'patch')
  assertAllowedKeys(rawPatch, ['identity', 'anchors', 'quantities', 'semantics', 'evidence', 'relations'], 'patch')
  return normalizeEditableData({
    identity: rawPatch.identity === undefined
      ? record.identity
      : { ...record.identity, ...requireObject(rawPatch.identity, 'patch.identity') },
    anchors: rawPatch.anchors === undefined
      ? record.anchors
      : { ...record.anchors, ...requireObject(rawPatch.anchors, 'patch.anchors') },
    quantities: rawPatch.quantities === undefined ? record.quantities : rawPatch.quantities,
    semantics: rawPatch.semantics === undefined
      ? record.semantics
      : { ...record.semantics, ...requireObject(rawPatch.semantics, 'patch.semantics') },
    evidence: rawPatch.evidence === undefined ? record.evidence : rawPatch.evidence,
    relations: rawPatch.relations === undefined ? record.relations : rawPatch.relations,
  })
}

export class ProjectComponentService {
  private async withMutationLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const queueKey = projectId.trim()
    const previous = componentMutationTails.get(queueKey) ?? Promise.resolve()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    componentMutationTails.set(queueKey, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (componentMutationTails.get(queueKey) === tail) {
        componentMutationTails.delete(queueKey)
      }
    }
  }

  async listComponents(
    projectId: string,
    filter?: ProjectComponentFilter,
    signal?: AbortSignal,
  ): Promise<ProjectComponentSummary[]> {
    const root = await resolveProjectComponentRoot(projectId, false)
    const records = await scanRecords(root, signal)
    return records
      .filter((record) => matchesFilter(record, filter))
      .sort((left, right) => right.provenance.updated_at.localeCompare(left.provenance.updated_at))
      .map(toSummary)
  }

  async getComponent(
    projectId: string,
    componentId: string,
    signal?: AbortSignal,
  ): Promise<ProjectComponentRecord> {
    const root = await resolveProjectComponentRoot(projectId, false)
    if (!root.recordsRootRealPath) {
      throw new Error(`未找到构件：${componentId}。`)
    }
    return readRecordFile(root.recordsRootRealPath, componentId, signal)
  }

  async saveComponents(
    projectId: string,
    inputs: ProjectComponentSaveInput[],
    status: ProjectComponentStatus,
    overwriteConfirmed = false,
    signal?: AbortSignal,
  ): Promise<ProjectComponentSaveItemResult[]> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new Error('components 至少需要一条构件数据。')
    }
    if (inputs.length > MAX_SAVE_BATCH) {
      throw new Error(`单次最多保存 ${MAX_SAVE_BATCH} 个构件。`)
    }
    if (status !== 'draft' && status !== 'confirmed') {
      throw new Error('status 必须是 draft 或 confirmed。')
    }

    const normalizedInputs = inputs.map((input, index) => {
      try {
        const rawInput = requireObject(input, `components[${index}]`)
        assertAllowedKeys(
          rawInput,
          ['identity', 'anchors', 'quantities', 'semantics', 'evidence', 'relations', 'provenance'],
          `components[${index}]`,
        )
        const data = normalizeEditableData({
          identity: rawInput.identity,
          anchors: rawInput.anchors,
          quantities: rawInput.quantities,
          semantics: rawInput.semantics,
          evidence: rawInput.evidence,
          relations: rawInput.relations,
        })
        const provenanceInput = rawInput.provenance === undefined
          ? {}
          : requireObject(rawInput.provenance, `components[${index}].provenance`)
        assertAllowedKeys(provenanceInput, ['created_by', 'run_id'], `components[${index}].provenance`)
        let createdBy: 'agent' | 'user'
        if (provenanceInput.created_by === undefined) {
          createdBy = 'agent'
        } else if (provenanceInput.created_by === 'agent' || provenanceInput.created_by === 'user') {
          createdBy = provenanceInput.created_by
        } else {
          throw new Error(`components[${index}].provenance.created_by 必须是 agent 或 user。`)
        }
        const runId = normalizeOptionalString(provenanceInput.run_id, `components[${index}].provenance.run_id`, 300)
        return { data, sourceKey: sourceKeyFor(data), createdBy, runId }
      } catch (error) {
        throw new Error(`第 ${index + 1} 个构件无效：${error instanceof Error ? error.message : String(error)}`)
      }
    })
    const batchKeys = new Set<string>()
    normalizedInputs.forEach((input) => {
      if (batchKeys.has(input.sourceKey)) {
        throw new Error(`批次中存在重复构件 source_key：${input.sourceKey}。`)
      }
      batchKeys.add(input.sourceKey)
    })

    return this.withMutationLock(projectId, async () => {
      throwIfAborted(signal)
      const root = await resolveProjectComponentRoot(projectId, true)
      if (!root.recordsRootRealPath) {
        throw new Error('构件记录目录创建失败。')
      }
      const records = await scanRecords(root, signal, true)
      const bySourceKey = new Map<string, ProjectComponentRecord>()
      for (const record of records) {
        if (bySourceKey.has(record.source_key)) {
          throw new Error(`构件库存在重复 source_key：${record.source_key}，请先修复数据冲突。`)
        }
        bySourceKey.set(record.source_key, record)
      }

      const results: ProjectComponentSaveItemResult[] = []
      for (const input of normalizedInputs) {
        throwIfAborted(signal)
        const existing = bySourceKey.get(input.sourceKey)
        if (existing?.status === 'confirmed' && !overwriteConfirmed) {
          results.push({
            action: 'conflict',
            component: toSummary(existing),
            warning: '已存在 confirmed 构件，默认未覆盖；仅在用户明确确认覆盖后传 overwrite_confirmed=true。',
          })
          continue
        }
        if (!existing && bySourceKey.size >= MAX_COMPONENT_RECORDS) {
          throw new Error(`项目构件已达到 ${MAX_COMPONENT_RECORDS} 条 v1 存储上限；请迁移到索引存储后再继续。`)
        }

        const now = new Date().toISOString()
        const finalStatus: ProjectComponentStatus = existing?.status === 'confirmed' ? 'confirmed' : status
        const record: ProjectComponentRecord = {
          schema_version: COMPONENT_SCHEMA_VERSION,
          component_id: existing?.component_id ?? randomUUID(),
          source_key: input.sourceKey,
          status: finalStatus,
          ...input.data,
          provenance: {
            created_by: existing?.provenance.created_by ?? input.createdBy,
            ...(input.runId || existing?.provenance.run_id
              ? { run_id: input.runId ?? existing?.provenance.run_id }
              : {}),
            ...(finalStatus === 'confirmed'
              ? {
                  confirmed_at: existing?.status === 'confirmed' && overwriteConfirmed
                    ? now
                    : existing?.provenance.confirmed_at ?? now,
                }
              : {}),
            created_at: existing?.provenance.created_at ?? now,
            updated_at: now,
          },
        }
        await atomicWriteRecord(root.recordsRootRealPath, record)
        bySourceKey.set(record.source_key, record)
        results.push({
          action: existing ? 'updated' : 'created',
          component: toSummary(record),
        })
      }
      return results
    })
  }

  async updateComponent(
    projectId: string,
    componentId: string,
    patch: ProjectComponentPatch,
    signal?: AbortSignal,
  ): Promise<ProjectComponentRecord> {
    const normalizedId = validateComponentId(componentId)
    return this.withMutationLock(projectId, async () => {
      throwIfAborted(signal)
      const root = await resolveProjectComponentRoot(projectId, false)
      if (!root.recordsRootRealPath) throw new Error(`未找到构件：${normalizedId}。`)
      const existing = await readRecordFile(root.recordsRootRealPath, normalizedId, signal)
      const data = mergePatch(existing, patch)
      const nextSourceKey = sourceKeyFor(data)
      if (nextSourceKey !== existing.source_key) {
        const records = await scanRecords(root, signal, true)
        const conflict = records.find((record) => (
          record.component_id !== existing.component_id && record.source_key === nextSourceKey
        ))
        if (conflict) {
          throw new Error(`修改后的锚点与构件 ${conflict.component_id} 冲突，已拒绝更新。`)
        }
      }

      const updated: ProjectComponentRecord = {
        ...existing,
        ...data,
        source_key: nextSourceKey,
        provenance: {
          ...existing.provenance,
          updated_at: new Date().toISOString(),
        },
      }
      await atomicWriteRecord(root.recordsRootRealPath, updated)
      return updated
    })
  }

  async confirmComponents(
    projectId: string,
    componentIds: string[],
    signal?: AbortSignal,
  ): Promise<ProjectComponentSummary[]> {
    if (!Array.isArray(componentIds) || componentIds.length === 0) {
      throw new Error('component_ids 至少需要一个构件 ID。')
    }
    if (componentIds.length > MAX_CONFIRM_BATCH) {
      throw new Error(`单次最多确认 ${MAX_CONFIRM_BATCH} 个构件。`)
    }
    const ids = [...new Set(componentIds.map(validateComponentId))]
    return this.withMutationLock(projectId, async () => {
      throwIfAborted(signal)
      const root = await resolveProjectComponentRoot(projectId, false)
      if (!root.recordsRootRealPath) throw new Error('项目构件库为空。')
      const records = await Promise.all(ids.map((id) => readRecordFile(root.recordsRootRealPath!, id, signal)))
      const summaries: ProjectComponentSummary[] = []
      for (const record of records) {
        throwIfAborted(signal)
        if (record.status === 'confirmed') {
          summaries.push(toSummary(record))
          continue
        }
        const now = new Date().toISOString()
        const confirmed: ProjectComponentRecord = {
          ...record,
          status: 'confirmed',
          provenance: {
            ...record.provenance,
            confirmed_at: now,
            updated_at: now,
          },
        }
        await atomicWriteRecord(root.recordsRootRealPath, confirmed)
        summaries.push(toSummary(confirmed))
      }
      return summaries
    })
  }

  async deleteComponent(
    projectId: string,
    componentId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const normalizedId = validateComponentId(componentId)
    await this.withMutationLock(projectId, async () => {
      throwIfAborted(signal)
      const root = await resolveProjectComponentRoot(projectId, false)
      if (!root.recordsRootRealPath) throw new Error(`未找到构件：${normalizedId}。`)
      const targetPath = path.join(root.recordsRootRealPath, `${normalizedId}.json`)
      const targetRealPath = await fs.promises.realpath(targetPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw new Error(`未找到构件：${normalizedId}。`)
        throw error
      })
      if (!isPathInsideRoot(root.recordsRootRealPath, targetRealPath)) {
        throw new Error('构件记录文件指向记录目录之外，已拒绝删除。')
      }
      const stat = await fs.promises.lstat(targetPath)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('构件记录目标不是普通文件，已拒绝删除。')
      }
      await fs.promises.unlink(targetPath)
    })
  }

  async readProjectImage(
    projectId: string,
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<ProjectComponentImageResult> {
    throwIfAborted(signal)
    const root = await resolveProjectComponentRoot(projectId, false)
    const normalizedPath = normalizeProjectRelativePath(relativePath, '图片路径')
    const extension = path.posix.extname(normalizedPath).toLocaleLowerCase()
    const mimeType = extension === '.png'
      ? 'image/png' as const
      : extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg' as const
        : null
    if (!mimeType) {
      throw new Error('只允许读取项目内 PNG/JPG 证据图。')
    }

    const absolutePath = path.resolve(root.projectRootRealPath, normalizedPath.replace(/\//g, path.sep))
    if (!isPathInsideRoot(root.projectRootRealPath, absolutePath)) {
      throw new Error('拒绝读取项目目录之外的图片。')
    }
    const realPath = await fs.promises.realpath(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new Error(`未找到证据图：${normalizedPath}。`)
      throw error
    })
    if (!isPathInsideRoot(root.projectRootRealPath, realPath)) {
      throw new Error('证据图指向项目目录之外，已拒绝读取。')
    }
    const stat = await fs.promises.stat(realPath)
    if (!stat.isFile()) throw new Error('证据图路径不是文件。')
    if (stat.size > MAX_COMPONENT_IMAGE_BYTES) {
      throw new Error(`证据图超过 ${Math.round(MAX_COMPONENT_IMAGE_BYTES / 1024 / 1024)}MB，已拒绝读取。`)
    }
    const buffer = await fs.promises.readFile(realPath)
    throwIfAborted(signal)
    const validSignature = mimeType === 'image/png'
      ? buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    if (!validSignature) {
      throw new Error('证据图内容与文件扩展名不一致。')
    }
    return {
      path: normalizedPath,
      mime_type: mimeType,
      size_bytes: buffer.byteLength,
      data_url: `data:${mimeType};base64,${buffer.toString('base64')}`,
    }
  }
}

export const PROJECT_COMPONENT_STORAGE_LIMITS = {
  maxRecords: MAX_COMPONENT_RECORDS,
  maxRecordBytes: MAX_COMPONENT_RECORD_BYTES,
  maxSaveBatch: MAX_SAVE_BATCH,
} as const
