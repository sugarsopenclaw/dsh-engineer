import { createHash } from 'node:crypto'
import path from 'node:path'

import type {
  SubagentTraceBlobRef,
  SubagentTraceJsonValue,
} from '../../../../src/shared/subagent-trace'

const MAX_TRACE_DEPTH = 8
const MAX_TRACE_NODES = 2_000
const MAX_TRACE_ARRAY_ITEMS = 200
const MAX_TRACE_OBJECT_KEYS = 200
const MAX_TRACE_STRING_BYTES = 32 * 1024
const MAX_INLINE_BASE64_CHARS = 1_024

const SECRET_KEY_PATTERN = /(?:authorization|cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|credential|private[_-]?key)/iu
const SECRET_ASSIGNMENT_PATTERN = /\b(authorization|password|passwd|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\b(\s*[:=]\s*)([^\s,;]+)/giu
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu
const DATA_URI_PATTERN = /data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/\r\n]*={0,2}/giu
const LONG_BASE64_PATTERN = /(?:data:[\w.+-]+\/[\w.+-]+;base64,)?[A-Za-z0-9+/]{1024,}={0,2}/gu
const SENSITIVE_CANARY_PATTERN = /\b(?:[A-Z0-9_]*CANARY[A-Z0-9_]*|[A-Z0-9_]*MUST_NOT_ESCAPE[A-Z0-9_]*|must[-_]?not[-_]?be[-_]?stored)\b/giu
const WINDOWS_ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>|),;]+/gu
const POSIX_ABSOLUTE_PATH_PATTERN = /(^|[\s("'`=])\/(?:Users|home|root|tmp|var|etc|opt|mnt|workspace)(?:\/[^\s\r\n\t"'`<>|),;]*)?/gmu

export interface SubagentTraceProjectionOptions {
  projectRoot: string
  storeBlob?: (
    data: Buffer,
    mimeType: string,
  ) => Promise<SubagentTraceBlobRef>
}

interface ProjectionBudget {
  nodes: number
  remainingStringBytes: number
  seen: WeakSet<object>
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function truncateTraceString(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= MAX_TRACE_STRING_BYTES) return value
  const limit = Math.max(0, Math.floor(MAX_TRACE_STRING_BYTES / 2))
  let prefix = value.slice(0, limit)
  while (Buffer.byteLength(prefix, 'utf8') > MAX_TRACE_STRING_BYTES - 160) {
    prefix = prefix.slice(0, -256)
  }
  return `${prefix}\n[truncated sha256=${sha256Text(value)} original_bytes=${Buffer.byteLength(value, 'utf8')}]`
}

function replaceProjectRoot(value: string, projectRoot: string): string {
  const normalizedRoot = path.resolve(projectRoot).replace(/\\/gu, '/')
  const normalizedValue = value.replace(/\\/gu, '/')
  if (!normalizedRoot) return normalizedValue
  const escapedRoot = normalizedRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return normalizedValue.replace(new RegExp(escapedRoot, 'giu'), () => '$PROJECT_ROOT')
}

/**
 * Produces renderer-safe text. Provider payloads never bypass this boundary.
 * Project-local paths remain useful while machine-local paths and credentials do not.
 */
export function projectSubagentTraceText(value: string, projectRoot: string): string {
  const withoutSecrets = value
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, label: string, separator: string) => (
      `${label}${separator}[REDACTED]`
    ))
    .replace(SENSITIVE_CANARY_PATTERN, '[REDACTED:canary]')
    .replace(DATA_URI_PATTERN, (match) => (
      `[omitted data-uri sha256=${sha256Text(match)} chars=${match.length}]`
    ))
    .replace(LONG_BASE64_PATTERN, (match) => (
      `[omitted base64 sha256=${sha256Text(match)} chars=${match.length}]`
    ))
  const withProjectAlias = replaceProjectRoot(withoutSecrets, projectRoot)
  const withoutWindowsPaths = withProjectAlias.replace(
    WINDOWS_ABSOLUTE_PATH_PATTERN,
    (match) => match.startsWith('$PROJECT_ROOT') ? match : '[redacted:absolute-path]',
  )
  const withoutAbsolutePaths = withoutWindowsPaths.replace(
    POSIX_ABSOLUTE_PATH_PATTERN,
    (_match, prefix: string) => `${prefix}[redacted:absolute-path]`,
  )
  return truncateTraceString(withoutAbsolutePaths)
}

function projectBudgetedString(
  value: string,
  options: SubagentTraceProjectionOptions,
  budget: ProjectionBudget,
): string {
  const projected = projectSubagentTraceText(value, options.projectRoot)
  const projectedBytes = Buffer.byteLength(projected, 'utf8')
  if (projectedBytes <= budget.remainingStringBytes) {
    budget.remainingStringBytes -= projectedBytes
    return projected
  }
  const remaining = Math.max(0, budget.remainingStringBytes)
  budget.remainingStringBytes = 0
  const prefix = projected.slice(0, Math.floor(remaining / 2))
  return `${prefix}[truncated:event-byte-budget sha256=${sha256Text(projected)}]`
}

function decodeImageData(record: Record<string, unknown>): { data: Buffer; mimeType: string } | null {
  if (record.type !== 'image' || typeof record.data !== 'string' || typeof record.mimeType !== 'string') {
    return null
  }
  const mimeType = record.mimeType.trim().toLowerCase()
  if (!/^image\/(?:png|jpeg|webp|gif)$/u.test(mimeType)) return null
  const raw = record.data.startsWith('data:')
    ? record.data.slice(record.data.indexOf(',') + 1)
    : record.data
  if (!raw || !/^[A-Za-z0-9+/\r\n]+={0,2}$/u.test(raw)) return null
  try {
    const data = Buffer.from(raw, 'base64')
    return data.length > 0 ? { data, mimeType } : null
  } catch {
    return null
  }
}

async function projectValue(
  value: unknown,
  options: SubagentTraceProjectionOptions,
  budget: ProjectionBudget,
  depth: number,
): Promise<SubagentTraceJsonValue> {
  budget.nodes += 1
  if (budget.nodes > MAX_TRACE_NODES) return '[truncated:node-budget]'
  if (depth > MAX_TRACE_DEPTH) return '[truncated:depth]'
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string') return projectBudgetedString(value, options, budget)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return null
  if (typeof value !== 'object') return `[unsupported:${typeof value}]`

  if (budget.seen.has(value)) return '[circular]'
  budget.seen.add(value)
  try {
    if (Array.isArray(value)) {
      const result = await Promise.all(value.slice(0, MAX_TRACE_ARRAY_ITEMS).map(
        (item) => projectValue(item, options, budget, depth + 1),
      ))
      if (value.length > MAX_TRACE_ARRAY_ITEMS) {
        result.push(`[truncated:${value.length - MAX_TRACE_ARRAY_ITEMS}-items]`)
      }
      return result
    }

    const record = value as Record<string, unknown>
    const image = decodeImageData(record)
    if (image && options.storeBlob) {
      return await options.storeBlob(image.data, image.mimeType) as unknown as SubagentTraceJsonValue
    }

    const result: Record<string, SubagentTraceJsonValue> = {}
    const entries = Object.entries(record).slice(0, MAX_TRACE_OBJECT_KEYS)
    for (const [rawKey, child] of entries) {
      const key = projectBudgetedString(rawKey, options, budget).slice(0, 256)
      result[key] = SECRET_KEY_PATTERN.test(rawKey)
        ? '[REDACTED]'
        : await projectValue(child, options, budget, depth + 1)
    }
    if (Object.keys(record).length > MAX_TRACE_OBJECT_KEYS) {
      result.__truncated__ = `${Object.keys(record).length - MAX_TRACE_OBJECT_KEYS} keys omitted`
    }
    return result
  } finally {
    budget.seen.delete(value)
  }
}

export async function projectSubagentTraceValue(
  value: unknown,
  options: SubagentTraceProjectionOptions,
): Promise<SubagentTraceJsonValue> {
  return projectValue(
    value,
    options,
    { nodes: 0, remainingStringBytes: 384 * 1024, seen: new WeakSet<object>() },
    0,
  )
}
