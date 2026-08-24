import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const CAD_HTTP_BRIDGE_PROTOCOL_VERSION = 1
export const DEFAULT_CAD_HTTP_TIMEOUT_MS = 120_000
export const DEFAULT_CAD_QUEUE_MS = 5_000
export const LONG_CAD_OPERATION_TIMEOUT_MS = 30 * 60 * 1000
export const LONG_CAD_HTTP_TIMEOUT_MS =
  LONG_CAD_OPERATION_TIMEOUT_MS + DEFAULT_CAD_QUEUE_MS + 30_000

const MAX_DESCRIPTOR_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024
const OPERATION_PATTERN = /^(?:app|doc|extract|capture)\.[a-z][a-z0-9_]*$/u
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u
const CHILD_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u

export interface CadHttpBridgeDescriptor {
  pid: number
  port: number
  token: string
  protocol_version: number
  project_root: string
  started_at: string
}

export interface CadHttpBridgeIdentity {
  kind: 'xiaoliang-desktop' | 'xiaoliang-cad-subagent'
  childRunId?: string
  agentRole?: 'cad-analyst'
}

export interface CadHttpBridgeExecuteResult {
  requestId: string
  data: Record<string, unknown>
  warnings: string[]
  meta: { queued_ms?: number; executed_ms?: number }
}

export interface CadHttpBridgeDeadlines {
  queue_ms?: number
  response_ms?: number
}

export interface CadHttpBridgeCallOptions {
  timeoutMs?: number
  deadlines?: CadHttpBridgeDeadlines
  identity?: CadHttpBridgeIdentity
}

export interface CadHttpBridgeClientOptions {
  descriptorPath?: string
  homeDirectory?: string
  projectRoot?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
}

export interface CadHttpBridgeExecutor {
  execute(
    operation: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    options?: CadHttpBridgeCallOptions,
  ): Promise<CadHttpBridgeExecuteResult>
}

export class CadHttpBridgeClientError extends Error {
  readonly code: string
  readonly statusCode: number | undefined
  readonly retryable: boolean
  readonly details: Record<string, unknown>

  constructor(
    code: string,
    message: string,
    options: {
      statusCode?: number
      retryable?: boolean
      details?: Record<string, unknown>
    } = {},
  ) {
    super(message)
    this.name = 'CadHttpBridgeClientError'
    this.code = code
    this.statusCode = options.statusCode
    this.retryable = options.retryable ?? false
    this.details = options.details ?? {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeRemoteText(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) return fallback
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (/data:[^;\s]+;base64,/iu.test(normalized) || /(?:[A-Za-z0-9+/]{4}){256,}/u.test(normalized)) {
    return fallback
  }
  return normalized
    .replace(/[A-Za-z]:\\[^,;)]*/gu, '[path]')
    .replace(/file:\/\/\S+/giu, '[path]')
    .replace(/authorization\s*:\s*bearer\s+\S+/giu, '[secret]')
    .replace(/(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*\S+/giu, '[secret]')
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function validateDeadline(label: string, value: number | undefined, maximum: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new CadHttpBridgeClientError('INVALID_ARGUMENT', label + ' is outside its supported range.')
  }
  return value
}

function normalizeIdentity(identity: CadHttpBridgeIdentity | undefined): Record<string, string> | undefined {
  if (!identity) return undefined
  if (identity.kind !== 'xiaoliang-desktop' && identity.kind !== 'xiaoliang-cad-subagent') {
    throw new CadHttpBridgeClientError('INVALID_ARGUMENT', 'CAD bridge client kind is invalid.')
  }
  if (identity.childRunId && !CHILD_RUN_ID_PATTERN.test(identity.childRunId)) {
    throw new CadHttpBridgeClientError('INVALID_ARGUMENT', 'CAD child run id is invalid.')
  }
  if (identity.agentRole && identity.agentRole !== 'cad-analyst') {
    throw new CadHttpBridgeClientError('INVALID_ARGUMENT', 'CAD agent role is invalid.')
  }
  return {
    kind: identity.kind,
    ...(identity.childRunId ? { child_run_id: identity.childRunId } : {}),
    ...(identity.agentRole ? { agent_role: identity.agentRole } : {}),
  }
}

export function cadHttpBridgeDescriptorPath(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, '.xiaoliang', 'cad-bridge.json')
}

export function parseCadHttpBridgeDescriptor(value: unknown): CadHttpBridgeDescriptor {
  if (!isRecord(value)) throw new Error('CAD bridge descriptor must be a JSON object.')
  const expectedKeys = ['pid', 'port', 'project_root', 'protocol_version', 'started_at', 'token']
  if (Object.keys(value).sort().join(',') !== expectedKeys.join(',')) {
    throw new Error('CAD bridge descriptor has an unexpected schema.')
  }
  if (
    !Number.isSafeInteger(value.pid)
    || (value.pid as number) <= 0
    || !Number.isSafeInteger(value.port)
    || (value.port as number) < 1
    || (value.port as number) > 65535
    || typeof value.token !== 'string'
    || value.token.length < 32
    || value.protocol_version !== CAD_HTTP_BRIDGE_PROTOCOL_VERSION
    || typeof value.project_root !== 'string'
    || !path.isAbsolute(value.project_root)
    || typeof value.started_at !== 'string'
    || !Number.isFinite(Date.parse(value.started_at))
  ) {
    throw new Error('CAD bridge descriptor is invalid.')
  }
  return {
    pid: value.pid as number,
    port: value.port as number,
    token: value.token,
    protocol_version: CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
    project_root: path.resolve(value.project_root),
    started_at: value.started_at,
  }
}

export function readCadHttpBridgeDescriptor(
  filePath = cadHttpBridgeDescriptorPath(),
): CadHttpBridgeDescriptor {
  const stat = fs.statSync(filePath)
  if (!stat.isFile() || stat.size > MAX_DESCRIPTOR_BYTES) {
    throw new Error('CAD bridge descriptor is missing or oversized.')
  }
  return parseCadHttpBridgeDescriptor(JSON.parse(fs.readFileSync(filePath, 'utf8')))
}

function errorFromPayload(payload: unknown, statusCode?: number): CadHttpBridgeClientError {
  if (isRecord(payload)) {
    const error = isRecord(payload.error) ? payload.error : payload
    const code = typeof error.code === 'string' && SAFE_ID_PATTERN.test(error.code)
      ? error.code
      : 'BRIDGE_REQUEST_FAILED'
    const message = sanitizeRemoteText(error.message, 'CAD bridge request failed.')
    return new CadHttpBridgeClientError(code, message, {
      statusCode,
      retryable: error.retryable === true,
      details: {},
    })
  }
  return new CadHttpBridgeClientError(
    'BRIDGE_REQUEST_FAILED',
    'CAD bridge returned an invalid error response.',
    { statusCode },
  )
}

async function readBoundedJsonResponse(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new CadHttpBridgeClientError(
      'BRIDGE_RESPONSE_TOO_LARGE',
      'CAD bridge response exceeds the 64 MiB limit.',
    )
  }
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new CadHttpBridgeClientError(
      'BRIDGE_RESPONSE_TOO_LARGE',
      'CAD bridge response exceeds the 64 MiB limit.',
    )
  }
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export function longCadHttpBridgeCallOptions(
  identity?: CadHttpBridgeIdentity,
): CadHttpBridgeCallOptions {
  return {
    timeoutMs: LONG_CAD_HTTP_TIMEOUT_MS,
    deadlines: {
      queue_ms: DEFAULT_CAD_QUEUE_MS,
      response_ms: LONG_CAD_OPERATION_TIMEOUT_MS,
    },
    ...(identity ? { identity } : {}),
  }
}

export class CadHttpBridgeClient implements CadHttpBridgeExecutor {
  constructor(private readonly options: CadHttpBridgeClientOptions = {}) {}

  private descriptor(): CadHttpBridgeDescriptor {
    let descriptor: CadHttpBridgeDescriptor
    try {
      descriptor = readCadHttpBridgeDescriptor(
        this.options.descriptorPath
          ?? cadHttpBridgeDescriptorPath(this.options.homeDirectory),
      )
    } catch {
      throw new CadHttpBridgeClientError(
        'BRIDGE_DESCRIPTOR_INVALID',
        'CAD bridge descriptor is missing or invalid.',
        { retryable: true },
      )
    }
    if (this.options.projectRoot && !samePath(descriptor.project_root, this.options.projectRoot)) {
      throw new CadHttpBridgeClientError(
        'BRIDGE_PROJECT_MISMATCH',
        'CAD bridge is bound to a different project.',
        { retryable: true },
      )
    }
    return descriptor
  }

  private async request(
    pathname: string,
    init: RequestInit,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<{ response: Response; payload: unknown }> {
    const descriptor = this.descriptor()
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs ?? this.options.timeoutMs ?? DEFAULT_CAD_HTTP_TIMEOUT_MS)
    const onAbort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await (this.options.fetchFn ?? fetch)(
        'http://127.0.0.1:' + descriptor.port + pathname,
        {
          ...init,
          headers: {
            ...(init.headers ?? {}),
            Authorization: 'Bearer ' + descriptor.token,
          },
          signal: controller.signal,
        },
      )
      const payload = await readBoundedJsonResponse(response)
      return { response, payload }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new CadHttpBridgeClientError(
          timedOut ? 'BRIDGE_TIMEOUT' : 'BRIDGE_ABORTED',
          timedOut ? 'CAD bridge request timed out.' : 'CAD bridge request was aborted.',
          { retryable: timedOut },
        )
      }
      if (error instanceof CadHttpBridgeClientError) throw error
      throw new CadHttpBridgeClientError(
        'BRIDGE_UNAVAILABLE',
        'CAD bridge is unavailable.',
        { retryable: true },
      )
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private assertSuccessEnvelope(
    response: Response,
    payload: unknown,
  ): asserts payload is Record<string, unknown> {
    if (
      !response.ok
      || !isRecord(payload)
      || payload.ok !== true
      || payload.protocol_version !== CAD_HTTP_BRIDGE_PROTOCOL_VERSION
    ) {
      throw errorFromPayload(payload, response.status)
    }
  }

  async status(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const { response, payload } = await this.request('/v1/status', { method: 'GET' }, signal)
    this.assertSuccessEnvelope(response, payload)
    if (!isRecord(payload.data)) throw errorFromPayload(payload, response.status)
    return payload.data
  }

  async capabilities(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const { response, payload } = await this.request('/v1/capabilities', { method: 'GET' }, signal)
    this.assertSuccessEnvelope(response, payload)
    if (!isRecord(payload.data)) throw errorFromPayload(payload, response.status)
    return payload.data
  }

  async execute(
    operation: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    options?: CadHttpBridgeCallOptions,
  ): Promise<CadHttpBridgeExecuteResult> {
    if (!OPERATION_PATTERN.test(operation)) {
      throw new CadHttpBridgeClientError('INVALID_ARGUMENT', 'CAD bridge operation is invalid.')
    }
    if (!isRecord(params)) {
      throw new CadHttpBridgeClientError('INVALID_ARGUMENT', 'CAD bridge params must be an object.')
    }
    const requestId = 'cad-' + randomUUID()
    const timeoutMs = options?.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_CAD_HTTP_TIMEOUT_MS
    const queueMs = validateDeadline(
      'CAD queue deadline',
      options?.deadlines?.queue_ms,
      60_000,
    )
    const responseMs = validateDeadline(
      'CAD response deadline',
      options?.deadlines?.response_ms,
      1_800_000,
    )
    const deadlines = options?.deadlines
      ? {
          queue_ms: queueMs ?? DEFAULT_CAD_QUEUE_MS,
          response_ms: responseMs ?? Math.min(timeoutMs, 1_800_000),
        }
      : undefined
    const identity = normalizeIdentity(options?.identity)
    const { response, payload } = await this.request(
      '/v1/execute',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol_version: CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
          request_id: requestId,
          operation,
          params,
          ...(deadlines ? { deadlines } : {}),
          ...(identity ? { client: identity } : {}),
        }),
      },
      signal,
      timeoutMs,
    )
    this.assertSuccessEnvelope(response, payload)
    if (payload.request_id !== requestId || !isRecord(payload.data)) {
      throw errorFromPayload(payload, response.status)
    }
    const warnings = Array.isArray(payload.warnings)
      ? payload.warnings
        .filter((warning): warning is string => typeof warning === 'string')
        .map((warning) => sanitizeRemoteText(warning, 'CAD bridge returned a warning.'))
        .slice(0, 100)
      : []
    const meta = isRecord(payload.meta)
      ? {
          ...(typeof payload.meta.queued_ms === 'number'
            ? { queued_ms: payload.meta.queued_ms }
            : {}),
          ...(typeof payload.meta.executed_ms === 'number'
            ? { executed_ms: payload.meta.executed_ms }
            : {}),
        }
      : {}
    return { requestId, data: payload.data, warnings, meta }
  }
}
