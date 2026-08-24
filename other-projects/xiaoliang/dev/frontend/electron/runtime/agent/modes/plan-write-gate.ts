import path from 'node:path'
import type { BeforeToolCallResult } from '@earendil-works/pi-agent-core'

/**
 * Explicit Plan-mode allowlist. Unknown tools are denied so adding a new
 * mutating tool cannot silently bypass the gate.
 */
const PLAN_ALLOWED_TOOLS = new Set([
  // Pi coding tools that cannot mutate the workspace.
  'read',
  'grep',
  'find',
  'ls',
  // Project/component inspection.
  'doc_parse',
  'component_query',
  'component_get',
  'project_document_skill_read',
  // User-skill inspection (authoring remains blocked).
  'user_skill_list',
  'user_skill_read',
  'user_skill_read_reference',
  'user_skill_read_resource',
  // Read-only network research; long web_fetch output may spill to a project artifact.
  'web_search',
  'web_fetch',
  // Plan-sanctioned evidence collection and inspection.
  'delegate_cad',
  'subagent_task_status',
  'cad_evidence_image',
  'cad_skill_read',
  'cad_algorithm_find',
  // Normally intercepted by AgentSessionManager before this gate.
  'exit_plan_mode',
])

const PATH_WRITE_TOOLS = new Set(['write', 'edit'])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function extractToolPathArgument(args: unknown): string {
  const record = asRecord(args)
  const raw = record.path ?? record.file_path ?? record.filePath
  return typeof raw === 'string' ? raw.trim() : ''
}

export function isPlanFileTarget(
  cwd: string,
  planFilePath: string,
  rawPath: string,
): boolean {
  if (!rawPath) return false
  const resolved = path.isAbsolute(rawPath)
    ? path.normalize(rawPath)
    : path.resolve(cwd, rawPath)
  return path.resolve(resolved) === path.resolve(planFilePath)
}

export function evaluatePlanWriteGate(input: {
  toolName: string
  args: unknown
  cwd: string
  planFilePath: string
}): BeforeToolCallResult | undefined {
  const toolName = input.toolName.trim()
  if (!toolName) {
    return {
      block: true,
      reason: 'Plan 模式拒绝了未命名工具；只允许调研与编辑当前对话的 plan.md。',
    }
  }

  if (PLAN_ALLOWED_TOOLS.has(toolName)) {
    return undefined
  }

  if (PATH_WRITE_TOOLS.has(toolName)) {
    const target = extractToolPathArgument(input.args)
    if (isPlanFileTarget(input.cwd, input.planFilePath, target)) {
      return undefined
    }

    return {
      block: true,
      reason: 'Plan 模式下只能写入当前对话的 plan.md。请把计划写进该文件，或先调用 exit_plan_mode 经用户批准后再改其他文件。',
    }
  }

  return {
    block: true,
    reason: `Plan 模式只允许调研与编辑计划文件，已拒绝 ${toolName}。请把方案写入 plan.md，需要开工时调用 exit_plan_mode。`,
  }
}
