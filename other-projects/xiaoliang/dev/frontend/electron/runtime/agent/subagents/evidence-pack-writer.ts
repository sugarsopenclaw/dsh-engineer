import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  CAD_ANALYST_AGENT_TYPE,
  isCadEvidenceSubagent,
  type SubagentType,
} from './contracts'
import {
  assertSafeSubagentText,
  CAD_ARTIFACT_ROOT,
  isPathInsideRoot,
  normalizeProjectArtifactRef,
} from './security'

export const EVIDENCE_BODY_HEADINGS = Object.freeze([
  '目标定位',
  '图片证据',
  '实体与文件摘录',
  '限制与未采用材料',
] as const)

/** A rejection the child can fix while its turn is still live and traced. */
export class EvidencePackRejection extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.name = 'EvidencePackRejection'
    this.reason = reason
  }
}

export interface EvidencePackProtocol {
  artifactRoot: string
  headings: readonly string[]
  packTitle: string
  taskLabel: string
  bodyLabel: string
}

const CAD_EVIDENCE_PROTOCOL: EvidencePackProtocol = {
  artifactRoot: CAD_ARTIFACT_ROOT,
  headings: EVIDENCE_BODY_HEADINGS,
  packTitle: 'CAD Evidence Pack',
  taskLabel: 'Delegated CAD task',
  bodyLabel: 'CAD evidence body',
}

export function evidencePackProtocol(type: SubagentType): EvidencePackProtocol {
  if (!isCadEvidenceSubagent(type)) {
    throw new EvidencePackRejection(
      `Evidence pack writing is not available for subagent type "${type}".`,
    )
  }
  return CAD_EVIDENCE_PROTOCOL
}

/**
 * Dry-runs the body checks so a CAD child can be asked to fix its write-up while its
 * turn is still live and traced. Returns the model-facing reason, or null when valid.
 */
export function inspectEvidenceBody(evidenceBody: string, type: SubagentType): string | null {
  try {
    validateEvidenceBody(evidenceBody, evidencePackProtocol(type))
    return null
  } catch (error) {
    if (error instanceof EvidencePackRejection) return error.reason
    return error instanceof Error ? error.message : String(error)
  }
}

export interface EvidencePackWriteInput {
  projectRoot: string
  childRunId: string
  task: string
  evidenceBody: string
  artifactRefs?: readonly string[]
  type?: SubagentType
}

export interface EvidencePackWriteResult {
  absolutePath: string
  relativePath: string
  artifactRefs: string[]
  /**
   * Non-fatal reference problems the pack absorbed instead of rejecting: declared refs
   * that are not existing regular files, and body citations no tool result declared.
   */
  warnings: string[]
}

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const MAX_TASK_BYTES = 64 * 1024
const MAX_EVIDENCE_BODY_BYTES = 512 * 1024
const FORBIDDEN_HEADING_PATTERN = /(?:结论|最终答案|最终回答|建议用户|工程建议|recommendation|final answer)/iu

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

function validateTask(task: string, protocol: EvidencePackProtocol): string {
  if (!task.trim()) throw new Error(`${protocol.taskLabel} cannot be empty.`)
  if (Buffer.byteLength(task, 'utf8') > MAX_TASK_BYTES) {
    throw new Error(`${protocol.taskLabel} exceeds the 64 KiB evidence limit.`)
  }
  if (/^#{1,6}\s+/mu.test(task)) {
    throw new Error(`${protocol.taskLabel} cannot inject Markdown headings into the evidence pack.`)
  }
  assertSafeSubagentText(protocol.taskLabel, task)
  return normalizeLineEndings(task)
}

function validateEvidenceBody(evidenceBody: string, protocol: EvidencePackProtocol): string {
  const body = normalizeLineEndings(evidenceBody).trim()
  if (!body) throw new EvidencePackRejection(`${protocol.bodyLabel} cannot be empty.`)
  if (Buffer.byteLength(body, 'utf8') > MAX_EVIDENCE_BODY_BYTES) {
    throw new Error(`${protocol.bodyLabel} exceeds the 512 KiB limit.`)
  }
  assertSafeSubagentText(protocol.bodyLabel, body)

  const headings = [...body.matchAll(/^(#{1,6})\s+(.+?)\s*$/gmu)].map((match) => ({
    level: match[1].length,
    title: match[2].trim(),
  }))
  if (headings.some((heading) => heading.level === 1)) {
    throw new EvidencePackRejection(`${protocol.bodyLabel} cannot contain a level-one heading.`)
  }
  if (headings.some((heading) => FORBIDDEN_HEADING_PATTERN.test(heading.title))) {
    throw new EvidencePackRejection(`${protocol.bodyLabel} contains a conclusion or recommendation heading.`)
  }

  const levelTwoHeadings = headings.filter((heading) => heading.level === 2).map((heading) => heading.title)
  if (
    levelTwoHeadings.length !== protocol.headings.length
    || levelTwoHeadings.some((heading, index) => heading !== protocol.headings[index])
  ) {
    throw new EvidencePackRejection(
      `${protocol.bodyLabel} must contain exactly these ordered sections: ${protocol.headings.join(', ')}.`,
    )
  }
  return body
}

function extractReferencedArtifacts(markdown: string, artifactRoot: string): string[] {
  const values: string[] = []
  const escapedRoot = artifactRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\//gu, '[\\\\/]')
  for (const match of markdown.matchAll(/`([^`]+)`/gu)) {
    const candidate = match[1].trim()
    if (candidate.replace(/\\/g, '/').startsWith(`${artifactRoot}/`)) values.push(candidate)
  }
  for (const match of markdown.matchAll(new RegExp(`\\((${escapedRoot}[\\\\/][^)\\s]+)\\)`, 'gu'))) {
    values.push(match[1])
  }
  for (const match of markdown.matchAll(
    new RegExp(`(?:^|[\\s"'(])((?:${escapedRoot}[\\\\/])[^\\s\`"'<>()[\\]]+)`, 'gmu'),
  )) {
    values.push(match[1].replace(/[,.;:!?，。；：！？]+$/u, ''))
  }
  return [...new Set(values.map((value) => normalizeProjectArtifactRef(value, [artifactRoot])))]
}

async function resolveProjectRoot(projectRoot: string): Promise<string> {
  if (!path.isAbsolute(projectRoot)) throw new Error('Project root must be absolute.')
  const root = await fs.promises.realpath(projectRoot)
  const stat = await fs.promises.stat(root)
  if (!stat.isDirectory()) throw new Error('Project root must resolve to a directory.')
  return root
}

async function ensureArtifactRoot(projectRoot: string, artifactRoot: string): Promise<string> {
  let current = projectRoot
  for (const segment of artifactRoot.split('/')) {
    const requested = path.join(current, segment)
    try {
      const stat = await fs.promises.lstat(requested)
      if (stat.isSymbolicLink()) {
        throw new Error(`Artifact root ${artifactRoot} cannot pass through a symlink or junction.`)
      }
      if (!stat.isDirectory()) throw new Error(`Artifact root segment is not a directory: ${requested}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await fs.promises.mkdir(requested, { recursive: false, mode: 0o700 })
    }
    const resolved = await fs.promises.realpath(requested)
    if (!isPathInsideRoot(projectRoot, resolved) || resolved === projectRoot) {
      throw new Error(`Artifact root ${artifactRoot} resolves outside the project root.`)
    }
    current = resolved
  }
  return current
}

async function validateExistingArtifacts(input: {
  projectRoot: string
  artifactRoot: string
  artifactRootAbsolute: string
  artifactRefs: readonly string[]
}): Promise<{ refs: string[]; dropped: string[] }> {
  const normalized = [...new Set(
    input.artifactRefs.map((value) => normalizeProjectArtifactRef(value, [input.artifactRoot])),
  )]
  if (normalized.length > 64) throw new Error('Evidence pack references more than 64 artifacts.')

  const refs: string[] = []
  const dropped: string[] = []
  for (const artifactRef of normalized) {
    const candidate = path.resolve(input.projectRoot, ...artifactRef.split('/'))
    let realPath: string
    try {
      realPath = await fs.promises.realpath(candidate)
    } catch {
      // A path that never materialized (for example, a still-planned L2-L4 store) must not
      // take the whole pack down; it is dropped and reported as a warning instead.
      dropped.push(artifactRef)
      continue
    }
    if (
      !isPathInsideRoot(input.artifactRootAbsolute, realPath)
      || realPath === input.artifactRootAbsolute
    ) {
      throw new Error(`Evidence artifact resolves outside ${input.artifactRoot}: ${artifactRef}`)
    }
    const stat = await fs.promises.stat(realPath)
    if (!stat.isFile()) {
      // A cited directory (such as a facts store root) degrades the same way as a gap.
      dropped.push(artifactRef)
      continue
    }
    refs.push(artifactRef)
  }
  return { refs, dropped }
}

async function removeFailedRunDirectory(runDirectory: string, temporaryPath: string | null): Promise<void> {
  if (temporaryPath) await fs.promises.unlink(temporaryPath).catch(() => undefined)
  await fs.promises.rmdir(runDirectory).catch(() => undefined)
}

export class EvidencePackWriter {
  async write(input: EvidencePackWriteInput): Promise<EvidencePackWriteResult> {
    const protocol = evidencePackProtocol(input.type ?? CAD_ANALYST_AGENT_TYPE)
    if (!RUN_ID_PATTERN.test(input.childRunId)) throw new Error('Invalid child run id for evidence pack.')
    const task = validateTask(input.task, protocol)
    const evidenceBody = validateEvidenceBody(input.evidenceBody, protocol)
    const projectRoot = await resolveProjectRoot(input.projectRoot)
    const artifactRootAbsolute = await ensureArtifactRoot(projectRoot, protocol.artifactRoot)
    const { refs: artifactRefs, dropped } = await validateExistingArtifacts({
      projectRoot,
      artifactRoot: protocol.artifactRoot,
      artifactRootAbsolute,
      artifactRefs: input.artifactRefs ?? [],
    })

    const referencedByBody = extractReferencedArtifacts(evidenceBody, protocol.artifactRoot)
    const declaredRefs = new Set(artifactRefs)
    const undeclaredRefs = referencedByBody.filter((artifactRef) => !declaredRefs.has(artifactRef))
    // Reference problems degrade to warnings rather than rejections: the evidence and its
    // materialized artifacts are worth more than the citation list being exact. The parent
    // only reads listed refs, so a dropped citation is inert instead of a broken promise.
    const warnings: string[] = []
    if (dropped.length > 0) {
      warnings.push(
        `Evidence artifact refs were dropped because they are not existing regular files: ${dropped.join(', ')}`,
      )
    }
    if (undeclaredRefs.length > 0) {
      warnings.push(
        `${protocol.bodyLabel} references undeclared artifacts that were left out of the pack: ${undeclaredRefs.join(', ')}`,
      )
    }

    const evidenceRootRequested = path.join(artifactRootAbsolute, 'evidence')
    await fs.promises.mkdir(evidenceRootRequested, { recursive: true })
    const evidenceRoot = await fs.promises.realpath(evidenceRootRequested)
    if (!isPathInsideRoot(artifactRootAbsolute, evidenceRoot) || evidenceRoot === artifactRootAbsolute) {
      throw new Error(`Evidence root resolves outside ${protocol.artifactRoot}.`)
    }

    const runDirectory = path.resolve(evidenceRoot, input.childRunId)
    if (path.dirname(runDirectory) !== evidenceRoot) throw new Error('Evidence run directory escaped its root.')
    await fs.promises.mkdir(runDirectory, { recursive: false })
    const realRunDirectory = await fs.promises.realpath(runDirectory)
    if (!isPathInsideRoot(evidenceRoot, realRunDirectory) || realRunDirectory === evidenceRoot) {
      await removeFailedRunDirectory(runDirectory, null)
      throw new Error('Evidence run directory resolves outside its root.')
    }

    const relativePath = `${protocol.artifactRoot}/evidence/${input.childRunId}/evidence.md`
    const absolutePath = path.join(realRunDirectory, 'evidence.md')
    const temporaryPath = path.join(realRunDirectory, `.evidence-${randomUUID()}.tmp`)
    const content = `# ${protocol.packTitle}\n\n## 委派任务\n\n${task}\n\n${evidenceBody}\n`

    let handle: fs.promises.FileHandle | null = null
    try {
      handle = await fs.promises.open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(content, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      await fs.promises.rename(temporaryPath, absolutePath)
      return {
        absolutePath,
        relativePath,
        artifactRefs: [...artifactRefs, relativePath],
        warnings,
      }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await removeFailedRunDirectory(realRunDirectory, temporaryPath)
      throw error
    }
  }
}
