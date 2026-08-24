import fs from 'node:fs'
import path from 'node:path'

import type { CadBridgeDrawing } from '../../../../cad/drivers/autocad-http/cad-application-facade'
import { sourceFingerprint } from '../cad-subagent/entity-index'

/**
 * Where the drafter's deliverables land.
 *
 * `xiaoliang-outputs/` is the project's existing artifact root, so drawings the agent
 * produces show up beside the reports and spreadsheets the user already expects to find
 * there instead of in a hidden directory. The `cad/` subdirectory keeps them from mixing
 * with document artifacts.
 */
export const DRAFTER_OUTPUT_ROOT = 'xiaoliang-outputs/cad'

const PROVENANCE_LEDGER = '.provenance.jsonl'
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024
const MAX_SLUG_LENGTH = 64
const OUTPUT_EXTENSIONS: ReadonlySet<string> = new Set(['.dxf', '.png', '.svg', '.pdf', '.html'])

export interface DrafterOutputRecord {
  relativePath: string
  byteLength: number
}

export interface DrafterProvenance {
  /** Absent when the drawing was authored from scratch rather than derived from a source. */
  source?: CadBridgeDrawing
  layers?: readonly string[]
  note?: string
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function slugify(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return normalized.slice(0, MAX_SLUG_LENGTH) || fallback
}

/**
 * Owns the drafter's output directory for one child run.
 *
 * Every write goes through here so three invariants hold no matter which tool is calling:
 * the file lands inside the project's output root, it never replaces something that is
 * already there, and it leaves a provenance line saying what it was derived from.
 */
export class DrafterWorkspace {
  private outputRoot: string | null = null

  constructor(
    private readonly projectRoot: string,
    private readonly childRunId: string,
  ) {}

  /**
   * Creates the output root, refusing a symlink that would relocate writes outside the
   * project. Resolved lazily so a read-only run never creates an empty directory.
   */
  private async ensureOutputRoot(): Promise<string> {
    if (this.outputRoot) return this.outputRoot
    const requested = path.resolve(this.projectRoot, ...DRAFTER_OUTPUT_ROOT.split('/'))
    await fs.promises.mkdir(requested, { recursive: true })
    const resolved = await fs.promises.realpath(requested)
    if (!isInside(this.projectRoot, resolved)) {
      throw new Error('The CAD output directory resolves outside the project root.')
    }
    this.outputRoot = resolved
    return resolved
  }

  /**
   * Turns a requested name into a project-relative output path that does not exist yet.
   *
   * The child run id is folded into the filename rather than a subdirectory: it keeps two
   * runs from clobbering each other while leaving the deliverable somewhere a user would
   * actually look for it.
   */
  async allocate(name: string, extension: string): Promise<{ relativePath: string; absolutePath: string }> {
    const normalizedExtension = extension.toLowerCase()
    if (!OUTPUT_EXTENSIONS.has(normalizedExtension)) {
      throw new Error(`The drafter cannot write ${normalizedExtension} files.`)
    }
    const outputRoot = await this.ensureOutputRoot()
    const stem = `${slugify(name, 'drawing')}-${this.childRunId.slice(-8)}`
    const fileName = `${stem}${normalizedExtension}`
    const absolutePath = path.join(outputRoot, fileName)
    if (!isInside(outputRoot, absolutePath) || path.dirname(absolutePath) !== outputRoot) {
      throw new Error('The requested output name escaped the CAD output directory.')
    }
    return {
      relativePath: `${DRAFTER_OUTPUT_ROOT}/${fileName}`,
      absolutePath,
    }
  }

  /**
   * Writes a produced file and records where it came from.
   *
   * The exclusive-create open is what enforces never-overwrite, which also covers a
   * project that happens to keep real drawings inside the output directory: the agent
   * cannot replace one even by choosing its exact name.
   */
  async write(input: {
    name: string
    extension: string
    bytes: Buffer
    provenance: DrafterProvenance
    signal?: AbortSignal
  }): Promise<DrafterOutputRecord> {
    if (input.bytes.byteLength === 0) throw new Error('Refusing to write an empty CAD output.')
    if (input.bytes.byteLength > MAX_OUTPUT_BYTES) {
      throw new Error('The produced CAD file exceeds the supported output size.')
    }
    const target = await this.allocate(input.name, input.extension)
    let handle: fs.promises.FileHandle | null = null
    try {
      handle = await fs.promises.open(target.absolutePath, 'wx', 0o600)
      await handle.writeFile(input.bytes)
      await handle.sync()
    } catch (error) {
      await handle?.close().catch(() => undefined)
      handle = null
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`${target.relativePath} already exists; choose a different name.`)
      }
      await fs.promises.rm(target.absolutePath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      await handle?.close().catch(() => undefined)
    }
    await this.recordProvenance(target.relativePath, input.bytes.byteLength, input.provenance, input.signal)
    return { relativePath: target.relativePath, byteLength: input.bytes.byteLength }
  }

  /**
   * Appends one line describing a produced file.
   *
   * The ledger is what makes a derived drawing auditable: it pins the exact bytes of the
   * source the copy was taken from, so a reviewer can tell whether the original has since
   * changed. A failure to record is not allowed to pass silently, because a deliverable
   * with no recorded origin is the thing this whole isolation model exists to prevent.
   */
  private async recordProvenance(
    relativePath: string,
    byteLength: number,
    provenance: DrafterProvenance,
    signal?: AbortSignal,
  ): Promise<void> {
    const outputRoot = await this.ensureOutputRoot()
    const source = provenance.source
      ? {
        project_relative_path: provenance.source.project_relative_path,
        ...(await sourceFingerprint(this.projectRoot, provenance.source, signal)),
      }
      : null
    const line = `${JSON.stringify({
      schema_version: 1,
      path: relativePath,
      byte_length: byteLength,
      generated_at: new Date().toISOString(),
      child_run_id: this.childRunId,
      producer: 'cad-drafter/mlightcad',
      source,
      ...(provenance.layers?.length ? { layers: [...provenance.layers] } : {}),
      ...(provenance.note ? { note: provenance.note } : {}),
    })}\n`
    await fs.promises.appendFile(path.join(outputRoot, PROVENANCE_LEDGER), line, {
      encoding: 'utf8',
      mode: 0o600,
    })
  }
}
