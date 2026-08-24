import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type {
  CadBridgeDocument,
  CadBridgeDocumentSelector,
  CadBridgeDrawing,
} from '../../../../cad/drivers/autocad-http/cad-application-facade'
import type { CadApplicationFacade } from '../../../../cad/drivers/autocad-http/cad-application-facade'
import {
  CAD_VISUAL_CAPTURE_MAX_PIXELS,
  CAD_VISUAL_FIRST_LEVEL_REGIONS,
  CAD_VISUAL_MAX_IMAGE_BYTES,
  CAD_VISUAL_MODEL,
  createCadVisualProducer,
  type CadVisualProducerDescriptor,
} from './visual-contract'

export const CAD_ARTIFACT_ROOT = '.xiaoliang/cad'
export const CAD_DRAWINGS_ROOT = `${CAD_ARTIFACT_ROOT}/drawings`
export const CAD_PREVIEWS_ROOT = `${CAD_ARTIFACT_ROOT}/previews`
export interface CadEntitiesProducerDescriptor {
  name: string
  version: string
  fingerprint: string
}

export type CadArtifactProducerDescriptor = CadEntitiesProducerDescriptor | CadVisualProducerDescriptor

export interface CadSourceFingerprint {
  size: number
  sha256: string
}

export const CAD_COM_ENTITIES_PRODUCER = {
  name: 'xiaoliang-cad-http-com',
  version: '1',
  fingerprint: createHash('sha256')
    .update('xiaoliang-cad-http-com\u0000v1\u0000complete\u0000include_geometry=true', 'utf8')
    .digest('hex'),
} as const
// These must track the pinned @mlightcad versions in package.json: the fingerprint is what
// makes cached artifacts fall out of date when the parser or serializer changes, so a stale
// version here would keep pre-upgrade caches alive. `cad-artifact-producer.test.cjs` fails
// the build if they drift apart.
const MLIGHT_DATA_MODEL_VERSION = '1.12.5'
const MLIGHT_SIMPLE_VIEWER_VERSION = '1.5.11'
const MLIGHT_SERIALIZER_VERSION = '1'

export const CAD_MLIGHT_ENTITIES_PRODUCER = {
  name: 'mlightcad',
  version: `data-model@${MLIGHT_DATA_MODEL_VERSION}+cad-simple-viewer@${MLIGHT_SIMPLE_VIEWER_VERSION}+serializer@${MLIGHT_SERIALIZER_VERSION}`,
  fingerprint: createHash('sha256')
    .update([
      'mlightcad',
      `data-model@${MLIGHT_DATA_MODEL_VERSION}`,
      `cad-simple-viewer@${MLIGHT_SIMPLE_VIEWER_VERSION}`,
      `serializer@${MLIGHT_SERIALIZER_VERSION}`,
      'complete',
      'include_geometry=true',
    ].join('\u0000'), 'utf8')
    .digest('hex'),
} as const

// Kept as the compatibility name for callers that still explicitly publish COM output.
export const CAD_ENTITIES_PRODUCER = CAD_COM_ENTITIES_PRODUCER

const CURRENT_ENTITIES_PRODUCERS: readonly CadEntitiesProducerDescriptor[] = [
  CAD_MLIGHT_ENTITIES_PRODUCER,
  CAD_COM_ENTITIES_PRODUCER,
]

const MAX_MANIFEST_BYTES = 512 * 1024
const MAX_RAW_JSONL_BYTES = 512 * 1024 * 1024
const MAX_READABLE_BYTES = 128 * 1024 * 1024
const MAX_JSONL_LINE_BYTES = 2 * 1024 * 1024
const MAX_INDEXED_ENTITIES = 2_000_000
const MAX_INVENTORIES = 200
const MAX_PREVIEW_IMAGES = 100
const MAX_VISUAL_FILES = 23
const MAX_VISUAL_REGIONS = 21
const MAX_VISUAL_TEXT_LENGTH = 16_384
const ARTIFACT_RUN_ID_PATTERN = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const FRAME_ID_PATTERN = /^frame-[0-9]{2}$/u
const VISUAL_REGION_ID_PATTERN = /^(?:full|q[1-4](?:\/q[1-4])?)$/u

export type CadEntitiesArtifactStatus =
  | 'valid'
  | 'missing'
  | 'untracked'
  | 'corrupt'
  | 'stale_source'
  | 'stale_pipeline'

export interface CadEntitiesArtifactInspection {
  status: CadEntitiesArtifactStatus
  reason: string
  drawing: CadBridgeDrawing
  artifactDirectory: string
  manifestPath: string
  rawPath: string
  readablePath: string
  summary: Record<string, unknown> | null
  producer: CadEntitiesProducerDescriptor | null
  source?: CadSourceFingerprint | null
  generatedAt?: string | null
  relativePaths: string[]
}

export interface CadArtifactInventory {
  artifact_key: string
  drawing: { name: string; project_relative_path: string } | null
  entities_status: CadEntitiesArtifactStatus
  visual_status: CadVisualArtifactStatus
  manifest_path: string | null
  reason: string
  visual_reason: string
  source_sha256?: string | null
  entities_producer_fingerprint?: string | null
  entities_generated_at?: string | null
  visual_producer_fingerprint?: string | null
  visual_generated_at?: string | null
}

interface ManifestFile {
  path: string
  size: number
  sha256: string
}

interface ArtifactSetManifest {
  producer: CadArtifactProducerDescriptor
  generated_at: string
  files: ManifestFile[]
  summary: Record<string, unknown>
}

interface CadArtifactManifest {
  schema_version: 1
  drawing: { name: string; project_relative_path: string }
  source: { path: string; size: number; sha256: string }
  artifact_sets: {
    entities?: ArtifactSetManifest
    visual?: ArtifactSetManifest
  }
}

export type CadVisualArtifactStatus = CadEntitiesArtifactStatus

export interface CadVisualArtifactInspection {
  status: CadVisualArtifactStatus
  reason: string
  drawing: CadBridgeDrawing
  frameId: string
  artifactDirectory: string
  manifestPath: string
  visualIndexPath: string
  visualKnowledgePath: string
  imagePaths: string[]
  summary: Record<string, unknown> | null
  producer: CadVisualProducerDescriptor | null
  source?: CadSourceFingerprint | null
  generatedAt?: string | null
  relativePaths: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function sameProducer(
  left: CadEntitiesProducerDescriptor,
  right: CadEntitiesProducerDescriptor,
): boolean {
  return left.name === right.name
    && left.version === right.version
    && left.fingerprint === right.fingerprint
}

function currentProducer(
  producer: CadEntitiesProducerDescriptor,
): CadEntitiesProducerDescriptor | null {
  return CURRENT_ENTITIES_PRODUCERS.find((candidate) => sameProducer(candidate, producer)) ?? null
}

async function ensureTrustedDirectory(projectRoot: string, relativePath: string): Promise<string> {
  const normalized = normalizeProjectRelativePath(relativePath)
  let current = projectRoot
  for (const segment of normalized.split('/')) {
    current = path.join(current, segment)
    try {
      const stat = await fs.promises.lstat(current)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('CAD artifact directory must not contain links or non-directories.')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await fs.promises.mkdir(current)
    }
    const real = await fs.promises.realpath(current)
    if (!isInside(projectRoot, real)) throw new Error('CAD artifact directory escaped through a link.')
  }
  return current
}

function stagingRunPath(projectRoot: string, artifactRunId: string): string {
  if (!ARTIFACT_RUN_ID_PATTERN.test(artifactRunId)) throw new Error('CAD artifact run id is invalid.')
  const stagingRoot = path.resolve(projectRoot, '.xiaoliang', 'cad', '.staging')
  const candidate = path.resolve(stagingRoot, artifactRunId)
  if (!isInside(stagingRoot, candidate) || candidate === stagingRoot) {
    throw new Error('CAD artifact staging path is invalid.')
  }
  return candidate
}

export function resolveTrustedProjectRoot(projectRootInput: string): string {
  const projectRoot = fs.realpathSync(path.resolve(projectRootInput))
  if (!fs.statSync(projectRoot).isDirectory()) throw new Error('CAD project root must be a directory.')
  return projectRoot
}

export function normalizeProjectRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '')
  if (
    !normalized
    || normalized.length > 4_096
    || normalized.includes('\0')
    || /^[A-Za-z]:/u.test(normalized)
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(normalized)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('CAD path must be a safe project-relative path.')
  }
  return normalized
}

export function resolveProjectFile(
  projectRootInput: string,
  relativePathInput: string,
  options: { extensions?: ReadonlySet<string>; mustExist?: boolean } = {},
): { projectRoot: string; relativePath: string; absolutePath: string } {
  const projectRoot = resolveTrustedProjectRoot(projectRootInput)
  const relativePath = normalizeProjectRelativePath(relativePathInput)
  if (options.extensions && !options.extensions.has(path.extname(relativePath).toLowerCase())) {
    throw new Error('CAD project file extension is not supported for this operation.')
  }
  const candidate = path.resolve(projectRoot, ...relativePath.split('/'))
  if (!isInside(projectRoot, candidate)) throw new Error('CAD project path escaped its trusted root.')
  let absolutePath = candidate
  if (options.mustExist ?? true) {
    try {
      absolutePath = fs.realpathSync(candidate)
    } catch {
      throw new Error('CAD project file does not exist.')
    }
    if (!isInside(projectRoot, absolutePath)) {
      throw new Error('CAD project path escaped through a link.')
    }
  }
  return { projectRoot, relativePath, absolutePath }
}

function safeDrawingStem(name: string): string {
  const stem = path.posix.parse(name.replace(/\\/gu, '/')).name.trim() || 'drawing'
  const normalized = stem.replace(/[^0-9A-Za-z._\-\u4e00-\u9fff]+/gu, '-').replace(/^[.\-]+|[.\-]+$/gu, '')
  return normalized.slice(0, 120) || 'drawing'
}

export function drawingArtifactKey(name: string, projectRelativePath: string): string {
  const normalizedPath = normalizeProjectRelativePath(projectRelativePath)
  const digest = createHash('sha256').update(normalizedPath, 'utf8').digest('hex').slice(0, 12)
  return `${safeDrawingStem(name)}--${digest}`
}

export function drawingArtifactPaths(drawing: Pick<CadBridgeDrawing, 'name' | 'project_relative_path'>): {
  artifactKey: string
  artifactDirectory: string
  manifestPath: string
  rawPath: string
  readablePath: string
  visualDirectory: string
  visualIndexPath: string
  visualKnowledgePath: string
} {
  const artifactKey = drawingArtifactKey(drawing.name, drawing.project_relative_path)
  const artifactDirectory = `${CAD_DRAWINGS_ROOT}/${artifactKey}`
  return {
    artifactKey,
    artifactDirectory,
    manifestPath: `${artifactDirectory}/manifest.json`,
    rawPath: `${artifactDirectory}/entities/entities.raw.jsonl`,
    readablePath: `${artifactDirectory}/entities/entities.readable.md`,
    visualDirectory: `${artifactDirectory}/visual`,
    visualIndexPath: `${artifactDirectory}/visual/visual-index.json`,
    visualKnowledgePath: `${artifactDirectory}/visual/visual-knowledge.md`,
  }
}

export async function sha256File(absolutePath: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  const input = fs.createReadStream(absolutePath)
  try {
    for await (const chunk of input) {
      if (signal?.aborted) throw new Error('CAD artifact validation was cancelled.')
      hash.update(chunk as Buffer)
    }
  } finally {
    input.destroy()
  }
  return hash.digest('hex')
}

function safeSummary(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) return null
  return value
}

function parseArtifactSet(
  value: unknown,
  minimumFiles: number,
  maximumFiles: number,
): ArtifactSetManifest | null {
  if (!isRecord(value) || !isRecord(value.producer) || !Array.isArray(value.files)) return null
  const producer = value.producer
  const summary = safeSummary(value.summary)
  if (
    typeof value.generated_at !== 'string'
    || !Number.isFinite(Date.parse(value.generated_at))
    || typeof producer.name !== 'string'
    || !producer.name
    || producer.name.length > 256
    || typeof producer.version !== 'string'
    || !producer.version
    || producer.version.length > 128
    || typeof producer.fingerprint !== 'string'
    || !/^[0-9a-f]{64}$/u.test(producer.fingerprint)
    || !summary
    || value.files.length < minimumFiles
    || value.files.length > maximumFiles
  ) return null
  const files: ManifestFile[] = []
  const paths = new Set<string>()
  try {
    for (const item of value.files) {
      if (
        !isRecord(item)
        || typeof item.path !== 'string'
        || !Number.isSafeInteger(item.size)
        || (item.size as number) < 0
        || typeof item.sha256 !== 'string'
        || !/^[0-9a-f]{64}$/u.test(item.sha256)
      ) return null
      const normalizedPath = normalizeProjectRelativePath(item.path)
      if (paths.has(normalizedPath)) return null
      paths.add(normalizedPath)
      files.push({ path: normalizedPath, size: item.size as number, sha256: item.sha256 })
    }
  } catch {
    return null
  }
  return {
    producer: {
      name: producer.name,
      version: producer.version,
      fingerprint: producer.fingerprint,
    },
    generated_at: value.generated_at,
    files,
    summary,
  }
}

function parseManifest(value: unknown): CadArtifactManifest | null {
  if (!isRecord(value) || value.schema_version !== 1) return null
  const drawing = value.drawing
  const source = value.source
  const artifactSets = value.artifact_sets
  if (!isRecord(drawing) || !isRecord(source) || !isRecord(artifactSets)) return null
  const entities = artifactSets.entities === undefined
    ? undefined
    : parseArtifactSet(artifactSets.entities, 2, 2)
  const visual = artifactSets.visual === undefined
    ? undefined
    : parseArtifactSet(artifactSets.visual, 7, MAX_VISUAL_FILES)
  if (
    (artifactSets.entities !== undefined && !entities)
    || (artifactSets.visual !== undefined && !visual)
    || typeof drawing.name !== 'string'
    || !drawing.name
    || drawing.name.length > 512
    || /[\\/]/u.test(drawing.name)
    || typeof drawing.project_relative_path !== 'string'
    || typeof source.path !== 'string'
    || !Number.isSafeInteger(source.size)
    || (source.size as number) < 0
    || typeof source.sha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(source.sha256)
  ) return null
  try {
    return {
      schema_version: 1,
      drawing: {
        name: drawing.name,
        project_relative_path: normalizeProjectRelativePath(drawing.project_relative_path),
      },
      source: {
        path: normalizeProjectRelativePath(source.path),
        size: source.size as number,
        sha256: source.sha256,
      },
      artifact_sets: {
        ...(entities ? { entities } : {}),
        ...(visual ? { visual } : {}),
      },
    }
  } catch {
    return null
  }
}

async function readManifestFile(absolutePath: string): Promise<CadArtifactManifest | null> {
  try {
    const stat = await fs.promises.stat(absolutePath)
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_MANIFEST_BYTES) return null
    return parseManifest(JSON.parse(await fs.promises.readFile(absolutePath, 'utf8')))
  } catch {
    return null
  }
}

async function existingRegularProjectFile(
  projectRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const resolved = resolveProjectFile(projectRoot, relativePath)
    return (await fs.promises.stat(resolved.absolutePath)).isFile() ? resolved.absolutePath : null
  } catch {
    return null
  }
}

function inspection(
  drawing: CadBridgeDrawing,
  status: CadEntitiesArtifactStatus,
  reason: string,
  relativePaths: string[],
  summary: Record<string, unknown> | null = null,
  producer: CadEntitiesProducerDescriptor | null = null,
  source: CadSourceFingerprint | null = null,
  generatedAt: string | null = null,
): CadEntitiesArtifactInspection {
  const paths = drawingArtifactPaths(drawing)
  return {
    status,
    reason,
    drawing,
    artifactDirectory: paths.artifactDirectory,
    manifestPath: paths.manifestPath,
    rawPath: paths.rawPath,
    readablePath: paths.readablePath,
    summary,
    producer,
    source,
    generatedAt,
    relativePaths,
  }
}

export async function inspectEntitiesArtifact(
  projectRootInput: string,
  drawing: CadBridgeDrawing,
  signal?: AbortSignal,
): Promise<CadEntitiesArtifactInspection> {
  const projectRoot = resolveTrustedProjectRoot(projectRootInput)
  const paths = drawingArtifactPaths(drawing)
  const [manifestAbsolute, rawAbsolute, readableAbsolute] = await Promise.all([
    existingRegularProjectFile(projectRoot, paths.manifestPath),
    existingRegularProjectFile(projectRoot, paths.rawPath),
    existingRegularProjectFile(projectRoot, paths.readablePath),
  ])
  if (!manifestAbsolute) {
    const artifactPresent = Boolean(rawAbsolute || readableAbsolute)
    return inspection(
      drawing,
      artifactPresent ? 'untracked' : 'missing',
      artifactPresent
        ? 'Entity files exist without a trusted manifest.'
        : 'No entity artifact exists for this drawing.',
      [
        ...(rawAbsolute ? [paths.rawPath] : []),
        ...(readableAbsolute ? [paths.readablePath] : []),
      ],
    )
  }
  const manifest = await readManifestFile(manifestAbsolute)
  if (!manifest) {
    return inspection(drawing, 'corrupt', 'Entity manifest is invalid.', [paths.manifestPath])
  }
  if (
    manifest.drawing.name !== drawing.name
    || manifest.drawing.project_relative_path !== drawing.project_relative_path
    || manifest.source.path !== drawing.project_relative_path
  ) {
    return inspection(drawing, 'corrupt', 'Entity manifest drawing identity does not match.', [paths.manifestPath])
  }
  const entities = manifest.artifact_sets.entities
  if (!entities) {
    const artifactPresent = Boolean(rawAbsolute || readableAbsolute)
    return inspection(
      drawing,
      artifactPresent ? 'untracked' : 'missing',
      artifactPresent
        ? 'Entity files exist but are not tracked by the shared CAD manifest.'
        : 'The shared CAD manifest has no entity artifact set.',
      [paths.manifestPath],
    )
  }
  const producer = currentProducer(entities.producer)
  if (!producer) {
    return inspection(
      drawing,
      'stale_pipeline',
      'Entity producer fingerprint changed.',
      [paths.manifestPath],
      null,
      entities.producer,
    )
  }
  let source
  try {
    source = resolveProjectFile(projectRoot, drawing.project_relative_path, {
      extensions: new Set(['.dwg', '.dxf']),
    })
  } catch {
    return inspection(drawing, 'stale_source', 'Drawing source is missing or outside the project.', [paths.manifestPath])
  }
  const sourceStat = await fs.promises.stat(source.absolutePath)
  if (
    sourceStat.size !== manifest.source.size
    || await sha256File(source.absolutePath, signal) !== manifest.source.sha256
  ) {
    return inspection(drawing, 'stale_source', 'Drawing source content changed.', [paths.manifestPath])
  }
  const expectedFiles = new Map(entities.files.map((file) => [file.path, file]))
  if (
    expectedFiles.size !== 2
    || !expectedFiles.has(paths.rawPath)
    || !expectedFiles.has(paths.readablePath)
  ) {
    return inspection(drawing, 'corrupt', 'Entity manifest file inventory is invalid.', [paths.manifestPath])
  }
  for (const relativePath of [paths.rawPath, paths.readablePath]) {
    const expected = expectedFiles.get(relativePath) as ManifestFile
    let resolved
    try {
      resolved = resolveProjectFile(projectRoot, relativePath)
    } catch {
      return inspection(drawing, 'corrupt', 'A required entity artifact is missing.', [paths.manifestPath])
    }
    const stat = await fs.promises.stat(resolved.absolutePath)
    if (
      !stat.isFile()
      || stat.size !== expected.size
      || await sha256File(resolved.absolutePath, signal) !== expected.sha256
    ) {
      return inspection(drawing, 'corrupt', 'A required entity artifact failed integrity validation.', [paths.manifestPath])
    }
  }
  return inspection(
    drawing,
    'valid',
    'Entity artifact source, producer and file hashes are valid.',
    [paths.manifestPath, paths.rawPath, paths.readablePath],
    entities.summary,
    producer,
    manifest.source,
    entities.generated_at,
  )
}

async function writeManifestAtomic(
  projectRoot: string,
  artifactDirectory: string,
  manifestPath: string,
  manifest: CadArtifactManifest,
): Promise<void> {
  const manifestAbsolute = path.resolve(projectRoot, ...manifestPath.split('/'))
  const directory = await ensureTrustedDirectory(projectRoot, artifactDirectory)
  const temporary = path.join(directory, `.manifest-${randomUUID()}.tmp`)
  const backup = path.join(directory, `.manifest-${randomUUID()}.backup`)
  let existingMoved = false
  let replacementPublished = false
  try {
    await fs.promises.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    try {
      const existing = await fs.promises.lstat(manifestAbsolute)
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new Error('Existing CAD artifact manifest is not a regular file.')
      }
      await fs.promises.rename(manifestAbsolute, backup)
      existingMoved = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await fs.promises.rename(temporary, manifestAbsolute)
    replacementPublished = true
    if (existingMoved) await fs.promises.rm(backup, { force: true }).catch(() => undefined)
  } catch (error) {
    if (!replacementPublished && existingMoved) {
      await fs.promises.rename(backup, manifestAbsolute).catch(() => undefined)
    }
    throw error
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined)
    if (replacementPublished) await fs.promises.rm(backup, { force: true }).catch(() => undefined)
  }
}

export async function invalidateCadArtifactSet(
  projectRootInput: string,
  drawingPathInput: string,
  kind: 'entities' | 'visual',
): Promise<{
  changed: boolean
  drawingPath: string
  kind: 'entities' | 'visual'
  manifestPath: string
  retainedPaths: string[]
}> {
  const source = resolveProjectFile(projectRootInput, drawingPathInput, {
    extensions: new Set(['.dwg', '.dxf']),
  })
  const drawing: CadBridgeDrawing = {
    name: path.basename(source.relativePath),
    project_relative_path: source.relativePath,
    saved: true,
    dbmod: 0,
  }
  const paths = drawingArtifactPaths(drawing)
  const manifestFile = resolveProjectFile(source.projectRoot, paths.manifestPath)
  const manifest = await readManifestFile(manifestFile.absolutePath)
  if (!manifest) throw new Error('CAD artifact manifest is missing or invalid; nothing trusted can be invalidated.')
  if (
    manifest.drawing.name !== drawing.name
    || manifest.drawing.project_relative_path !== drawing.project_relative_path
    || manifest.source.path !== drawing.project_relative_path
  ) {
    throw new Error('CAD artifact manifest does not match the requested drawing.')
  }
  if (!manifest.artifact_sets[kind]) {
    return {
      changed: false,
      drawingPath: drawing.project_relative_path,
      kind,
      manifestPath: paths.manifestPath,
      retainedPaths: [],
    }
  }
  const retainedPaths = manifest.artifact_sets[kind]?.files.map((file) => file.path) ?? []
  const artifactSets = { ...manifest.artifact_sets }
  delete artifactSets[kind]
  await writeManifestAtomic(
    source.projectRoot,
    paths.artifactDirectory,
    paths.manifestPath,
    { ...manifest, artifact_sets: artifactSets },
  )
  return {
    changed: true,
    drawingPath: drawing.project_relative_path,
    kind,
    manifestPath: paths.manifestPath,
    retainedPaths,
  }
}

function sameManifestSource(
  manifest: CadArtifactManifest | null,
  drawing: CadBridgeDrawing,
  source: CadSourceFingerprint,
): manifest is CadArtifactManifest {
  return Boolean(
    manifest
    && manifest.drawing.name === drawing.name
    && manifest.drawing.project_relative_path === drawing.project_relative_path
    && manifest.source.path === drawing.project_relative_path
    && manifest.source.size === source.size
    && manifest.source.sha256 === source.sha256,
  )
}

export async function publishEntitiesManifest(
  projectRootInput: string,
  drawing: CadBridgeDrawing,
  summary: Record<string, unknown>,
  signal?: AbortSignal,
  producer: CadEntitiesProducerDescriptor = CAD_COM_ENTITIES_PRODUCER,
  expectedSource?: CadSourceFingerprint,
): Promise<string> {
  const trustedProducer = currentProducer(producer)
  if (!trustedProducer) throw new Error('CAD entity producer is not trusted by this build.')
  const trustedSummary = safeSummary(summary)
  if (!trustedSummary) throw new Error('CAD entity summary is invalid or too large.')
  if (expectedSource && (
    !Number.isSafeInteger(expectedSource.size)
    || expectedSource.size < 0
    || !/^[0-9a-f]{64}$/u.test(expectedSource.sha256)
  )) throw new Error('Expected CAD source fingerprint is invalid.')
  const projectRoot = resolveTrustedProjectRoot(projectRootInput)
  const paths = drawingArtifactPaths(drawing)
  const source = resolveProjectFile(projectRoot, drawing.project_relative_path, {
    extensions: new Set(['.dwg', '.dxf']),
  })
  const raw = resolveProjectFile(projectRoot, paths.rawPath)
  const readable = resolveProjectFile(projectRoot, paths.readablePath)
  const [sourceStat, rawStat, readableStat] = await Promise.all([
    fs.promises.stat(source.absolutePath),
    fs.promises.stat(raw.absolutePath),
    fs.promises.stat(readable.absolutePath),
  ])
  const [sourceHash, rawHash, readableHash] = await Promise.all([
    sha256File(source.absolutePath, signal),
    sha256File(raw.absolutePath, signal),
    sha256File(readable.absolutePath, signal),
  ])
  if (
    expectedSource
    && (sourceStat.size !== expectedSource.size || sourceHash !== expectedSource.sha256)
  ) throw new Error('CAD drawing source changed before artifact publication.')
  const manifestAbsolute = path.resolve(projectRoot, ...paths.manifestPath.split('/'))
  const existing = await readManifestFile(manifestAbsolute)
  const manifest: CadArtifactManifest = {
    schema_version: 1,
    drawing: { name: drawing.name, project_relative_path: drawing.project_relative_path },
    source: { path: drawing.project_relative_path, size: sourceStat.size, sha256: sourceHash },
    artifact_sets: {
      ...(sameManifestSource(existing, drawing, { size: sourceStat.size, sha256: sourceHash })
        && existing.artifact_sets.visual
        ? { visual: existing.artifact_sets.visual }
        : {}),
      entities: {
        producer: trustedProducer,
        generated_at: new Date().toISOString(),
        files: [
          { path: paths.rawPath, size: rawStat.size, sha256: rawHash },
          { path: paths.readablePath, size: readableStat.size, sha256: readableHash },
        ],
        summary: trustedSummary,
      },
    },
  }
  await writeManifestAtomic(projectRoot, paths.artifactDirectory, paths.manifestPath, manifest)
  return paths.manifestPath
}

async function validateRawJsonl(
  absolutePath: string,
  expectedCount: number,
  signal?: AbortSignal,
): Promise<void> {
  let count = 0
  let fragments: Buffer[] = []
  let bufferedBytes = 0
  const consumeLine = (tail: Buffer): void => {
    const total = bufferedBytes + tail.length
    if (total > MAX_JSONL_LINE_BYTES) throw new Error('CAD entity JSONL contains an oversized line.')
    let line = fragments.length ? Buffer.concat([...fragments, tail], total) : tail
    if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1)
    fragments = []
    bufferedBytes = 0
    if (!line.length) throw new Error('CAD entity JSONL contains a blank record.')
    let parsed: unknown
    try {
      parsed = JSON.parse(line.toString('utf8'))
    } catch {
      throw new Error('CAD entity JSONL contains invalid JSON.')
    }
    if (!isRecord(parsed)) throw new Error('CAD entity JSONL records must be objects.')
    count += 1
    if (count > MAX_INDEXED_ENTITIES) throw new Error('CAD entity JSONL exceeds the record limit.')
  }

  const input = fs.createReadStream(absolutePath)
  try {
    for await (const value of input) {
      if (signal?.aborted) throw new Error('CAD artifact validation was cancelled.')
      const chunk = value as Buffer
      let start = 0
      while (start < chunk.length) {
        const newline = chunk.indexOf(0x0a, start)
        if (newline < 0) {
          const tail = chunk.subarray(start)
          bufferedBytes += tail.length
          if (bufferedBytes > MAX_JSONL_LINE_BYTES) {
            throw new Error('CAD entity JSONL contains an oversized line.')
          }
          fragments.push(Buffer.from(tail))
          break
        }
        consumeLine(chunk.subarray(start, newline))
        start = newline + 1
      }
    }
    if (bufferedBytes) consumeLine(Buffer.alloc(0))
  } finally {
    input.destroy()
  }
  if (count !== expectedCount) {
    throw new Error(`CAD entity JSONL count ${count} does not match summary count ${expectedCount}.`)
  }
}

async function validateStagedEntities(
  entitiesDirectory: string,
  summary: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const entityCount = summary.indexed_entity_count
  if (!Number.isSafeInteger(entityCount) || (entityCount as number) < 0 || (entityCount as number) > MAX_INDEXED_ENTITIES) {
    throw new Error('CAD extraction summary has an invalid indexed entity count.')
  }
  const directoryStat = await fs.promises.lstat(entitiesDirectory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('CAD staging entities path must be a regular directory.')
  }
  const entries = await fs.promises.readdir(entitiesDirectory, { withFileTypes: true })
  const names = entries.map((entry) => entry.name).sort()
  if (names.length !== 2 || names[0] !== 'entities.raw.jsonl' || names[1] !== 'entities.readable.md') {
    throw new Error('CAD staging entities directory has an unexpected file inventory.')
  }
  const rawPath = path.join(entitiesDirectory, 'entities.raw.jsonl')
  const readablePath = path.join(entitiesDirectory, 'entities.readable.md')
  const [rawStat, readableStat] = await Promise.all([
    fs.promises.lstat(rawPath),
    fs.promises.lstat(readablePath),
  ])
  if (!rawStat.isFile() || rawStat.isSymbolicLink() || rawStat.size > MAX_RAW_JSONL_BYTES) {
    throw new Error('CAD staged raw entity index is invalid or too large.')
  }
  if (!readableStat.isFile() || readableStat.isSymbolicLink() || readableStat.size > MAX_READABLE_BYTES) {
    throw new Error('CAD staged readable entity index is invalid or too large.')
  }
  const readable = await fs.promises.open(readablePath, 'r')
  try {
    const header = Buffer.alloc(Math.min(4_096, readableStat.size))
    await readable.read(header, 0, header.length, 0)
    if (!header.toString('utf8').startsWith('# CAD Entity Index')) {
      throw new Error('CAD staged readable entity index has an invalid header.')
    }
  } finally {
    await readable.close()
  }
  await validateRawJsonl(rawPath, entityCount as number, signal)
}

interface ValidatedVisualIndex {
  frameId: string
  imagePaths: string[]
  regionIds: string[]
  overview: Record<string, unknown>
  warnings: string[]
}

function boundedVisualString(
  value: unknown,
  field: string,
  maximum = MAX_VISUAL_TEXT_LENGTH,
): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new Error(`CAD visual index field ${field} is invalid.`)
  }
  return value
}

function boundedVisualStringArray(
  value: unknown,
  field: string,
  maximumItems = 200,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`CAD visual index field ${field} is invalid.`)
  }
  return value.map((item, index) => boundedVisualString(item, `${field}[${index}]`, 2_048))
}

function validateVisualBBox(value: unknown): void {
  if (!isRecord(value) || !Array.isArray(value.min) || !Array.isArray(value.max)) {
    throw new Error('CAD visual region bbox is invalid.')
  }
  const coordinates = [...value.min, ...value.max]
  if (
    value.min.length !== 2
    || value.max.length !== 2
    || !coordinates.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    || (value.min[0] as number) >= (value.max[0] as number)
    || (value.min[1] as number) >= (value.max[1] as number)
  ) throw new Error('CAD visual region bbox is invalid.')
}

function visualCapturePath(
  drawing: Pick<CadBridgeDrawing, 'name' | 'project_relative_path'>,
  frameId: string,
  regionId: string,
): string {
  const paths = drawingArtifactPaths(drawing)
  const filename = regionId === 'full' ? 'full.png' : `${regionId.replace('/', '-')}.png`
  return `${paths.visualDirectory}/captures/${frameId}/${filename}`
}

function validateVisualIndexObject(
  value: unknown,
  drawing: CadBridgeDrawing,
  expectedFrameId: string,
): ValidatedVisualIndex {
  if (
    !isRecord(value)
    || value.schema_version !== 1
    || !isRecord(value.drawing)
    || value.drawing.name !== drawing.name
    || value.drawing.project_relative_path !== drawing.project_relative_path
    || value.frame_id !== expectedFrameId
    || value.model !== CAD_VISUAL_MODEL
    || typeof value.generated_at !== 'string'
    || !Number.isFinite(Date.parse(value.generated_at))
    || !isRecord(value.overview)
    || !Array.isArray(value.regions)
    || value.regions.length < CAD_VISUAL_FIRST_LEVEL_REGIONS.length
    || value.regions.length > MAX_VISUAL_REGIONS
  ) throw new Error('CAD visual index identity or schema is invalid.')

  const overview = {
    title: value.overview.title === null
      ? null
      : boundedVisualString(value.overview.title, 'overview.title', 2_048),
    drawing_type: value.overview.drawing_type === null
      ? null
      : boundedVisualString(value.overview.drawing_type, 'overview.drawing_type', 2_048),
    scale: value.overview.scale === null
      ? null
      : boundedVisualString(value.overview.scale, 'overview.scale', 2_048),
    summary: boundedVisualString(value.overview.summary, 'overview.summary'),
    visible_sections: boundedVisualStringArray(value.overview.visible_sections, 'overview.visible_sections'),
  }
  const warnings = boundedVisualStringArray(value.warnings, 'warnings')
  const regionIds: string[] = []
  const imagePaths: string[] = []
  const needsZoomByFirstLevel = new Map<string, boolean>()
  const nestedCounts = new Map<string, number>()
  const seen = new Set<string>()
  for (const [index, raw] of value.regions.entries()) {
    if (
      !isRecord(raw)
      || typeof raw.region_id !== 'string'
      || !VISUAL_REGION_ID_PATTERN.test(raw.region_id)
      || seen.has(raw.region_id)
      || typeof raw.legible !== 'boolean'
      || typeof raw.needs_zoom !== 'boolean'
      || typeof raw.image_path !== 'string'
    ) throw new Error('CAD visual index contains an invalid region entry.')
    if (index < CAD_VISUAL_FIRST_LEVEL_REGIONS.length && raw.region_id !== CAD_VISUAL_FIRST_LEVEL_REGIONS[index]) {
      throw new Error('CAD visual index must begin with full and q1-q4 in deterministic order.')
    }
    validateVisualBBox(raw.bbox)
    boundedVisualString(raw.summary, `regions.${raw.region_id}.summary`)
    boundedVisualStringArray(raw.labels, `regions.${raw.region_id}.labels`, 100)
    const expectedImagePath = visualCapturePath(drawing, expectedFrameId, raw.region_id)
    if (raw.image_path !== expectedImagePath) {
      throw new Error('CAD visual index contains a non-canonical capture path.')
    }
    if (raw.region_id === 'full' && raw.needs_zoom) {
      throw new Error('CAD full-frame overview must not request recursive zoom.')
    }
    if (/^q[1-4]$/u.test(raw.region_id)) needsZoomByFirstLevel.set(raw.region_id, raw.needs_zoom)
    if (raw.region_id.includes('/')) {
      if (raw.needs_zoom) throw new Error('CAD visual index exceeds the maximum zoom depth.')
      const parent = raw.region_id.slice(0, 2)
      nestedCounts.set(parent, (nestedCounts.get(parent) ?? 0) + 1)
    }
    seen.add(raw.region_id)
    regionIds.push(raw.region_id)
    imagePaths.push(raw.image_path)
  }
  for (const regionId of CAD_VISUAL_FIRST_LEVEL_REGIONS) {
    if (!seen.has(regionId)) throw new Error(`CAD visual index is missing required region ${regionId}.`)
  }
  for (const quadrant of CAD_VISUAL_FIRST_LEVEL_REGIONS.slice(1)) {
    const expectedNestedCount = needsZoomByFirstLevel.get(quadrant) ? 4 : 0
    if ((nestedCounts.get(quadrant) ?? 0) !== expectedNestedCount) {
      throw new Error('CAD visual index nested captures do not match first-level zoom decisions.')
    }
    if (expectedNestedCount) {
      for (let child = 1; child <= 4; child += 1) {
        if (!seen.has(`${quadrant}/q${child}`)) {
          throw new Error('CAD visual index is missing a required second-level quadrant.')
        }
      }
    }
  }
  return { frameId: expectedFrameId, imagePaths, regionIds, overview, warnings }
}

function validateVisualSummary(
  summary: Record<string, unknown>,
  drawing: CadBridgeDrawing,
  expectedFrameId?: string,
): { frameId: string; regionCount: number; zoomRegionCount: number } {
  const paths = drawingArtifactPaths(drawing)
  const frameId = summary.frame_id
  const regionCount = summary.region_count
  const zoomRegionCount = summary.zoom_region_count
  if (
    typeof frameId !== 'string'
    || !FRAME_ID_PATTERN.test(frameId)
    || (expectedFrameId !== undefined && frameId !== expectedFrameId)
    || summary.model !== CAD_VISUAL_MODEL
    || summary.visual_index_path !== paths.visualIndexPath
    || summary.visual_knowledge_path !== paths.visualKnowledgePath
    || !Number.isSafeInteger(regionCount)
    || (regionCount as number) < 5
    || (regionCount as number) > MAX_VISUAL_REGIONS
    || !Number.isSafeInteger(zoomRegionCount)
    || (zoomRegionCount as number) < 0
    || (zoomRegionCount as number) > 16
    || (regionCount as number) !== 5 + (zoomRegionCount as number)
    || (zoomRegionCount as number) % 4 !== 0
  ) throw new Error('CAD visual summary is invalid.')
  return {
    frameId,
    regionCount: regionCount as number,
    zoomRegionCount: zoomRegionCount as number,
  }
}

async function validatePngFile(absolutePath: string): Promise<void> {
  const stat = await fs.promises.lstat(absolutePath)
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.size < 24
    || stat.size > CAD_VISUAL_MAX_IMAGE_BYTES
  ) throw new Error('CAD visual capture is invalid or too large.')
  const handle = await fs.promises.open(absolutePath, 'r')
  try {
    const header = Buffer.alloc(24)
    await handle.read(header, 0, header.length, 0)
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    if (!header.subarray(0, 8).equals(signature) || header.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error('CAD visual capture is not a valid PNG.')
    }
    const width = header.readUInt32BE(16)
    const height = header.readUInt32BE(20)
    if (
      width < 1
      || height < 1
      || width > 4_096
      || height > 4_096
      || width * height > CAD_VISUAL_CAPTURE_MAX_PIXELS
    ) throw new Error('CAD visual capture dimensions exceed the safety limit.')
  } finally {
    await handle.close()
  }
}

async function validateStagedVisual(
  visualDirectory: string,
  drawing: CadBridgeDrawing,
  summary: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ValidatedVisualIndex> {
  const expectedSummary = validateVisualSummary(summary, drawing)
  const directoryStat = await fs.promises.lstat(visualDirectory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('CAD staging visual path must be a regular directory.')
  }
  const entries = await fs.promises.readdir(visualDirectory, { withFileTypes: true })
  const names = entries.map((entry) => entry.name).sort()
  if (
    names.length !== 3
    || names[0] !== 'captures'
    || names[1] !== 'visual-index.json'
    || names[2] !== 'visual-knowledge.md'
    || entries.some((entry) => entry.isSymbolicLink())
  ) throw new Error('CAD staging visual directory has an unexpected inventory.')

  const indexPath = path.join(visualDirectory, 'visual-index.json')
  const knowledgePath = path.join(visualDirectory, 'visual-knowledge.md')
  const [indexStat, knowledgeStat] = await Promise.all([
    fs.promises.lstat(indexPath),
    fs.promises.lstat(knowledgePath),
  ])
  if (!indexStat.isFile() || indexStat.isSymbolicLink() || indexStat.size < 1 || indexStat.size > MAX_MANIFEST_BYTES) {
    throw new Error('CAD staged visual index is invalid or too large.')
  }
  if (!knowledgeStat.isFile() || knowledgeStat.isSymbolicLink() || knowledgeStat.size < 1 || knowledgeStat.size > MAX_READABLE_BYTES) {
    throw new Error('CAD staged visual knowledge is invalid or too large.')
  }
  const validated = validateVisualIndexObject(
    JSON.parse(await fs.promises.readFile(indexPath, 'utf8')),
    drawing,
    expectedSummary.frameId,
  )
  if (
    validated.regionIds.length !== expectedSummary.regionCount
    || validated.regionIds.filter((regionId) => regionId.includes('/')).length !== expectedSummary.zoomRegionCount
  ) throw new Error('CAD visual index counts do not match its summary.')

  const knowledge = await fs.promises.open(knowledgePath, 'r')
  try {
    const header = Buffer.alloc(Math.min(4_096, knowledgeStat.size))
    await knowledge.read(header, 0, header.length, 0)
    if (!header.toString('utf8').startsWith('# CAD Visual Knowledge')) {
      throw new Error('CAD staged visual knowledge has an invalid header.')
    }
  } finally {
    await knowledge.close()
  }

  const capturesDirectory = path.join(visualDirectory, 'captures')
  const captureRoots = await fs.promises.readdir(capturesDirectory, { withFileTypes: true })
  if (
    captureRoots.length !== 1
    || captureRoots[0]?.name !== expectedSummary.frameId
    || !captureRoots[0].isDirectory()
    || captureRoots[0].isSymbolicLink()
  ) throw new Error('CAD staging visual captures contain an unexpected frame directory.')
  const frameDirectory = path.join(capturesDirectory, expectedSummary.frameId)
  const captureEntries = await fs.promises.readdir(frameDirectory, { withFileTypes: true })
  const expectedNames = validated.regionIds
    .map((regionId) => regionId === 'full' ? 'full.png' : `${regionId.replace('/', '-')}.png`)
    .sort()
  const actualNames = captureEntries.map((entry) => entry.name).sort()
  if (
    actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])
    || captureEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
  ) throw new Error('CAD staging visual captures have an unexpected image inventory.')
  for (const filename of expectedNames) {
    if (signal?.aborted) throw new Error('CAD visual artifact validation was cancelled.')
    await validatePngFile(path.join(frameDirectory, filename))
  }
  return validated
}

export function createCadArtifactRunId(): string {
  return `run-${randomUUID()}`
}

export async function cleanupCadArtifactRun(
  projectRootInput: string,
  artifactRunId: string,
): Promise<void> {
  const projectRoot = resolveTrustedProjectRoot(projectRootInput)
  const runPath = stagingRunPath(projectRoot, artifactRunId)
  let runStat: fs.Stats
  try {
    runStat = await fs.promises.lstat(runPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!runStat.isDirectory() || runStat.isSymbolicLink()) {
    throw new Error('CAD staging run path must be a regular directory.')
  }
  const realRunPath = await fs.promises.realpath(runPath)
  const stagingRoot = await fs.promises.realpath(path.dirname(runPath))
  if (!isInside(stagingRoot, realRunPath) || realRunPath === stagingRoot) {
    throw new Error('CAD staging run escaped through a link.')
  }
  await fs.promises.rm(runPath, { recursive: true, force: true })
}

export async function promoteStagedEntities(input: {
  projectRoot: string
  drawing: CadBridgeDrawing
  artifactRunId: string
  summary: Record<string, unknown>
  producer: CadEntitiesProducerDescriptor
  sourceFingerprint: CadSourceFingerprint
  signal?: AbortSignal
}): Promise<{ manifestPath: string; rawPath: string; readablePath: string }> {
  const projectRoot = resolveTrustedProjectRoot(input.projectRoot)
  const paths = drawingArtifactPaths(input.drawing)
  const runPath = stagingRunPath(projectRoot, input.artifactRunId)
  const runStat = await fs.promises.lstat(runPath)
  if (!runStat.isDirectory() || runStat.isSymbolicLink()) {
    throw new Error('CAD staging run path must be a regular directory.')
  }
  const realRunPath = await fs.promises.realpath(runPath)
  if (!isInside(projectRoot, realRunPath)) throw new Error('CAD staging run escaped the project.')
  const stagedEntities = path.join(runPath, 'entities')
  const realStagedEntities = await fs.promises.realpath(stagedEntities)
  if (!isInside(realRunPath, realStagedEntities) || realStagedEntities === realRunPath) {
    throw new Error('CAD staging entities escaped through a link.')
  }
  await validateStagedEntities(stagedEntities, input.summary, input.signal)
  if (input.signal?.aborted) throw new Error('CAD artifact promotion was cancelled.')

  const artifactDirectory = await ensureTrustedDirectory(projectRoot, paths.artifactDirectory)
  const target = path.join(artifactDirectory, 'entities')
  const incoming = path.join(artifactDirectory, `.entities-incoming-${randomUUID()}`)
  const backup = path.join(artifactDirectory, `.entities-backup-${randomUUID()}`)
  let oldMoved = false
  let incomingPublished = false
  try {
    await fs.promises.rename(stagedEntities, incoming)
    try {
      const targetStat = await fs.promises.lstat(target)
      if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
        throw new Error('Existing CAD entity artifact is not a regular directory.')
      }
      await fs.promises.rename(target, backup)
      oldMoved = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await fs.promises.rename(incoming, target)
    incomingPublished = true
    const manifestPath = await publishEntitiesManifest(
      projectRoot,
      input.drawing,
      input.summary,
      input.signal,
      input.producer,
      input.sourceFingerprint,
    )
    if (oldMoved) await fs.promises.rm(backup, { recursive: true, force: true }).catch(() => undefined)
    return { manifestPath, rawPath: paths.rawPath, readablePath: paths.readablePath }
  } catch (error) {
    if (incomingPublished) {
      await fs.promises.rm(target, { recursive: true, force: true }).catch(() => undefined)
    }
    if (oldMoved) await fs.promises.rename(backup, target).catch(() => undefined)
    throw error
  } finally {
    await fs.promises.rm(incoming, { recursive: true, force: true }).catch(() => undefined)
    await cleanupCadArtifactRun(projectRoot, input.artifactRunId).catch(() => undefined)
  }
}

function visualInspection(
  drawing: CadBridgeDrawing,
  frameId: string,
  status: CadVisualArtifactStatus,
  reason: string,
  relativePaths: string[],
  imagePaths: string[] = [],
  summary: Record<string, unknown> | null = null,
  producer: CadVisualProducerDescriptor | null = null,
  source: CadSourceFingerprint | null = null,
  generatedAt: string | null = null,
): CadVisualArtifactInspection {
  const paths = drawingArtifactPaths(drawing)
  return {
    status,
    reason,
    drawing,
    frameId,
    artifactDirectory: paths.artifactDirectory,
    manifestPath: paths.manifestPath,
    visualIndexPath: paths.visualIndexPath,
    visualKnowledgePath: paths.visualKnowledgePath,
    imagePaths,
    summary,
    producer,
    source,
    generatedAt,
    relativePaths,
  }
}

export async function inspectVisualArtifact(
  projectRootInput: string,
  drawing: CadBridgeDrawing,
  frameId = 'frame-01',
  signal?: AbortSignal,
): Promise<CadVisualArtifactInspection> {
  if (!FRAME_ID_PATTERN.test(frameId)) throw new Error('Persistent CAD visual indexes require a detected frame id.')
  const projectRoot = resolveTrustedProjectRoot(projectRootInput)
  const paths = drawingArtifactPaths(drawing)
  const [manifestAbsolute, indexAbsolute, knowledgeAbsolute] = await Promise.all([
    existingRegularProjectFile(projectRoot, paths.manifestPath),
    existingRegularProjectFile(projectRoot, paths.visualIndexPath),
    existingRegularProjectFile(projectRoot, paths.visualKnowledgePath),
  ])
  if (!manifestAbsolute) {
    const artifactPresent = Boolean(indexAbsolute || knowledgeAbsolute)
    return visualInspection(
      drawing,
      frameId,
      artifactPresent ? 'untracked' : 'missing',
      artifactPresent
        ? 'Visual files exist without a trusted manifest.'
        : 'No visual index exists for this drawing.',
      [
        ...(indexAbsolute ? [paths.visualIndexPath] : []),
        ...(knowledgeAbsolute ? [paths.visualKnowledgePath] : []),
      ],
    )
  }
  const manifest = await readManifestFile(manifestAbsolute)
  if (!manifest) {
    return visualInspection(drawing, frameId, 'corrupt', 'CAD artifact manifest is invalid.', [paths.manifestPath])
  }
  if (
    manifest.drawing.name !== drawing.name
    || manifest.drawing.project_relative_path !== drawing.project_relative_path
    || manifest.source.path !== drawing.project_relative_path
  ) {
    return visualInspection(drawing, frameId, 'corrupt', 'Visual manifest drawing identity does not match.', [paths.manifestPath])
  }
  const visual = manifest.artifact_sets.visual
  if (!visual) {
    const artifactPresent = Boolean(indexAbsolute || knowledgeAbsolute)
    return visualInspection(
      drawing,
      frameId,
      artifactPresent ? 'untracked' : 'missing',
      artifactPresent
        ? 'Visual files exist but are not tracked by the shared CAD manifest.'
        : 'The shared CAD manifest has no visual artifact set.',
      [paths.manifestPath],
    )
  }
  let summaryShape
  try {
    summaryShape = validateVisualSummary(visual.summary, drawing, frameId)
  } catch {
    const storedFrameId = typeof visual.summary.frame_id === 'string' ? visual.summary.frame_id : null
    return visualInspection(
      drawing,
      frameId,
      storedFrameId && FRAME_ID_PATTERN.test(storedFrameId) && storedFrameId !== frameId
        ? 'stale_pipeline'
        : 'corrupt',
      storedFrameId && storedFrameId !== frameId
        ? `Visual index was generated for ${storedFrameId}, not ${frameId}.`
        : 'Visual manifest summary is invalid.',
      [paths.manifestPath],
      [],
      visual.summary,
      visual.producer,
    )
  }
  const expectedProducer = createCadVisualProducer(frameId)
  if (!sameProducer(visual.producer, expectedProducer)) {
    return visualInspection(
      drawing,
      frameId,
      'stale_pipeline',
      'Visual producer fingerprint changed.',
      [paths.manifestPath],
      [],
      visual.summary,
      visual.producer,
    )
  }
  let source
  try {
    source = resolveProjectFile(projectRoot, drawing.project_relative_path, {
      extensions: new Set(['.dwg', '.dxf']),
    })
  } catch {
    return visualInspection(drawing, frameId, 'stale_source', 'Drawing source is missing or outside the project.', [paths.manifestPath])
  }
  const sourceStat = await fs.promises.stat(source.absolutePath)
  if (
    sourceStat.size !== manifest.source.size
    || await sha256File(source.absolutePath, signal) !== manifest.source.sha256
  ) {
    return visualInspection(drawing, frameId, 'stale_source', 'Drawing source content changed.', [paths.manifestPath])
  }
  const expectedFiles = new Map(visual.files.map((file) => [file.path, file]))
  if (
    expectedFiles.size !== visual.files.length
    || !expectedFiles.has(paths.visualIndexPath)
    || !expectedFiles.has(paths.visualKnowledgePath)
    || [...expectedFiles.keys()].some((filePath) => !filePath.startsWith(`${paths.visualDirectory}/`))
  ) {
    return visualInspection(drawing, frameId, 'corrupt', 'Visual manifest file inventory is invalid.', [paths.manifestPath])
  }
  for (const expected of expectedFiles.values()) {
    if (signal?.aborted) throw new Error('CAD visual artifact validation was cancelled.')
    let resolved
    try {
      resolved = resolveProjectFile(projectRoot, expected.path)
    } catch {
      return visualInspection(drawing, frameId, 'corrupt', 'A required visual artifact is missing.', [paths.manifestPath])
    }
    const stat = await fs.promises.stat(resolved.absolutePath)
    if (
      !stat.isFile()
      || stat.size !== expected.size
      || await sha256File(resolved.absolutePath, signal) !== expected.sha256
    ) {
      return visualInspection(drawing, frameId, 'corrupt', 'A required visual artifact failed integrity validation.', [paths.manifestPath])
    }
    if (path.extname(expected.path).toLowerCase() === '.png') {
      try {
        await validatePngFile(resolved.absolutePath)
      } catch {
        return visualInspection(drawing, frameId, 'corrupt', 'A visual capture failed PNG validation.', [paths.manifestPath])
      }
    }
  }
  let validated: ValidatedVisualIndex
  try {
    const index = resolveProjectFile(projectRoot, paths.visualIndexPath)
    validated = validateVisualIndexObject(
      JSON.parse(await fs.promises.readFile(index.absolutePath, 'utf8')),
      drawing,
      frameId,
    )
    const inventory = new Set([paths.visualIndexPath, paths.visualKnowledgePath, ...validated.imagePaths])
    if (
      inventory.size !== expectedFiles.size
      || [...inventory].some((filePath) => !expectedFiles.has(filePath))
      || validated.regionIds.length !== summaryShape.regionCount
      || validated.regionIds.filter((regionId) => regionId.includes('/')).length !== summaryShape.zoomRegionCount
    ) throw new Error('visual inventory mismatch')
    const knowledge = await fs.promises.readFile(
      resolveProjectFile(projectRoot, paths.visualKnowledgePath).absolutePath,
      'utf8',
    )
    if (!knowledge.startsWith('# CAD Visual Knowledge')) throw new Error('invalid visual knowledge header')
  } catch {
    return visualInspection(drawing, frameId, 'corrupt', 'Visual index content is invalid.', [paths.manifestPath])
  }
  return visualInspection(
    drawing,
    frameId,
    'valid',
    'Visual artifact source, producer and file hashes are valid.',
    [paths.manifestPath, paths.visualIndexPath, paths.visualKnowledgePath, ...validated.imagePaths],
    validated.imagePaths,
    visual.summary,
    expectedProducer,
    manifest.source,
    visual.generated_at,
  )
}

async function publishVisualManifest(input: {
  projectRoot: string
  drawing: CadBridgeDrawing
  summary: Record<string, unknown>
  producer: CadVisualProducerDescriptor
  sourceFingerprint: CadSourceFingerprint
  signal?: AbortSignal
}): Promise<string> {
  const trustedSummary = safeSummary(input.summary)
  if (!trustedSummary) throw new Error('CAD visual summary is invalid or too large.')
  const summaryShape = validateVisualSummary(trustedSummary, input.drawing)
  const expectedProducer = createCadVisualProducer(summaryShape.frameId)
  if (!sameProducer(input.producer, expectedProducer)) {
    throw new Error('CAD visual producer is not trusted by this build.')
  }
  if (
    !Number.isSafeInteger(input.sourceFingerprint.size)
    || input.sourceFingerprint.size < 0
    || !/^[0-9a-f]{64}$/u.test(input.sourceFingerprint.sha256)
  ) throw new Error('Expected CAD source fingerprint is invalid.')

  const projectRoot = resolveTrustedProjectRoot(input.projectRoot)
  const paths = drawingArtifactPaths(input.drawing)
  const source = resolveProjectFile(projectRoot, input.drawing.project_relative_path, {
    extensions: new Set(['.dwg', '.dxf']),
  })
  const sourceStat = await fs.promises.stat(source.absolutePath)
  const sourceHash = await sha256File(source.absolutePath, input.signal)
  if (
    sourceStat.size !== input.sourceFingerprint.size
    || sourceHash !== input.sourceFingerprint.sha256
  ) throw new Error('CAD drawing source changed before visual artifact publication.')

  const index = resolveProjectFile(projectRoot, paths.visualIndexPath)
  const validated = validateVisualIndexObject(
    JSON.parse(await fs.promises.readFile(index.absolutePath, 'utf8')),
    input.drawing,
    summaryShape.frameId,
  )
  if (
    validated.regionIds.length !== summaryShape.regionCount
    || validated.regionIds.filter((regionId) => regionId.includes('/')).length !== summaryShape.zoomRegionCount
  ) throw new Error('CAD visual index counts do not match its summary.')
  const relativeFiles = [paths.visualIndexPath, paths.visualKnowledgePath, ...validated.imagePaths]
  if (relativeFiles.length < 7 || relativeFiles.length > MAX_VISUAL_FILES) {
    throw new Error('CAD visual artifact file count is invalid.')
  }
  const files: ManifestFile[] = []
  for (const relativePath of relativeFiles.sort()) {
    if (input.signal?.aborted) throw new Error('CAD visual artifact publication was cancelled.')
    const resolved = resolveProjectFile(projectRoot, relativePath)
    const stat = await fs.promises.stat(resolved.absolutePath)
    if (!stat.isFile()) throw new Error('CAD visual artifact contains a non-file entry.')
    files.push({
      path: relativePath,
      size: stat.size,
      sha256: await sha256File(resolved.absolutePath, input.signal),
    })
  }
  const manifestAbsolute = path.resolve(projectRoot, ...paths.manifestPath.split('/'))
  const existing = await readManifestFile(manifestAbsolute)
  const manifest: CadArtifactManifest = {
    schema_version: 1,
    drawing: { name: input.drawing.name, project_relative_path: input.drawing.project_relative_path },
    source: { path: input.drawing.project_relative_path, size: sourceStat.size, sha256: sourceHash },
    artifact_sets: {
      ...(sameManifestSource(existing, input.drawing, { size: sourceStat.size, sha256: sourceHash })
        && existing.artifact_sets.entities
        ? { entities: existing.artifact_sets.entities }
        : {}),
      visual: {
        producer: expectedProducer,
        generated_at: new Date().toISOString(),
        files,
        summary: trustedSummary,
      },
    },
  }
  await writeManifestAtomic(projectRoot, paths.artifactDirectory, paths.manifestPath, manifest)
  return paths.manifestPath
}

export async function promoteStagedVisual(input: {
  projectRoot: string
  drawing: CadBridgeDrawing
  artifactRunId: string
  summary: Record<string, unknown>
  producer: CadVisualProducerDescriptor
  sourceFingerprint: CadSourceFingerprint
  signal?: AbortSignal
}): Promise<{ manifestPath: string; visualIndexPath: string; visualKnowledgePath: string; imagePaths: string[] }> {
  const projectRoot = resolveTrustedProjectRoot(input.projectRoot)
  const paths = drawingArtifactPaths(input.drawing)
  const runPath = stagingRunPath(projectRoot, input.artifactRunId)
  const runStat = await fs.promises.lstat(runPath)
  if (!runStat.isDirectory() || runStat.isSymbolicLink()) {
    throw new Error('CAD staging run path must be a regular directory.')
  }
  const realRunPath = await fs.promises.realpath(runPath)
  if (!isInside(projectRoot, realRunPath)) throw new Error('CAD staging run escaped the project.')
  const stagedVisual = path.join(runPath, 'visual')
  const realStagedVisual = await fs.promises.realpath(stagedVisual)
  if (!isInside(realRunPath, realStagedVisual) || realStagedVisual === realRunPath) {
    throw new Error('CAD staging visual artifact escaped through a link.')
  }
  const validated = await validateStagedVisual(
    stagedVisual,
    input.drawing,
    input.summary,
    input.signal,
  )
  if (input.signal?.aborted) throw new Error('CAD visual artifact promotion was cancelled.')

  const artifactDirectory = await ensureTrustedDirectory(projectRoot, paths.artifactDirectory)
  const target = path.join(artifactDirectory, 'visual')
  const incoming = path.join(artifactDirectory, `.visual-incoming-${randomUUID()}`)
  const backup = path.join(artifactDirectory, `.visual-backup-${randomUUID()}`)
  let oldMoved = false
  let incomingPublished = false
  try {
    await fs.promises.rename(stagedVisual, incoming)
    try {
      const targetStat = await fs.promises.lstat(target)
      if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
        throw new Error('Existing CAD visual artifact is not a regular directory.')
      }
      await fs.promises.rename(target, backup)
      oldMoved = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await fs.promises.rename(incoming, target)
    incomingPublished = true
    const manifestPath = await publishVisualManifest(input)
    if (oldMoved) await fs.promises.rm(backup, { recursive: true, force: true }).catch(() => undefined)
    return {
      manifestPath,
      visualIndexPath: paths.visualIndexPath,
      visualKnowledgePath: paths.visualKnowledgePath,
      imagePaths: validated.imagePaths,
    }
  } catch (error) {
    if (incomingPublished) {
      await fs.promises.rm(target, { recursive: true, force: true }).catch(() => undefined)
    }
    if (oldMoved) await fs.promises.rename(backup, target).catch(() => undefined)
    throw error
  } finally {
    await fs.promises.rm(incoming, { recursive: true, force: true }).catch(() => undefined)
    await cleanupCadArtifactRun(projectRoot, input.artifactRunId).catch(() => undefined)
  }
}

function drawingFromManifest(value: unknown): CadBridgeDrawing | null {
  if (!isRecord(value) || !isRecord(value.drawing)) return null
  const name = value.drawing.name
  const relativePath = value.drawing.project_relative_path
  if (
    typeof name !== 'string'
    || !name
    || name.length > 512
    || /[\\/]/u.test(name)
    || typeof relativePath !== 'string'
  ) return null
  try {
    return {
      name,
      project_relative_path: normalizeProjectRelativePath(relativePath),
      saved: true,
      dbmod: 0,
    }
  } catch {
    return null
  }
}

export async function listArtifactInventories(
  projectRootInput: string,
  signal?: AbortSignal,
): Promise<{ inventories: CadArtifactInventory[]; truncated: boolean }> {
  const projectRoot = resolveTrustedProjectRoot(projectRootInput)
  let root: string
  let entries: fs.Dirent[]
  try {
    root = resolveProjectFile(projectRoot, CAD_DRAWINGS_ROOT).absolutePath
    entries = await fs.promises.readdir(root, { withFileTypes: true })
  } catch {
    return { inventories: [], truncated: false }
  }
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name))
  const selected = directories.slice(0, MAX_INVENTORIES)
  const inventories: CadArtifactInventory[] = []
  for (const entry of selected) {
    if (signal?.aborted) throw new Error('CAD artifact listing was cancelled.')
    const manifestPath = `${CAD_DRAWINGS_ROOT}/${entry.name}/manifest.json`
    let drawing: CadBridgeDrawing | null = null
    let manifestPresent = false
    let visualFrameId = 'frame-01'
    try {
      const manifest = resolveProjectFile(projectRoot, manifestPath)
      const stat = await fs.promises.stat(manifest.absolutePath)
      manifestPresent = stat.isFile()
      if (stat.size > 0 && stat.size <= MAX_MANIFEST_BYTES) {
        const rawManifest: unknown = JSON.parse(await fs.promises.readFile(manifest.absolutePath, 'utf8'))
        drawing = drawingFromManifest(rawManifest)
        const parsed = parseManifest(rawManifest)
        const storedFrameId = parsed?.artifact_sets.visual?.summary.frame_id
        if (typeof storedFrameId === 'string' && FRAME_ID_PATTERN.test(storedFrameId)) {
          visualFrameId = storedFrameId
        }
      }
    } catch {
      // Missing and malformed manifests are represented as untracked inventories.
    }
    if (!drawing || drawingArtifactKey(drawing.name, drawing.project_relative_path) !== entry.name) {
      inventories.push({
        artifact_key: entry.name,
        drawing: null,
        entities_status: manifestPresent ? 'corrupt' : 'untracked',
        visual_status: manifestPresent ? 'corrupt' : 'untracked',
        manifest_path: manifestPresent ? manifestPath : null,
        reason: manifestPresent
          ? 'Artifact directory manifest is malformed or has a mismatched drawing key.'
          : 'Artifact directory has no trusted drawing manifest.',
        visual_reason: manifestPresent
          ? 'Artifact directory manifest is malformed or has a mismatched drawing key.'
          : 'Artifact directory has no trusted drawing manifest.',
      })
      continue
    }
    const [inspected, visual] = await Promise.all([
      inspectEntitiesArtifact(projectRoot, drawing, signal),
      inspectVisualArtifact(projectRoot, drawing, visualFrameId, signal),
    ])
    inventories.push({
      artifact_key: entry.name,
      drawing: { name: drawing.name, project_relative_path: drawing.project_relative_path },
      entities_status: inspected.status,
      visual_status: visual.status,
      manifest_path: inspected.manifestPath,
      reason: inspected.reason,
      visual_reason: visual.reason,
      source_sha256: inspected.source?.sha256 ?? visual.source?.sha256 ?? null,
      entities_producer_fingerprint: inspected.producer?.fingerprint ?? null,
      entities_generated_at: inspected.generatedAt,
      visual_producer_fingerprint: visual.producer?.fingerprint ?? null,
      visual_generated_at: visual.generatedAt,
    })
  }
  return { inventories, truncated: directories.length > selected.length }
}

export async function listPreviewImages(
  projectRootInput: string,
  drawing: Pick<CadBridgeDrawing, 'name' | 'project_relative_path'>,
  signal?: AbortSignal,
): Promise<{ paths: string[]; truncated: boolean }> {
  const projectRoot = resolveTrustedProjectRoot(projectRootInput)
  const key = drawingArtifactKey(drawing.name, drawing.project_relative_path)
  const relativeRoot = `${CAD_PREVIEWS_ROOT}/${key}`
  let absoluteRoot: string
  let rootStat
  try {
    absoluteRoot = resolveProjectFile(projectRoot, relativeRoot).absolutePath
    rootStat = await fs.promises.stat(absoluteRoot)
  } catch {
    return { paths: [], truncated: false }
  }
  if (!rootStat.isDirectory()) return { paths: [], truncated: false }
  const queue = [absoluteRoot]
  const images: string[] = []
  while (queue.length) {
    if (signal?.aborted) throw new Error('CAD preview listing was cancelled.')
    const directory = queue.shift() as string
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        queue.push(absolute)
        continue
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.png') continue
      const relative = path.relative(projectRoot, absolute).replace(/\\/gu, '/')
      if (!relative.startsWith(`${CAD_PREVIEWS_ROOT}/`)) continue
      images.push(relative)
      if (images.length >= MAX_PREVIEW_IMAGES) return { paths: images, truncated: true }
    }
  }
  return { paths: images, truncated: false }
}

export async function resolveDocument(
  facade: CadApplicationFacade,
  selector: CadBridgeDocumentSelector | undefined,
  signal?: AbortSignal,
): Promise<CadBridgeDocument & { status?: 'foreign_document' }> {
  const documents = await facade.listDocuments(signal)
  let selected: CadBridgeDocument | undefined
  if (selector && 'index' in selector) selected = documents.find((item) => item.index === selector.index)
  else if (selector && 'name' in selector) {
    const exact = documents.filter((item) => item.name === selector.name)
    const folded = exact.length ? exact : documents.filter(
      (item) => item.name.toLocaleLowerCase() === selector.name.toLocaleLowerCase(),
    )
    if (folded.length > 1) throw new Error('CAD document name is ambiguous; use its index.')
    selected = folded[0]
  } else selected = documents.find((item) => item.active) ?? documents[0]
  if (!selected) throw new Error('No matching open CAD document is available.')
  return {
    ...selected,
    ...(selected.project_relative_path === null ? { status: 'foreign_document' as const } : {}),
  }
}

export function documentAsDrawing(document: CadBridgeDocument): CadBridgeDrawing {
  if (!document.project_relative_path) {
    throw new Error('Selected CAD document must be saved inside the trusted project.')
  }
  return {
    name: document.name,
    project_relative_path: document.project_relative_path,
    saved: document.saved,
    dbmod: document.dbmod,
  }
}
