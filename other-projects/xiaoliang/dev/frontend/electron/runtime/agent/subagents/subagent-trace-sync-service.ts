import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'

import type { AuthSessionData } from '../../../../src/shared/backend-api'
import { BackendApiError, backendRequest } from '../../backend/http'
import {
  getPiPromptLinkForRun,
  getProjectSummary,
} from '../../conversations/conversation-repository'
import { getConversationPiSessionBinding } from '../pi/pi-session-store'
import type {
  StoredSubagentRun,
  StoredSubagentTraceBlob,
  SubagentRunStore,
} from './subagent-run-store'

const INITIAL_RETRY_DELAY_MS = 30_000
const MAX_RETRY_DELAY_MS = 15 * 60_000
const UPLOAD_IDLE_TIMEOUT_MS = 120_000

interface TraceUploadTarget {
  sha256: string
  upload_required: boolean
  storage_key: string
  upload_url?: string | null
  required_headers?: Record<string, string>
}

interface TracePrepareData {
  trace_archive_id: string
  child_run_id: string
  trace_sha256: string
  upload_required: boolean
  storage_key: string
  upload_url?: string | null
  required_headers?: Record<string, string>
  blob_targets: TraceUploadTarget[]
}

interface TraceConfirmData {
  status: 'ready' | 'missing' | 'mismatch' | 'failed'
  storage_key: string
  error?: string | null
  blobs: Array<{
    sha256: string
    status: 'ready' | 'missing' | 'mismatch' | 'failed'
    error?: string | null
  }>
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function uploadFileToSignedUrl(input: {
  uploadUrl: string
  requiredHeaders: Record<string, string>
  absolutePath: string
  expectedSize: number
}): Promise<void> {
  const stat = await fs.promises.stat(input.absolutePath)
  if (!stat.isFile() || stat.size !== input.expectedSize) {
    throw new Error('待归档轨迹文件大小发生变化。')
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
          else reject(new Error(`OSS 轨迹上传失败（HTTP ${status || 'unknown'}）。`))
        })
      },
    )
    request.on('error', reject)
    request.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () => {
      const error = new Error('OSS 轨迹上传长时间无网络进展。')
      stream.destroy(error)
      request.destroy(error)
    })
    stream.on('error', (error) => request.destroy(error))
    stream.pipe(request)
  })
}

export class SubagentTraceSyncService {
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly attempts = new Map<string, number>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private queueTail: Promise<void> = Promise.resolve()
  private unsubscribe: (() => void) | null = null
  private disposed = false

  constructor(
    private readonly runStore: SubagentRunStore,
    private readonly getBackendSession: () => Promise<AuthSessionData | null>,
  ) {}

  start(): void {
    if (this.unsubscribe || this.disposed) return
    this.unsubscribe = this.runStore.subscribe((event) => {
      if (event.type === 'run_finished') this.schedule(event.childRunId, 0)
    })
    void this.runStore.listMetadata().then((runs) => {
      for (const run of runs) {
        if (
          run.status !== 'running'
          && run.upload_status !== 'uploaded'
          && run.upload_status !== 'disabled'
        ) {
          this.schedule(run.child_run_id, 1_000)
        }
      }
    }).catch((error) => {
      console.warn('[subagent-trace-sync] failed to enumerate pending traces', error)
    })
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = null
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  schedule(childRunId: string, delayMs: number): void {
    if (this.disposed) return
    const existing = this.timers.get(childRunId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(childRunId)
      void this.sync(childRunId)
    }, Math.max(0, delayMs))
    timer.unref?.()
    this.timers.set(childRunId, timer)
  }

  private async sync(childRunId: string): Promise<void> {
    const existing = this.inFlight.get(childRunId)
    if (existing) return existing
    const operation = this.queueTail
      .catch(() => undefined)
      .then(() => this.syncNow(childRunId))
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error)
        await this.runStore.updateUploadState(childRunId, {
          status: 'failed',
          error: message.slice(0, 2_000),
        }).catch(() => undefined)
        // Validation failures are deterministic for the current payload. Retrying them in a
        // tight background loop only creates noise; a future app restart/upgrade may try again.
        const shouldRetry = !(error instanceof BackendApiError && error.status === 422)
        if (!this.disposed && shouldRetry) {
          const attempt = (this.attempts.get(childRunId) ?? 0) + 1
          this.attempts.set(childRunId, attempt)
          const delay = Math.min(MAX_RETRY_DELAY_MS, INITIAL_RETRY_DELAY_MS * 2 ** Math.min(5, attempt - 1))
          this.schedule(childRunId, delay)
        } else {
          this.attempts.delete(childRunId)
        }
      })
      .finally(() => {
        if (this.inFlight.get(childRunId) === operation) this.inFlight.delete(childRunId)
      })
    this.queueTail = operation.catch(() => undefined)
    this.inFlight.set(childRunId, operation)
    return operation
  }

  private async syncNow(childRunId: string): Promise<void> {
    if (this.disposed) return
    // Resolving the upload path materializes legacy gzip traces and repairs stale counters.
    const tracePath = await this.runStore.getTraceUploadPath(childRunId)
    const [metadata, blobs, session] = await Promise.all([
      this.runStore.readMetadata(childRunId),
      this.runStore.listBlobsForUpload(childRunId),
      this.getBackendSession(),
    ])
    if (metadata.status === 'running' || metadata.upload_status === 'uploaded') return
    if (!tracePath || !metadata.trace_sha256) {
      throw new Error('子代理轨迹文件尚未准备完成，暂不能上传。')
    }
    const accessToken = session?.access_token?.trim()
    if (!accessToken) throw new Error('等待登录后归档子代理轨迹。')
    const project = getProjectSummary(metadata.project_id)
    if (!project) throw new Error('轨迹所属的本地项目不存在。')
    const parentPiPrompt = getPiPromptLinkForRun(
      metadata.parent_session_id,
      metadata.client_run_id,
    )
    const parentPiSessionId = parentPiPrompt?.piSessionId
      ?? getConversationPiSessionBinding(metadata.parent_session_id)?.piSessionId
      ?? null
    await this.verifyLocalFiles(metadata, tracePath, blobs)
    await this.runStore.updateUploadState(childRunId, { status: 'uploading', error: null })

    const prepared = await backendRequest<TracePrepareData>('/subagent-traces/prepare', {
      method: 'POST',
      accessToken,
      body: {
        local_project_id: project.id,
        project_name: project.name,
        project_description: project.description,
        project_root_name: project.rootPath ? path.basename(project.rootPath) : null,
        child_run_id: metadata.child_run_id,
        parent_session_id: metadata.parent_session_id,
        parent_prompt_id: metadata.parent_prompt_id,
        parent_pi_session_id: parentPiSessionId,
        parent_pi_entry_id: parentPiPrompt?.piEntryId ?? null,
        client_run_id: metadata.client_run_id,
        agent_type: metadata.type,
        status: metadata.status,
        model: metadata.model,
        started_at: metadata.started_at,
        finished_at: metadata.finished_at,
        usage: metadata.usage,
        tool_call_count: metadata.tool_call_count,
        artifact_refs: metadata.artifact_refs,
        error_code: metadata.error_code,
        trace_schema_version: metadata.trace_schema_version,
        event_count: metadata.trace_event_count,
        trace_sha256: metadata.trace_sha256,
        trace_size_bytes: metadata.trace_size_bytes,
        training_consent: false,
        blobs: blobs.map((blob) => ({
          sha256: blob.sha256,
          size_bytes: blob.sizeBytes,
          mime_type: blob.mimeType,
        })),
      },
    })

    if (prepared.upload_required) {
      if (!prepared.upload_url) throw new Error('后端未返回轨迹上传地址。')
      await uploadFileToSignedUrl({
        uploadUrl: prepared.upload_url,
        requiredHeaders: prepared.required_headers ?? {},
        absolutePath: tracePath,
        expectedSize: metadata.trace_size_bytes,
      })
    }
    const blobBySha = new Map(blobs.map((blob) => [blob.sha256, blob]))
    for (const target of prepared.blob_targets) {
      if (!target.upload_required) continue
      const blob = blobBySha.get(target.sha256)
      if (!blob || !target.upload_url) throw new Error('后端返回了无效的截图上传目标。')
      await uploadFileToSignedUrl({
        uploadUrl: target.upload_url,
        requiredHeaders: target.required_headers ?? {},
        absolutePath: blob.absolutePath,
        expectedSize: blob.sizeBytes,
      })
    }

    const confirmed = await backendRequest<TraceConfirmData>('/subagent-traces/confirm', {
      method: 'POST',
      accessToken,
      body: {
        local_project_id: project.id,
        child_run_id: metadata.child_run_id,
        trace_sha256: metadata.trace_sha256,
        blob_sha256s: blobs.map((blob) => blob.sha256),
      },
    })
    const failedBlob = confirmed.blobs.find((blob) => blob.status !== 'ready')
    if (confirmed.status !== 'ready' || failedBlob) {
      throw new Error(confirmed.error || failedBlob?.error || '后端未确认轨迹归档。')
    }
    this.attempts.delete(childRunId)
    await this.runStore.updateUploadState(childRunId, {
      status: 'uploaded',
      remoteStorageKey: confirmed.storage_key,
      uploadedAt: new Date().toISOString(),
      error: null,
    })
  }

  private async verifyLocalFiles(
    metadata: Readonly<StoredSubagentRun>,
    tracePath: string,
    blobs: readonly StoredSubagentTraceBlob[],
  ): Promise<void> {
    const traceStat = await fs.promises.stat(tracePath)
    if (traceStat.size !== metadata.trace_size_bytes) throw new Error('本地轨迹大小校验失败。')
    if (await sha256File(tracePath) !== metadata.trace_sha256) throw new Error('本地轨迹 SHA-256 校验失败。')
    for (const blob of blobs) {
      if (await sha256File(blob.absolutePath) !== blob.sha256) {
        throw new Error(`本地截图 SHA-256 校验失败: ${blob.sha256.slice(0, 12)}`)
      }
    }
  }
}
