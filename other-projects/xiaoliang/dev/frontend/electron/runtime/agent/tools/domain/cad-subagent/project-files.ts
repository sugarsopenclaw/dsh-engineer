import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

import { isWorldSpaceRecord, recordSpace } from './entity-geometry'
import { quantityContract, type CadQuantityContract } from './quantity-contract'

const CAD_ARTIFACT_ROOT = '.xiaoliang/cad'
const TEXT_EXTENSIONS = new Set(['.json', '.jsonl', '.md', '.txt', '.csv'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const SOURCE_EXTENSIONS = new Set(['.dwg', '.dxf'])
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  'dist',
  'dist-electron',
  'release',
])
const MAX_DIRECTORY_ENTRIES = 20_000
const MAX_FIND_RESULTS = 500
const MAX_GREP_FILES = 200
const MAX_GREP_MATCHES = 200
const MAX_TEXT_CHARS = 120_000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_CAD_SEARCH_TERMS = 16
const MAX_CAD_SEARCH_ENTITIES = 500_000
const MAX_CAD_SEARCH_LINE_CHARS = 2_000_000
const MAX_CAD_SEARCH_NEARBY = 120

interface ToolDetails {
  operation: string
  relative_paths: string[]
  truncated?: boolean
  match_count?: number
  matched_fields?: string[]
  matched_entity_count?: number
  nearby_count?: number
  /** Matches whose coordinates are local to a block definition or a layout. */
  outside_world_space_match_count?: number
  quantity_kind?: CadQuantityContract['quantity_kind']
  quantity_basis?: CadQuantityContract['quantity_basis']
  quantity_basis_enum?: CadQuantityContract['quantity_basis_enum']
  quantity_contracts?: Record<string, CadQuantityContract>
  suggested_detail_window?: EntityBBox
  coverage_handles?: CadSearchCoverageHandles
}

export interface CadArtifactImageContent {
  type: 'image'
  data: string
  mimeType: string
}

interface ReadInput {
  path: string
  offset?: number
  limit?: number
}

interface GrepInput {
  pattern: string
  path?: string
  case_sensitive?: boolean
  max_matches?: number
}

interface FindInput {
  pattern: string
  path?: string
  limit?: number
}

interface LsInput {
  path?: string
  limit?: number
}

interface CadSearchInput {
  path: string
  terms: string[]
  radius?: number
  max_matches?: number
  max_nearby?: number
}

interface EntityBBox {
  min: [number, number]
  max: [number, number]
}

interface LocalEntityResult {
  lineNumber: number
  bbox: EntityBBox | null
  value: Record<string, unknown>
  matchedFields?: string[]
}

interface NearbyEntityResult extends LocalEntityResult {
  distance: number
  rank: number
}

interface CadSearchCoverageHandles {
  matches: string[]
  annotations: string[]
  dimensions: string[]
  geometry: string[]
}

function normalizeRelativePath(value: string, allowRoot = false): string {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/$/u, '')
  if (allowRoot && (!normalized || normalized === '.')) return '.'
  if (
    !normalized
    || normalized.length > 4_096
    || normalized.includes('\0')
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(normalized)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Project path must be a safe relative path.')
  }
  return normalized
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveExistingPath(projectRoot: string, relativePath: string): string {
  const candidate = path.resolve(projectRoot, ...relativePath.split('/'))
  if (!isInside(projectRoot, candidate)) throw new Error('Project path escaped its trusted root.')
  let resolved: string
  try {
    resolved = fs.realpathSync(candidate)
  } catch {
    throw new Error('Requested project path does not exist.')
  }
  if (!isInside(projectRoot, resolved)) throw new Error('Project path escaped through a link.')
  return resolved
}

function toRelative(projectRoot: string, absolutePath: string): string {
  const relative = path.relative(projectRoot, absolutePath).replace(/\\/gu, '/')
  return relative || '.'
}

function isCadArtifactPath(relativePath: string): boolean {
  return relativePath === CAD_ARTIFACT_ROOT || relativePath.startsWith(`${CAD_ARTIFACT_ROOT}/`)
}

function mayReadFile(relativePath: string): boolean {
  if (!isCadArtifactPath(relativePath)) return false
  const extension = path.extname(relativePath).toLowerCase()
  return TEXT_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension)
}

function mayListFile(relativePath: string): boolean {
  const extension = path.extname(relativePath).toLowerCase()
  return SOURCE_EXTENSIONS.has(extension) || (isCadArtifactPath(relativePath) && mayReadFile(relativePath))
}

function mayDescend(relativePath: string, directoryName: string): boolean {
  if (IGNORED_DIRECTORIES.has(directoryName)) return false
  if (directoryName.startsWith('.') && directoryName !== '.xiaoliang') return false
  if (relativePath === '.xiaoliang') return true
  if (relativePath.startsWith('.xiaoliang/')) {
    return relativePath === CAD_ARTIFACT_ROOT || relativePath.startsWith(`${CAD_ARTIFACT_ROOT}/`)
  }
  return true
}

async function collectFiles(
  projectRoot: string,
  startRelativePath: string,
  predicate: (relativePath: string) => boolean,
  maximum: number,
  signal?: AbortSignal,
): Promise<{ files: string[]; truncated: boolean }> {
  const start = resolveExistingPath(projectRoot, startRelativePath)
  const stat = await fs.promises.stat(start)
  if (stat.isFile()) {
    const relative = toRelative(projectRoot, start)
    return { files: predicate(relative) ? [relative] : [], truncated: false }
  }
  if (!stat.isDirectory()) throw new Error('Project path must identify a file or directory.')
  const queue = [start]
  const files: string[] = []
  let visited = 0
  while (queue.length) {
    if (signal?.aborted) throw new Error('Project file operation was cancelled.')
    const directory = queue.shift() as string
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      visited += 1
      if (visited > MAX_DIRECTORY_ENTRIES) return { files, truncated: true }
      if (entry.isSymbolicLink()) continue
      const absolute = path.join(directory, entry.name)
      const relative = toRelative(projectRoot, absolute)
      if (entry.isDirectory()) {
        if (mayDescend(relative, entry.name)) queue.push(absolute)
        continue
      }
      if (!entry.isFile() || !predicate(relative)) continue
      files.push(relative)
      if (files.length >= maximum) return { files, truncated: true }
    }
  }
  return { files, truncated: false }
}

function globRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/gu, '/')
  if (!normalized || normalized.length > 256 || normalized.includes('\0')) {
    throw new Error('Find pattern is invalid.')
  }
  const doubleStar = '\u0000'
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*/gu, doubleStar)
    .replace(/\*/gu, '[^/]*')
    .replace(/\?/gu, '[^/]')
    .replaceAll(doubleStar, '.*')
  return new RegExp(`^(?:${escaped})$`, 'iu')
}

function imageMimeType(relativePath: string, data: Buffer): string {
  const extension = path.extname(relativePath).toLowerCase()
  if (
    extension === '.png'
    && data.length >= 8
    && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) return 'image/png'
  if (
    (extension === '.jpg' || extension === '.jpeg')
    && data.length >= 3
    && data[0] === 0xff
    && data[1] === 0xd8
    && data[2] === 0xff
  ) return 'image/jpeg'
  if (
    extension === '.webp'
    && data.length >= 12
    && data.subarray(0, 4).toString('ascii') === 'RIFF'
    && data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp'
  throw new Error('Image content does not match its supported extension.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface CadSearchField {
  path: string
  value: string
}

function searchableFieldValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function cadSearchFields(record: Record<string, unknown>): CadSearchField[] {
  const fields: CadSearchField[] = []
  const append = (fieldPath: string, value: unknown): void => {
    const searchable = searchableFieldValue(value)
    if (searchable !== null) fields.push({ path: fieldPath, value: searchable })
  }
  for (const key of ['text', 'content', 'content_clean', 'text_override'] as const) {
    append(key, record[key])
  }
  append('layer', record.layer)
  if (
    typeof record.type === 'string'
    && record.type.toLocaleLowerCase() === 'block_reference'
  ) append('name', record.name)
  if (isRecord(record.attributes)) {
    for (const [key, value] of Object.entries(record.attributes)) append(`attributes.${key}`, value)
  }
  return fields
}

function fieldContainsTerm(fieldValue: string, term: string): boolean {
  const normalized = fieldValue.toLocaleLowerCase()
  if (!/^\d{1,3}$/u.test(term)) return normalized.includes(term)
  const escaped = term.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(normalized)
}

function matchedCadSearchFields(
  record: Record<string, unknown>,
  terms: readonly string[],
): string[] {
  return cadSearchFields(record)
    .filter((field) => terms.some((term) => fieldContainsTerm(field.value, term)))
    .map((field) => field.path)
}

function entityBBox(value: unknown): EntityBBox | null {
  if (!isRecord(value) || !Array.isArray(value.min) || !Array.isArray(value.max)) return null
  const [minX, minY] = value.min
  const [maxX, maxY] = value.max
  if (
    typeof minX !== 'number'
    || typeof minY !== 'number'
    || typeof maxX !== 'number'
    || typeof maxY !== 'number'
    || !Number.isFinite(minX)
    || !Number.isFinite(minY)
    || !Number.isFinite(maxX)
    || !Number.isFinite(maxY)
  ) {
    return null
  }
  return {
    min: [Math.min(minX, maxX), Math.min(minY, maxY)],
    max: [Math.max(minX, maxX), Math.max(minY, maxY)],
  }
}

function bboxDistance(left: EntityBBox, right: EntityBBox): number {
  const dx = Math.max(left.min[0] - right.max[0], right.min[0] - left.max[0], 0)
  const dy = Math.max(left.min[1] - right.max[1], right.min[1] - left.max[1], 0)
  return Math.hypot(dx, dy)
}

function unionEntityBBoxes(values: EntityBBox[]): EntityBBox | undefined {
  if (!values.length) return undefined
  return values.reduce<EntityBBox>((combined, bbox) => ({
    min: [Math.min(combined.min[0], bbox.min[0]), Math.min(combined.min[1], bbox.min[1])],
    max: [Math.max(combined.max[0], bbox.max[0]), Math.max(combined.max[1], bbox.max[1])],
  }), values[0])
}

function bboxSpan(bbox: EntityBBox): { width: number; height: number } {
  return {
    width: bbox.max[0] - bbox.min[0],
    height: bbox.max[1] - bbox.min[1],
  }
}

function entityHandle(value: Record<string, unknown>): string | undefined {
  return typeof value.handle === 'string' && value.handle.trim()
    ? value.handle.toLocaleUpperCase()
    : undefined
}

function cadSearchCoverage(
  matches: LocalEntityResult[],
  nearby: NearbyEntityResult[],
  radius: number,
): { window?: EntityBBox; handles: CadSearchCoverageHandles } {
  const matchBoxes = matches.flatMap((item) => item.bbox ? [item.bbox] : [])
  const maximumMatchSpan = matchBoxes.reduce((maximum, bbox) => {
    const span = bboxSpan(bbox)
    return Math.max(maximum, span.width, span.height)
  }, 0)
  const maximumSpan = Math.max(radius * 4, maximumMatchSpan * 4, 1_000)
  const eligible = [...matches, ...nearby].filter((item) => {
    if (!item.bbox) return false
    const span = bboxSpan(item.bbox)
    // Drawing borders and title-block containers often enclose the text hit. Including
    // them would turn a local detail suggestion back into a near-full-sheet capture.
    return span.width <= maximumSpan && span.height <= maximumSpan
  })
  // Connectivity follows the caller's neighborhood scale. Long title text must not
  // widen this gap, otherwise it can bridge the intended detail into an adjacent view.
  const connectionDistance = Math.max(radius / 6, 1)
  const clusters = matches
    .filter((match) => match.bbox && eligible.includes(match))
    .map((match) => {
      const cluster: Array<LocalEntityResult | NearbyEntityResult> = [match]
      const selected = new Set([match])
      let expanded = true
      while (expanded) {
        expanded = false
        for (const candidate of eligible) {
          if (selected.has(candidate) || !candidate.bbox) continue
          if (!cluster.some((item) => item.bbox && bboxDistance(item.bbox, candidate.bbox as EntityBBox) <= connectionDistance)) {
            continue
          }
          cluster.push(candidate)
          selected.add(candidate)
          expanded = true
        }
      }
      const types = new Set(cluster.map((item) => (
        typeof item.value.type === 'string' ? item.value.type.toLocaleLowerCase() : ''
      )))
      const roleCount = Number(types.has('dimension'))
        + Number([...types].some((type) => ['text', 'mtext', 'leader', 'mleader', 'table'].includes(type)))
        + Number([...types].some((type) => !['', 'dimension', 'text', 'mtext', 'leader', 'mleader', 'table'].includes(type)))
      return { cluster, roleCount, firstLine: match.lineNumber }
    })
    .sort((left, right) => (
      right.roleCount - left.roleCount
      || right.cluster.length - left.cluster.length
      || left.firstLine - right.firstLine
    ))
  const selectedCluster = clusters[0]?.cluster ?? []
  const selectedMatches = selectedCluster.filter((item) => matches.includes(item))
  const handles: CadSearchCoverageHandles = {
    matches: [],
    annotations: [],
    dimensions: [],
    geometry: [],
  }
  const seen = new Set<string>()
  const append = (bucket: keyof CadSearchCoverageHandles, value: Record<string, unknown>, maximum: number): void => {
    const handle = entityHandle(value)
    if (!handle || seen.has(handle) || handles[bucket].length >= maximum) return
    seen.add(handle)
    handles[bucket].push(handle)
  }
  for (const item of selectedMatches) append('matches', item.value, 8)
  for (const item of selectedCluster) {
    const type = typeof item.value.type === 'string' ? item.value.type.toLocaleLowerCase() : ''
    if (type === 'dimension') {
      append('dimensions', item.value, 12)
    } else if (['text', 'mtext', 'leader', 'mleader', 'table'].includes(type)) {
      append('annotations', item.value, 12)
    } else {
      append('geometry', item.value, 16)
    }
  }
  return {
    window: unionEntityBBoxes(selectedCluster.flatMap((item) => item.bbox ? [item.bbox] : [])),
    handles,
  }
}

function compactEntity(record: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {}
  const scalarKeys = [
    'handle',
    'type',
    'object_name',
    'layer',
    'bbox',
    'content_clean',
    'content',
    'text_override',
    'measurement',
    'position',
    'insert_point',
    'name',
    'closed',
    'area',
    'length',
    'height',
    'rotation',
    'style',
  ]
  for (const key of scalarKeys) {
    const value = record[key]
    if (value === undefined || value === null || value === '') continue
    compact[key] = typeof value === 'string' && value.length > 1_200
      ? `${value.slice(0, 1_199)}…`
      : value
  }
  // A hit inside a block definition or on a layout is real content, but its coordinates
  // are local to that space. Saying so on the record keeps a reader from reporting the
  // block's own origin as a place on the sheet.
  if (!isWorldSpaceRecord(record)) {
    const space = recordSpace(record)
    compact.owner_scope = space
    if (typeof record.owner_block_name === 'string' && record.owner_block_name) {
      compact.owner_block_name = record.owner_block_name.slice(0, 1_024)
    }
    compact.position_semantics = space === 'paper_space' ? 'layout_sheet_local' : 'block_definition_local'
  }
  if (Array.isArray(record.vertices)) compact.vertices = record.vertices.slice(0, 12)
  if (isRecord(record.attributes)) {
    compact.attributes = Object.fromEntries(Object.entries(record.attributes).slice(0, 20))
  }
  const attributeQuantityFields = isRecord(record.attributes)
    ? Object.keys(record.attributes).filter((key) => /数量|qty|quantity|count/iu.test(key)).slice(0, 20)
    : []
  const type = typeof record.type === 'string' ? record.type.toLocaleLowerCase() : ''
  compact.quantity_contract = attributeQuantityFields.length > 0
    ? {
        ...quantityContract('bom_attribute'),
        fields: attributeQuantityFields.map((key) => `attributes.${key}`),
      }
    : quantityContract(type === 'dimension' ? 'annotation_occurrences' : 'unknown')
  if (type === 'dimension' && typeof record.measurement === 'number' && Number.isFinite(record.measurement)) {
    compact.measurement_quantity_contract = quantityContract('measured_length')
  }
  return compact
}

function nearbyEntityPenalty(record: Record<string, unknown>): number {
  const type = typeof record.type === 'string' ? record.type.toLocaleLowerCase() : ''
  if (type === 'dimension') return 0
  if (['text', 'mtext', 'leader', 'mleader', 'table'].includes(type)) return 150
  if (type === 'lwpolyline' && record.closed === true) return 300
  if (['block_reference', 'hatch', 'lwpolyline', 'polyline'].includes(type)) return 600
  if (type === 'line') return 1_200
  return 900
}

function renderLocalEntities(
  title: string,
  values: Array<LocalEntityResult | NearbyEntityResult>,
  maximumCharacters: number,
): { text: string; truncated: boolean } {
  const lines = [title]
  let characters = title.length
  let truncated = false
  for (const item of values) {
    const matchedFields = item.matchedFields?.length ? { matched_fields: item.matchedFields } : {}
    const payload = 'distance' in item
      ? {
          distance: Number(item.distance.toFixed(3)),
          line: item.lineNumber,
          ...matchedFields,
          ...compactEntity(item.value),
        }
      : { line: item.lineNumber, ...matchedFields, ...compactEntity(item.value) }
    const line = JSON.stringify(payload)
    if (characters + line.length + 1 > maximumCharacters) {
      truncated = true
      break
    }
    lines.push(line)
    characters += line.length + 1
  }
  return { text: lines.join('\n'), truncated }
}

export async function loadCadArtifactImage(
  projectRootInput: string,
  relativePathInput: string,
  signal?: AbortSignal,
): Promise<CadArtifactImageContent> {
  const projectRoot = fs.realpathSync(path.resolve(projectRootInput))
  const relativePath = normalizeRelativePath(relativePathInput)
  if (
    !isCadArtifactPath(relativePath)
    || !IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
  ) {
    throw new Error('CAD image must be a supported project artifact under .xiaoliang/cad.')
  }
  const absolutePath = resolveExistingPath(projectRoot, relativePath)
  const stat = await fs.promises.stat(absolutePath)
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_IMAGE_BYTES) {
    throw new Error('CAD image must be a regular file between 1 byte and 20 MiB.')
  }
  if (signal?.aborted) throw new Error('Project image read was cancelled.')
  const data = await fs.promises.readFile(absolutePath)
  if (signal?.aborted) throw new Error('Project image read was cancelled.')
  return {
    type: 'image',
    data: data.toString('base64'),
    mimeType: imageMimeType(relativePath, data),
  }
}

async function readTextLines(
  absolutePath: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<{ text: string; truncated: boolean }> {
  const input = fs.createReadStream(absolutePath, { encoding: 'utf8' })
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  const selected: string[] = []
  let lineNumber = 0
  let characters = 0
  let truncated = false
  try {
    for await (const line of lines) {
      if (signal?.aborted) throw new Error('Project file read was cancelled.')
      lineNumber += 1
      if (lineNumber <= offset) continue
      if (selected.length >= limit || characters + line.length + 1 > MAX_TEXT_CHARS) {
        truncated = true
        break
      }
      selected.push(`${lineNumber}: ${line}`)
      characters += line.length + 1
    }
  } finally {
    lines.close()
    input.destroy()
  }
  return { text: selected.join('\n'), truncated }
}

const ENTITY_INDEX_FILENAME = 'entities.raw.jsonl'
const MAX_LISTED_ENTITY_INDEXES = 40

function isEntityIndexPath(relativePath: string): boolean {
  return isCadArtifactPath(relativePath)
    && path.posix.basename(relativePath).toLocaleLowerCase() === ENTITY_INDEX_FILENAME
}

/**
 * Every wrong cad_search path in the field was a guessed artifact directory, and the bare
 * "does not exist" told the model nothing about where the indexes actually are. Listing them
 * turns a dead end into the next call.
 */
async function describeEntityIndexes(
  projectRoot: string,
  signal?: AbortSignal,
): Promise<string> {
  let files: string[] = []
  try {
    const collected = await collectFiles(
      projectRoot,
      CAD_ARTIFACT_ROOT,
      isEntityIndexPath,
      MAX_LISTED_ENTITY_INDEXES,
      signal,
    )
    files = collected.files
  } catch {
    // No CAD artifact root yet, which the empty-inventory wording below already covers.
  }
  if (!files.length) {
    return `No ${ENTITY_INDEX_FILENAME} exists in this project yet; run cad_extract action=run on the drawing first.`
  }
  return `Available entity indexes: ${files.join(', ')}`
}

export function buildCadSubagentProjectFileTools(projectRootInput: string): AgentTool<any, ToolDetails>[] {
  const projectRoot = fs.realpathSync(path.resolve(projectRootInput))

  const readTool: AgentTool<any, ToolDetails> = {
    name: 'read',
    label: 'Read CAD Artifact',
    description: [
      'Read a text or image artifact under .xiaoliang/cad using a project-relative path.',
      'Images are returned directly to the isolated multimodal child; raw DWG and files outside the CAD artifact root are rejected.',
    ].join('\n'),
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4_096 }),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000_000, default: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000, default: 400 })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, raw, signal) => {
      const input = raw as ReadInput
      const relativePath = normalizeRelativePath(input.path)
      if (!mayReadFile(relativePath)) {
        throw new Error('read only accepts supported files under .xiaoliang/cad.')
      }
      const absolutePath = resolveExistingPath(projectRoot, relativePath)
      const stat = await fs.promises.stat(absolutePath)
      if (!stat.isFile()) throw new Error('read path must identify a regular file.')
      const extension = path.extname(relativePath).toLowerCase()
      if (IMAGE_EXTENSIONS.has(extension)) {
        const image = await loadCadArtifactImage(projectRoot, relativePath, signal)
        return {
          content: [
            { type: 'text', text: `CAD image artifact: ${relativePath}` },
            image,
          ],
          details: { operation: 'read', relative_paths: [relativePath] },
        }
      }
      const result = await readTextLines(
        absolutePath,
        input.offset ?? 0,
        input.limit ?? 400,
        signal,
      )
      return {
        content: [{
          type: 'text',
          text: [`CAD artifact: ${relativePath}`, result.text || '(empty)', result.truncated ? '[truncated]' : '']
            .filter(Boolean)
            .join('\n'),
        }],
        details: {
          operation: 'read',
          relative_paths: [relativePath],
          truncated: result.truncated,
        },
      }
    },
  }

  const grepTool: AgentTool<any, ToolDetails> = {
    name: 'grep',
    label: 'Search CAD Artifacts',
    description: 'Literal text search across project-local CAD text artifacts. Returns bounded path, line and snippet matches.',
    parameters: Type.Object({
      pattern: Type.String({ minLength: 1, maxLength: 512 }),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096, default: CAD_ARTIFACT_ROOT })),
      case_sensitive: Type.Optional(Type.Boolean({ default: false })),
      max_matches: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_GREP_MATCHES, default: 80 })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, raw, signal) => {
      const input = raw as GrepInput
      const startPath = normalizeRelativePath(input.path ?? CAD_ARTIFACT_ROOT, true)
      if (!isCadArtifactPath(startPath)) throw new Error('grep is restricted to .xiaoliang/cad.')
      const maximum = input.max_matches ?? 80
      const collected = await collectFiles(
        projectRoot,
        startPath,
        (relative) => isCadArtifactPath(relative) && TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase()),
        MAX_GREP_FILES,
        signal,
      )
      const needle = input.case_sensitive ? input.pattern : input.pattern.toLocaleLowerCase()
      const matches: string[] = []
      const paths = new Set<string>()
      outer: for (const relativePath of collected.files) {
        const absolutePath = resolveExistingPath(projectRoot, relativePath)
        const stream = fs.createReadStream(absolutePath, { encoding: 'utf8' })
        const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
        let lineNumber = 0
        try {
          for await (const line of lines) {
            if (signal?.aborted) throw new Error('CAD artifact search was cancelled.')
            lineNumber += 1
            const haystack = input.case_sensitive ? line : line.toLocaleLowerCase()
            if (!haystack.includes(needle)) continue
            matches.push(`${relativePath}:${lineNumber}: ${line.slice(0, 2_000)}`)
            paths.add(relativePath)
            if (matches.length >= maximum) break outer
          }
        } finally {
          lines.close()
          stream.destroy()
        }
      }
      const truncated = collected.truncated || matches.length >= maximum
      return {
        content: [{
          type: 'text',
          text: matches.length
            ? `${matches.join('\n')}${truncated ? '\n[truncated]' : ''}`
            : 'No matching CAD artifact text was found.',
        }],
        details: {
          operation: 'grep',
          relative_paths: [...paths],
          match_count: matches.length,
          truncated,
        },
      }
    },
  }

  const cadSearchTool: AgentTool<any, ToolDetails> = {
    name: 'cad_search',
    label: 'Search Local CAD Entities',
    description: [
      'Zero-network search over one project-local entities.raw.jsonl artifact.',
      'Use this before cad_query for a named or numbered component. Start with all likely literal aliases; if the component tag and its method/section/detail live in different regions, make a new targeted search for the relevant title instead of repeating the same terms.',
      'The result includes field-level substring matches over text/content/text_override/attributes/block name/layer, a bounded bbox-neighborhood, coverage-role handles, and a suggested_detail_window that excludes oversized drawing frames.',
      'match_count is text_frequency, not a drawing-occurrence or budget quantity; short numeric terms only match complete tokens in allowed text fields.',
      'The index also covers text authored inside block definitions and on layouts. Those hits are returned with owner_scope and position_semantics because their coordinates are local to that space: they anchor no neighborhood and no detail window, and are located through the block_reference insertion points that place their block.',
    ].join('\n'),
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4_096 }),
      terms: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
        minItems: 1,
        maxItems: MAX_CAD_SEARCH_TERMS,
      }),
      radius: Type.Optional(Type.Number({ minimum: 0, maximum: 1_000_000_000, default: 12_000 })),
      max_matches: Type.Optional(Type.Integer({ minimum: 1, maximum: 40, default: 20 })),
      max_nearby: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_CAD_SEARCH_NEARBY, default: 32 })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, raw, signal) => {
      const input = raw as CadSearchInput
      const relativePath = normalizeRelativePath(input.path)
      if (!isEntityIndexPath(relativePath)) {
        throw new Error(
          `cad_search only accepts an ${ENTITY_INDEX_FILENAME} artifact under ${CAD_ARTIFACT_ROOT}. `
          + await describeEntityIndexes(projectRoot, signal),
        )
      }
      let absolutePath: string
      try {
        absolutePath = resolveExistingPath(projectRoot, relativePath)
      } catch {
        throw new Error(
          `cad_search found no artifact at ${relativePath}. `
          + await describeEntityIndexes(projectRoot, signal),
        )
      }
      const stat = await fs.promises.stat(absolutePath)
      if (!stat.isFile()) throw new Error('cad_search path must identify a regular file.')

      const terms = [...new Set(input.terms.map((term) => term.trim().toLocaleLowerCase()).filter(Boolean))]
      if (terms.length < 1) throw new Error('cad_search requires at least one non-empty literal term.')
      const maximumMatches = input.max_matches ?? 20
      const maximumNearby = input.max_nearby ?? 32
      const radius = input.radius ?? 12_000
      const matches: LocalEntityResult[] = []
      const matchedHandles = new Set<string>()
      const matchedFieldNames = new Set<string>()
      let totalMatches = 0
      let totalMatchedEntities = 0
      let outsideWorldSpaceMatches = 0
      let lineNumber = 0

      const matchInput = fs.createReadStream(absolutePath, { encoding: 'utf8' })
      const matchLines = readline.createInterface({ input: matchInput, crlfDelay: Infinity })
      try {
        for await (const line of matchLines) {
          if (signal?.aborted) throw new Error('Local CAD entity search was cancelled.')
          lineNumber += 1
          if (lineNumber > MAX_CAD_SEARCH_ENTITIES) throw new Error('CAD entity artifact exceeds the local search limit.')
          if (!line || line.length > MAX_CAD_SEARCH_LINE_CHARS) continue
          const haystack = line.toLocaleLowerCase()
          if (!terms.some((term) => haystack.includes(term))) continue
          let value: unknown
          try {
            value = JSON.parse(line)
          } catch {
            continue
          }
          if (!isRecord(value)) continue
          const matchedFields = matchedCadSearchFields(value, terms)
          if (matchedFields.length === 0) continue
          totalMatches += matchedFields.length
          totalMatchedEntities += 1
          for (const field of matchedFields) matchedFieldNames.add(field)
          if (!isWorldSpaceRecord(value)) outsideWorldSpaceMatches += 1
          if (matches.length >= maximumMatches) continue
          // The text of a hit inside a block definition is worth returning; its box is
          // not, because it would anchor the neighborhood and the suggested detail window
          // to the block's own origin instead of anywhere the block was inserted.
          matches.push({
            lineNumber,
            bbox: isWorldSpaceRecord(value) ? entityBBox(value.bbox) : null,
            value,
            matchedFields,
          })
          if (typeof value.handle === 'string') matchedHandles.add(value.handle.toLocaleUpperCase())
        }
      } finally {
        matchLines.close()
        matchInput.destroy()
      }

      const anchors = matches.flatMap((item) => item.bbox ? [item.bbox] : [])
      const nearby: NearbyEntityResult[] = []
      let totalNearby = 0
      if (anchors.length > 0 && maximumNearby > 0) {
        lineNumber = 0
        const nearbyInput = fs.createReadStream(absolutePath, { encoding: 'utf8' })
        const nearbyLines = readline.createInterface({ input: nearbyInput, crlfDelay: Infinity })
        try {
          for await (const line of nearbyLines) {
            if (signal?.aborted) throw new Error('Local CAD entity search was cancelled.')
            lineNumber += 1
            if (lineNumber > MAX_CAD_SEARCH_ENTITIES) throw new Error('CAD entity artifact exceeds the local search limit.')
            if (!line || line.length > MAX_CAD_SEARCH_LINE_CHARS) continue
            let value: unknown
            try {
              value = JSON.parse(line)
            } catch {
              continue
            }
            if (!isRecord(value)) continue
            const handle = typeof value.handle === 'string' ? value.handle.toLocaleUpperCase() : ''
            if (handle && matchedHandles.has(handle)) continue
            if (!isWorldSpaceRecord(value)) continue
            const bbox = entityBBox(value.bbox)
            if (!bbox) continue
            const distance = Math.min(...anchors.map((anchor) => bboxDistance(anchor, bbox)))
            if (distance > radius) continue
            totalNearby += 1
            nearby.push({
              lineNumber,
              bbox,
              value,
              distance,
              rank: distance + nearbyEntityPenalty(value),
            })
            if (nearby.length > Math.max(maximumNearby * 20, 400)) {
              nearby.sort((left, right) => left.rank - right.rank || left.lineNumber - right.lineNumber)
              nearby.length = Math.max(maximumNearby * 4, 160)
            }
          }
        } finally {
          nearbyLines.close()
          nearbyInput.destroy()
        }
      }
      nearby.sort((left, right) => left.rank - right.rank || left.lineNumber - right.lineNumber)
      const selectedNearby = nearby.slice(0, maximumNearby)
      const coverage = cadSearchCoverage(matches, selectedNearby, radius)
      const matchSection = renderLocalEntities(`Substring matches (${totalMatches} field hits):`, matches, MAX_TEXT_CHARS / 2)
      const nearbySection = renderLocalEntities(
        `Nearby entities within ${radius} drawing units (${totalNearby}, showing ${selectedNearby.length}):`,
        selectedNearby,
        MAX_TEXT_CHARS - matchSection.text.length,
      )
      const truncated = totalMatchedEntities > matches.length
        || totalNearby > selectedNearby.length
        || matchSection.truncated
        || nearbySection.truncated
      return {
        content: [{
          type: 'text',
          text: [
            `Local CAD entity search: ${relativePath}`,
            `Terms: ${input.terms.join(' | ')}`,
            matchSection.text,
            nearbySection.text,
            coverage.window
              ? `Suggested complete-detail window (oversized frames excluded): ${JSON.stringify(coverage.window)}`
              : 'Suggested complete-detail window: unavailable',
            outsideWorldSpaceMatches > 0
              ? `${outsideWorldSpaceMatches} of the matched entities are authored inside a block `
                + 'definition or on a layout, so their coordinates are local to that space and '
                + 'they anchor no window here. Locate them through the block_reference '
                + 'insertion points that place their block.'
              : '',
            `Coverage handles: ${JSON.stringify(coverage.handles)}`,
            truncated ? '[truncated]' : '',
          ].filter(Boolean).join('\n'),
        }],
        details: {
          operation: 'cad_search',
          relative_paths: [relativePath],
          match_count: totalMatches,
          matched_entity_count: totalMatchedEntities,
          matched_fields: [...matchedFieldNames].sort(),
          nearby_count: totalNearby,
          outside_world_space_match_count: outsideWorldSpaceMatches,
          ...quantityContract('text_frequency'),
          quantity_contracts: {
            match_count: quantityContract('text_frequency'),
            nearby_count: quantityContract('drawing_occurrences'),
          },
          ...(coverage.window ? { suggested_detail_window: coverage.window } : {}),
          coverage_handles: coverage.handles,
          truncated,
        },
      }
    },
  }

  const findTool: AgentTool<any, ToolDetails> = {
    name: 'find',
    label: 'Find CAD Files',
    description: 'Find project DWG/DXF sources and .xiaoliang/cad artifacts by a bounded glob pattern.',
    parameters: Type.Object({
      pattern: Type.String({ minLength: 1, maxLength: 256 }),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096, default: '.' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_FIND_RESULTS, default: 100 })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, raw, signal) => {
      const input = raw as FindInput
      const startPath = normalizeRelativePath(input.path ?? '.', true)
      const matcher = globRegex(input.pattern)
      const collected = await collectFiles(
        projectRoot,
        startPath,
        (relative) => mayListFile(relative) && (matcher.test(relative) || matcher.test(path.posix.basename(relative))),
        input.limit ?? 100,
        signal,
      )
      return {
        content: [{
          type: 'text',
          text: collected.files.length
            ? `${collected.files.join('\n')}${collected.truncated ? '\n[truncated]' : ''}`
            : 'No matching CAD source or artifact was found.',
        }],
        details: {
          operation: 'find',
          relative_paths: collected.files.filter(isCadArtifactPath),
          truncated: collected.truncated,
        },
      }
    },
  }

  const lsTool: AgentTool<any, ToolDetails> = {
    name: 'ls',
    label: 'List CAD Project Paths',
    description: 'List safe project directories, DWG/DXF files and CAD artifacts without following links.',
    parameters: Type.Object({
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096, default: '.' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, raw) => {
      const input = raw as LsInput
      const relativePath = normalizeRelativePath(input.path ?? '.', true)
      const absolutePath = resolveExistingPath(projectRoot, relativePath)
      const stat = await fs.promises.stat(absolutePath)
      if (!stat.isDirectory()) throw new Error('ls path must identify a directory.')
      const entries = await fs.promises.readdir(absolutePath, { withFileTypes: true })
      const maximum = input.limit ?? 100
      const visible = entries
        .filter((entry) => {
          if (entry.isSymbolicLink()) return false
          const childRelative = relativePath === '.' ? entry.name : `${relativePath}/${entry.name}`
          return entry.isDirectory()
            ? mayDescend(childRelative, entry.name)
            : entry.isFile() && mayListFile(childRelative)
        })
        .sort((left, right) => left.name.localeCompare(right.name))
      const selected = visible.slice(0, maximum)
      const rendered = selected.map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)
      return {
        content: [{
          type: 'text',
          text: rendered.length
            ? `${rendered.join('\n')}${visible.length > selected.length ? '\n[truncated]' : ''}`
            : 'No safe CAD paths were found in this directory.',
        }],
        details: {
          operation: 'ls',
          relative_paths: [],
          truncated: visible.length > selected.length,
        },
      }
    },
  }

  return [readTool, grepTool, cadSearchTool, findTool, lsTool]
}
