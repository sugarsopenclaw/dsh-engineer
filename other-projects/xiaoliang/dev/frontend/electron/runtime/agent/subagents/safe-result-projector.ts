import {
  BLENDER_MODELER_AGENT_TYPE,
  CAD_ANALYST_AGENT_TYPE,
  CAD_DRAFTER_AGENT_TYPE,
  EMPTY_SUBAGENT_USAGE,
  isEvidencePackSubagent,
  isTerminalSubagentFailureCode,
  RESEARCH_ANALYST_AGENT_TYPE,
  SUBAGENT_RETRY_REFUSED_ERROR_CODE,
  SUBAGENT_TYPES,
  type SafeSubagentToolResult,
  type SafeSubagentTaskLaunchResult,
  type SubagentRunSnapshot,
  type SubagentTerminalResult,
  type SubagentType,
  type SubagentUsage,
} from './contracts'
import {
  artifactRootForSubagentType,
  assertSafeCompletedBlenderReportText,
  CANONICAL_EVIDENCE_PACK_REF_PATTERN,
  containsSensitiveMaterial,
  normalizeProjectArtifactRef,
} from './security'

export const SAFE_DETAIL_KEYS = Object.freeze([
  'child_run_id',
  'agent_type',
  'status',
  'model',
  'usage',
  'duration_ms',
  'tool_call_count',
  'artifact_refs',
] as const)

export const SAFE_USAGE_KEYS = Object.freeze([
  'input',
  'output',
  'cache_read',
  'cache_write',
  'total',
  'cost',
] as const)

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u
const PUBLIC_MODEL = 'qwen3.8-max'
const MAX_ARTIFACT_REFS = 64
const ACTIVE_STATUSES = new Set(['queued', 'initializing', 'running'])

function nonNegativeNumber(value: unknown, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return integer ? Math.floor(value) : value
}

export function normalizeSubagentUsage(value: Partial<SubagentUsage> | undefined): SubagentUsage {
  if (!value) return { ...EMPTY_SUBAGENT_USAGE }
  return {
    input: nonNegativeNumber(value.input, true),
    output: nonNegativeNumber(value.output, true),
    cache_read: nonNegativeNumber(value.cache_read, true),
    cache_write: nonNegativeNumber(value.cache_write, true),
    total: nonNegativeNumber(value.total, true),
    cost: nonNegativeNumber(value.cost),
  }
}

function normalizeModel(value: string): typeof PUBLIC_MODEL {
  const model = value.trim()
  if (model !== PUBLIC_MODEL && !model.endsWith(`/${PUBLIC_MODEL}`)) {
    throw new Error('Subagent result contains an unexpected model identifier.')
  }
  return PUBLIC_MODEL
}

function normalizeArtifactRefs(values: readonly string[], type: SubagentType): string[] {
  if (values.length > MAX_ARTIFACT_REFS) {
    throw new Error(`Subagent result exceeds ${MAX_ARTIFACT_REFS} artifact refs.`)
  }
  const artifactRoot = artifactRootForSubagentType(type)
  const normalized = values.map((value) => {
    if (typeof value !== 'string' || value.length > 1024 || containsSensitiveMaterial(value)) {
      throw new Error('Subagent result contains an unsafe artifact ref.')
    }
    return normalizeProjectArtifactRef(value, [artifactRoot])
  })
  return [...new Set(normalized)]
}

function parentVisibleArtifactRefs(values: readonly string[], type: SubagentType): string[] {
  if (type !== RESEARCH_ANALYST_AGENT_TYPE) return [...values]
  // Raw pages are untrusted child input. Only the host-validated pack crosses back to the
  // parent; the internal run record still retains every page ref for audit and cleanup.
  return values.filter((value) => CANONICAL_EVIDENCE_PACK_REF_PATTERN.test(value))
}

const ACTIVITY_LABELS: Readonly<Record<SubagentType, string>> = Object.freeze({
  [CAD_ANALYST_AGENT_TYPE]: 'CAD evidence collection',
  [CAD_DRAFTER_AGENT_TYPE]: 'CAD evidence collection',
  [BLENDER_MODELER_AGENT_TYPE]: 'Blender execution',
  [RESEARCH_ANALYST_AGENT_TYPE]: 'Research evidence collection',
})

const LAUNCH_LABELS: Readonly<Record<SubagentType, string>> = Object.freeze({
  [CAD_ANALYST_AGENT_TYPE]: 'CAD evidence task',
  [CAD_DRAFTER_AGENT_TYPE]: 'CAD evidence task',
  [BLENDER_MODELER_AGENT_TYPE]: 'Blender task',
  [RESEARCH_ANALYST_AGENT_TYPE]: 'Research evidence task',
})

const COMPLETED_PACK_NOTICES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  cad: [
    'CAD evidence pack saved.',
    'Read this file and inspect its cited images before answering the user. The CAD child did not produce the user-facing conclusion.',
  ],
  research: [
    'Research evidence pack saved.',
    '按路径 read 这份 evidence.md 再回答。只引用「原文摘录」中的逐字内容并核对「来源与分级」的效力状态；标为「支撑级别：待核」或只有 Tier2 支撑的内容一律写成待核事项，不得升级为强条或 A 类结论。调查研究 child 不产出用户答案。',
  ],
})

function buildContent(result: SubagentTerminalResult, artifactRefs: readonly string[]): string {
  if (result.status === 'completed') {
    if (isEvidencePackSubagent(result.type)) {
      const isResearch = result.type === RESEARCH_ANALYST_AGENT_TYPE
      const artifactRoot = artifactRootForSubagentType(result.type)
      const expectedEvidenceRef = `${artifactRoot}/evidence/${result.childRunId}/evidence.md`
      const evidenceRefs = artifactRefs.filter((value) => CANONICAL_EVIDENCE_PACK_REF_PATTERN.test(value))
      if (evidenceRefs.length !== 1 || evidenceRefs[0] !== expectedEvidenceRef) {
        throw new Error('Completed subagent result must contain its canonical evidence pack ref.')
      }
      if (result.resultText !== undefined) {
        throw new Error('Completed subagent result cannot expose direct child text.')
      }
      const notice = COMPLETED_PACK_NOTICES[isResearch ? 'research' : 'cad']
      return [notice[0], `Project-relative path: ${expectedEvidenceRef}`, notice[1]].join('\n')
    }

    if (result.type !== BLENDER_MODELER_AGENT_TYPE || artifactRefs.length > 0) {
      throw new Error('Completed Blender subagent result has an invalid identity or artifact list.')
    }
    const resultText = result.resultText?.trim() || ''
    if (!resultText || Buffer.byteLength(resultText, 'utf8') > 64 * 1024) {
      throw new Error('Completed Blender subagent result contains an unsafe execution report.')
    }
    try {
      assertSafeCompletedBlenderReportText('Completed Blender subagent result', resultText)
    } catch {
      throw new Error('Completed Blender subagent result contains an unsafe execution report.')
    }
    return `Blender subagent completed and verified the scene.\n\n${resultText}`
  }

  if (result.status === 'cancelled') {
    return [
      `${ACTIVITY_LABELS[result.type]} was cancelled.`,
      ...describeSalvage(result, artifactRefs, 'was cancelled'),
    ].join('\n')
  }

  const errorCode = result.error?.code || 'INTERNAL_ERROR'
  if (!ERROR_CODE_PATTERN.test(errorCode)) throw new Error('Subagent result contains an invalid error code.')
  const salvage = describeSalvage(result, artifactRefs, 'failed')
  const terminalFailure = isTerminalSubagentFailureCode(errorCode)
  if (errorCode === SUBAGENT_RETRY_REFUSED_ERROR_CODE) {
    return [
      `${ACTIVITY_LABELS[result.type]} was not started. Error code: ${errorCode}.`,
      '同一用户任务的同类型子代理已因 MODEL_SCHEMA_INVALID 或 MODEL_UNAVAILABLE 终态失败一次，本轮不得再次启动 child。',
      '你必须立即用中文向用户说明失败；不得只说“重试中”、不得暗示仍在后台处理。没有新的 child，也没有新的 salvage 路径。',
      ...describeTerminalAlternative(result.type),
    ].join('\n')
  }
  return [
    [
      `${ACTIVITY_LABELS[result.type]} failed. Error code: ${errorCode}.`,
      ...(salvage.length === 0 ? ['No evidence pack was published.'] : []),
      ...(!terminalFailure && result.type === CAD_DRAFTER_AGENT_TYPE
        ? ['If this question still needs AutoCAD-authoritative evidence, wait for the in-flight CAD evidence task or retry it after that task finishes.']
        : []),
    ].join(' '),
    ...(terminalFailure
      ? [
          '这是本轮终态失败。你必须立即用中文向用户说明失败；不得只说“重试中”、不得暗示仍在后台处理。',
          artifactRefs.length > 0
            ? '向用户列出下方所有已落盘的 salvage 路径，并明确它们尚未通过完整主机验证。'
            : '明确告诉用户：没有已落盘的 salvage 路径可列出。',
          ...describeTerminalAlternative(result.type),
        ]
      : []),
    ...salvage,
  ].join('\n')
}

function describeTerminalAlternative(type: SubagentType): string[] {
  if (type === CAD_ANALYST_AGENT_TYPE) {
    return ['若仍需 CAD 证据，向用户建议是否改走 `delegate_cad_drafter`；本轮不得自行再次委派。']
  }
  if (type === CAD_DRAFTER_AGENT_TYPE) {
    return ['`delegate_cad_drafter` 已是替代通道；说明本轮没有可继续自动重派的 CAD 通道。']
  }
  return ['说明 `delegate_cad_drafter` 只适用于 CAD 取证，不适用于当前任务。']
}

/**
 * What survived a run that never published an evidence pack.
 *
 * The child's own last account and the files it already wrote are the difference between
 * the parent redoing the whole investigation and picking up where the child stopped. They
 * are unverified by definition, so the wording says so rather than presenting them as an
 * evidence pack.
 */
function describeSalvage(
  result: SubagentTerminalResult,
  artifactRefs: readonly string[],
  outcome: string,
): string[] {
  const partial = result.resultText?.trim() || ''
  const safePartial = partial
    && Buffer.byteLength(partial, 'utf8') <= 8 * 1024
    && !containsSensitiveMaterial(partial)
    ? partial
    : ''
  if (!safePartial && artifactRefs.length === 0) return []
  // A research run without a child account has nothing to reuse: its last write-up is
  // what the evidence gate rejected, so only the files on disk are named.
  const reuseCue = result.type === RESEARCH_ANALYST_AGENT_TYPE && !safePartial
    ? []
    : ['Decide from this whether to reuse it or delegate only the missing part.']
  return [
    ...(safePartial
      ? [
          `The child's last report before it ${outcome}, unverified by the host:`,
          safePartial,
        ]
      : []),
    ...(artifactRefs.length > 0
      ? [
          'These artifacts were already written and are usable; read them before repeating the work:',
          ...artifactRefs.map((ref) => `- ${ref}`),
        ]
      : []),
    ...reuseCue,
  ]
}

export function projectSafeSubagentResult(result: SubagentTerminalResult): SafeSubagentToolResult {
  if (!RUN_ID_PATTERN.test(result.childRunId)) throw new Error('Subagent result contains an invalid child run id.')
  if (!SUBAGENT_TYPES.includes(result.type)) {
    throw new Error('Subagent result contains an invalid agent type.')
  }
  if (result.status !== 'completed' && result.status !== 'failed' && result.status !== 'cancelled') {
    throw new Error('Subagent result is not terminal.')
  }

  const usage = normalizeSubagentUsage(result.usage)
  const normalizedArtifactRefs = normalizeArtifactRefs(result.artifactRefs, result.type)
  const artifactRefs = parentVisibleArtifactRefs(normalizedArtifactRefs, result.type)
  const model = normalizeModel(result.model)
  const durationMs = nonNegativeNumber(result.durationMs, true)
  const toolCallCount = nonNegativeNumber(result.toolCallCount, true)
  const text = buildContent(result, artifactRefs)
  const errorCode = result.status === 'failed' ? result.error?.code : undefined
  const terminal = isTerminalSubagentFailureCode(errorCode)
    || errorCode === SUBAGENT_RETRY_REFUSED_ERROR_CODE

  return {
    content: [{ type: 'text', text }],
    details: {
      child_run_id: result.childRunId,
      agent_type: result.type,
      status: result.status,
      model,
      usage,
      duration_ms: durationMs,
      tool_call_count: toolCallCount,
      artifact_refs: artifactRefs,
      ...(terminal ? { terminal: true as const } : {}),
    },
    usage: {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cache_read,
      cacheWrite: usage.cache_write,
      totalTokens: usage.total,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: usage.cost,
      },
    },
  }
}

export function projectSafeSubagentTaskLaunch(
  snapshot: SubagentRunSnapshot,
): SafeSubagentTaskLaunchResult {
  if (!RUN_ID_PATTERN.test(snapshot.childRunId)) {
    throw new Error('Subagent task contains an invalid child run id.')
  }
  if (!SUBAGENT_TYPES.includes(snapshot.type)) {
    throw new Error('Subagent task contains an invalid agent type.')
  }
  if (!ACTIVE_STATUSES.has(snapshot.status)) {
    throw new Error('Subagent task launch must project an active status.')
  }
  const queuePosition = snapshot.queuePosition === null
    ? null
    : nonNegativeNumber(snapshot.queuePosition, true)
  const label = LAUNCH_LABELS[snapshot.type]
  return {
    content: [{
      type: 'text',
      text: [
        `${label} started in the background.`,
        `Task ID: ${snapshot.childRunId}`,
        `Status: ${snapshot.status}`,
        ...(queuePosition ? [`Queue position: ${queuePosition}`] : []),
        'Use subagent_task_status to query or wait for the safe terminal result.',
      ].join('\n'),
    }],
    details: {
      task_id: snapshot.childRunId,
      agent_type: snapshot.type,
      status: snapshot.status as SafeSubagentTaskLaunchResult['details']['status'],
      queue_position: queuePosition,
    },
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }
}
