import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { CadBridgeDrawing } from '../drivers/autocad-http/cad-application-facade'
import type { MLightCadEngine } from '../mlight/mlight-session-service'
import {
  drawingArtifactPaths,
  resolveProjectFile,
  resolveTrustedProjectRoot,
  sha256File,
} from '../../agent/tools/domain/cad-subagent/artifact-store'
import {
  CadstackRuntime,
  type CadstackResponse,
  type CadstackRunOptions,
} from './cadstack-runtime'

const DRAWING_EXTENSIONS: ReadonlySet<string> = new Set(['.dwg', '.dxf'])
const MLight_INDEX_EXTENSIONS: ReadonlySet<string> = new Set(['.jsonl'])
const MAX_DXF_BYTES = 1024 * 1024 * 1024

interface CadstackRunner {
  run(args: readonly string[], options?: CadstackRunOptions): Promise<CadstackResponse>
}

export interface EnsureCadFactsInput {
  projectRoot: string
  drawing: Pick<CadBridgeDrawing, 'name' | 'project_relative_path'>
  mlightIndexPath?: string
  force?: boolean
}

export interface EnsureCadFactsResult {
  drawingKey: string
  cacheHit: boolean
  backgroundScheduled: boolean
  status: CadstackResponse
  warnings: string[]
}

export interface CadFactsLookupInput {
  projectRoot: string
  drawingKey: string
  classId?: string
  bounds?: readonly [number, number, number, number]
  representation?: string
  text?: string
  limit?: number
  signal?: AbortSignal
}

export interface FactsBuildServiceOptions {
  engine: Pick<MLightCadEngine, 'exportDxf'>
  runtime?: CadstackRunner
}

interface Preparation {
  l1: Promise<EnsureCadFactsResult>
  complete: Promise<void>
  l1Settled: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function statusDrawing(response: CadstackResponse, drawingKey: string): Record<string, unknown> | null {
  if (!Array.isArray(response.drawings)) return null
  const value = response.drawings.find((item) => isRecord(item) && item.drawing_key === drawingKey)
  return isRecord(value) ? value : null
}

function readyLayer(drawing: Record<string, unknown> | null, layer: string): boolean {
  return isRecord(drawing?.layers) && drawing.layers[layer] === 'ready'
}

function preparationKey(projectRoot: string, drawingKey: string): string {
  const root = process.platform === 'win32'
    ? projectRoot.toLocaleLowerCase('en-US')
    : projectRoot
  return `${root}\u0000${drawingKey}`
}

function safeBase64(value: string): boolean {
  return value.length > 0
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]*={0,2}$/u.test(value)
}

function backgroundError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class FactsBuildService {
  private readonly engine: Pick<MLightCadEngine, 'exportDxf'>
  private readonly runtime: CadstackRunner
  private readonly controller = new AbortController()
  private readonly inflight = new Map<string, Preparation>()
  private readonly buildFailures = new Map<string, string>()
  private disposed = false

  constructor(options: FactsBuildServiceOptions) {
    this.engine = options.engine
    this.runtime = options.runtime ?? new CadstackRuntime()
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('CAD facts build service is disposed.')
  }

  private async statusInternal(
    projectRoot: string,
    drawingKey?: string,
    signal: AbortSignal = this.controller.signal,
  ): Promise<CadstackResponse> {
    const args = ['status', '--project-root', projectRoot]
    if (drawingKey) args.push('--drawing-key', drawingKey)
    return this.runtime.run(args, { signal })
  }

  async status(
    projectRootInput: string,
    drawingKey?: string,
    signal?: AbortSignal,
  ): Promise<CadstackResponse> {
    this.assertActive()
    const projectRoot = resolveTrustedProjectRoot(projectRootInput)
    const response = await this.statusInternal(projectRoot, drawingKey, signal)
    const buildingKeys = new Set(
      [...this.inflight.keys()]
        .filter((key) => key.startsWith(`${preparationKey(projectRoot, '')}`))
        .map((key) => key.slice(key.lastIndexOf('\u0000') + 1)),
    )
    if (Array.isArray(response.drawings)) {
      response.drawings = response.drawings.map((item) => {
        if (!isRecord(item) || typeof item.drawing_key !== 'string') return item
        // Surface the last background build failure through the same status channel that
        // already reports in-flight builds, so a silent L2-L4 failure stays observable.
        const failure = this.buildFailures.get(preparationKey(projectRoot, item.drawing_key))
        return {
          ...item,
          building: buildingKeys.has(item.drawing_key),
          ...(failure ? { build_error: failure } : {}),
        }
      })
    }
    response.building = drawingKey ? buildingKeys.has(drawingKey) : buildingKeys.size > 0
    response.building_drawing_keys = [...buildingKeys].sort()
    return response
  }

  private async publishDxf(
    projectRoot: string,
    drawing: Pick<CadBridgeDrawing, 'name' | 'project_relative_path'>,
    drawingKey: string,
  ): Promise<{ path: string; warnings: string[] }> {
    const source = resolveProjectFile(projectRoot, drawing.project_relative_path, {
      extensions: DRAWING_EXTENSIONS,
    })
    if (path.extname(source.relativePath).toLowerCase() === '.dxf') {
      return { path: source.absolutePath, warnings: [] }
    }
    const relative = `.xiaoliang/cad/facts/.cache/dxf/${drawingKey}.dxf`
    const target = resolveProjectFile(projectRoot, relative, {
      extensions: new Set(['.dxf']),
      mustExist: false,
    })
    await fs.promises.mkdir(path.dirname(target.absolutePath), { recursive: true })
    const exported = await this.engine.exportDxf({
      projectRoot,
      sourceRelativePath: source.relativePath,
      signal: this.controller.signal,
    })
    if (!safeBase64(exported.dxfBase64)) {
      throw new Error('MLightCAD returned invalid base64 DXF content.')
    }
    const bytes = Buffer.from(exported.dxfBase64, 'base64')
    if (
      bytes.byteLength !== exported.byteLength
      || bytes.byteLength === 0
      || bytes.byteLength > MAX_DXF_BYTES
    ) {
      throw new Error('MLightCAD returned an invalid DXF byte length.')
    }
    const temporary = path.join(
      path.dirname(target.absolutePath),
      `.${path.basename(target.absolutePath)}.tmp-${process.pid}-${randomUUID()}`,
    )
    try {
      await fs.promises.writeFile(temporary, bytes, { flag: 'wx' })
      try {
        await fs.promises.rename(temporary, target.absolutePath)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST' && code !== 'EPERM') throw error
        await fs.promises.rm(target.absolutePath, { force: true })
        await fs.promises.rename(temporary, target.absolutePath)
      }
    } finally {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined)
    }
    return { path: target.absolutePath, warnings: [...exported.warnings] }
  }

  private async prepareL1(input: EnsureCadFactsInput): Promise<EnsureCadFactsResult> {
    const projectRoot = resolveTrustedProjectRoot(input.projectRoot)
    const drawingPaths = drawingArtifactPaths(input.drawing)
    const drawingKey = drawingPaths.artifactKey
    const source = resolveProjectFile(projectRoot, input.drawing.project_relative_path, {
      extensions: DRAWING_EXTENSIONS,
    })
    const index = input.mlightIndexPath
      ? resolveProjectFile(projectRoot, input.mlightIndexPath, {
        extensions: MLight_INDEX_EXTENSIONS,
      })
      : null
    const [sourceSha256, mlightIndexSha256] = await Promise.all([
      sha256File(source.absolutePath, this.controller.signal),
      index ? sha256File(index.absolutePath, this.controller.signal) : Promise.resolve(null),
    ])
    const before = await this.statusInternal(projectRoot, drawingKey)
    const current = statusDrawing(before, drawingKey)
    const cacheHit = !input.force
      && current?.source_sha256 === sourceSha256
      && current?.mlight_index_sha256 === mlightIndexSha256
      && readyLayer(current, 'l1')
    const warnings: string[] = []
    let status = before
    if (!cacheHit) {
      const dxf = await this.publishDxf(projectRoot, input.drawing, drawingKey)
      warnings.push(...dxf.warnings)
      const args = [
        'ingest',
        '--project-root', projectRoot,
        '--drawing-key', drawingKey,
        '--dxf', dxf.path,
        '--logical-source', source.relativePath,
      ]
      if (index) args.push('--mlight-index', index.absolutePath)
      await this.runtime.run(args, { signal: this.controller.signal })
      status = await this.statusInternal(projectRoot, drawingKey)
      const ingested = statusDrawing(status, drawingKey)
      if (
        !readyLayer(ingested, 'l1')
        || ingested?.source_sha256 !== sourceSha256
        || ingested?.mlight_index_sha256 !== mlightIndexSha256
      ) {
        throw new Error('cadstack ingest completed without a verified L1 result for the current source.')
      }
    }
    const drawingStatus = statusDrawing(status, drawingKey)
    return {
      drawingKey,
      cacheHit,
      backgroundScheduled: !readyLayer(drawingStatus, 'l4'),
      status,
      warnings,
    }
  }

  private async buildRemaining(projectRootInput: string, drawingKey: string): Promise<void> {
    const projectRoot = resolveTrustedProjectRoot(projectRootInput)
    const status = await this.statusInternal(projectRoot, drawingKey)
    const drawing = statusDrawing(status, drawingKey)
    if (readyLayer(drawing, 'l4')) return
    if (!readyLayer(drawing, 'l3')) {
      await this.runtime.run([
        'build',
        '--project-root', projectRoot,
        '--drawing-key', drawingKey,
      ], { signal: this.controller.signal })
    }
    await this.runtime.run([
      'bind',
      '--project-root', projectRoot,
    ], { signal: this.controller.signal })
  }

  ensureL1(input: EnsureCadFactsInput): Promise<EnsureCadFactsResult> {
    this.assertActive()
    const projectRoot = resolveTrustedProjectRoot(input.projectRoot)
    const drawingKey = drawingArtifactPaths(input.drawing).artifactKey
    const key = preparationKey(projectRoot, drawingKey)
    const existing = this.inflight.get(key)
    if (existing && (!input.force || !existing.l1Settled)) return existing.l1
    // A fresh attempt supersedes the last background failure for this drawing.
    this.buildFailures.delete(key)

    let preparation: Preparation
    const l1 = this.prepareL1({ ...input, projectRoot }).finally(() => {
      preparation.l1Settled = true
    })
    const complete = l1
      .then(async (result) => {
        if (!result.backgroundScheduled) return
        try {
          await existing?.complete
          await this.buildRemaining(projectRoot, result.drawingKey)
          this.buildFailures.delete(key)
        } catch (error) {
          if (
            !this.controller.signal.aborted
            && this.inflight.get(key)?.complete === complete
          ) {
            const message = backgroundError(error)
            this.buildFailures.set(key, message.slice(0, 500))
            console.warn(`[cad-facts] background build failed for ${drawingKey}:`, message)
          }
        }
      }, () => undefined)
      .finally(() => {
        if (this.inflight.get(key)?.complete === complete) this.inflight.delete(key)
      })
    preparation = { l1, complete, l1Settled: false }
    this.inflight.set(key, preparation)
    return l1
  }

  async build(input: EnsureCadFactsInput): Promise<CadstackResponse> {
    const result = await this.ensureL1(input)
    return this.status(input.projectRoot, result.drawingKey)
  }

  async ask(
    projectRootInput: string,
    request: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CadstackResponse> {
    this.assertActive()
    const projectRoot = resolveTrustedProjectRoot(projectRootInput)
    const requestId = randomUUID()
    const relative = `.xiaoliang/cad/facts/.cache/requests/${requestId}.json`
    const target = resolveProjectFile(projectRoot, relative, {
      extensions: new Set(['.json']),
      mustExist: false,
    })
    await fs.promises.mkdir(path.dirname(target.absolutePath), { recursive: true })
    try {
      await fs.promises.writeFile(target.absolutePath, `${JSON.stringify(request)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      })
      return await this.runtime.run([
        'ask',
        '--project-root', projectRoot,
        '--request', target.absolutePath,
      ], { signal })
    } finally {
      await fs.promises.rm(target.absolutePath, { force: true }).catch(() => undefined)
    }
  }

  lookup(input: CadFactsLookupInput): Promise<CadstackResponse> {
    this.assertActive()
    const projectRoot = resolveTrustedProjectRoot(input.projectRoot)
    const args = [
      'lookup',
      '--project-root', projectRoot,
      '--drawing-key', input.drawingKey,
    ]
    if (input.classId) args.push('--class', input.classId)
    if (input.bounds) args.push('--bounds', ...input.bounds.map(String))
    if (input.representation) args.push('--representation', input.representation)
    if (input.text) args.push('--text', input.text)
    if (input.limit !== undefined) args.push('--limit', String(input.limit))
    return this.runtime.run(args, { signal: input.signal })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.controller.abort(new Error('CAD facts build service is shutting down.'))
    await Promise.allSettled([...this.inflight.values()].map((entry) => entry.complete))
    this.inflight.clear()
  }
}
