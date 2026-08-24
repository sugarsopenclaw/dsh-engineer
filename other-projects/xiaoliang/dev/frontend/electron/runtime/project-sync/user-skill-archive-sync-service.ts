import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import type { AuthSessionData } from '../../../src/shared/backend-api'
import type { LocalUserSkillSummary } from '../../../src/shared/local-agent'
import { backendRequest } from '../backend/http'
import { getDB } from '../db'
import { userSkillService } from '../agent/user-skills/service'
import { isDefaultProjectArchiveIgnoredDirectory } from './project-scan-policy'
import {
  canCommitUserSkillArchiveScan,
  userSkillArchiveCacheKey,
} from './user-skill-archive-policy'

const SKILL_SYNC_START_DELAY_MS = 18_000
const SKILL_SYNC_CHANGE_DELAY_MS = 2_500
const PREPARE_BATCH_SIZE = 50
const CONFIRM_BATCH_SIZE = 50
const UPLOAD_CONCURRENCY = 2
const UPLOAD_IDLE_TIMEOUT_MS = 120_000
const USER_SKILL_SLUG_PATTERN = /^(?=.{2,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/

const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.py': 'text/x-python',
  '.js': 'text/javascript',
  '.ts': 'text/plain',
  '.ps1': 'text/plain',
  '.sh': 'text/x-shellscript',
}

interface ScannedSkillFile {
  relativePath: string
  absolutePath: string
  sizeBytes: number
  modifiedAt: string
  modifiedAtMs: number
  sha256: string
  mediaType: string
  skillSlug: string | null
}

interface SkillFileScanResult {
  files: ScannedSkillFile[]
  complete: boolean
  rootName: string | null
  rootAvailable: boolean
}

interface SnapshotStartData {
  archive_id: string
  sync_status: string
  snapshot_id: string
}

interface UploadTarget {
  relative_path: string
  sha256: string
  upload_required: boolean
  upload_url?: string | null
  required_headers?: Record<string, string>
  expires_in_seconds?: number | null
}

interface PrepareFilesData {
  archive_id: string
  targets: UploadTarget[]
}

interface ConfirmFilesData {
  results: Array<{
    relative_path: string
    sha256: string
    status: 'ready' | 'missing' | 'mismatch' | 'failed'
    error?: string | null
  }>
}

interface HashCacheRow {
  size_bytes: number
  modified_at_ms: number
  sha256: string
}

function normalizeSlash(value: string) {
  return value.replace(/\\/g, '/')
}

function isPathInsideRoot(rootPath: string, targetPath: string) {
  const relative = path.relative(rootPath, targetPath)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function mediaTypeForPath(filePath: string) {
  return MEDIA_TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function skillSlugFromRelativePath(relativePath: string): string | null {
  const first = relativePath.split('/')[0] || ''
  if (relativePath.toLowerCase() === 'manifest.json') return null
  return USER_SKILL_SLUG_PATTERN.test(first) ? first : null
}

function chunksOf<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('操作已取消。')
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

function cachedSha256(
  skillsRoot: string,
  relativePath: string,
  sizeBytes: number,
  modifiedAtMs: number,
): string | null {
  const row = getDB()
    .prepare(
      `SELECT size_bytes, modified_at_ms, sha256
       FROM user_skill_archive_file_cache
       WHERE relative_path = ?`,
    )
    .get(userSkillArchiveCacheKey(skillsRoot, relativePath)) as HashCacheRow | undefined
  if (
    row
    && row.size_bytes === sizeBytes
    && row.modified_at_ms === modifiedAtMs
    && /^[0-9a-f]{64}$/i.test(row.sha256)
  ) {
    return row.sha256.toLowerCase()
  }
  return null
}

function replaceSkillHashCache(skillsRoot: string, files: ScannedSkillFile[]) {
  const db = getDB()
  const remove = db.prepare('DELETE FROM user_skill_archive_file_cache')
  const insert = db.prepare(
    `INSERT INTO user_skill_archive_file_cache (
       relative_path, size_bytes, modified_at_ms, sha256, updated_at
     ) VALUES (?, ?, ?, ?, datetime('now','localtime'))`,
  )
  db.transaction(() => {
    remove.run()
    for (const file of files) {
      insert.run(
        userSkillArchiveCacheKey(skillsRoot, file.relativePath),
        file.sizeBytes,
        file.modifiedAtMs,
        file.sha256,
      )
    }
  })()
}

async function uploadFileToSignedUrl(input: {
  uploadUrl: string
  requiredHeaders: Record<string, string>
  absolutePath: string
  expectedSize: number
  expectedModifiedAtMs: number
  signal?: AbortSignal
}): Promise<void> {
  throwIfAborted(input.signal)
  const statBefore = await fs.promises.stat(input.absolutePath)
  if (
    !statBefore.isFile()
    || statBefore.size !== input.expectedSize
    || Math.trunc(statBefore.mtimeMs) !== input.expectedModifiedAtMs
  ) {
    throw new Error('自制 skill 文件在上传前发生变化，将在下一次后台同步重试。')
  }

  const endpoint = new URL(input.uploadUrl)
  const transport = endpoint.protocol === 'https:' ? https : http
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(input.absolutePath)
    const request = transport.request(
      endpoint,
      {
        method: 'PUT',
        headers: {
          ...input.requiredHeaders,
          'Content-Length': String(input.expectedSize),
        },
      },
      (response) => {
        response.resume()
        response.on('end', () => {
          const status = response.statusCode || 0
          if (status >= 200 && status < 300) resolve()
          else reject(new Error(`自制 skill OSS 上传失败（HTTP ${status || 'unknown'}）。`))
        })
      },
    )
    const abort = () => {
      stream.destroy(new Error('操作已取消。'))
      request.destroy(new Error('操作已取消。'))
    }
    input.signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => input.signal?.removeEventListener('abort', abort)
    request.on('error', (error) => {
      cleanup()
      reject(error)
    })
    request.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () => {
      const error = new Error('自制 skill OSS 上传长时间无网络进展，已中止并等待后台重试。')
      stream.destroy(error)
      request.destroy(error)
    })
    request.on('close', cleanup)
    stream.on('error', (error) => request.destroy(error))
    stream.pipe(request)
  })

  const statAfter = await fs.promises.stat(input.absolutePath)
  if (
    statAfter.size !== input.expectedSize
    || Math.trunc(statAfter.mtimeMs) !== input.expectedModifiedAtMs
  ) {
    throw new Error('自制 skill 文件在上传过程中发生变化，将在下一次后台同步重试。')
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await worker(item)
    }
  })
  await Promise.all(runners)
}

function skillPayload(skills: LocalUserSkillSummary[], files: ScannedSkillFile[]) {
  const fileCountBySlug = new Map<string, number>()
  for (const file of files) {
    if (!file.skillSlug) continue
    fileCountBySlug.set(file.skillSlug, (fileCountBySlug.get(file.skillSlug) || 0) + 1)
  }
  return skills.map((skill) => ({
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    enabled: skill.enabled,
    validation_status: skill.validationStatus,
    validation_message: skill.validationMessage ? skill.validationMessage.slice(0, 2000) : null,
    file_count: fileCountBySlug.get(skill.slug) || 0,
    updated_at: skill.updatedAt,
  }))
}

export class UserSkillArchiveSyncService {
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<void> | null = null
  private pending = false
  private disposed = false

  constructor(
    private readonly getBackendSession: () => Promise<AuthSessionData | null>,
  ) {}

  scheduleInitialSync(delayMs = SKILL_SYNC_START_DELAY_MS) {
    this.scheduleSync(delayMs)
  }

  scheduleSync(delayMs = SKILL_SYNC_CHANGE_DELAY_MS) {
    if (this.disposed) return
    if (this.timer) clearTimeout(this.timer)
    const timer = setTimeout(() => {
      this.timer = null
      void this.syncNow().catch((error) => {
        console.warn('[user-skill-archive] background sync failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, Math.max(0, delayMs))
    timer.unref?.()
    this.timer = timer
  }

  dispose() {
    this.disposed = true
    this.pending = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async syncNow(): Promise<void> {
    if (this.inFlight) {
      this.pending = true
      return this.inFlight
    }
    const operation = this.syncSkills().finally(() => {
      if (this.inFlight === operation) this.inFlight = null
      if (this.pending && !this.disposed) {
        this.pending = false
        void this.syncNow().catch((error) => {
          console.warn('[user-skill-archive] follow-up sync failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    })
    this.inFlight = operation
    return operation
  }

  private async syncSkills(): Promise<void> {
    if (this.disposed) return
    const accessToken = await this.optionalAccessToken()
    if (!accessToken) return

    const scan = await this.scanSkillFiles()
    if (!scan.rootAvailable) return
    if (this.disposed) return
    const snapshot = await backendRequest<SnapshotStartData>('/user-skills/archive/snapshots/start', {
      method: 'POST',
      accessToken,
      body: {
        scanned_at: new Date().toISOString(),
        skills_root_name: scan.rootName,
      },
    })
    const manifestComplete = await this.ensureFilesUploaded(
      accessToken,
      snapshot.snapshot_id,
      scan.files,
    )
    if (this.disposed) return
    const status = userSkillService.getStatus()
    await backendRequest('/user-skills/archive/snapshots/' + encodeURIComponent(snapshot.snapshot_id) + '/complete', {
      method: 'POST',
      accessToken,
      body: {
        file_count: scan.files.length,
        total_bytes: scan.files.reduce((sum, file) => sum + file.sizeBytes, 0),
        scan_complete: scan.complete && manifestComplete,
        skills_root_name: scan.rootName,
        skills: skillPayload(status.skills, scan.files),
      },
    })
  }

  private async scanSkillFiles(): Promise<SkillFileScanResult> {
    const rootPath = userSkillService.getSkillsRootPath()
    const rootName = path.basename(rootPath)
    if (!fs.existsSync(rootPath)) {
      return { files: [], complete: false, rootName, rootAvailable: false }
    }
    const rootStat = await fs.promises.stat(rootPath)
    if (!canCommitUserSkillArchiveScan({
      rootExists: true,
      rootIsDirectory: rootStat.isDirectory(),
    })) {
      return { files: [], complete: false, rootName, rootAvailable: false }
    }

    const rootRealPath = await fs.promises.realpath(rootPath)
    const files: ScannedSkillFile[] = []
    let complete = true

    const walk = async (directory: string): Promise<void> => {
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true })
      } catch (error) {
        complete = false
        console.warn('[user-skill-archive] skipping unreadable directory', directory, error)
        return
      }
      entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      for (const entry of entries) {
        const candidate = path.join(directory, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          if (isDefaultProjectArchiveIgnoredDirectory(entry.name)) continue
          await walk(candidate)
          continue
        }
        if (!entry.isFile()) continue
        try {
          const absolutePath = await fs.promises.realpath(candidate)
          if (!isPathInsideRoot(rootRealPath, absolutePath)) continue
          const stat = await fs.promises.stat(absolutePath)
          if (!stat.isFile()) continue
          const relativePath = normalizeSlash(path.relative(rootRealPath, absolutePath))
          const modifiedAtMs = Math.trunc(stat.mtimeMs)
          const sha256 = cachedSha256(rootRealPath, relativePath, stat.size, modifiedAtMs) || await sha256File(absolutePath)
          const afterHashStat = await fs.promises.stat(absolutePath)
          if (
            afterHashStat.size !== stat.size
            || Math.trunc(afterHashStat.mtimeMs) !== modifiedAtMs
          ) {
            complete = false
            continue
          }
          files.push({
            relativePath,
            absolutePath,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            modifiedAtMs,
            sha256,
            mediaType: mediaTypeForPath(relativePath),
            skillSlug: skillSlugFromRelativePath(relativePath),
          })
        } catch (error) {
          complete = false
          console.warn('[user-skill-archive] skipping unreadable file', candidate, error)
        }
      }
    }

    await walk(rootRealPath)
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'))
    replaceSkillHashCache(rootRealPath, files)
    return { files, complete, rootName, rootAvailable: true }
  }

  private async ensureFilesUploaded(
    accessToken: string,
    snapshotId: string,
    files: ScannedSkillFile[],
  ) {
    let manifestComplete = true
    const byPath = new Map(files.map((file) => [file.relativePath, file]))
    for (const batch of chunksOf(files, PREPARE_BATCH_SIZE)) {
      let prepared: PrepareFilesData
      try {
        prepared = await this.prepareFileBatch(accessToken, snapshotId, batch)
      } catch (error) {
        if (batch.length === 1) {
          manifestComplete = false
          console.warn('[user-skill-archive] file preparation failed', {
            path: batch[0]?.relativePath,
            error: error instanceof Error ? error.message : String(error),
          })
          continue
        }
        for (const file of batch) {
          try {
            const single = await this.prepareFileBatch(accessToken, snapshotId, [file])
            const uploadComplete = await this.uploadPreparedTargets(accessToken, single.targets, byPath)
            if (!uploadComplete) manifestComplete = false
          } catch (singleError) {
            manifestComplete = false
            console.warn('[user-skill-archive] file preparation failed', {
              path: file.relativePath,
              error: singleError instanceof Error ? singleError.message : String(singleError),
            })
          }
        }
        continue
      }
      const uploadComplete = await this.uploadPreparedTargets(accessToken, prepared.targets, byPath)
      if (!uploadComplete) manifestComplete = false
    }
    return manifestComplete
  }

  private prepareFileBatch(
    accessToken: string,
    snapshotId: string,
    files: ScannedSkillFile[],
  ) {
    return backendRequest<PrepareFilesData>('/user-skills/archive/files/prepare', {
      method: 'POST',
      accessToken,
      body: {
        snapshot_id: snapshotId,
        files: files.map((file) => ({
          relative_path: file.relativePath,
          size_bytes: file.sizeBytes,
          sha256: file.sha256,
          modified_at: file.modifiedAt,
          media_type: file.mediaType,
          skill_slug: file.skillSlug,
        })),
      },
    })
  }

  private async uploadPreparedTargets(
    accessToken: string,
    targets: UploadTarget[],
    byPath: Map<string, ScannedSkillFile>,
  ) {
    const completed: Array<{ relative_path: string; sha256: string }> = []
    const uploadErrors: Error[] = []
    const uploadTargets = targets.filter((target) => target.upload_required)
    await runWithConcurrency(uploadTargets, UPLOAD_CONCURRENCY, async (target) => {
      const file = byPath.get(target.relative_path)
      if (!file || !target.upload_url) {
        uploadErrors.push(new Error(`后端未返回完整上传目标：${target.relative_path}`))
        return
      }
      try {
        await uploadFileToSignedUrl({
          uploadUrl: target.upload_url,
          requiredHeaders: target.required_headers || {},
          absolutePath: file.absolutePath,
          expectedSize: file.sizeBytes,
          expectedModifiedAtMs: file.modifiedAtMs,
        })
        completed.push({ relative_path: file.relativePath, sha256: file.sha256 })
      } catch (error) {
        uploadErrors.push(error instanceof Error ? error : new Error(String(error)))
        console.warn('[user-skill-archive] OSS upload failed; product flow continues', {
          path: file.relativePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    for (const batch of chunksOf(completed, CONFIRM_BATCH_SIZE)) {
      const confirmation = await backendRequest<ConfirmFilesData>('/user-skills/archive/files/confirm', {
        method: 'POST',
        accessToken,
        body: { files: batch },
      })
      const failed = confirmation.results.filter((item) => item.status !== 'ready')
      if (failed.length > 0) {
        uploadErrors.push(new Error(
          `自制 skill OSS 确认未完成：${failed.map((item) => item.relative_path).join('、')}`,
        ))
        console.warn('[user-skill-archive] OSS confirmations incomplete', {
          failed: failed.map((item) => ({ path: item.relative_path, status: item.status })),
        })
      }
    }
    return uploadErrors.length === 0
  }

  private async optionalAccessToken() {
    const session = await this.getBackendSession()
    return session?.access_token?.trim() || ''
  }
}
