import { createHash } from 'node:crypto'

const MAX_TOOL_RESULT_BYTES = 1_500_000
const MAX_ARTIFACT_REFS = 64

export interface CadSubagentToolDetails {
  operation: string
  request_id: string
  relative_paths: string[]
  warnings: string[]
}

function collectArtifactPaths(
  value: unknown,
  output: Set<string>,
  depth = 0,
  budget = { remaining: 2_000 },
  pathValue = false,
): void {
  if (depth > 8 || budget.remaining <= 0 || output.size >= MAX_ARTIFACT_REFS) return
  budget.remaining -= 1
  if (typeof value === 'string') {
    if (!pathValue) return
    const normalized = value.trim().replace(/\\/gu, '/')
    if (
      normalized.startsWith('.xiaoliang/cad/')
      && normalized.length <= 4_096
      && !normalized.split('/').some((part) => part === '..')
    ) output.add(normalized)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectArtifactPaths(item, output, depth + 1, budget, pathValue)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const childIsPath = pathValue || /(?:^|_)(?:path|paths)$/u.test(key)
    collectArtifactPaths(item, output, depth + 1, budget, childIsPath)
  }
}

function safeRequestId(operation: string, toolCallId: string): string {
  const prefix = operation.replace(/[^a-z0-9._-]+/giu, '-').slice(0, 48) || 'cad-tool'
  const digest = createHash('sha256').update(toolCallId, 'utf8').digest('hex').slice(0, 20)
  return `${prefix}-${digest}`
}

function normalizeWarnings(warnings: readonly string[]): string[] {
  return [...new Set(warnings)]
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.replace(/\s+/gu, ' ').trim().slice(0, 2_000))
    .slice(0, 100)
}

export function cadToolResult(
  operation: string,
  toolCallId: string,
  data: Record<string, unknown>,
  warnings: readonly string[] = [],
) {
  const requestId = safeRequestId(operation, toolCallId)
  const safeWarnings = normalizeWarnings(warnings)
  const payload = JSON.stringify({
    ok: true,
    operation,
    request_id: requestId,
    data,
    warnings: safeWarnings,
  })
  if (Buffer.byteLength(payload, 'utf8') > MAX_TOOL_RESULT_BYTES) {
    throw new Error('CAD tool result is too large; narrow the request or split handle reads.')
  }
  const paths = new Set<string>()
  collectArtifactPaths(data, paths)
  return {
    content: [{ type: 'text' as const, text: payload }],
    details: {
      operation,
      request_id: requestId,
      relative_paths: [...paths],
      warnings: safeWarnings,
    } satisfies CadSubagentToolDetails,
  }
}
