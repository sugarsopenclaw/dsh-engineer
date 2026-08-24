import { Agent } from '@earendil-works/pi-agent-core'
import type {
  AgentEvent,
  AgentMessage,
  AgentState,
  AgentTool,
  BeforeToolCallResult,
} from '@earendil-works/pi-agent-core'
import {
  type Api,
  type ImageContent,
  type Model,
} from '@earendil-works/pi-ai'
import { streamSimple as legacyStreamSimple } from '@earendil-works/pi-ai/compat'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { app, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  type CadAutomationStatus,
  type CadAutomationStatusRequest,
  type CadAutomationDiagnostics,
  type CadAutomationReadiness,
  type RestartCadAutomationBridgeRequest,
  type RestartCadAutomationBridgeResult,
  type InvalidateCadAutomationArtifactRequest,
  type InvalidateCadAutomationArtifactResult,
  type AgentUiEvent,
  type AgentConversationRunSnapshot,
  type AgentClearedQueue,
  type AgentInteractionResolution,
  type AgentInteractionResponseInput,
  type AgentMessageRecord,
  type AgentPendingInteraction,
  type ComponentReviewPayload,
  type ConversationCreationSource,
  type ConversationPiSessionExportFormat,
  type ConversationPiSessionInfo,
  type ConversationPiSessionStats,
  type PiRuntimeResourceStatus,
  type ConversationAgentMode,
  type ConversationSummary,
  type PlanDocumentSnapshot,
  type ConversationTreeBranchResult,
  type ConversationTreeNavigateInput,
  type ConversationTreeNavigateResult,
  type ConversationTreeSnapshot,
  type ImageAttachmentInput,
  type ProjectArtifactWriteResult,
  type SubagentRunUpdate,
  type WorkspaceSearchRequest,
  INTERACTION_PLAN_ABANDON_ACTION,
  INTERACTION_PLAN_APPROVE_ACTION,
  INTERACTION_REVIEW_CONFIRM_ACTION,
  INTERACTION_REVIEW_REVISE_ACTION,
  INTERACTION_REVIEW_SKIP_ACTION,
} from '../../../../src/shared/local-agent'
import type {
  AuthSessionData,
  WebFetchRequest,
  WebGroundedData,
  WebSearchRequest,
} from '../../../../src/shared/backend-api'
import type {
  SubagentTraceBlobData,
  SubagentTraceEvent,
  SubagentTracePage,
  SubagentTraceRunSummary,
} from '../../../../src/shared/subagent-trace'
import {
  parseSubagentCompletionDeliveryDetails,
  parseSubagentCompletionPrompt,
  SUBAGENT_COMPLETION_CUSTOM_TYPE,
} from '../../../../src/shared/subagent-completion'
import type { ScreenshotManager } from '../../../shell/screenshot-manager'
import {
  createDrawing,
  createOrOpenProjectFromDirectory,
  createProject,
  createConversation,
  createConversationBranch,
  createConversationInProject,
  createConversationInDrawing,
  deleteDrawing,
  deleteProject,
  deleteConversation as deleteConversationState,
  getConversationPreferredModelId,
  getConversationThinkingMode,
  getProjectSummary,
  getConversationSnapshot,
  getConversationSummary,
  getDisplayMessageRecords,
  clearPiConversationProjection,
  listDrawings,
  listDrawingConversations,
  listProjectConversations,
  listProjects,
  listConversations,
  searchWorkspace,
  persistConversationState,
  renameConversation as renameConversationState,
  renameConversationIfFirstMessageMatches,
  resetConversation as resetConversationState,
  setConversationPinned as setConversationPinnedState,
  setConversationPreferredModel as persistConversationPreferredModel,
  setConversationThinkingMode as persistConversationThinkingMode,
  updateProjectRootDirectory,
  updateConversationContextUsage,
} from '../../conversations/conversation-repository'
import {
  buildManagedPiModel,
  ensureManagedModelCatalog,
  getManagedLlmFingerprint,
  getManagedPiSessionIdentity,
} from '../../llm/managed-model-factory'
import { agentUsageApiClient } from '../../backend/agent-usage-client'
import { agentConversationTitleApiClient } from '../../backend/agent-conversation-title-client'
import { BackendApiError } from '../../backend/http'
import { toQuotaExceededError } from '../../billing/quota-errors'
import {
  buildManagedGatewayCredential,
  AUX_REASONING_EFFORT,
  reasoningEffortForThinkingMode,
  MANAGED_MODEL_ALIASES,
  normalizeThinkingMode,
  piThinkingLevelForMode,
  type ThinkingMode,
} from '../../../../src/shared/billing-domain'
import {
  assertKnownModel,
  getResolvedLlmConfig,
  resolveLlmConfigInput,
  type ResolvedLlmConfig,
} from '../../settings/settings-repository'
import {
  createDesktopCadHttpRuntime,
  type CadHttpRuntimeLease,
  type CadHttpRuntimeDiagnosis,
  type ProjectScopedCadHttpRuntime,
} from '../../cad/drivers/autocad-http/cad-http-runtime'
import {
  listCadArtifactSetRecords,
  reconcileCadArtifactSetReferences,
} from '../../cad/artifacts/cad-artifact-set-repository'
import { deleteCadDrawingLocalArtifacts } from '../../cad/storage/cad-drawing-store'
import {
  assembleContextLayers,
  collectContextProviderLayers,
  type ContextProvider,
  CONTEXT_SNAPSHOT_PREFACE,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  renderContextLayers,
} from '../context/context-assembler'
import { buildProjectFilesProvider } from '../context/providers/project-files-provider'
import { buildAgentWorkspaceProvider } from '../context/providers/agent-workspace-provider'
import {
  buildCadSessionProvider,
  formatCadSessionDelegateContext,
  type CadSessionSnapshot,
} from '../context/providers/cad-session-provider'
import { serializeAgentEvent } from '../events/serialize-agent-event'
import {
  getToolConfirmationRequest,
  guardToolExecution,
  serializeToolApprovalPayload,
  type ToolApprovalContext,
} from '../policy/approval-gates'
import { InteractionCoordinator } from '../interactions/interaction-coordinator'
import { createSqlitePersistentInteractionStore } from '../interactions/pending-interaction-store'
import { resolveInteractionModeForConversation } from './interaction-mode'
import {
  ensurePlanDocument,
  isPlanWriteRestricted,
  nextReminderKind,
  readPlanDocument,
  resolvePlanDocumentPath,
  type PlanModeState,
} from '../modes/plan-mode'
import {
  foldAllPlanModesOnRestart,
  listAwaitingPlanApprovalConversationIds,
  loadPlanModeState,
  markAwaitingPlanApproval,
  markPlanAbandoned,
  markPlanApproved,
  markPlanPromptStart,
  markPlanRevised,
  markPlanTurnEnd,
  setConversationAgentMode as persistConversationAgentMode,
} from '../modes/plan-mode-store'
import { evaluatePlanWriteGate } from '../modes/plan-write-gate'
import { buildPlanReminder } from '../modes/plan-reminders'
import { EXIT_PLAN_MODE_TOOL_NAME } from '../tools/domain/plan'
import {
  createExtractionPrompt,
  maybeBuildComponentReview,
  selectReviewedComponentIds,
} from '../review/component-review-service'
import {
  collectTurnAssistantText,
  findGenuineTurnStartIndex,
  getGenuineUserText,
  getGenuineUserTextWindow,
  hasReadArtifact,
} from '../review/turn-window'
import {
  recordInteractionRequested,
  recordInteractionResolved,
} from '../interactions/interaction-audit-repository'
import { buildSystemPrompt } from '../prompts/system/builder'
import { buildRuntimeReminder } from '../prompts/reminders/runtime-reminder-builder'
import { formatComputerRegionFallback } from '../prompts/system/prompt-context'
import { buildAvailableAlgorithmsContext } from '../algorithms/store'
import { getSkillRegistry } from '../skills/registry'
import { getBundledCadSkillsRoot, getManagedSkillsRoot } from '../skills/paths'
import { getBundledProjectDocumentSkillsRoot } from '../document-skills/registry'
import { createAgentTools, listAgentToolNames } from '../tools'
import { buildWebSearchRequest } from '../tools/domain/web'
import { resolvePiBashRuntime } from '../pi/pi-bash-runtime'
import { buildCadEvidenceTools } from '../tools/domain/cad-evidence'
import {
  invalidateCadArtifactSet,
  listArtifactInventories,
  resolveProjectFile,
} from '../tools/domain/cad-subagent/artifact-store'
import {
  CAD_ANALYST_AGENT_TYPE,
  createSubagentRuntime,
  createSqliteSubagentRunMetadataIndex,
  getCadSubagentCanaryProjectIds,
  getCadSubagentDeveloperToolsEnabled,
  getCadSubagentMode,
  hasPendingRestartedSubagentTaskNotices,
  isCadEvidenceSubagent,
  isCadSubagentEnabled,
  isMainWebFetchEnabled,
  isSubagentInteractiveEnabled,
  REGISTERED_SUBAGENT_TYPES,
  type SubagentRuntime,
  type SubagentRunSnapshot,
} from '../subagents'
import { SubagentTraceSyncService } from '../subagents/subagent-trace-sync-service'
import type { SubagentTaskDeliveryContext } from '../tasks/background/subagent-task-service'
import { detectComponent } from '../tools/domain/cad/probe/cad-task-probe-core'
import { ProjectFileService } from '../../project-files/project-file-service'
import { ProjectArtifactService } from '../../project-files/project-artifact-service'
import { ProjectComponentService } from '../../project-files/project-component-service'
import { ProjectContextService } from '../../project-files/project-context-service'
import { ProjectArchiveSyncService } from '../../project-sync/project-archive-sync-service'
import { UserSkillArchiveSyncService } from '../../project-sync/user-skill-archive-sync-service'
import { userSkillService } from '../user-skills/service'
import { AgentWorkspaceService } from '../workspace/agent-workspace-service'
import {
  contextUsageFingerprint,
  updateContextUsageFromMessages,
  updateContextUsageEstimate,
  clearContextUsage,
  restoreContextUsage,
} from '../context/context-tracker'
import {
  findLastAssistantMessageForRun,
  stampAgentMessageRun,
} from './message-run-linkage'
import {
  assertAgentConversationCapacity,
} from './agent-concurrency'
import {
  toAgentRunSource,
  type AgentPromptCreationSource,
} from './agent-run-source'
import { isPiFeatureEnabled } from '../pi/feature-flags'
import { ensurePiToolBinaries } from '../pi/pi-tool-binaries'
import { resolveXiaoliangPiControlledResources } from '../pi/controlled-resources'
import type {
  XiaoliangPiAgentHost,
  XiaoliangPiAgentHostEvent,
  XiaoliangQueuedItem,
  XiaoliangPiToolCall,
} from '../pi/xiaoliang-pi-agent-host'
import {
  appendPiActivePathMarker,
  appendConversationPiThinkingLevel,
  buildConversationPiTreeSnapshot,
  commitConversationPiSession,
  createConversationPiBranch,
  createReplacementConversationPiSession,
  deleteManagedConversationPiSessionFile,
  exportPiSessionToJsonl,
  getConversationPiSessionBinding,
  importConversationPiSession,
  listConversationPiSessionBindings,
  prepareConversationPiSession,
  rebuildConversationPiProjection,
  summarizePiSession,
  type ConversationPiSessionBinding,
  type PreparedConversationPiSession,
} from '../pi/pi-session-store'

interface SessionRecord {
  agent: Agent
  fingerprint: string
  fingerprintsByThinkingMode: Record<ThinkingMode, string>
  thinkingModeRef: { current: ThinkingMode }
  tools: AgentTool<any>[]
  pendingThinkingMode?: ThinkingMode
  unsubscribe?: () => void
  piHost?: XiaoliangPiAgentHost
  piGeneration?: number
  piLastSequence?: number
}

export interface ManagedCallSettlement {
  clientRunId: string
  /** 反向解析不到（如 run 已结束后的迟到记录）时为 null。 */
  conversationId: string | null
}

interface AgentSessionManagerDeps {
  screenshotManager: ScreenshotManager
  getBackendSession: () => Promise<AuthSessionData | null>
  emitSubagentTrace: (event: SubagentTraceEvent) => void
  /** Fires whenever a managed model call settles (per-call billing hook). */
  onManagedCallSettled?: (settlement: ManagedCallSettlement) => void
  /** Fires after a usage run's finishRun completes (usage is final on the backend). */
  onManagedRunFinished?: (conversationId: string, clientRunId: string) => void
  onSubagentWakeSettled?: (settlement: AgentSubagentWakeSettlement) => void
}

interface ActivePromptSettlement {
  promise: Promise<void>
  resolve: () => void
}

const FALLBACK_BACKEND_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://127.0.0.1:8000'
  : 'https://xl.x3yun.com/api'
const WEB_SEARCH_TIMEOUT_MS = 2 * 60 * 1000
const WEB_FETCH_TIMEOUT_MS = 4 * 60 * 1000
/** Runs while the billed turn is still open, so it must not stall settlement. */
const COMPONENT_REVIEW_EXTRACTION_TIMEOUT_MS = 30_000

function resolveComputerEnvironmentContext() {
  const dateTimeOptions = new Intl.DateTimeFormat().resolvedOptions()
  let systemLocale = dateTimeOptions.locale?.trim() || ''
  let computerRegionCode = ''

  try {
    if (app.isReady()) {
      systemLocale = app.getSystemLocale().trim() || app.getLocale().trim() || systemLocale
      computerRegionCode = app.getLocaleCountryCode().trim().toUpperCase()
    }
  } catch {
    // Fall through to the runtime locale when native OS locale APIs are unavailable.
  }

  if (!computerRegionCode && systemLocale) {
    try {
      computerRegionCode = new Intl.Locale(systemLocale).region?.toUpperCase() || ''
    } catch {
      // Keep region unknown; callers will use the explicit non-geographic fallback.
    }
  }

  return {
    computerRegionCode,
    systemLocale,
    timeZone: dateTimeOptions.timeZone?.trim() || '',
  }
}

function resolveSubagentDefinitionsDir(): string {
  const candidates = [
    path.resolve(__dirname, 'runtime', 'agent', 'subagents', 'definitions'),
    path.resolve(process.cwd(), 'electron', 'runtime', 'agent', 'subagents', 'definitions'),
    path.resolve(process.cwd(), 'dev', 'frontend', 'electron', 'runtime', 'agent', 'subagents', 'definitions'),
  ]
  const match = candidates.find((candidate) => (
    REGISTERED_SUBAGENT_TYPES.every((type) => fs.existsSync(path.join(candidate, `${type}.md`)))
  ))
  if (!match) {
    throw new Error('Bundled subagent definitions are missing.')
  }
  return fs.realpathSync(match)
}

function isCadArtifactPath(value: string): boolean {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '')
  return normalized === '.xiaoliang/cad' || normalized.startsWith('.xiaoliang/cad/')
}

function isCanonicalCadEvidenceMarkdownPath(value: string): boolean {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '')
  return /^\.xiaoliang\/cad\/evidence\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/evidence\.md$/u.test(normalized)
}

function normalizeCadArtifactPath(value: string): string {
  return value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '')
}

function extractCadEvidenceImagePaths(markdown: string): string[] {
  const paths = new Set<string>()
  for (const match of markdown.matchAll(/\.xiaoliang[\\/]cad[\\/][^\s`"'<>()[\]]+?\.(?:png|jpe?g|webp)/giu)) {
    paths.add(normalizeCadArtifactPath(match[0]))
  }
  return [...paths]
}


const COMPONENT_WORKFLOW_INTENT_PATTERN =
  /算量|工程量|体积|方量|立方|混凝土量|钢筋量|模板量|重量|算法|calculator|当前选中|选中构件|这个构件怎么算|怎么计算|算一下|帮我算|确认算法|保存算法|可以保存/i
const COMPONENT_SAVE_OPT_OUT_PATTERN = /不要(?:保存|入库)|不(?:保存|入库)|无需(?:保存|入库)|禁止(?:保存|入库)/i
const USER_CONFIRM_POSITIVE_PATTERNS = [
  /^(确认|确认了|确认无误|确认正确|可以保存|保存吧|保存|没问题|正确|对的|通过|可用)[。.!！\s]*$/i,
  /^确认[，,\s]*(可以保存|保存吧|没问题|正确|通过|无误|可用)[。.!！\s]*$/i,
  /(算法|体积|结果).{0,10}(正确|没问题|准确|通过|可以|对的?)/i,
  /确认.{0,8}(算法|体积|结果).{0,8}(正确|可用|通过|没问题)/i,
  /(这个|该).{0,6}(算法|结果|体积).{0,6}(可用|可以|对的?|没问题)/i,
]
const USER_CONFIRM_NEGATIVE_PATTERN = /不对|错误|不正确|有问题|不通过|需修改|需要修改|重新算|重算|先别保存|不要保存/i


function normalizeChatCompletionContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .flatMap((item) => {
      if (typeof item === 'string') {
        const text = item.trim()
        return text ? [text] : []
      }
      if (!item || typeof item !== 'object') {
        return []
      }
      const record = item as { text?: unknown }
      const text = typeof record.text === 'string' ? record.text.trim() : ''
      return text ? [text] : []
    })
    .join('\n')
    .trim()
}


const ABORT_SOFT_ERROR = /request was aborted|this operation was aborted|the operation was aborted/iu

// 墨迹/边缘像素占比阈值：低于此值视为"空白绘图区/无图纸内容"。
function isAbortLikeError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') {
    return true
  }
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error ?? '')
  return ABORT_SOFT_ERROR.test(message)
}

function isCompactionCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Compaction cancelled'
}

/**
 * pi-ai 在 context.tools 为 [] 时仍会走 `if (context.tools)`（空数组为 truthy），把 `tools: []` 放进请求体。
 * 通义 / DashScope 兼容接口会报 400：`[] is too short - 'tools'`，应直接省略 tools 字段。
 * 一旦 tools 注册表里出现真实工具，此处不会对非空 `tools` 动手。
 */
function omitEmptyToolsForQwenStack(payload: unknown, model: Model<Api>): unknown | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const p = payload as Record<string, unknown>
  if (!Array.isArray(p.tools) || p.tools.length > 0) return undefined

  const baseUrl = model.baseUrl ?? ''
  const isQwenStack =
    model.provider === 'qwen' ||
    // Managed gateway ultimately proxies DashScope/Qwen; empty tools:[] is rejected upstream.
    model.provider === 'xiaoliang-backend' ||
    baseUrl.includes('dashscope') ||
    baseUrl.includes('aliyuncs.com') ||
    baseUrl.includes('/agent/v1')

  if (!isQwenStack) return undefined

  const next = { ...p }
  delete next.tools
  delete next.tool_choice
  delete next.tool_stream
  return next
}

function patchManagedThinkingPayload(
  payload: unknown,
  model: Model<Api>,
  thinkingMode: ThinkingMode,
): unknown | undefined {
  const sanitized = omitEmptyToolsForQwenStack(payload, model)
  const base = sanitized ?? payload
  if (!base || typeof base !== 'object') {
    return sanitized
  }

  const params = base as Record<string, unknown>
  let next: Record<string, unknown> | undefined

  function ensureNext() {
    next ??= { ...params }
    return next
  }

  function setField(key: string, value: unknown) {
    if (params[key] !== value) {
      ensureNext()[key] = value
    }
  }

  function deleteField(key: string) {
    if (key in params) {
      const draft = ensureNext()
      delete draft[key]
    }
  }

  // qwen3.8-max: always think; 极速=low / 深度=xhigh. Never pair with thinking_budget.
  setField('enable_thinking', true)
  setField('reasoning_effort', reasoningEffortForThinkingMode(thinkingMode))
  deleteField('thinking_budget')
  // Server default for qwen3.8-max is preserve_thinking=true; do not override.
  deleteField('preserve_thinking')
  return next ?? sanitized
}


function fallbackConversationTitle(firstUserMessage: string, hasImages: boolean): string {
  const normalized = firstUserMessage.replace(/\s+/gu, ' ').trim()
  return normalized ? normalized.slice(0, 24) : hasImages ? '图片对话' : '新对话'
}

function emptyAgentQueue(): AgentClearedQueue {
  return { steering: [], followUp: [] }
}

function emptyPiSessionStats(): ConversationPiSessionStats {
  return {
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
    cost: 0,
  }
}

function createRequestedStopError(): Error {
  const error = new Error('Agent run was stopped before generation started.')
  error.name = 'AbortError'
  return error
}

/**
 * What a single prompt run produced. Headless channels need the answer this
 * run authored, not whatever assistant message happens to be last in the
 * transcript, otherwise a turn that produced nothing replays an old reply.
 */
export interface AgentPromptRunResult {
  clientRunId: string
  status: 'completed' | 'stopped' | 'failed'
  finalAnswer: string | null
  errorText: string | null
}

export interface AgentSubagentWakeSettlement extends AgentPromptRunResult {
  conversationId: string
  subagentTaskId: string
}

interface AgentPromptOptions {
  interactionMode?: 'a2ui' | 'unavailable'
  creationSource?: AgentPromptCreationSource
  subagentTaskId?: string
  subagentDeliveryContext?: SubagentTaskDeliveryContext
  /** Internal: transition out of Plan only after launch preflight succeeds. */
  approvedPlan?: boolean
  /** Internal lifecycle hook used by host-authored wake delivery. */
  onSettled?: (result: AgentPromptRunResult) => void
}

function notifyPromptSettled(
  callback: AgentPromptOptions['onSettled'],
  result: AgentPromptRunResult,
): void {
  if (!callback) return
  try {
    callback(result)
  } catch (error) {
    console.warn(
      '[agent] prompt settlement observer failed',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export class AgentSessionManager {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly interactionCoordinator: InteractionCoordinator
  private readonly activeInteractionModes = new Map<string, 'a2ui' | 'unavailable'>()
  private readonly structuredAlgorithmApprovalCounts = new Map<string, number>()
  private readonly planApprovalNotes = new Map<string, string>()
  private readonly livePlanApprovalConversations = new Set<string>()
  private readonly requestedStops = new Set<string>()
  private readonly cadPreExtractInFlight = new Map<string, Promise<void>>()
  private readonly cadArtifactReconcileInFlight = new Map<string, Promise<void>>()
  private readonly cadArtifactReconciledAt = new Map<string, number>()
  private readonly cadHttpRuntime: ProjectScopedCadHttpRuntime
  private readonly agentWorkspaceProvider: ContextProvider
  private readonly projectFilesProvider: ContextProvider
  private readonly cadSessionProvider: ContextProvider
  private readonly cadSessionSnapshots = new Map<string, CadSessionSnapshot>()
  private readonly agentWorkspaceService = new AgentWorkspaceService()
  private readonly projectFileService: ProjectFileService
  private readonly projectArtifactService: ProjectArtifactService
  private readonly projectComponentService: ProjectComponentService
  private readonly projectContextService: ProjectContextService
  private readonly projectArchiveSyncService: ProjectArchiveSyncService
  private readonly userSkillArchiveSyncService: UserSkillArchiveSyncService
  private readonly unsubscribeUserSkillArchive: () => void
  private readonly getBackendSession: () => Promise<AuthSessionData | null>
  private readonly emitSubagentTrace: (event: SubagentTraceEvent) => void
  private readonly onManagedCallSettled?: (settlement: ManagedCallSettlement) => void
  private readonly onManagedRunFinished?: (conversationId: string, clientRunId: string) => void
  private readonly onSubagentWakeSettled?: (settlement: AgentSubagentWakeSettlement) => void
  private readonly backendBaseUrl: string
  private readonly cadSubagentMode = getCadSubagentMode()
  private readonly cadSubagentCanaryProjectIds = getCadSubagentCanaryProjectIds()
  private readonly cadSubagentDeveloperToolsEnabled = getCadSubagentDeveloperToolsEnabled()
  private readonly subagentInteractiveEnabled = isSubagentInteractiveEnabled()
  private readonly mainWebFetchEnabled = isMainWebFetchEnabled()
  private subagentRuntimePromise: Promise<SubagentRuntime> | null = null
  private subagentEventUnsubscribe: (() => void) | null = null
  private subagentTraceUnsubscribe: (() => void) | null = null
  private subagentTraceSyncService: SubagentTraceSyncService | null = null
  private activeCadAnalystParents = new Set<string>()
  private readonly allowedCadEvidenceImages = new Map<string, Set<string>>()
  /** conversationId -> evidence.md read that is still unlocking its images */
  private readonly cadEvidenceAllowlistFills = new Map<string, Promise<void>>()
  private readonly restoredCadEvidenceScopes = new Map<string, string>()
  private readonly pendingSubagentUsageCompletions = new Set<string>()
  /** conversationId -> client_run_id while a charged sendPrompt is in flight */
  private readonly activeClientRunIds = new Map<string, string>()
  /** client_run_id -> conversationId until all background usage has settled */
  private readonly managedRunConversationIds = new Map<string, string>()

  private findConversationIdForClientRun(clientRunId: string): string | null {
    return this.managedRunConversationIds.get(clientRunId) ?? null
  }

  private registerManagedRun(conversationId: string, clientRunId: string): void {
    this.activeClientRunIds.set(conversationId, clientRunId)
    this.managedRunConversationIds.set(clientRunId, conversationId)
  }

  private clearActiveManagedRun(conversationId: string, clientRunId: string): void {
    if (this.activeClientRunIds.get(conversationId) === clientRunId) {
      this.activeClientRunIds.delete(conversationId)
    }
  }

  private releaseManagedRun(clientRunId: string): void {
    this.managedRunConversationIds.delete(clientRunId)
  }

  private notifyManagedRunFinished(conversationId: string, clientRunId: string): void {
    try {
      this.onManagedRunFinished?.(conversationId, clientRunId)
    } catch {
      // 用量刷新是尽力而为的观察者，不能影响 run 收尾。
    }
  }
  /** Includes prompt startup before the backend has assigned the charged run. */
  private readonly activePromptConversations = new Set<string>()
  private readonly activePromptSettlements = new Map<string, ActivePromptSettlement>()
  /** Freezes the mode from prompt admission through the complete Pi run. */
  private readonly activePromptThinkingModes = new Map<string, ThinkingMode>()
  /** Covers mode changes made before a Pi host has finished being constructed. */
  private readonly pendingThinkingModes = new Map<string, ThinkingMode>()
  private readonly conversationTitleJobs = new Map<string, AbortController>()
  private readonly retiringSessions = new Map<string, Promise<void>>()
  private readonly piSessionGenerations = new Map<string, number>()
  private readonly piRuntimeV2Enabled: boolean
  private readonly piSessionJsonlEnabled: boolean
  private readonly piBranchingEnabled: boolean
  private readonly piExtensionsEnabled: boolean
  private readonly piCodingToolsEnabled: boolean
  private readonly detachedQueueItems = new Map<string, XiaoliangQueuedItem[]>()
  private shuttingDown = false
  private shutdownPromise: Promise<void> | null = null

  constructor(
    private readonly emit: (event: AgentUiEvent) => void,
    deps: AgentSessionManagerDeps,
  ) {
    this.getBackendSession = deps.getBackendSession
    this.emitSubagentTrace = deps.emitSubagentTrace
    this.onManagedCallSettled = deps.onManagedCallSettled
    this.onManagedRunFinished = deps.onManagedRunFinished
    this.onSubagentWakeSettled = deps.onSubagentWakeSettled
    this.backendBaseUrl = getBackendBaseUrl()
    this.piRuntimeV2Enabled = isPiFeatureEnabled('pi_runtime_v2')
    this.piSessionJsonlEnabled = this.piRuntimeV2Enabled
      && isPiFeatureEnabled('pi_session_jsonl')
    this.piBranchingEnabled = this.piSessionJsonlEnabled
      && isPiFeatureEnabled('pi_branching')
    this.piExtensionsEnabled = this.piRuntimeV2Enabled
      && isPiFeatureEnabled('pi_extensions')
    this.piCodingToolsEnabled = this.piRuntimeV2Enabled
      && isPiFeatureEnabled('pi_coding_tools')
    this.interactionCoordinator = new InteractionCoordinator(this.emit, undefined, {
      recordRequested: recordInteractionRequested,
      recordResolved: recordInteractionResolved,
    }, createSqlitePersistentInteractionStore())
    try {
      foldAllPlanModesOnRestart()
      this.interactionCoordinator.restorePersistentInteractions()
    } catch (error) {
      console.warn(
        '[agent] failed to restore plan/review state',
        error instanceof Error ? error.message : String(error),
      )
    }
    void this.restoreAwaitingPlanApprovals()
    this.projectArchiveSyncService = new ProjectArchiveSyncService(this.getBackendSession)
    this.userSkillArchiveSyncService = new UserSkillArchiveSyncService(this.getBackendSession)
    this.unsubscribeUserSkillArchive = userSkillService.onChange(() => {
      this.userSkillArchiveSyncService.scheduleSync()
    })
    this.projectFileService = new ProjectFileService((input) => (
      this.projectArchiveSyncService.readCloudDocument(input)
    ))
    this.projectArtifactService = new ProjectArtifactService()
    this.projectComponentService = new ProjectComponentService()
    this.projectContextService = new ProjectContextService(
      this.projectFileService,
      this.projectArtifactService,
    )
    this.cadHttpRuntime = createDesktopCadHttpRuntime()
    this.agentWorkspaceProvider = buildAgentWorkspaceProvider(this.agentWorkspaceService)
    this.projectFilesProvider = buildProjectFilesProvider(this.projectContextService)
    this.cadSessionProvider = buildCadSessionProvider(
      (conversationId) => this.cadSessionSnapshots.get(conversationId) ?? null,
    )
    void this.ensureAgentWorkspaceReady()
    if (this.piCodingToolsEnabled) {
      void ensurePiToolBinaries()
    }
    this.projectArchiveSyncService.scheduleInitialSync()
    this.userSkillArchiveSyncService.scheduleInitialSync()
  }

  private beginActivePrompt(conversationId: string): ActivePromptSettlement {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((settled) => {
      resolve = settled
    })
    const activity = { promise, resolve }
    this.activePromptThinkingModes.set(
      conversationId,
      this.sessions.get(conversationId)?.thinkingModeRef.current
        ?? getConversationThinkingMode(conversationId),
    )
    this.activePromptConversations.add(conversationId)
    this.activePromptSettlements.set(conversationId, activity)
    return activity
  }

  private finishActivePrompt(
    conversationId: string,
    activity: ActivePromptSettlement,
  ) {
    // `agent_settled` is the normal commit point. This also covers startup failures,
    // manual compaction and abort paths that settle without a Pi agent event.
    this.applyPendingThinkingMode(conversationId)
    this.activePromptThinkingModes.delete(conversationId)
    this.activePromptConversations.delete(conversationId)
    if (this.activePromptSettlements.get(conversationId) === activity) {
      this.activePromptSettlements.delete(conversationId)
    }
    activity.resolve()
    const runtimePromise = this.subagentRuntimePromise
    if (runtimePromise) {
      void runtimePromise
        .then((runtime) => runtime.taskService?.flushPendingDeliveries())
        .catch(() => undefined)
    }
  }

  async getRunningConversations(): Promise<AgentConversationRunSnapshot[]> {
    const grouped = new Map<string, AgentConversationRunSnapshot>()
    for (const conversationId of this.activePromptConversations) {
      grouped.set(conversationId, {
        conversationId,
        status: 'running',
        promptRunning: true,
        supportsQueueing: Boolean(this.sessions.get(conversationId)?.piHost),
        subagentRuns: [],
      })
    }

    const runtimePromise = this.subagentRuntimePromise
    if (runtimePromise) {
      try {
        const runtime = await runtimePromise
        for (const snapshot of runtime.coordinator.listSnapshots()) {
          if (
            snapshot.status === 'completed'
            || snapshot.status === 'failed'
            || snapshot.status === 'cancelled'
          ) continue
          const current = grouped.get(snapshot.parentSessionId) ?? {
            conversationId: snapshot.parentSessionId,
            status: 'queued' as const,
            promptRunning: false,
            supportsQueueing: Boolean(this.sessions.get(snapshot.parentSessionId)?.piHost),
            subagentRuns: [],
          }
          current.subagentRuns.push(this.toSubagentRunUpdate(snapshot))
          if (snapshot.status === 'initializing' || snapshot.status === 'running') {
            current.status = 'running'
          }
          grouped.set(snapshot.parentSessionId, current)
        }
      } catch {
        // A shutting-down child runtime must not make the recovery snapshot fail.
      }
    }

    return [...grouped.values()]
      .map((snapshot) => ({
        ...snapshot,
        subagentRuns: snapshot.subagentRuns
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      }))
      .sort((left, right) => left.conversationId.localeCompare(right.conversationId))
  }

  private async guardToolExecution(
    conversationId: string,
    context: ToolApprovalContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    const staticGate = await guardToolExecution(context)
    if (staticGate) return staticGate

    const planGate = await this.guardPlanModeTool(conversationId, context, signal)
    if (planGate) return planGate

    const request = getToolConfirmationRequest(context)
    if (!request) return undefined
    if (this.activeInteractionModes.get(conversationId) !== 'a2ui') {
      return {
        block: true,
        reason: '该操作需要在桌面端通过确认卡批准；当前消息通道不支持交互确认，已拒绝执行。',
      }
    }

    const payloadHash = createHash('sha256')
      .update(serializeToolApprovalPayload(context), 'utf8')
      .digest('hex')
    const result = await this.interactionCoordinator.waitForConfirmation({
      conversationId,
      toolCallId: context.toolCall.id,
      toolName: context.toolCall.name,
      payloadHash,
      request,
      signal,
    })
    if (!result.approved) {
      return { block: true, reason: result.reason }
    }

    if (context.toolCall.name === 'cad_algorithm_save') {
      const current = this.structuredAlgorithmApprovalCounts.get(conversationId) ?? 0
      this.structuredAlgorithmApprovalCounts.set(conversationId, current + 1)
    }
    return undefined
  }

  getPendingInteraction(conversationId: string): AgentPendingInteraction | null {
    return this.interactionCoordinator.getPendingInteraction(conversationId)
  }

  async resolveInteraction(input: AgentInteractionResponseInput): Promise<AgentInteractionResolution> {
    const pending = this.interactionCoordinator.getPendingInteraction(input.conversationId)
    const resolution = this.interactionCoordinator.resolveInteraction(input)
    const resolvedInteraction = pending?.id === resolution.interactionId ? pending : null
    // The interaction itself is settled synchronously. Follow-up work (starting
    // an approved plan or a review revision) has its own lifecycle and must not
    // make IPC pretend the already-closed card is still submitting.
    void this.afterPersistentResolution(resolution, resolvedInteraction).catch((error) => {
      void this.handlePersistentFollowUpFailure(resolution, error)
    })
    return resolution
  }

  setConversationMode(conversationId: string, mode: ConversationAgentMode) {
    const summary = getConversationSummary(conversationId)
    if (!summary) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    const state = persistConversationAgentMode(conversationId, mode)
    this.emitConversationMode(conversationId, state)
    const session = this.sessions.get(conversationId)
    if (session) {
      this.updateSystemPrompt(session, {
        conversationId,
        conversationTitle: summary.title,
        imageCount: 0,
      })
    }
    this.emit({ type: 'conversation_updated', conversationId })
  }

  async getPlanDocument(conversationId: string): Promise<PlanDocumentSnapshot> {
    const summary = getConversationSummary(conversationId)
    if (!summary) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    const planFilePath = this.resolvePlanFilePath(conversationId)
    const content = await readPlanDocument(planFilePath)
    return {
      path: planFilePath,
      content,
      exists: fs.existsSync(planFilePath),
    }
  }

  async openPlanApproval(conversationId: string) {
    const summary = getConversationSummary(conversationId)
    if (!summary) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    const existing = this.interactionCoordinator.getPendingInteraction(conversationId)
    if (existing?.kind === 'plan_approval') {
      return existing
    }
    if (existing) {
      throw new Error('当前会话已有待处理的构件复核或确认，请先处理后再查看计划。')
    }
    const planFilePath = this.resolvePlanFilePath(conversationId)
    const planContent = await readPlanDocument(planFilePath)
    markAwaitingPlanApproval(conversationId, true)
    return this.interactionCoordinator.parkPersistentInteraction({
      conversationId,
      kind: 'plan_approval',
      title: '查看并审批计划',
      description: planContent.trim()
        ? '核对计划后选择批准开工、打回修改或放弃。'
        : '计划文件还是空的。可以打回让助手继续写，或放弃本次计划。',
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      payload: {
        planContent,
        planFilePath,
        openedManually: true,
      },
    })
  }

  private resolvePlanFilePath(conversationId: string): string {
    const summary = getConversationSummary(conversationId)
    const cwd = summary
      ? this.resolveConversationWorkingDirectory(summary)
      : app.getPath('userData')
    return resolvePlanDocumentPath(cwd, conversationId)
  }

  private emitConversationMode(conversationId: string, state: PlanModeState) {
    this.emit({
      type: 'conversation_mode',
      conversationId,
      mode: state.preferredMode,
      phase: state.phase,
      awaitingPlanApproval: state.awaitingPlanApproval,
    })
  }

  private async guardPlanModeTool(
    conversationId: string,
    context: ToolApprovalContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    const state = loadPlanModeState(conversationId)
    if (context.toolCall.name === EXIT_PLAN_MODE_TOOL_NAME) {
      if (state.phase !== 'active') {
        return { block: true, reason: '当前不在 Plan 模式，无法提交计划审批。' }
      }
      return this.interceptExitPlanMode(conversationId, context, signal)
    }
    if (!isPlanWriteRestricted(state)) {
      return undefined
    }
    const summary = getConversationSummary(conversationId)
    const cwd = summary
      ? this.resolveConversationWorkingDirectory(summary)
      : app.getPath('userData')
    return evaluatePlanWriteGate({
      toolName: context.toolCall.name,
      args: context.args,
      cwd,
      planFilePath: resolvePlanDocumentPath(cwd, conversationId),
    })
  }

  private async interceptExitPlanMode(
    conversationId: string,
    context: ToolApprovalContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    // A headless channel can never render the approval card, and the persistent
    // decision has no timeout, so waiting here would hang the run forever and
    // block every later message on that route. Refuse before claiming state.
    if (this.activeInteractionModes.get(conversationId) !== 'a2ui') {
      return {
        block: true,
        reason: '计划审批卡只能在桌面端确认；当前消息通道不支持交互确认。请把计划要点直接回复给用户，由用户在桌面端批准后再开工。',
      }
    }

    const planFilePath = this.resolvePlanFilePath(conversationId)
    const planContent = await readPlanDocument(planFilePath)
    markAwaitingPlanApproval(conversationId, true)
    this.livePlanApprovalConversations.add(conversationId)
    try {
      const decision = await this.interactionCoordinator.waitForPersistentDecision({
        conversationId,
        kind: 'plan_approval',
        title: '审批计划并开工',
        description: planContent.trim()
          ? '核对计划后选择批准开工、打回修改或放弃。'
          : '计划文件还是空的。批准会被拒绝，请打回让助手补全，或放弃。',
        toolCallId: context.toolCall.id,
        toolName: context.toolCall.name,
        payload: {
          planContent,
          planFilePath,
          restored: false,
        },
        signal,
      })
      return await this.concludeLivePlanApproval(
        conversationId,
        decision.actionId,
        decision.status,
        decision.data,
      )
    } finally {
      this.livePlanApprovalConversations.delete(conversationId)
    }
  }

  private async concludeLivePlanApproval(
    conversationId: string,
    actionId: string,
    status: AgentInteractionResolution['status'],
    data?: Record<string, unknown>,
  ): Promise<BeforeToolCallResult | undefined> {
    const feedback = typeof data?.feedback === 'string' ? data.feedback.trim() : ''

    if (status === 'aborted' || actionId.startsWith('system.')) {
      const next = markAwaitingPlanApproval(conversationId, false)
      this.emitConversationMode(conversationId, next)
      return { block: true, reason: '计划审批已随本轮停止，未批准开工。' }
    }

    if (actionId === INTERACTION_PLAN_APPROVE_ACTION) {
      const planContent = await readPlanDocument(this.resolvePlanFilePath(conversationId))
      if (!planContent.trim()) {
        const revised = markPlanRevised(conversationId)
        this.emitConversationMode(conversationId, revised)
        return { block: true, reason: '计划文件为空，已按打回处理。请先把计划写入 plan.md。' }
      }
      if (feedback) {
        this.planApprovalNotes.set(conversationId, feedback)
      }
      const next = markPlanApproved(conversationId)
      this.emitConversationMode(conversationId, next)
      this.refreshLiveSystemPrompt(conversationId)
      return undefined
    }

    if (actionId === INTERACTION_PLAN_ABANDON_ACTION) {
      this.planApprovalNotes.delete(conversationId)
      const next = markPlanAbandoned(conversationId)
      this.emitConversationMode(conversationId, next)
      this.refreshLiveSystemPrompt(conversationId)
      return { block: true, reason: '用户已放弃本次计划，未开工。' }
    }

    const next = markPlanRevised(conversationId)
    this.emitConversationMode(conversationId, next)
    const reason = feedback
      ? `用户打回了计划，请按反馈修订 plan.md 后再次调用 exit_plan_mode。\n反馈：${feedback}`
      : '用户打回了计划。请修订 plan.md 后再次调用 exit_plan_mode。未知或异常响应已按打回处理。'
    return { block: true, reason }
  }

  private refreshLiveSystemPrompt(conversationId: string) {
    const session = this.sessions.get(conversationId)
    const summary = getConversationSummary(conversationId)
    if (!session || !summary) return
    this.updateSystemPrompt(session, {
      conversationId,
      conversationTitle: summary.title,
      imageCount: 0,
    })
  }

  private async afterPersistentResolution(
    resolution: AgentInteractionResolution,
    interaction: AgentPendingInteraction | null,
  ) {
    if (resolution.status === 'aborted') return
    if (
      resolution.kind === 'plan_approval'
      && this.livePlanApprovalConversations.has(resolution.conversationId)
    ) {
      return
    }
    if (resolution.kind === 'plan_approval') {
      await this.handleRestoredOrManualPlanDecision(resolution)
      return
    }
    if (resolution.kind === 'component_review') {
      await this.handleComponentReviewDecision(resolution, interaction)
    }
  }

  private async handlePersistentFollowUpFailure(
    resolution: AgentInteractionResolution,
    error: unknown,
  ) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      // If the approved implementation prompt failed before it was actually
      // invoked (login, quota, capacity, session creation), Plan is still
      // active. Restore a fresh card instead of losing the approval workflow.
      if (
        resolution.kind === 'plan_approval'
        && loadPlanModeState(resolution.conversationId).phase === 'active'
        && !this.interactionCoordinator.getPendingInteraction(resolution.conversationId)
      ) {
        const conversationId = resolution.conversationId
        const waiting = markAwaitingPlanApproval(conversationId, true)
        this.emitConversationMode(conversationId, waiting)
        this.refreshLiveSystemPrompt(conversationId)
        const planFilePath = this.resolvePlanFilePath(conversationId)
        const planContent = await readPlanDocument(planFilePath)
        this.interactionCoordinator.parkPersistentInteraction({
          conversationId,
          kind: 'plan_approval',
          title: '审批计划并开工',
          description: `刚才未能启动执行回合：${message}。计划仍未批准退出，请处理问题后重试。`,
          toolName: EXIT_PLAN_MODE_TOOL_NAME,
          payload: {
            planContent,
            planFilePath,
            restored: true,
          },
        })
      }
    } catch (recoveryError) {
      console.warn(
        '[agent] failed to restore persistent interaction after follow-up error',
        recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
      )
    }
    this.emit({ type: 'error', conversationId: resolution.conversationId, error: message })
  }

  private async handleRestoredOrManualPlanDecision(resolution: AgentInteractionResolution) {
    const conversationId = resolution.conversationId
    const feedback = typeof resolution.data?.feedback === 'string'
      ? resolution.data.feedback.trim()
      : ''
    if (resolution.actionId === INTERACTION_PLAN_APPROVE_ACTION) {
      const planContent = await readPlanDocument(this.resolvePlanFilePath(conversationId))
      if (!planContent.trim()) {
        const next = markPlanRevised(conversationId)
        this.emitConversationMode(conversationId, next)
        return
      }
      const prompt = feedback
        ? `用户已批准计划，并补充：${feedback}\n请按 plan 文件实施。`
        : '用户已批准计划，请按 plan 文件实施。'
      await this.sendPrompt(conversationId, prompt, [], {
        interactionMode: resolveInteractionModeForConversation(
          getConversationSummary(conversationId)?.creationSource,
        ),
        approvedPlan: true,
      })
      return
    }
    if (resolution.actionId === INTERACTION_PLAN_ABANDON_ACTION) {
      const next = markPlanAbandoned(conversationId)
      this.emitConversationMode(conversationId, next)
      this.refreshLiveSystemPrompt(conversationId)
      return
    }
    const next = markPlanRevised(conversationId)
    this.emitConversationMode(conversationId, next)
  }

  private async handleComponentReviewDecision(
    resolution: AgentInteractionResolution,
    interaction: AgentPendingInteraction | null,
  ) {
    const conversationId = resolution.conversationId
    const responseData = resolution.data
    const feedback = typeof responseData?.feedback === 'string'
      ? responseData.feedback.trim()
      : ''
    const rawPayload = interaction?.kind === 'component_review' ? interaction.payload : null
    const payload = rawPayload
      && 'items' in rawPayload
      && Array.isArray(rawPayload.items)
      ? rawPayload as ComponentReviewPayload
      : null
    const projectId = getConversationSummary(conversationId)?.projectId?.trim() || ''
    if (payload && projectId && payload.projectId !== projectId) {
      throw new Error('构件复核所属项目已变化，未执行任何入库操作。')
    }
    const selected = payload
      ? selectReviewedComponentIds(responseData?.selectedComponentIds, payload)
      : []

    if (resolution.actionId === INTERACTION_REVIEW_CONFIRM_ACTION) {
      if (!payload || !projectId) {
        throw new Error('构件复核载荷已失效，未执行任何入库操作。')
      }
      if (selected.length === 0) return
      await this.projectComponentService.confirmComponents(projectId, selected)
      this.emit({ type: 'conversation_updated', conversationId })
      return
    }
    if (
      resolution.actionId === INTERACTION_REVIEW_SKIP_ACTION
      && payload?.source === 'extracted'
      && projectId
    ) {
      await Promise.all(payload.items.map(async (item) => {
        try {
          const record = await this.projectComponentService.getComponent(projectId, item.componentId)
          if (record.status === 'draft') {
            await this.projectComponentService.deleteComponent(projectId, item.componentId)
          }
        } catch (cleanupError) {
          console.warn(
            '[agent] failed to remove skipped extracted component draft',
            item.componentId,
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          )
        }
      }))
      this.emit({ type: 'conversation_updated', conversationId })
      return
    }
    if (resolution.actionId === INTERACTION_REVIEW_REVISE_ACTION && feedback) {
      await this.sendPrompt(conversationId, `用户打回构件复核，请按以下反馈修改后重新整理：\n${feedback}`, [], {
        interactionMode: resolveInteractionModeForConversation(
          getConversationSummary(conversationId)?.creationSource,
        ),
      })
    }
  }

  private async restoreAwaitingPlanApprovals() {
    try {
      for (const conversationId of listAwaitingPlanApprovalConversationIds()) {
        const existing = this.interactionCoordinator.getPendingInteraction(conversationId)
        if (existing?.kind === 'plan_approval') continue
        const planFilePath = this.resolvePlanFilePath(conversationId)
        const planContent = await readPlanDocument(planFilePath)
        if (!planContent.trim()) continue
        this.interactionCoordinator.parkPersistentInteraction({
          conversationId,
          kind: 'plan_approval',
          title: '审批计划并开工',
          description: '应用重启后恢复的计划审批。批准后将按 plan 文件开新的执行回合。',
          toolName: EXIT_PLAN_MODE_TOOL_NAME,
          payload: {
            planContent,
            planFilePath,
            restored: true,
          },
        })
      }
    } catch (error) {
      console.warn(
        '[agent] failed to restore awaiting plan approvals',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private async maybeStartComponentReview(input: {
    conversationId: string
    projectId: string
    messages: unknown
    userText: string
    assistantText: string
    clientRunId: string
    turnStartedAt: string
    interactionMode: 'a2ui' | 'unavailable'
  }) {
    if (!input.projectId) return
    const state = loadPlanModeState(input.conversationId)
    if (state.phase !== 'inactive' || state.preferredMode === 'plan') return
    if (input.interactionMode !== 'a2ui') return

    const payload = await maybeBuildComponentReview({
      projectId: input.projectId,
      messages: input.messages,
      userText: input.userText,
      assistantText: input.assistantText,
      clientRunId: input.clientRunId,
      turnStartedAt: input.turnStartedAt,
      deps: {
        listComponents: (projectId, filter) => (
          this.projectComponentService.listComponents(projectId, filter)
        ),
        getComponent: (projectId, componentId) => (
          this.projectComponentService.getComponent(projectId, componentId)
        ),
        saveDrafts: (projectId, components) => (
          this.projectComponentService.saveComponents(
            projectId,
            components.map((component) => ({
              ...component,
              provenance: {
                ...component.provenance,
                created_by: component.provenance?.created_by ?? 'agent',
                run_id: input.clientRunId,
              },
            })),
            'draft',
          )
        ),
        extractComponents: async (userText, assistantText) => {
          const prompt = createExtractionPrompt(userText, assistantText)
          const accessToken = (await this.getBackendSession())?.access_token?.trim() || ''
          if (!accessToken) return '{"components":[]}'
          return this.callMainModelChat({
            settings: this.resolveConversationLlmConfig(input.conversationId),
            // The gateway rejects calls that are not bound to a live run, so the
            // credential carries the turn that is still open at this point.
            apiKey: buildManagedGatewayCredential(accessToken, input.clientRunId),
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            signal: createTimeoutSignal(COMPONENT_REVIEW_EXTRACTION_TIMEOUT_MS),
          })
        },
      },
    })
    if (!payload) return
    this.interactionCoordinator.parkPersistentInteraction({
      conversationId: input.conversationId,
      kind: 'component_review',
      title: '复核本轮构件',
      description: '确认后由运行时直接入库，不必再让模型调用 component_save。',
      toolName: 'component_review',
      payload,
    })
  }

  private isCadSubagentEnabledForProject(projectId?: string | null): boolean {
    return isCadSubagentEnabled({
      mode: this.cadSubagentMode,
      projectId,
      canaryProjectIds: this.cadSubagentCanaryProjectIds,
    })
  }

  private async refreshCadSessionSnapshot(
    conversationId: string,
    projectRoot: string,
  ): Promise<CadSessionSnapshot> {
    let lease: CadHttpRuntimeLease | null = null
    let snapshot: CadSessionSnapshot
    try {
      lease = await this.cadHttpRuntime.acquire(projectRoot, { kind: 'xiaoliang-desktop' })
      const status = await lease.facade.status()
      const active = status.documents.find((document) => document.active) ?? null
      snapshot = {
        state: !status.running
          ? 'not_running'
          : !status.supported
            ? 'unsupported'
            : active
              ? 'ready'
              : 'no_document',
        activeDocument: active
          ? {
              name: active.name.replace(/[\r\n\t]+/gu, ' ').trim().slice(0, 512) || '未知',
              projectRelativePath: active.project_relative_path
                ?.replace(/[\r\n\t]+/gu, ' ')
                .trim()
                .slice(0, 4_096) || null,
            }
          : null,
        documentCount: status.document_count,
        updatedAt: new Date().toISOString(),
      }
    } catch {
      snapshot = {
        state: 'unavailable',
        activeDocument: null,
        documentCount: 0,
        updatedAt: new Date().toISOString(),
      }
    } finally {
      await lease?.release().catch(() => undefined)
    }
    this.cadSessionSnapshots.set(conversationId, snapshot)
    return snapshot
  }

  private toCadAutomationReadiness(
    diagnosis: CadHttpRuntimeDiagnosis,
  ): CadAutomationReadiness {
    const toDocument = (document: CadHttpRuntimeDiagnosis['autocad']['documents'][number]) => ({
      index: document.index,
      name: document.name,
      projectRelativePath: document.project_relative_path,
      active: document.active,
      saved: document.saved,
      dbmod: document.dbmod,
    })
    const documents = diagnosis.autocad.documents.map(toDocument)
    const activeDocument = diagnosis.plot.activeDocument
      ? toDocument(diagnosis.plot.activeDocument)
      : null
    let state: CadAutomationReadiness['state'] = 'error'
    if (!diagnosis.bridge.reachable) state = 'bridge_unavailable'
    else if (diagnosis.autocad.state === 'busy' || diagnosis.plot.state === 'busy') state = 'busy'
    else if (diagnosis.autocad.state === 'unsupported') state = 'autocad_unsupported'
    else if (diagnosis.autocad.state === 'not_installed') state = 'autocad_not_installed'
    else if (diagnosis.autocad.state === 'com_unregistered') state = 'autocad_com_unregistered'
    else if (diagnosis.autocad.state === 'not_running') state = 'autocad_not_running'
    else if (diagnosis.autocad.state === 'no_document') state = 'no_document'
    else if (diagnosis.plot.ready) state = 'ready'
    else if (diagnosis.plot.state === 'no_document') state = 'no_document'
    else if (diagnosis.plot.state === 'drawing_outside_project') state = 'drawing_outside_project'
    else if (diagnosis.plot.state === 'operation_unavailable') state = 'operation_unavailable'
    else if (diagnosis.plot.state === 'environment_unavailable') state = 'environment_unavailable'
    return {
      ready: diagnosis.bridge.reachable && diagnosis.plot.ready,
      state,
      bridge: {
        state: diagnosis.bridge.state,
        reachable: diagnosis.bridge.reachable,
        adopted: diagnosis.bridge.adopted,
        activeLeases: diagnosis.bridge.activeLeases,
        consecutiveHealthFailures: diagnosis.bridge.consecutiveHealthFailures,
        restartCount: diagnosis.bridge.restartCount,
        lastHealthAt: diagnosis.bridge.lastHealthAt,
        lastHealthyAt: diagnosis.bridge.lastHealthyAt,
        lastError: diagnosis.bridge.lastError,
      },
      autocad: {
        state: diagnosis.autocad.state,
        fullInstalled: diagnosis.autocad.fullInstalled,
        ltInstalled: diagnosis.autocad.ltInstalled,
        comRegistered: diagnosis.autocad.comRegistered,
        running: diagnosis.autocad.running,
        supported: diagnosis.autocad.supported,
        visible: diagnosis.autocad.visible,
        version: diagnosis.autocad.version,
        documentCount: diagnosis.autocad.documentCount,
        documents,
        errorCode: diagnosis.autocad.errorCode,
        message: diagnosis.autocad.message,
      },
      plot: {
        state: diagnosis.plot.state,
        ready: diagnosis.plot.ready,
        operationAvailable: diagnosis.plot.operationAvailable,
        activeDocument,
        dependencies: diagnosis.plot.dependencies,
        configurations: diagnosis.plot.configurations,
        warnings: diagnosis.plot.warnings,
        message: diagnosis.plot.message,
      },
      updatedAt: diagnosis.updatedAt,
    }
  }

  private toSubagentRunUpdate(snapshot: SubagentRunSnapshot): SubagentRunUpdate {
    return {
      childRunId: snapshot.childRunId,
      type: snapshot.type,
      description: snapshot.description,
      status: snapshot.status,
      createdAt: snapshot.createdAt,
      startedAt: snapshot.startedAt,
      finishedAt: snapshot.finishedAt,
      durationMs: snapshot.durationMs,
      queuePosition: snapshot.queuePosition,
      progress: { ...snapshot.progress },
      errorCode: snapshot.errorCode,
    }
  }

  private emitSubagentSnapshot(
    snapshot: SubagentRunSnapshot,
    allSnapshots: readonly SubagentRunSnapshot[] = [snapshot],
  ): void {
    this.refreshActiveCadAnalystParents(allSnapshots)
    if (isCadEvidenceSubagent(snapshot.type) && snapshot.status === 'completed') {
      const project = getProjectSummary(snapshot.projectId)
      const projectRoot = project?.rootPathExists ? project.rootPath?.trim() || '' : ''
      if (projectRoot) {
        // 证据包发布即解锁其中引用的图片。evidence.md 由主 Agent 用 Pi read 读取,
        // 不再经过 project_read executor,因此填充点前移到子代理完成时。
        this.scheduleCadEvidenceAllowlistFill(
          snapshot.parentSessionId,
          projectRoot,
          `.xiaoliang/cad/evidence/${snapshot.childRunId}/evidence.md`,
        )
        void this.reconcileCadArtifactReferences({
          projectId: snapshot.projectId,
          projectRoot,
          force: true,
        }).catch((error) => {
          console.warn(
            '[cad-subagent] post-run artifact reconcile failed',
            error instanceof Error ? error.message : String(error),
          )
        })
      }
    }
    this.emit({
      type: 'subagent_run',
      conversationId: snapshot.parentSessionId,
      update: this.toSubagentRunUpdate(snapshot),
      updates: allSnapshots
        .filter((candidate) => candidate.parentSessionId === snapshot.parentSessionId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((candidate) => this.toSubagentRunUpdate(candidate)),
    })
  }

  private refreshActiveCadAnalystParents(snapshots: readonly SubagentRunSnapshot[]): void {
    const next = new Set<string>()
    for (const candidate of snapshots) {
      if (candidate.type !== 'cad-analyst') continue
      if (candidate.status === 'completed' || candidate.status === 'failed' || candidate.status === 'cancelled') {
        continue
      }
      next.add(candidate.parentSessionId)
    }
    this.activeCadAnalystParents = next
  }

  /**
   * Publishes one display-ready row immediately after its authoritative projection lands.
   * The final transcript reload still reconciles the whole branch when the prompt settles;
   * this event only closes the mid-turn visibility gap for user rows and host notices.
   */
  private emitPersistedTranscriptMessage(
    conversationId: string,
    matches: (message: AgentMessageRecord) => boolean,
  ): void {
    const message = getDisplayMessageRecords(conversationId)
      .filter(matches)
      .at(-1)
    if (!message) return
    this.emit({ type: 'transcript_message', conversationId, message })
  }

  /**
   * The completion that unlocks these images is injected into the parent turn, so the model
   * can call cad_evidence_image before the file read finishes. Publishing the in-flight fill
   * lets the tool wait for it instead of reporting the image as uncited.
   */
  private scheduleCadEvidenceAllowlistFill(
    conversationId: string,
    projectRoot: string,
    evidenceRelativePath: string,
  ): void {
    const pending = this.cadEvidenceAllowlistFills.get(conversationId) ?? Promise.resolve()
    const fill = pending.then(() => this.allowCadEvidenceImagesFromEvidenceFile(
      conversationId,
      projectRoot,
      evidenceRelativePath,
    ))
    this.cadEvidenceAllowlistFills.set(conversationId, fill)
    void fill.finally(() => {
      if (this.cadEvidenceAllowlistFills.get(conversationId) === fill) {
        this.cadEvidenceAllowlistFills.delete(conversationId)
      }
    })
  }

  /** 读取一份 canonical evidence.md,把其中引用的图片加入 cad_evidence_image 白名单。 */
  private async allowCadEvidenceImagesFromEvidenceFile(
    conversationId: string,
    projectRoot: string,
    evidenceRelativePath: string,
  ): Promise<void> {
    try {
      const normalized = normalizeCadArtifactPath(evidenceRelativePath)
      if (!isCanonicalCadEvidenceMarkdownPath(normalized)) return
      const resolved = resolveProjectFile(projectRoot, normalized)
      const markdown = await fs.promises.readFile(resolved.absolutePath, 'utf8')
      const allowedImages = this.allowedCadEvidenceImages.get(conversationId) ?? new Set<string>()
      for (const imagePath of extractCadEvidenceImagePaths(markdown)) {
        allowedImages.add(imagePath)
      }
      this.allowedCadEvidenceImages.set(conversationId, allowedImages)
    } catch {
      // Missing evidence keeps its referenced images blocked for cad_evidence_image.
    }
  }

  private async restoreCadEvidenceAllowances(input: {
    runtime: SubagentRuntime
    conversationId: string
    projectId: string
    projectRoot: string
  }): Promise<void> {
    const scope = `${input.projectId}\0${path.resolve(input.projectRoot)}`
    if (this.restoredCadEvidenceScopes.get(input.conversationId) === scope) return
    this.allowedCadEvidenceImages.delete(input.conversationId)
    const metadata = await input.runtime.runStore.listMetadata()
    for (const run of metadata) {
      if (
        run.status !== 'completed'
        || run.parent_session_id !== input.conversationId
        || run.project_id !== input.projectId
      ) continue
      for (const artifactRef of run.artifact_refs) {
        const normalized = normalizeCadArtifactPath(artifactRef)
        if (!isCanonicalCadEvidenceMarkdownPath(normalized)) continue
        await this.allowCadEvidenceImagesFromEvidenceFile(
          input.conversationId,
          input.projectRoot,
          normalized,
        )
      }
    }
    this.restoredCadEvidenceScopes.set(input.conversationId, scope)
  }

  private async reconcileCadArtifactReferences(input: {
    projectId: string
    projectRoot: string
    force?: boolean
    signal?: AbortSignal
  }): Promise<void> {
    const key = `${input.projectId}\0${path.resolve(input.projectRoot)}`
    const existing = this.cadArtifactReconcileInFlight.get(key)
    if (existing) {
      await existing
      if (!input.force) return
    }
    if (!input.force && Date.now() - (this.cadArtifactReconciledAt.get(key) ?? 0) < 30_000) return
    const operation = (async () => {
      const listed = await listArtifactInventories(input.projectRoot, input.signal)
      reconcileCadArtifactSetReferences({
        projectId: input.projectId,
        inventories: listed.inventories,
        truncated: listed.truncated,
        verifiedAt: new Date().toISOString(),
      })
      this.cadArtifactReconciledAt.set(key, Date.now())
    })()
    this.cadArtifactReconcileInFlight.set(key, operation)
    try {
      await operation
    } finally {
      if (this.cadArtifactReconcileInFlight.get(key) === operation) {
        this.cadArtifactReconcileInFlight.delete(key)
      }
    }
  }

  private async getSubagentRuntime(): Promise<SubagentRuntime> {
    if (!this.subagentRuntimePromise) {
      const creating = createSubagentRuntime({
        definitionsDir: resolveSubagentDefinitionsDir(),
        runStoreRoot: path.join(app.getPath('userData'), 'subagent-runs'),
        runMetadataIndex: createSqliteSubagentRunMetadataIndex(),
        mode: this.cadSubagentMode,
        canaryProjectIds: this.cadSubagentCanaryProjectIds,
        backgroundTaskDelivery: {
          parentExists: (conversationId) => Boolean(getConversationSummary(conversationId)),
          // A prompt in flight rejects a second sendPrompt even before the model streams,
          // so an accepted prompt must count as busy or the wake path races it and fails.
          isParentBusy: (conversationId) => (
            this.activePromptConversations.has(conversationId)
            || this.sessions.get(conversationId)?.piHost?.isRunning === true
          ),
          hasSeenEvidence: (conversationId, artifactRefs) => hasReadArtifact(
            this.sessions.get(conversationId)?.piHost?.agent.state.messages,
            artifactRefs,
          ),
          followUp: async (conversationId, message, context) => {
            const host = this.sessions.get(conversationId)?.piHost
            if (!host || !this.activePromptConversations.has(conversationId)) {
              throw new Error('Parent conversation is no longer running.')
            }
            await host.followUpSystemMessage({
              id: `${SUBAGENT_COMPLETION_CUSTOM_TYPE}:${context.taskId}`,
              customType: SUBAGENT_COMPLETION_CUSTOM_TYPE,
              content: message,
              details: context,
            })
          },
          wake: async (conversationId, message, context) => {
            const parent = getConversationSummary(conversationId)
            let settled = false
            try {
              await this.sendPrompt(conversationId, message, [], {
                interactionMode: resolveInteractionModeForConversation(parent?.creationSource),
                creationSource: 'subagent_completion',
                subagentTaskId: context.taskId,
                subagentDeliveryContext: context,
                onSettled: (result) => {
                  settled = true
                  this.onSubagentWakeSettled?.({
                    conversationId,
                    subagentTaskId: context.taskId,
                    ...result,
                  })
                },
              })
            } catch (error) {
              // Failures before a run is claimed remain pending; settled failures
              // have already been surfaced to the parent and its outbound channel.
              if (!settled) throw error
            }
          },
        },
        cadHttpRuntime: this.cadHttpRuntime,
        resolveApiKey: async (request) => buildManagedGatewayCredential(
          await this.resolveManagedAccessToken(),
          request.clientRunId,
        ),
        ...(this.onManagedCallSettled
          ? {
            onUsageRecorded: (clientRunId: string) => {
              this.onManagedCallSettled?.({
                clientRunId,
                conversationId: this.findConversationIdForClientRun(clientRunId),
              })
            },
          }
          : {}),
      }).then((runtime) => {
        this.subagentEventUnsubscribe = runtime.delegateService.subscribe((snapshot) => {
          this.emitSubagentSnapshot(snapshot, runtime.coordinator.listSnapshots())
        })
        this.subagentTraceUnsubscribe = runtime.runStore.subscribe((event) => {
          this.emitSubagentTrace(event)
        })
        this.subagentTraceSyncService = new SubagentTraceSyncService(
          runtime.runStore,
          this.getBackendSession,
        )
        this.subagentTraceSyncService.start()
        return runtime
      })
      this.subagentRuntimePromise = creating.catch((error) => {
        this.subagentRuntimePromise = null
        throw error
      })
    }
    return this.subagentRuntimePromise
  }

  async listSubagentRuns(conversationId: string): Promise<SubagentTraceRunSummary[]> {
    const normalizedConversationId = conversationId.trim()
    if (!normalizedConversationId) return []
    return (await this.getSubagentRuntime()).runStore.listSummaries(normalizedConversationId)
  }

  async getSubagentTrace(
    childRunId: string,
    afterSequence = 0,
    limit = 200,
  ): Promise<SubagentTracePage> {
    return (await this.getSubagentRuntime()).runStore.readTrace(childRunId, afterSequence, limit)
  }

  async getSubagentTraceBlob(childRunId: string, sha256: string): Promise<SubagentTraceBlobData> {
    return (await this.getSubagentRuntime()).runStore.readBlob(childRunId, sha256)
  }

  private async cancelSubagentRuns(
    conversationId: string,
    parentPromptId?: string,
  ): Promise<number> {
    const runtimePromise = this.subagentRuntimePromise
    if (!runtimePromise) return 0
    try {
      const runtime = await runtimePromise
      return runtime.delegateService.cancelByParent(conversationId, parentPromptId)
    } catch (error) {
      console.warn('[subagent] cancel failed', error instanceof Error ? error.message : String(error))
      return 0
    }
  }

  /** Explicit "stop everything" action: cancels this conversation's background children. */
  async cancelConversationSubagents(conversationId: string): Promise<number> {
    const normalizedConversationId = conversationId.trim()
    if (!normalizedConversationId) return 0
    return this.cancelSubagentRuns(normalizedConversationId)
  }

  private completeSubagentUsageRunWhenChildrenSettle(
    runtime: SubagentRuntime,
    clientRunId: string,
    onSettled?: () => Promise<void> | void,
  ): boolean {
    if (this.pendingSubagentUsageCompletions.has(clientRunId)) return true
    this.pendingSubagentUsageCompletions.add(clientRunId)

    const hasActiveChildren = () => runtime.coordinator.listSnapshots().some((snapshot) => (
      snapshot.clientRunId === clientRunId
      && snapshot.status !== 'completed'
      && snapshot.status !== 'failed'
      && snapshot.status !== 'cancelled'
    ))
    let unsubscribe: (() => void) | null = null
    const initiallyActive = hasActiveChildren()
    const complete = () => {
      if (hasActiveChildren()) return
      unsubscribe?.()
      unsubscribe = null
      this.pendingSubagentUsageCompletions.delete(clientRunId)
      try {
        const usage = runtime.usageAggregator.completeRun(clientRunId)
        console.info('[cad-subagent] usage run completed', {
          clientRunId,
          callCount: usage.call_count,
          breakdown: usage.breakdown.map((item) => ({
            callPurpose: item.call_purpose,
            childRunId: item.child_run_id,
            callCount: item.call_count,
            totalTokens: item.usage.total,
          })),
        })
      } catch (error) {
        console.warn('[cad-subagent] usage completion failed', error instanceof Error ? error.message : String(error))
      }
      if (onSettled && initiallyActive) {
        void Promise.resolve(onSettled()).catch((error) => {
          console.warn(
            '[cad-subagent] deferred parent usage finish failed',
            error instanceof Error ? error.message : String(error),
          )
        })
      }
    }

    if (initiallyActive) {
      unsubscribe = runtime.delegateService.subscribe((snapshot) => {
        if (snapshot.clientRunId === clientRunId) complete()
      })
    }
    complete()
    return initiallyActive
  }

  private async ensureAgentWorkspaceReady() {
    await this.agentWorkspaceService.ensureWorkspaceReady().catch((error) => {
      console.warn('[agent-workspace] 初始化失败：', error instanceof Error ? error.message : String(error))
    })
  }

  private async searchWeb(
    payload: WebSearchRequest,
    signal?: AbortSignal,
  ): Promise<WebGroundedData> {
    const query = payload.query.trim()
    const region = payload.region?.trim()
      || formatComputerRegionFallback(resolveComputerEnvironmentContext().computerRegionCode)
    if (!query) {
      return {
        query_or_url: '',
        model: 'web-search-empty-query',
        answer: '',
        sources: [],
        elapsed_ms: 0,
        warning: '查询内容为空。',
      }
    }

    return this.requestWebTool({
      endpoint: '/web/search',
      body: {
        query,
        limit: payload.limit,
        region,
        freshness: payload.freshness,
        allowed_domains: payload.allowed_domains,
        blocked_domains: payload.blocked_domains,
      },
      timeoutMs: WEB_SEARCH_TIMEOUT_MS,
      timeoutMessage: '联网搜索超时（2 分钟）。',
      fallbackTarget: query,
      signal,
    })
  }

  private async fetchWeb(
    payload: WebFetchRequest,
    signal?: AbortSignal,
  ): Promise<WebGroundedData> {
    const url = payload.url.trim()
    const region = payload.region?.trim()
      || formatComputerRegionFallback(resolveComputerEnvironmentContext().computerRegionCode)
    return this.requestWebTool({
      endpoint: '/web/fetch',
      body: {
        url,
        prompt: payload.prompt,
        region,
      },
      timeoutMs: WEB_FETCH_TIMEOUT_MS,
      timeoutMessage: '服务端网页抽取超时（4 分钟）。',
      fallbackTarget: url,
      signal,
    })
  }

  private async requestWebTool(input: {
    endpoint: '/web/search' | '/web/fetch'
    body: Record<string, unknown>
    timeoutMs: number
    timeoutMessage: string
    fallbackTarget: string
    signal?: AbortSignal
  }): Promise<WebGroundedData> {
    const session = await this.getBackendSession()
    const accessToken = session?.access_token
    if (!accessToken) {
      return {
        query_or_url: input.fallbackTarget,
        model: 'web-unauthorized',
        answer: '',
        sources: [],
        elapsed_ms: 0,
        warning: '当前未登录后端，无法联网检索。',
        status: 'error',
      }
    }

    const timeoutSignal = createTimeoutSignal(input.timeoutMs)
    const requestSignal = mergeAbortSignals(input.signal, timeoutSignal)

    let response: Response
    try {
      response = await fetch(`${this.backendBaseUrl}${input.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(input.body),
        signal: requestSignal,
      })
    } catch (error) {
      if (isAbortLikeError(error) && timeoutSignal.aborted && !input.signal?.aborted) {
        throw new Error(input.timeoutMessage)
      }
      throw error
    }

    const payloadData = await parseApiPayload(response)
    if (!response.ok) {
      const message = extractApiError(payloadData) || `联网检索失败 (${response.status})`
      throw new Error(message)
    }

    if (!payloadData || typeof payloadData !== 'object') {
      throw new Error('联网检索返回格式错误。')
    }

    const envelope = payloadData as {
      success?: boolean
      data?: WebGroundedData
      error?: string
      message?: string
    }
    if (!envelope.success || !envelope.data) {
      throw new Error(envelope.error || envelope.message || '联网检索接口返回失败。')
    }

    return envelope.data
  }


  async getCadAutomationStatus(
    request: CadAutomationStatusRequest = {},
  ): Promise<CadAutomationStatus> {
    const requestedConversationId = request.conversationId?.trim() || ''
    const conversation = requestedConversationId
      ? getConversationSummary(requestedConversationId)
      : null
    const projectId = conversation?.projectId?.trim()
      || request.projectId?.trim()
      || ''
    const project = projectId ? getProjectSummary(projectId) : null
    const projectRoot = project?.rootPathExists ? project.rootPath?.trim() || '' : ''
    const projectRootReady = Boolean(projectRoot)
    const enabled = Boolean(
      projectId
      && this.isCadSubagentEnabledForProject(projectId),
    )
    let activeRun: SubagentRunUpdate | null = null
    let activeRuns: SubagentRunUpdate[] = []
    const runtimePromise = this.subagentRuntimePromise
    if (enabled && runtimePromise) {
      try {
        const runtime = await runtimePromise
        const snapshots = runtime.coordinator.listSnapshots()
          .filter((snapshot) => (
            snapshot.type === CAD_ANALYST_AGENT_TYPE
            &&
            snapshot.projectId === projectId
            && (!requestedConversationId || snapshot.parentSessionId === requestedConversationId)
            && snapshot.status !== 'completed'
            && snapshot.status !== 'failed'
            && snapshot.status !== 'cancelled'
          ))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        activeRuns = snapshots
          .slice()
          .reverse()
          .map((snapshot) => this.toSubagentRunUpdate(snapshot))
        activeRun = activeRuns.at(-1) ?? null
      } catch {
        // Capability reporting must not initialize or fail because a child runtime is shutting down.
      }
    }
    let readiness: CadAutomationReadiness | null = null
    if (enabled && projectRoot) {
      const diagnosis = await this.cadHttpRuntime.diagnose(projectRoot)
      readiness = this.toCadAutomationReadiness(diagnosis)
    }
    const message = enabled
      ? projectRootReady
        ? readiness?.state === 'bridge_unavailable'
          ? `CAD HTTP 地基不可用：${readiness.bridge.lastError?.message || '桥接进程未就绪。'}`
          : readiness?.state === 'autocad_not_installed'
            ? '未检测到已注册的完整版 AutoCAD；CAD 子代理无法执行 COM 读图和 plot。'
            : readiness?.state === 'autocad_com_unregistered'
              ? '已检测到完整版 AutoCAD，但 AutoCAD.Application COM 类未注册。'
              : readiness?.state === 'autocad_unsupported'
                ? '仅检测到不支持所需 COM 自动化能力的 AutoCAD LT。'
                : readiness?.state === 'autocad_not_running'
                  ? 'CAD HTTP 地基健康；AutoCAD 尚未运行，任务需要时可由 CAD 子代理打开应用。'
                  : readiness?.state === 'no_document'
                    ? 'CAD HTTP 地基与 AutoCAD 已连接；当前没有活动图纸，任务时将打开项目内 DWG。'
                    : readiness?.state === 'drawing_outside_project'
                      ? 'CAD 已连接，但当前活动图纸不在项目内；任务时将切换到项目内 DWG。'
                      : readiness?.state === 'environment_unavailable'
                        ? 'CAD 已连接，但 plot 依赖或 AutoCAD 出图配置不完整。'
                        : readiness?.state === 'busy'
                          ? 'CAD HTTP 地基健康；AutoCAD 当前繁忙。'
                          : 'CAD、项目图纸与 plot 均已就绪；相关任务会由主模型自动交给 CAD 子代理抽取、识图和精读。'
        : '已启用 CAD 子代理，但项目目录未绑定或不可访问。'
      : !projectId
        ? '当前会话尚未绑定项目，CAD 子代理无法启动。主代理不会回退到手动 CAD 工具。'
        : 'CAD 子代理已由安全开关暂停。主代理不会回退到直连 AutoCAD、手动选区、实体读取或视觉识图。'
    return {
      mode: enabled ? 'subagent' : 'disabled',
      featureFlag: this.cadSubagentMode,
      projectId: projectId || null,
      projectRootReady,
      automaticEntityExtraction: enabled,
      automaticVisualIndexing: enabled,
      automaticPreciseReading: enabled,
      requiresManualSelection: false,
      manualPreprocessingVisible: false,
      developerToolsAvailable: this.cadSubagentDeveloperToolsEnabled,
      activeRun,
      activeRuns,
      readiness,
      message,
      updatedAt: new Date().toISOString(),
    }
  }

  async getCadAutomationDiagnostics(
    request: CadAutomationStatusRequest = {},
  ): Promise<CadAutomationDiagnostics> {
    if (!this.cadSubagentDeveloperToolsEnabled) {
      throw new Error('CAD 开发者诊断未启用。')
    }
    const conversationId = request.conversationId?.trim() || ''
    const conversation = conversationId ? getConversationSummary(conversationId) : null
    const projectId = conversation?.projectId?.trim() || request.projectId?.trim() || ''
    if (!projectId) throw new Error('CAD 开发者诊断需要项目。')
    const project = getProjectSummary(projectId)
    const projectRoot = project?.rootPathExists ? project.rootPath?.trim() || '' : ''
    if (!projectRoot) throw new Error('项目目录未绑定或不可访问，无法执行 CAD 诊断。')

    const [runtime, listed, cadDiagnosis] = await Promise.all([
      this.getSubagentRuntime(),
      listArtifactInventories(projectRoot),
      this.cadHttpRuntime.diagnose(projectRoot),
    ])
    reconcileCadArtifactSetReferences({
      projectId,
      inventories: listed.inventories,
      truncated: listed.truncated,
      verifiedAt: new Date().toISOString(),
    })
    const runs = (await runtime.runStore.listMetadata())
      .filter((run) => run.type === CAD_ANALYST_AGENT_TYPE && run.project_id === projectId)
      .sort((left, right) => right.started_at.localeCompare(left.started_at))
      .slice(0, 25)
      .map((run) => ({
        childRunId: run.child_run_id,
        clientRunId: run.client_run_id,
        status: run.status,
        model: run.model,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        toolCallCount: run.tool_call_count,
        totalTokens: run.usage.total,
        artifactCount: run.artifact_refs.length,
        errorCode: run.error_code,
      }))
    const artifactRecords = listCadArtifactSetRecords(projectId)
    const artifacts = artifactRecords.slice(0, 200).map((record) => ({
      drawingPath: record.drawingRelpath,
      kind: record.kind,
      storageScope: record.storageScope,
      status: record.status,
      manifestPath: record.manifestRelpath || null,
      sourceSha256: record.sourceSha256 || null,
      producerFingerprint: record.producerFingerprint || null,
      reason: record.reason || null,
      generatedAt: record.generatedAt,
      verifiedAt: record.verifiedAt,
    }))
    return {
      projectId,
      projectRootReady: true,
      featureFlag: this.cadSubagentMode,
      bridge: 'http',
      extraction: 'mlight-first-com-fallback',
      readiness: this.toCadAutomationReadiness(cadDiagnosis),
      artifacts,
      runs,
      backendUsage: [],
      backendUsageError: null,
      inventoryTruncated: listed.truncated || artifactRecords.length > artifacts.length,
      updatedAt: new Date().toISOString(),
    }
  }

  async restartCadAutomationBridge(
    request: RestartCadAutomationBridgeRequest = {},
  ): Promise<RestartCadAutomationBridgeResult> {
    if (!this.cadSubagentDeveloperToolsEnabled) {
      throw new Error('CAD 开发者诊断未启用。')
    }
    const conversationId = request.conversationId?.trim() || ''
    const conversation = conversationId ? getConversationSummary(conversationId) : null
    const projectId = conversation?.projectId?.trim() || request.projectId?.trim() || ''
    if (!projectId) throw new Error('重启 CAD bridge 需要项目。')
    const project = getProjectSummary(projectId)
    const projectRoot = project?.rootPathExists ? project.rootPath?.trim() || '' : ''
    if (!projectRoot) throw new Error('项目目录未绑定或不可访问，无法重启 CAD bridge。')
    await this.cadHttpRuntime.restart(projectRoot)
    const diagnosis = await this.cadHttpRuntime.diagnose(projectRoot)
    const readiness = this.toCadAutomationReadiness(diagnosis)
    return {
      success: true,
      readiness,
      message: readiness.bridge.reachable
        ? 'CAD HTTP bridge 已安全重启；AutoCAD 应用和已打开图纸未被关闭。'
        : 'CAD HTTP bridge 已执行重启，但健康检查仍未通过。',
      updatedAt: new Date().toISOString(),
    }
  }

  async invalidateCadAutomationArtifact(
    request: InvalidateCadAutomationArtifactRequest,
  ): Promise<InvalidateCadAutomationArtifactResult> {
    if (!this.cadSubagentDeveloperToolsEnabled) {
      throw new Error('CAD 开发者重建入口未启用。')
    }
    const conversationId = request.conversationId?.trim() || ''
    const conversation = conversationId ? getConversationSummary(conversationId) : null
    const projectId = conversation?.projectId?.trim() || request.projectId?.trim() || ''
    if (!projectId) throw new Error('CAD artifact 失效操作需要项目。')
    const project = getProjectSummary(projectId)
    const projectRoot = project?.rootPathExists ? project.rootPath?.trim() || '' : ''
    if (!projectRoot) throw new Error('项目目录未绑定或不可访问，无法失效 CAD artifact。')
    const drawingPath = typeof request.drawingPath === 'string' ? request.drawingPath.trim() : ''
    if (!drawingPath) throw new Error('CAD artifact 失效操作需要图纸相对路径。')
    if (request.kind !== 'entities' && request.kind !== 'visual') {
      throw new Error('CAD artifact 类型无效。')
    }
    const runtime = await this.getSubagentRuntime()
    const hasActiveRun = runtime.coordinator.listSnapshots().some((snapshot) => (
      isCadEvidenceSubagent(snapshot.type)
      && snapshot.projectId === projectId
      && snapshot.status !== 'completed'
      && snapshot.status !== 'failed'
      && snapshot.status !== 'cancelled'
    ))
    if (hasActiveRun) throw new Error('当前项目有 CAD 子代理正在运行，请在任务结束后再执行开发者重建。')
    const result = await invalidateCadArtifactSet(
      projectRoot,
      drawingPath,
      request.kind,
    )
    await this.reconcileCadArtifactReferences({ projectId, projectRoot, force: true })
    return {
      changed: result.changed,
      drawingPath: result.drawingPath,
      kind: result.kind,
      manifestPath: result.manifestPath,
      retainedPaths: result.retainedPaths,
      message: result.changed
        ? '可信登记已失效，原产物文件仍保留；下一次相关 CAD 任务会自动重建。'
        : '该 artifact set 当前没有可信登记，无需重复失效。',
    }
  }


  private resolveConversationLlmConfig(conversationId: string): ResolvedLlmConfig {
    const preferredRaw = getConversationPreferredModelId(conversationId)
    return preferredRaw != null && preferredRaw !== ''
      ? resolveLlmConfigInput({ model: preferredRaw })
      : getResolvedLlmConfig()
  }

  private async callMainModelChat(params: {
    settings: ResolvedLlmConfig
    apiKey: string
    messages: Array<{ role: 'system' | 'user'; content: string }>
    signal: AbortSignal
  }): Promise<string> {
    // Always use company gateway for production managed billing.
    const model = buildManagedPiModel('default', 'cad_query')
    const payload = {
      model: model.id,
      messages: params.messages,
      stream: false,
      max_completion_tokens: model.maxTokens,
      // Tool path bypasses Agent onPayload; always think at low for latency.
      enable_thinking: true,
      reasoning_effort: AUX_REASONING_EFFORT,
    }
    const requestBody = payload

    const response = await fetch(`${model.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: params.signal,
    })

    const bodyText = await response.text().catch(() => '')
    if (!response.ok) {
      throw new Error(`主模型图纸问答失败 (${response.status}): ${bodyText || '无响应体'}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(bodyText)
    } catch (error) {
      throw new Error(`主模型图纸问答响应不是合法 JSON：${String(error)}`)
    }

    const content = (parsed as {
      choices?: Array<{ message?: { content?: unknown } }>
    })?.choices?.[0]?.message?.content
    return normalizeChatCompletionContent(content)
  }


  private getPiAgentDir(): string {
    return path.join(app.getPath('userData'), 'pi-runtime')
  }

  private resolvePiControlledResources(projectRoot: string) {
    return resolveXiaoliangPiControlledResources({
      bundledSkillRoots: [
        getBundledCadSkillsRoot(),
        getBundledProjectDocumentSkillsRoot(),
      ],
      managedSkillsRoot: getManagedSkillsRoot(),
      projectRoot: projectRoot || null,
    })
  }

  private shouldUseConversationPiSession(conversationId: string): boolean {
    return this.piSessionJsonlEnabled
      || getConversationPiSessionBinding(conversationId) !== null
  }

  private resolveConversationWorkingDirectory(conversation: ConversationSummary): string {
    const projectId = conversation.projectId?.trim() || ''
    const project = projectId ? getProjectSummary(projectId) : null
    return project?.rootPathExists
      ? project.rootPath?.trim() || app.getPath('userData')
      : app.getPath('userData')
  }

  private preparePiSessionForConversation(
    conversation: ConversationSummary,
    thinkingModeOverride?: ThinkingMode,
  ): {
    prepared: PreparedConversationPiSession
    cwd: string
    effectiveThinkingMode: ThinkingMode
  } | null {
    if (!this.shouldUseConversationPiSession(conversation.id)) return null

    const cwd = this.resolveConversationWorkingDirectory(conversation)
    const liveRecord = this.sessions.get(conversation.id)
    const liveHost = liveRecord?.piHost
    if (liveRecord && liveHost) {
      const binding = getConversationPiSessionBinding(conversation.id)
      if (!binding) return null

      // A live host is the sole owner of its SessionManager and JSONL writer.
      return {
        prepared: {
          binding,
          sessionManager: liveHost.session.sessionManager,
          migratedLegacyMessages: false,
        },
        cwd,
        effectiveThinkingMode: liveRecord.thinkingModeRef.current,
      }
    }

    const configuredThinkingMode = thinkingModeOverride
      ?? this.activePromptThinkingModes.get(conversation.id)
      ?? getConversationThinkingMode(conversation.id)
    const sessionIdentity = getManagedPiSessionIdentity('default')
    const prepared = prepareConversationPiSession({
      conversationId: conversation.id,
      title: conversation.title,
      cwd,
      agentDir: this.getPiAgentDir(),
      modelProvider: sessionIdentity.provider,
      modelId: sessionIdentity.modelId,
      thinkingLevel: piThinkingLevelForMode(configuredThinkingMode),
    })
    const desiredLevel = piThinkingLevelForMode(configuredThinkingMode)
    if (prepared.sessionManager.buildSessionContext().thinkingLevel !== desiredLevel) {
      prepared.sessionManager.appendThinkingLevelChange(desiredLevel)
    }
    return { prepared, cwd, effectiveThinkingMode: configuredThinkingMode }
  }

  private initializeConversationPiSession(conversation: ConversationSummary) {
    this.preparePiSessionForConversation(conversation)
    return getConversationSummary(conversation.id) ?? conversation
  }

  private initializeNewConversationPiSession(conversation: ConversationSummary) {
    try {
      return this.initializeConversationPiSession(conversation)
    } catch (error) {
      const binding = getConversationPiSessionBinding(conversation.id)
      this.removeManagedPiSessionFile(binding)
      try {
        deleteConversationState(conversation.id)
      } catch (cleanupError) {
        console.warn(
          '[agent] failed to roll back conversation after Pi session initialization failed',
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        )
      }
      throw error
    }
  }

  private preparePiSessionForDisplay(conversation: ConversationSummary) {
    try {
      this.preparePiSessionForConversation(conversation)
    } catch (error) {
      console.warn(
        '[agent] Pi session preparation failed while loading messages; using the SQLite projection',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async createConversation(
    creationSource: ConversationCreationSource = 'legacy_unknown',
  ) {
    const conversation = createConversation('新对话', creationSource)
    return this.initializeNewConversationPiSession(conversation)
  }

  async createConversationInProject(
    projectId: string,
    title?: string,
    creationSource: ConversationCreationSource = 'legacy_unknown',
    thinkingMode?: ThinkingMode,
  ) {
    const conversation = createConversationInProject(
      projectId,
      title ?? '新对话',
      creationSource,
      thinkingMode,
    )
    return this.initializeNewConversationPiSession(conversation)
  }

  private async disposeSessionRecord(record: SessionRecord) {
    if (record.piHost) {
      await record.piHost.dispose()
      return
    }
    record.agent.abort()
    await record.agent.waitForIdle()
    record.unsubscribe?.()
  }

  private scheduleSessionRetirement(
    conversationId: string,
    record: SessionRecord,
  ): Promise<void> {
    const previous = this.retiringSessions.get(conversationId) ?? Promise.resolve()
    const retirement = previous
      .catch(() => undefined)
      .then(() => this.disposeSessionRecord(record))
    this.retiringSessions.set(conversationId, retirement)
    void retirement
      .catch((error) => {
        console.warn(
          '[agent] session retirement failed',
          error instanceof Error ? error.message : String(error),
        )
      })
      .finally(() => {
        if (this.retiringSessions.get(conversationId) === retirement) {
          this.retiringSessions.delete(conversationId)
        }
      })
    return retirement
  }

  private releaseSessionRuntime(conversationId: string): Promise<void> {
    const detachedQueueItems = this.detachedQueueItems.get(conversationId) ?? []
    this.detachedQueueItems.delete(conversationId)
    const record = this.sessions.get(conversationId)
    if (!record) {
      if (detachedQueueItems.length > 0) {
        const queueCleared = serializeAgentEvent(conversationId, {
          type: 'queue_update',
          steering: [],
          followUp: [],
        } as AgentSessionEvent)
        if (queueCleared) this.emit(queueCleared)
      }
      return this.retiringSessions.get(conversationId) ?? Promise.resolve()
    }
    if (
      detachedQueueItems.length > 0
      || (record.piHost?.getQueuedItems().length ?? 0) > 0
    ) {
      const queueCleared = serializeAgentEvent(conversationId, {
        type: 'queue_update',
        steering: [],
        followUp: [],
      } as AgentSessionEvent)
      if (queueCleared) this.emit(queueCleared)
    }
    this.sessions.delete(conversationId)
    return this.scheduleSessionRetirement(conversationId, record)
  }

  private async waitForSessionRetirement(conversationId: string) {
    await this.retiringSessions.get(conversationId)
  }

  private acceptPiHostEvent(
    conversationId: string,
    record: SessionRecord,
    envelope: XiaoliangPiAgentHostEvent,
  ): boolean {
    const generation = record.piGeneration ?? 0
    if (envelope.generation < generation) return false
    if (envelope.generation > generation) {
      record.piGeneration = envelope.generation
      record.piLastSequence = 0
      this.piSessionGenerations.set(conversationId, envelope.generation)
    }
    const lastSequence = record.piLastSequence ?? 0
    if (envelope.sequence <= lastSequence) return false
    record.piLastSequence = envelope.sequence
    return true
  }

  private releaseConversationState(conversationId: string) {
    this.cancelConversationTitleGeneration(conversationId)
    this.requestedStops.delete(conversationId)
    this.interactionCoordinator.cancelConversation(conversationId)
    this.activeInteractionModes.delete(conversationId)
    this.structuredAlgorithmApprovalCounts.delete(conversationId)
    this.activePromptThinkingModes.delete(conversationId)
    this.pendingThinkingModes.delete(conversationId)
    void this.releaseSessionRuntime(conversationId)
    void this.cancelSubagentRuns(conversationId)
    this.allowedCadEvidenceImages.delete(conversationId)
    this.cadEvidenceAllowlistFills.delete(conversationId)
    this.restoredCadEvidenceScopes.delete(conversationId)
    clearContextUsage(conversationId)
  }

  dispose(): Promise<void> {
    this.shutdownPromise ??= this.performShutdown()
    return this.shutdownPromise
  }

  private async performShutdown(): Promise<void> {
    this.shuttingDown = true
    this.projectArchiveSyncService.dispose()
    this.unsubscribeUserSkillArchive()
    this.userSkillArchiveSyncService.dispose()
    for (const controller of this.conversationTitleJobs.values()) {
      controller.abort()
    }
    this.conversationTitleJobs.clear()

    const activeConversationIds = new Set([
      ...this.activePromptConversations,
      ...this.sessions.keys(),
      ...this.retiringSessions.keys(),
    ])
    const subagentCancellations: Promise<number>[] = []
    for (const conversationId of activeConversationIds) {
      if (this.activePromptConversations.has(conversationId)) {
        this.requestedStops.add(conversationId)
      }
      this.interactionCoordinator.cancelConversation(conversationId)
      subagentCancellations.push(this.cancelSubagentRuns(conversationId))
    }
    await Promise.allSettled(subagentCancellations)
    this.interactionCoordinator.dispose()

    const sessionRetirements = [...new Set([
      ...this.sessions.keys(),
      ...this.retiringSessions.keys(),
    ])].map((conversationId) => (
      this.releaseSessionRuntime(conversationId)
    ))
    this.subagentEventUnsubscribe?.()
    this.subagentEventUnsubscribe = null
    this.subagentTraceUnsubscribe?.()
    this.subagentTraceUnsubscribe = null
    this.subagentTraceSyncService?.dispose()
    this.subagentTraceSyncService = null
    const runtimePromise = this.subagentRuntimePromise
    this.subagentRuntimePromise = null

    const promptSettlements = [...this.activePromptSettlements.values()]
      .map(({ promise }) => promise)
    const results = await Promise.allSettled([
      ...sessionRetirements,
      ...promptSettlements,
      runtimePromise
        ? runtimePromise.then((runtime) => runtime.dispose())
        : Promise.resolve(),
      this.cadHttpRuntime.dispose(),
    ])
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn(
          '[agent] shutdown cleanup failed',
          result.reason instanceof Error ? result.reason.message : String(result.reason),
        )
      }
    }
    this.activeClientRunIds.clear()
    this.managedRunConversationIds.clear()
    this.activePromptThinkingModes.clear()
    this.pendingThinkingModes.clear()
  }

  private cancelConversationTitleGeneration(conversationId: string) {
    const controller = this.conversationTitleJobs.get(conversationId)
    controller?.abort()
    if (controller) {
      this.conversationTitleJobs.delete(conversationId)
    }
  }

  private applyAutomaticConversationTitle(
    conversationId: string,
    firstUserMessageId: string,
    title: string,
  ) {
    if (!renameConversationIfFirstMessageMatches(conversationId, firstUserMessageId, title)) {
      return
    }
    if (this.shouldUseConversationPiSession(conversationId)) {
      const renamed = getConversationSummary(conversationId)
      const runningHost = this.sessions.get(conversationId)?.piHost
      if (renamed && runningHost) {
        runningHost.setSessionName(renamed.title)
      } else if (renamed) {
        this.preparePiSessionForConversation(renamed)
      }
    }
    this.projectArchiveSyncService.scheduleConversation(conversationId)
    this.emit({ type: 'conversation_updated', conversationId })
  }

  private scheduleConversationTitleGeneration(input: {
    conversationId: string
    firstUserMessageId: string
    firstUserMessage: string
    hasImages: boolean
  }) {
    if (this.conversationTitleJobs.has(input.conversationId)) {
      return
    }

    const fallbackTitle = fallbackConversationTitle(input.firstUserMessage, input.hasImages)
    if (!input.firstUserMessage.trim()) {
      this.applyAutomaticConversationTitle(
        input.conversationId,
        input.firstUserMessageId,
        fallbackTitle,
      )
      return
    }

    const controller = new AbortController()
    this.conversationTitleJobs.set(input.conversationId, controller)
    void (async () => {
      let title = fallbackTitle
      try {
        const accessToken = (await this.getBackendSession())?.access_token?.trim() || ''
        if (accessToken) {
          const result = await agentConversationTitleApiClient.generate(
            accessToken,
            input.firstUserMessage.slice(0, 8_000),
            controller.signal,
          )
          title = result.title.trim() || fallbackTitle
        }
      } catch (error) {
        if (!isAbortLikeError(error)) {
          console.warn('[agent] conversation title generation failed; using local fallback', {
            conversationId: input.conversationId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        if (this.conversationTitleJobs.get(input.conversationId) === controller) {
          this.conversationTitleJobs.delete(input.conversationId)
        }
      }

      if (controller.signal.aborted) {
        return
      }
      this.applyAutomaticConversationTitle(
        input.conversationId,
        input.firstUserMessageId,
        title,
      )
    })()
  }

  private cleanupDeletedDrawingState(drawingIds: string[]) {
    for (const drawingId of drawingIds) {
      this.cadPreExtractInFlight.delete(drawingId)
      try {
        deleteCadDrawingLocalArtifacts(drawingId)
      } catch (error) {
        console.warn('[cad] 删除本地图纸产物失败：', {
          drawingId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  private removeManagedPiSessionFile(
    binding: ConversationPiSessionBinding | null | undefined,
  ) {
    if (!binding) return
    try {
      deleteManagedConversationPiSessionFile({
        binding,
        agentDir: this.getPiAgentDir(),
      })
    } catch (error) {
      console.warn(
        '[agent] failed to remove deleted conversation Pi session',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  listProjects() {
    return listProjects()
  }

  scheduleAllProjectArchiveSync() {
    this.projectArchiveSyncService.scheduleAllProjects()
    this.userSkillArchiveSyncService.scheduleSync(0)
  }

  createProject(name: string, description?: string) {
    const project = createProject(name, description ?? '')
    this.projectArchiveSyncService.scheduleProject(project.id, 0)
    return project
  }

  createOrOpenProjectFromDirectory(rootPath: string, name?: string, description?: string) {
    const project = createOrOpenProjectFromDirectory({
      rootPath,
      name,
      description: description ?? '',
    })
    this.projectArchiveSyncService.scheduleProject(project.id, 0)
    return project
  }

  getAgentWorkspaceStatus() {
    return this.agentWorkspaceService.ensureWorkspaceReady()
      .then(() => this.agentWorkspaceService.getStatus())
  }

  setAgentWorkspaceRootDirectory(rootPath: string | null) {
    return this.agentWorkspaceService.setRootDirectory(rootPath).then((status) => {
      this.userSkillArchiveSyncService.scheduleSync(0)
      return status
    })
  }

  clearAgentWorkspaceRootDirectory() {
    return this.agentWorkspaceService.clearRootDirectory().then((status) => {
      this.userSkillArchiveSyncService.scheduleSync(0)
      return status
    })
  }

  initializeAgentWorkspace() {
    return this.agentWorkspaceService.initializeWorkspace()
  }

  refreshAgentWorkspaceIndex() {
    return this.agentWorkspaceService.refreshIndex()
  }

  getAgentWorkspaceDirectoryPath() {
    return this.agentWorkspaceService.getDirectoryPath()
  }

  getAgentWorkspaceIndexMarkdownPath() {
    return this.agentWorkspaceService.getIndexMarkdownPath()
  }

  getAgentWorkspaceCoreFilePath(fileName: Parameters<AgentWorkspaceService['getCoreFilePath']>[0]) {
    return this.agentWorkspaceService.getCoreFilePath(fileName)
  }

  async deleteProject(projectId: string) {
    const conversations = listProjectConversations(projectId)
    const bindings = new Map<string, ConversationPiSessionBinding | null>(
      conversations.map((conversation) => [
        conversation.id,
        getConversationPiSessionBinding(conversation.id),
      ]),
    )
    for (const conversation of conversations) {
      this.releaseConversationState(conversation.id)
    }
    await Promise.all(conversations.map((conversation) => (
      this.releaseSessionRuntime(conversation.id)
    )))
    const result = deleteProject(projectId)
    this.cleanupDeletedDrawingState(result.deletedDrawingIds)
    for (const conversationId of result.deletedConversationIds) {
      this.removeManagedPiSessionFile(bindings.get(conversationId))
    }
  }

  updateProjectRootDirectory(projectId: string, rootPath: string | null) {
    const project = updateProjectRootDirectory(projectId, rootPath)
    this.projectArchiveSyncService.scheduleProject(projectId, 0)
    return project
  }

  getProject(projectId: string) {
    return getProjectSummary(projectId)
  }

  getProjectContextStatus(projectId: string) {
    return this.projectContextService.getStatus(projectId)
  }

  async refreshProjectContextIndex(projectId: string) {
    const result = await this.projectContextService.refreshIndex(projectId)
    this.projectArchiveSyncService.scheduleProject(projectId, 2_000)
    return result
  }

  async createProjectAgentsFile(projectId: string) {
    const result = await this.projectContextService.createAgentsFile(projectId)
    this.projectArchiveSyncService.scheduleProject(projectId, 2_000)
    return result
  }

  getProjectAgentsFilePath(projectId: string) {
    return this.projectContextService.getAgentsPath(projectId)
  }

  getProjectIndexMarkdownPath(projectId: string) {
    return this.projectContextService.getIndexMarkdownPath(projectId)
  }

  listDrawings(projectId: string) {
    return listDrawings(projectId)
  }

  createDrawing(projectId: string, drawingName: string) {
    return createDrawing(projectId, drawingName)
  }

  async deleteDrawing(drawingId: string) {
    const result = deleteDrawing(drawingId)
    this.cleanupDeletedDrawingState(result.deletedDrawingIds)
    for (const conversationId of result.deletedConversationIds) {
      this.releaseConversationState(conversationId)
    }
    await Promise.all(result.deletedConversationIds.map((conversationId) => (
      this.releaseSessionRuntime(conversationId)
    )))
  }

  listDrawingConversations(drawingId: string) {
    return listDrawingConversations(drawingId)
  }

  async createConversationInDrawing(
    drawingId: string,
    title?: string,
    creationSource: ConversationCreationSource = 'legacy_unknown',
    thinkingMode?: ThinkingMode,
  ) {
    const conversation = createConversationInDrawing(
      drawingId,
      title ?? '新对话',
      creationSource,
      thinkingMode,
    )
    return this.initializeNewConversationPiSession(conversation)
  }

  listConversations(searchQuery?: string) {
    return listConversations(searchQuery)
  }

  listProjectConversations(projectId: string, searchQuery?: string) {
    return listProjectConversations(projectId, searchQuery)
  }

  searchWorkspace(input: WorkspaceSearchRequest) {
    return searchWorkspace(input)
  }

  async deleteConversation(conversationId: string) {
    const summary = getConversationSummary(conversationId)
    if (!summary) {
      throw new Error(`未找到会话: ${conversationId}`)
    }

    const binding = getConversationPiSessionBinding(conversationId)
    await this.cancelSubagentRuns(conversationId)
    await this.releaseSessionRuntime(conversationId)
    this.releaseConversationState(conversationId)
    deleteConversationState(conversationId)
    this.removeManagedPiSessionFile(binding)
  }

  renameConversation(conversationId: string, title: string) {
    const summary = getConversationSummary(conversationId)
    if (!summary) {
      throw new Error(`未找到会话: ${conversationId}`)
    }

    this.cancelConversationTitleGeneration(conversationId)
    renameConversationState(conversationId, title)
    if (this.shouldUseConversationPiSession(conversationId)) {
      const renamed = getConversationSummary(conversationId)
      if (renamed) {
        const runningHost = this.sessions.get(conversationId)?.piHost
        if (runningHost) {
          runningHost.setSessionName(renamed.title)
        } else {
          this.preparePiSessionForConversation(renamed)
        }
      }
    }
    this.projectArchiveSyncService.scheduleConversation(conversationId)
  }

  async getMessages(conversationId: string) {
    if (this.shouldUseConversationPiSession(conversationId)) {
      const conversation = getConversationSummary(conversationId)
      if (!conversation) {
        throw new Error(`未找到会话: ${conversationId}`)
      }
      this.preparePiSessionForDisplay(conversation)
    }
    const messages = getDisplayMessageRecords(conversationId)
    let shouldRestoreTaskNotices = this.subagentRuntimePromise !== null
    if (!shouldRestoreTaskNotices) {
      try {
        shouldRestoreTaskNotices = hasPendingRestartedSubagentTaskNotices(conversationId)
      } catch (error) {
        console.warn(
          '[subagent] failed to inspect interrupted task notices',
          error instanceof Error ? error.message : String(error),
        )
        shouldRestoreTaskNotices = true
      }
    }
    const restartedTaskIds = shouldRestoreTaskNotices
      ? await this.getSubagentRuntime()
          .then((runtime) => runtime.taskService?.takeRestartedTaskNotices(conversationId) ?? [])
          .catch((error) => {
            console.warn(
              '[subagent] failed to restore interrupted task notices',
              error instanceof Error ? error.message : String(error),
            )
            return []
          })
      : []
    if (restartedTaskIds.length > 0) {
      this.emit({
        type: 'subagent_orphaned',
        conversationId,
        taskIds: restartedTaskIds,
        message: `应用重启中断了 ${restartedTaskIds.length} 个子代理任务，请按需重新委派。`,
      })
    }
    return messages
  }

  getConversationSessionInfo(
    conversationId: string,
  ): ConversationPiSessionInfo | null {
    if (!this.shouldUseConversationPiSession(conversationId)) return null
    const conversation = getConversationSummary(conversationId)
    if (!conversation) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    let prepared: ReturnType<AgentSessionManager['preparePiSessionForConversation']>
    try {
      prepared = this.preparePiSessionForConversation(conversation)
    } catch (error) {
      const binding = getConversationPiSessionBinding(conversationId)
      if (!binding) throw error
      return {
        conversationId,
        sessionId: binding.piSessionId,
        sessionFile: binding.piSessionFile,
        name: conversation.title || null,
        parentConversationId: binding.parentConversationId,
        forkedFromEntryId: binding.forkedFromEntryId,
        runtimeVersion: binding.runtimeVersion,
        migrationStatus: 'failed',
        migrationError: binding.migrationError
          || (error instanceof Error ? error.message : String(error)),
        modelProvider: null,
        modelId: null,
        thinkingLevel: piThinkingLevelForMode(getConversationThinkingMode(conversationId)),
        stats: emptyPiSessionStats(),
      }
    }
    if (!prepared) return null
    const { sessionManager } = prepared.prepared
    const binding = getConversationPiSessionBinding(conversationId)
    if (!binding) return null
    const context = sessionManager.buildSessionContext()
    return {
      conversationId,
      sessionId: binding.piSessionId,
      sessionFile: binding.piSessionFile,
      name: sessionManager.getSessionName() ?? null,
      parentConversationId: binding.parentConversationId,
      forkedFromEntryId: binding.forkedFromEntryId,
      runtimeVersion: binding.runtimeVersion,
      migrationStatus: binding.migrationStatus,
      migrationError: binding.migrationError || null,
      modelProvider: context.model?.provider ?? null,
      modelId: context.model?.modelId ?? null,
      thinkingLevel: context.thinkingLevel,
      stats: summarizePiSession(sessionManager),
    }
  }

  listConversationSessions(): ConversationPiSessionInfo[] {
    return listConversationPiSessionBindings().flatMap((binding) => {
      try {
        const info = this.getConversationSessionInfo(binding.conversationId)
        return info ? [info] : []
      } catch (error) {
        const conversation = getConversationSummary(binding.conversationId)
        if (!conversation) return []
        return [{
          conversationId: binding.conversationId,
          sessionId: binding.piSessionId,
          sessionFile: binding.piSessionFile,
          name: conversation.title || null,
          parentConversationId: binding.parentConversationId,
          forkedFromEntryId: binding.forkedFromEntryId,
          runtimeVersion: binding.runtimeVersion,
          migrationStatus: 'failed' as const,
          migrationError: error instanceof Error ? error.message : String(error),
          modelProvider: null,
          modelId: null,
          thinkingLevel: piThinkingLevelForMode(
            getConversationThinkingMode(binding.conversationId),
          ),
          stats: emptyPiSessionStats(),
        }]
      }
    })
  }

  async getConversationPiResourceStatus(
    conversationId: string,
  ): Promise<PiRuntimeResourceStatus> {
    this.assertPiExtensionsAvailable()
    const liveRecord = this.sessions.get(conversationId)
    const liveHost = liveRecord?.piHost
    if (
      liveHost
      && (
        liveHost.isBusy
        || this.activePromptConversations.has(conversationId)
        || Boolean(liveRecord.pendingThinkingMode)
      )
    ) {
      return liveHost.getResourceStatus()
    }
    const session = await this.getOrCreateSession(conversationId)
    if (!session.piHost) throw new Error('当前会话没有可用的 Pi runtime。')
    return session.piHost.getResourceStatus()
  }

  async setConversationPiActiveTools(
    conversationId: string,
    toolNames: readonly string[],
  ): Promise<PiRuntimeResourceStatus> {
    this.assertPiExtensionsAvailable()
    const session = await this.getOrCreateSession(conversationId)
    if (!session.piHost) throw new Error('当前会话没有可用的 Pi runtime。')
    return session.piHost.setActiveTools(toolNames)
  }

  async reloadActivePiResources(): Promise<{
    reloaded: number
    busy: number
    failed: number
  }> {
    if (!this.piExtensionsEnabled) return { reloaded: 0, busy: 0, failed: 0 }
    let reloaded = 0
    let busy = 0
    let failed = 0
    for (const [conversationId, session] of this.sessions) {
      const host = session.piHost
      if (!host) continue
      if (host.isBusy || this.activePromptConversations.has(conversationId)) {
        busy += 1
        continue
      }
      try {
        await host.reloadResources()
        reloaded += 1
      } catch (error) {
        failed += 1
        console.warn(
          '[agent] Pi controlled resource reload failed',
          conversationId,
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    return { reloaded, busy, failed }
  }

  private assertPiExtensionsAvailable() {
    if (!this.piExtensionsEnabled) {
      throw new Error('Pi Extensions、Skills 和 Prompt Templates 功能尚未启用。')
    }
  }

  async exportConversationSession(
    conversationId: string,
    format: ConversationPiSessionExportFormat,
    outputPath: string,
  ): Promise<string> {
    if (!this.shouldUseConversationPiSession(conversationId)) {
      throw new Error('Pi JSONL session 功能尚未启用。')
    }
    const conversation = getConversationSummary(conversationId)
    if (!conversation) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    const prepared = this.preparePiSessionForConversation(conversation)
    if (!prepared) {
      throw new Error('无法准备 Pi session。')
    }
    if (format === 'jsonl') {
      return exportPiSessionToJsonl(prepared.prepared.sessionManager, outputPath)
    }

    const runningHost = this.sessions.get(conversationId)?.piHost
    if (runningHost) {
      return runningHost.exportToHtml(outputPath)
    }

    const { XiaoliangPiAgentHost: PiAgentHost } = await import(
      '../pi/xiaoliang-pi-agent-host'
    )
    const model = buildManagedPiModel('default', 'main')
    const host = await PiAgentHost.create({
      cwd: prepared.cwd,
      agentDir: this.getPiAgentDir(),
      generation: 1,
      model,
      thinkingLevel: piThinkingLevelForMode(prepared.effectiveThinkingMode),
      thinkingLevelSource: 'caller',
      tools: [],
      sessionManager: prepared.prepared.sessionManager,
      systemPrompt: '',
      resolveApiKey: async () => 'offline-session-export',
      onEvent: () => undefined,
    })
    try {
      return await host.exportToHtml(outputPath)
    } finally {
      await host.dispose()
    }
  }

  async importConversationSession(
    conversationId: string,
    sourceFile: string,
  ): Promise<ConversationPiSessionInfo> {
    if (!this.shouldUseConversationPiSession(conversationId)) {
      throw new Error('Pi JSONL session 功能尚未启用。')
    }
    if (this.activePromptConversations.has(conversationId)) {
      throw new Error('当前会话仍在运行，不能导入 session。')
    }
    const conversation = getConversationSummary(conversationId)
    if (!conversation) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    const cwd = this.resolveConversationWorkingDirectory(conversation)
    const imported = importConversationPiSession({
      sourceFile,
      cwd,
      agentDir: this.getPiAgentDir(),
      title: conversation.title,
    })
    const existing = this.sessions.get(conversationId)
    let committedSessionManager = imported
    if (existing?.piHost) {
      existing.agent = await existing.piHost.switchSession(
        imported.getSessionFile() as string,
        cwd,
      )
      existing.fingerprint = ''
      existing.piGeneration = existing.piHost.currentGeneration
      existing.piLastSequence = 0
      this.piSessionGenerations.set(conversationId, existing.piGeneration)
      committedSessionManager = existing.piHost.session.sessionManager
    } else if (existing) {
      await this.releaseSessionRuntime(conversationId)
    }
    commitConversationPiSession({
      conversationId,
      title: conversation.title,
      sessionManager: committedSessionManager,
      clearMessageMappings: true,
    })
    clearContextUsage(conversationId)
    this.projectArchiveSyncService.scheduleConversation(conversationId)
    this.emit({ type: 'messages_updated', conversationId })
    this.emit({ type: 'conversation_updated', conversationId })
    const info = this.getConversationSessionInfo(conversationId)
    if (!info) {
      throw new Error('Pi session 导入后未能建立会话绑定。')
    }
    return info
  }

  private assertPiBranchingAvailable() {
    if (!this.piBranchingEnabled) {
      throw new Error('Pi Tree 分支功能尚未启用。')
    }
  }

  private getConversationTreeSessionManager(conversation: ConversationSummary) {
    const running = this.sessions.get(conversation.id)?.piHost
    if (running) return running.session.sessionManager
    const prepared = this.preparePiSessionForConversation(conversation)
    if (!prepared) throw new Error('当前会话尚未建立 Pi JSONL session。')
    return prepared.prepared.sessionManager
  }

  private updateContextUsageFromPiBranch(
    conversationId: string,
    sessionManager: PreparedConversationPiSession['sessionManager'],
  ) {
    const messages = sessionManager.buildSessionContext().messages as AgentMessage[]
    if (messages.length === 0) {
      clearContextUsage(conversationId)
      this.emit({ type: 'context_usage', conversationId, usage: null })
      return
    }
    const usage = updateContextUsageFromMessages(
      conversationId,
      messages,
      buildManagedPiModel('default', 'main').contextWindow,
      MANAGED_MODEL_ALIASES.default,
    )
    if (!usage) {
      clearContextUsage(conversationId)
      this.emit({ type: 'context_usage', conversationId, usage: null })
      return
    }
    updateConversationContextUsage(conversationId, usage)
    this.emit({ type: 'context_usage', conversationId, usage })
  }

  private collectForkedChildCounts(conversationId: string): Map<string, number> {
    const counts = new Map<string, number>()
    for (const child of listConversations()) {
      if (child.parentConversationId !== conversationId || !child.forkedFromEntryId) continue
      counts.set(child.forkedFromEntryId, (counts.get(child.forkedFromEntryId) ?? 0) + 1)
    }
    return counts
  }

  private snapshotConversationTree(
    conversationId: string,
    sessionManager: PreparedConversationPiSession['sessionManager'],
  ): ConversationTreeSnapshot {
    return buildConversationPiTreeSnapshot({
      conversationId,
      sessionManager,
      forkedChildCounts: this.collectForkedChildCounts(conversationId),
    })
  }

  getConversationTree(conversationId: string): ConversationTreeSnapshot {
    this.assertPiBranchingAvailable()
    const conversation = getConversationSummary(conversationId)
    if (!conversation) throw new Error(`未找到会话: ${conversationId}`)
    return this.snapshotConversationTree(
      conversationId,
      this.getConversationTreeSessionManager(conversation),
    )
  }

  async navigateConversationTree(
    input: ConversationTreeNavigateInput,
  ): Promise<ConversationTreeNavigateResult> {
    this.assertPiBranchingAvailable()
    if (this.shuttingDown) throw new Error('应用正在退出，不能切换会话 Tree。')
    const conversationId = input.conversationId.trim()
    const targetEntryId = input.targetEntryId.trim()
    if (!conversationId || !targetEntryId) throw new Error('Tree navigate 参数不完整。')
    const conversation = getConversationSummary(conversationId)
    if (!conversation) throw new Error(`未找到会话: ${conversationId}`)
    if (this.activePromptConversations.has(conversationId)) {
      throw new Error('当前会话已有任务在运行，请先停止或等待任务完成。')
    }

    const summarize = input.summarize === true
    const promptActivity = this.beginActivePrompt(conversationId)
    const clientRunId = summarize ? randomUUID() : null
    let accessToken = ''
    let backendRunStarted = false
    let usageRuntime: SubagentRuntime | null = null
    let usageRunStarted = false
    let finishStatus: 'completed' | 'stopped' | 'failed' = 'completed'
    let finishError: string | null = null

    try {
      if (clientRunId) {
        try {
          const backendSession = await this.getBackendSession()
          accessToken = backendSession?.access_token?.trim() || ''
          if (!accessToken) throw new Error('请先登录后再生成分支摘要。')
          await agentUsageApiClient.startRun(accessToken, {
            client_run_id: clientRunId,
            source: 'desktop_chat',
            local_conversation_id: conversationId,
            original_question: null,
            task_preview: '生成 Pi Tree 分支摘要',
            started_at: new Date().toISOString(),
          })
        } catch (error) {
          const quotaError = toQuotaExceededError(error)
          if (quotaError) {
            this.emit({ type: 'error', conversationId, error: quotaError.message })
            throw quotaError
          }
          throw error
        }
        backendRunStarted = true
        this.registerManagedRun(conversationId, clientRunId)
        usageRuntime = await this.getSubagentRuntime()
        usageRuntime.usageAggregator.beginRun(clientRunId)
        usageRunStarted = true
      }

      this.requestedStops.delete(conversationId)
      const session = await this.getOrCreateSession(conversationId)
      if (!session.piHost) throw new Error('当前会话没有可用的 Pi session。')
      const result = await session.piHost.navigateTree(targetEntryId, {
        summarize,
        customInstructions: input.customInstructions?.trim() || undefined,
      })
      const stopped = result.aborted === true || this.requestedStops.has(conversationId)
      if (stopped) finishStatus = 'stopped'
      if (result.cancelled) {
        return {
          cancelled: true,
          stopped,
          editorText: result.editorText ?? null,
          summaryEntryId: result.summaryEntry?.id ?? null,
          tree: this.snapshotConversationTree(
            conversationId,
            session.piHost.session.sessionManager,
          ),
        }
      }

      if (clientRunId && usageRuntime && result.summaryEntry?.usage) {
        const rawUsage = result.summaryEntry.usage
        try {
          usageRuntime.usageAggregator.record({
            clientRunId,
            contributionId: 'branch-summary-call-1',
            // The managed gateway intentionally shares the compaction billing bucket.
            callPurpose: 'compaction',
            usage: {
              input: rawUsage.input,
              output: rawUsage.output,
              cache_read: rawUsage.cacheRead,
              cache_write: rawUsage.cacheWrite,
              total: rawUsage.totalTokens,
              cost: rawUsage.cost?.total,
            },
          })
        } catch (error) {
          console.warn(
            '[agent] branch-summary usage aggregation failed',
            error instanceof Error ? error.message : String(error),
          )
        }
      }

      appendPiActivePathMarker(session.piHost.session.sessionManager, targetEntryId)
      const latestConversation = getConversationSummary(conversationId) ?? conversation
      rebuildConversationPiProjection({
        conversationId,
        title: latestConversation.title,
        sessionManager: session.piHost.session.sessionManager,
      })
      this.updateContextUsageFromPiBranch(
        conversationId,
        session.piHost.session.sessionManager,
      )
      this.projectArchiveSyncService.scheduleConversation(conversationId)
      if (conversation.projectId) {
        this.projectArchiveSyncService.scheduleProject(conversation.projectId)
      }
      this.emit({ type: 'messages_updated', conversationId })
      this.emit({ type: 'conversation_updated', conversationId })
      return {
        cancelled: false,
        stopped,
        editorText: result.editorText ?? null,
        summaryEntryId: result.summaryEntry?.id ?? null,
        tree: this.snapshotConversationTree(
          conversationId,
          session.piHost.session.sessionManager,
        ),
      }
    } catch (error) {
      const stopped = this.requestedStops.has(conversationId) || isAbortLikeError(error)
      finishStatus = stopped ? 'stopped' : 'failed'
      finishError = stopped ? null : error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      this.requestedStops.delete(conversationId)
      if (clientRunId) {
        this.clearActiveManagedRun(conversationId, clientRunId)
        if (usageRuntime && usageRunStarted) {
          this.completeSubagentUsageRunWhenChildrenSettle(usageRuntime, clientRunId)
        }
        if (backendRunStarted) {
          try {
            const finishToken = (await this.getBackendSession())?.access_token?.trim() || accessToken
            await agentUsageApiClient.finishRun(finishToken, clientRunId, {
              status: finishStatus,
              error_message: finishError,
              final_answer: null,
              ended_at: new Date().toISOString(),
            })
          } catch (error) {
            console.warn(
              '[agent] finish branch-summary usage run failed',
              error instanceof Error ? error.message : String(error),
            )
          }
          this.notifyManagedRunFinished(conversationId, clientRunId)
        }
        this.releaseManagedRun(clientRunId)
      }
      this.finishActivePrompt(conversationId, promptActivity)
    }
  }

  setConversationTreeLabel(
    conversationId: string,
    targetEntryId: string,
    label: string | null,
  ): ConversationTreeSnapshot {
    this.assertPiBranchingAvailable()
    const normalizedConversationId = conversationId.trim()
    const normalizedTargetId = targetEntryId.trim()
    if (!normalizedConversationId || !normalizedTargetId) {
      throw new Error('书签参数不完整。')
    }
    if (this.activePromptConversations.has(normalizedConversationId)) {
      throw new Error('当前会话已有任务在运行，暂时不能修改书签。')
    }
    const conversation = getConversationSummary(normalizedConversationId)
    if (!conversation) throw new Error(`未找到会话: ${normalizedConversationId}`)
    const sessionManager = this.getConversationTreeSessionManager(conversation)
    sessionManager.appendLabelChange(
      normalizedTargetId,
      label?.trim().slice(0, 120) || undefined,
    )
    rebuildConversationPiProjection({
      conversationId: normalizedConversationId,
      title: conversation.title,
      sessionManager,
    })
    this.emit({ type: 'conversation_updated', conversationId: normalizedConversationId })
    return this.snapshotConversationTree(normalizedConversationId, sessionManager)
  }

  private async createConversationTreeBranch(
    conversationId: string,
    targetEntryId: string,
    mode: 'fork_before' | 'clone_at',
  ): Promise<ConversationTreeBranchResult> {
    this.assertPiBranchingAvailable()
    const normalizedConversationId = conversationId.trim()
    const normalizedTargetId = targetEntryId.trim()
    if (!normalizedConversationId || !normalizedTargetId) {
      throw new Error('创建分支的参数不完整。')
    }
    if (this.activePromptConversations.has(normalizedConversationId)) {
      throw new Error('当前会话已有任务在运行，请先停止或等待任务完成。')
    }
    const sourceConversation = getConversationSummary(normalizedConversationId)
    if (!sourceConversation) throw new Error(`未找到会话: ${normalizedConversationId}`)
    const prepared = this.preparePiSessionForConversation(sourceConversation)
    if (!prepared) throw new Error('当前会话尚未建立 Pi JSONL session。')
    const sourceSessionManager = this.sessions.get(normalizedConversationId)?.piHost
      ?.session.sessionManager ?? prepared.prepared.sessionManager
    const sourceSessionFile = sourceSessionManager.getSessionFile()
    if (!sourceSessionFile) throw new Error('源 Pi session 尚未持久化，无法创建分支。')

    const suffix = mode === 'fork_before' ? '分叉' : '克隆'
    const title = `${sourceConversation.title || '新对话'} · ${suffix}`.slice(0, 500)
    const sessionIdentity = getManagedPiSessionIdentity('default')
    const branched = createConversationPiBranch({
      sourceSessionFile,
      targetEntryId: normalizedTargetId,
      mode,
      cwd: prepared.cwd,
      agentDir: this.getPiAgentDir(),
      title,
      modelProvider: sessionIdentity.provider,
      modelId: sessionIdentity.modelId,
      thinkingLevel: piThinkingLevelForMode(prepared.effectiveThinkingMode),
    })
    const newSessionFile = branched.sessionManager.getSessionFile()
    let createdConversation: ConversationSummary | null = null
    try {
      createdConversation = createConversationBranch(normalizedConversationId, title)
      commitConversationPiSession({
        conversationId: createdConversation.id,
        title: createdConversation.title,
        sessionManager: branched.sessionManager,
        clearMessageMappings: true,
        parentConversationId: normalizedConversationId,
        forkedFromEntryId: normalizedTargetId,
      })
      this.updateContextUsageFromPiBranch(createdConversation.id, branched.sessionManager)
    } catch (error) {
      if (createdConversation) {
        try {
          deleteConversationState(createdConversation.id)
        } catch {
          // Preserve the original branch failure.
        }
      }
      if (newSessionFile && fs.existsSync(newSessionFile)) {
        try {
          fs.unlinkSync(newSessionFile)
        } catch {
          // Preserve the original branch failure.
        }
      }
      throw error
    }

    const conversation = getConversationSummary(createdConversation.id) ?? createdConversation
    this.projectArchiveSyncService.scheduleConversation(conversation.id)
    if (conversation.projectId) this.projectArchiveSyncService.scheduleProject(conversation.projectId)
    this.emit({ type: 'messages_updated', conversationId: conversation.id })
    this.emit({ type: 'conversation_updated', conversationId: normalizedConversationId })
    this.emit({ type: 'conversation_updated', conversationId: conversation.id })
    return {
      mode,
      sourceConversationId: normalizedConversationId,
      targetEntryId: normalizedTargetId,
      clonedThroughEntryId: branched.clonedThroughEntryId,
      clonedToolResultCount: branched.clonedToolResultCount,
      composerText: branched.selectedText,
      conversation,
    }
  }

  forkConversationBefore(
    conversationId: string,
    targetEntryId: string,
  ): Promise<ConversationTreeBranchResult> {
    return this.createConversationTreeBranch(conversationId, targetEntryId, 'fork_before')
  }

  cloneConversationAt(
    conversationId: string,
    targetEntryId: string,
  ): Promise<ConversationTreeBranchResult> {
    return this.createConversationTreeBranch(conversationId, targetEntryId, 'clone_at')
  }

  private getRunningPiHost(conversationId: string): XiaoliangPiAgentHost {
    const summary = getConversationSummary(conversationId)
    if (!summary) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    if (this.requestedStops.has(conversationId)) {
      throw new Error('当前任务正在停止，不能再加入排队消息。')
    }
    const host = this.sessions.get(conversationId)?.piHost
    if (!host || !host.isRunning || !this.activeClientRunIds.has(conversationId)) {
      throw new Error('当前没有可排队的 Pi 任务。')
    }
    return host
  }

  private toQueueImageContents(images: ImageAttachmentInput[] = []): ImageContent[] {
    return images.flatMap((image) => {
      const payload = typeof image.data === 'string' && typeof image.mimeType === 'string'
        ? { data: image.data, mimeType: image.mimeType }
        : null
      if (!payload?.data || !payload.mimeType) return []
      return [{
        type: 'image' as const,
        data: payload.data,
        mimeType: payload.mimeType,
      }]
    })
  }

  private getManagedPiHost(conversationId: string): XiaoliangPiAgentHost {
    const summary = getConversationSummary(conversationId)
    if (!summary) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    const host = this.sessions.get(conversationId)?.piHost
    if (!host) {
      throw new Error('当前没有可管理的排队消息。')
    }
    return host
  }

  private async queueConversationMessage(
    conversationId: string,
    text: string,
    kind: 'steer' | 'followUp',
    images: ImageAttachmentInput[] = [],
  ) {
    const normalizedText = text.trim()
    const imageContents = this.toQueueImageContents(images)
    if (!normalizedText && imageContents.length === 0) {
      throw new Error('排队消息不能为空。')
    }
    const host = this.getRunningPiHost(conversationId)
    if (kind === 'steer') {
      await host.steer(normalizedText, imageContents.length > 0 ? imageContents : undefined)
      return
    }
    await host.followUp(normalizedText, imageContents.length > 0 ? imageContents : undefined)
  }

  async steerConversation(
    conversationId: string,
    text: string,
    images: ImageAttachmentInput[] = [],
  ) {
    await this.queueConversationMessage(conversationId, text, 'steer', images)
  }

  async followUpConversation(
    conversationId: string,
    text: string,
    images: ImageAttachmentInput[] = [],
  ) {
    await this.queueConversationMessage(conversationId, text, 'followUp', images)
  }

  async removeConversationQueueItem(conversationId: string, id: string) {
    await this.getManagedPiHost(conversationId).removeQueuedItem(id)
  }

  async updateConversationQueueItem(
    conversationId: string,
    id: string,
    text: string,
    images: ImageAttachmentInput[] = [],
  ) {
    const imageContents = this.toQueueImageContents(images)
    await this.getManagedPiHost(conversationId).updateQueuedItem(
      id,
      text,
      imageContents.length > 0 ? imageContents : undefined,
    )
  }

  async setConversationQueueItemKind(
    conversationId: string,
    id: string,
    kind: 'steer' | 'followUp',
  ) {
    if (kind !== 'steer' && kind !== 'followUp') {
      throw new Error('排队消息类型无效。')
    }
    await this.getManagedPiHost(conversationId).setQueuedItemKind(id, kind)
  }

  async clearConversationQueue(conversationId: string): Promise<AgentClearedQueue> {
    return this.getManagedPiHost(conversationId).clearQueue()
  }

  /**
   * Stops the main conversation turn. Background subagents keep running by default so
   * a delegated task survives the user reclaiming the conversation; their completions
   * still reach the parent through the normal injection path. `includeSubagents`
   * (the explicit "stop everything" action) restores the cancel-all behaviour.
   */
  async stopConversation(
    conversationId: string,
    options: { includeSubagents?: boolean } = {},
  ): Promise<AgentClearedQueue> {
    const hasActivePrompt = this.activePromptConversations.has(conversationId)
    const session = this.sessions.get(conversationId)
    const hasActiveSession = session?.piHost?.isBusy === true
      || session?.agent.state.isStreaming === true
    const cancelSubagents = options.includeSubagents ?? !this.subagentInteractiveEnabled
    if (cancelSubagents) {
      await this.cancelSubagentRuns(conversationId)
    }
    if (!hasActivePrompt && !hasActiveSession) {
      return emptyAgentQueue()
    }

    this.requestedStops.add(conversationId)
    this.interactionCoordinator.cancelConversation(conversationId)
    const promptSettlement = this.activePromptSettlements.get(conversationId)?.promise
    let cleared = emptyAgentQueue()
    if (session?.piHost) {
      cleared = await session.piHost.abort()
    } else {
      session?.agent.clearAllQueues()
      session?.agent.abort()
      await session?.agent.waitForIdle()
    }
    await promptSettlement
    return cleared
  }

  abortConversationCompaction(conversationId: string) {
    this.sessions.get(conversationId)?.piHost?.abortCompaction()
  }

  abortConversationBranchSummary(conversationId: string) {
    this.sessions.get(conversationId)?.piHost?.abortBranchSummary()
  }

  abortConversationRetry(conversationId: string) {
    this.sessions.get(conversationId)?.piHost?.abortRetry()
  }

  async resetConversation(conversationId: string) {
    this.cancelConversationTitleGeneration(conversationId)
    this.interactionCoordinator.cancelConversation(conversationId)
    await this.cancelSubagentRuns(conversationId)
    this.structuredAlgorithmApprovalCounts.delete(conversationId)
    const existing = this.sessions.get(conversationId)
    if (this.shouldUseConversationPiSession(conversationId)) {
      const conversation = getConversationSummary(conversationId)
      if (!conversation) {
        throw new Error(`未找到会话: ${conversationId}`)
      }
      const sessionIdentity = getManagedPiSessionIdentity('default')
      const thinkingMode = getConversationThinkingMode(conversationId)
      const cwd = this.resolveConversationWorkingDirectory(conversation)
      const replacement = createReplacementConversationPiSession({
        cwd,
        agentDir: this.getPiAgentDir(),
        title: '新对话',
        modelProvider: sessionIdentity.provider,
        modelId: sessionIdentity.modelId,
        thinkingLevel: piThinkingLevelForMode(thinkingMode),
      })
      let committedSessionManager = replacement
      if (existing?.piHost) {
        existing.agent = await existing.piHost.switchSession(
          replacement.getSessionFile() as string,
          cwd,
        )
        existing.piGeneration = existing.piHost.currentGeneration
        existing.piLastSequence = 0
        this.piSessionGenerations.set(conversationId, existing.piGeneration)
        committedSessionManager = existing.piHost.session.sessionManager
      } else if (existing) {
        await this.releaseSessionRuntime(conversationId)
      }
      commitConversationPiSession({
        conversationId,
        title: '新对话',
        sessionManager: committedSessionManager,
        clearMessageMappings: true,
      })
      clearPiConversationProjection(conversationId)
      clearContextUsage(conversationId)
      this.projectArchiveSyncService.scheduleConversation(conversationId)
      return
    }
    if (existing?.piHost) {
      existing.agent = await existing.piHost.reset()
      existing.piGeneration = existing.piHost.currentGeneration
      existing.piLastSequence = 0
      this.piSessionGenerations.set(conversationId, existing.piGeneration)
    } else {
      existing?.agent.reset()
    }
    resetConversationState(conversationId)
    clearContextUsage(conversationId)
    this.projectArchiveSyncService.scheduleConversation(conversationId)
  }

  setConversationPinned(conversationId: string, pinned: boolean) {
    const summary = getConversationSummary(conversationId)
    if (!summary) {
      throw new Error(`未找到会话: ${conversationId}`)
    }

    setConversationPinnedState(conversationId, pinned)
    this.projectArchiveSyncService.scheduleConversation(conversationId)
  }

  /**
   * @deprecated 托管模式下对话不再跟随本地模型目录；保留 IPC 兼容。
   */
  setConversationPreferredModel(conversationId: string, modelId: string | null) {
    const summary = getConversationSummary(conversationId)
    if (!summary) {
      throw new Error(`未找到会话: ${conversationId}`)
    }

    const { profileId, model: globalModel } = getResolvedLlmConfig()
    let resolvedModelId = globalModel

    if (modelId === null || modelId.trim() === '') {
      persistConversationPreferredModel(conversationId, null)
    } else {
      const verified = assertKnownModel(profileId, modelId)
      resolvedModelId = verified
      persistConversationPreferredModel(
        conversationId,
        verified === globalModel ? null : verified,
      )
    }

    void this.releaseSessionRuntime(conversationId)
    this.projectArchiveSyncService.scheduleConversation(conversationId)
    void resolvedModelId
  }

  private applyThinkingModeToRecord(
    record: SessionRecord,
    host: XiaoliangPiAgentHost,
    mode: ThinkingMode,
  ): void {
    host.session.setThinkingLevel(piThinkingLevelForMode(mode))
    record.thinkingModeRef.current = mode
    record.fingerprint = record.fingerprintsByThinkingMode[mode]
    delete record.pendingThinkingMode
  }

  private applyPendingThinkingMode(conversationId: string): void {
    const record = this.sessions.get(conversationId)
    const host = record?.piHost
    const pendingMode = this.pendingThinkingModes.get(conversationId)
      ?? record?.pendingThinkingMode
    if (!pendingMode) return
    if (!record || !host) {
      this.pendingThinkingModes.delete(conversationId)
      if (record) void this.releaseSessionRuntime(conversationId)
      return
    }
    try {
      this.applyThinkingModeToRecord(record, host, pendingMode)
      this.pendingThinkingModes.delete(conversationId)
      this.projectArchiveSyncService.scheduleConversation(conversationId)
    } catch (error) {
      console.warn(
        '[agent] failed to apply pending thinking mode',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /** 会话级思考档位：极速=low / 深度=xhigh（始终开启思考，不换模型别名）。 */
  setConversationThinkingMode(
    conversationId: string,
    mode: ThinkingMode,
  ): { appliedAt: 'now' | 'next_turn' } {
    const summary = getConversationSummary(conversationId)
    if (!summary) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    const normalizedMode = normalizeThinkingMode(mode)
    persistConversationThinkingMode(conversationId, normalizedMode)
    if (this.activePromptConversations.has(conversationId)) {
      this.pendingThinkingModes.set(conversationId, normalizedMode)
      const runningRecord = this.sessions.get(conversationId)
      if (runningRecord?.piHost) {
        runningRecord.pendingThinkingMode = normalizedMode
      }
      this.projectArchiveSyncService.scheduleConversation(conversationId)
      return { appliedAt: 'next_turn' }
    }

    let updatedExistingPiHost = false
    if (this.shouldUseConversationPiSession(conversationId)) {
      const level = piThinkingLevelForMode(normalizedMode)
      const runningRecord = this.sessions.get(conversationId)
      const runningHost = runningRecord?.piHost
      if (runningRecord && runningHost) {
        // The live host owns held queue rows, so keep it reusable after changing
        // thinking mode. Its request/subagent closures share this mutable ref.
        this.applyThinkingModeToRecord(runningRecord, runningHost, normalizedMode)
        updatedExistingPiHost = true
      } else {
        const appended = appendConversationPiThinkingLevel({
          conversationId,
          cwd: this.resolveConversationWorkingDirectory(summary),
          agentDir: this.getPiAgentDir(),
          thinkingLevel: level,
        })
        if (!appended) {
          this.preparePiSessionForConversation(
            getConversationSummary(conversationId) ?? summary,
          )
        }
      }
    }
    if (!updatedExistingPiHost) {
      void this.releaseSessionRuntime(conversationId)
    }
    this.projectArchiveSyncService.scheduleConversation(conversationId)
    return { appliedAt: 'now' }
  }

  private consumeAlgorithmSaveApproval(conversationId: string) {
    const structuredApprovalCount = this.structuredAlgorithmApprovalCounts.get(conversationId) ?? 0
    if (structuredApprovalCount > 0) {
      if (structuredApprovalCount === 1) {
        this.structuredAlgorithmApprovalCounts.delete(conversationId)
      } else {
        this.structuredAlgorithmApprovalCounts.set(conversationId, structuredApprovalCount - 1)
      }
      return true
    }
    return false
  }

  private async resolveManagedAccessToken(): Promise<string> {
    const backendSession = await this.getBackendSession()
    const accessToken = backendSession?.access_token?.trim() || ''
    if (!accessToken) {
      throw new Error('请先登录后再使用 AI 能力。')
    }
    return accessToken
  }

  /** Gateway credential: xl.<client_run_id>.<jwt> when a charged run is active. */
  private async resolveManagedApiKey(conversationId?: string): Promise<string> {
    const accessToken = await this.resolveManagedAccessToken()
    await ensureManagedModelCatalog(accessToken)
    const runId = conversationId ? this.activeClientRunIds.get(conversationId) : undefined
    return buildManagedGatewayCredential(accessToken, runId)
  }

  private async resolveSettingsOrThrow(conversationId?: string) {
    const settings = getResolvedLlmConfig()
    const apiKey = await this.resolveManagedApiKey(conversationId)
    return { settings, apiKey, managed: true as const }
  }

  private async getOrCreateSession(conversationId: string) {
    if (this.shuttingDown) throw createRequestedStopError()
    await this.waitForSessionRetirement(conversationId)
    if (this.shuttingDown) throw createRequestedStopError()
    const { apiKey } = await this.resolveSettingsOrThrow(conversationId)
    if (this.shuttingDown) throw createRequestedStopError()
    const conversation = getConversationSummary(conversationId)
    if (!conversation) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    if (conversation.contextUsage) {
      restoreContextUsage(conversationId, conversation.contextUsage)
    }

    const liveSession = this.sessions.get(conversationId)
    const activeThinkingMode = this.activePromptThinkingModes.get(conversationId)
    const preparedPiSession = this.preparePiSessionForConversation(
      conversation,
      activeThinkingMode,
    )
    let thinkingMode = liveSession?.piHost
      ? liveSession.thinkingModeRef.current
      : activeThinkingMode
      ?? preparedPiSession?.effectiveThinkingMode
      ?? getConversationThinkingMode(conversationId)
    const thinkingModeRef = { current: thinkingMode }
    const projectId = conversation.projectId?.trim() || ''
    const project = projectId ? getProjectSummary(projectId) : null
    const projectRoot = project?.rootPathExists ? project.rootPath?.trim() || '' : ''
    const cadSubagentEnabled = Boolean(
      projectId
      && projectRoot
      && this.isCadSubagentEnabledForProject(projectId),
    )
    const subagentRuntime = await this.getSubagentRuntime()
    if (this.shuttingDown) throw createRequestedStopError()
    if (cadSubagentEnabled && projectId && projectRoot) {
      void this.reconcileCadArtifactReferences({ projectId, projectRoot }).catch((error) => {
        console.warn(
          '[cad-subagent] artifact reference reconcile failed',
          error instanceof Error ? error.message : String(error),
        )
      })
      await this.restoreCadEvidenceAllowances({
        runtime: subagentRuntime,
        conversationId,
        projectId,
        projectRoot,
      })
      if (this.shuttingDown) throw createRequestedStopError()
    }
    const subagentTools = [
      ...subagentRuntime.buildDelegateTools({
        projectId,
        cadContextAvailable: Boolean(cadSubagentEnabled && projectId && projectRoot),
        resolveCadSessionContext: async () => {
          if (!projectRoot) return null
          const snapshot = await this.refreshCadSessionSnapshot(conversationId, projectRoot)
          return formatCadSessionDelegateContext(snapshot)
        },
        resolveParentConversationId: () => conversationId,
        observeParentUserMessage: async (signal) => {
          const host = this.sessions.get(conversationId)?.piHost
          if (host) return host.waitForSteeringMessage(signal)
          // No host means nothing can interject; settle only when the wait releases.
          if (signal.aborted) return
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
        },
        resolveContext: (type) => {
          const clientRunId = this.activeClientRunIds.get(conversationId)
          if (!clientRunId) {
            throw new Error('Subagent delegation requires an active billed prompt.')
          }
          if (isCadEvidenceSubagent(type) && !projectId) {
            throw new Error('当前会话未归属项目，无法启动隔离 CAD 取证。请先进入并绑定一个项目。')
          }
          if (isCadEvidenceSubagent(type) && !projectRoot) {
            throw new Error('当前项目目录未绑定或不可访问，无法启动隔离 CAD 取证。请先绑定可访问的项目目录。')
          }
          return {
            parentSessionId: conversationId,
            parentPromptId: clientRunId,
            clientRunId,
            projectId: projectId || `conversation-${conversationId}`,
            projectRoot,
            thinkingMode: thinkingModeRef.current,
          }
        },
      }),
      ...(cadSubagentEnabled && projectRoot
        ? buildCadEvidenceTools({
            projectRoot,
            isAllowedPath: async (relativePath) => {
              await this.cadEvidenceAllowlistFills.get(conversationId)?.catch(() => undefined)
              return this.allowedCadEvidenceImages.get(conversationId)
                ?.has(normalizeCadArtifactPath(relativePath)) ?? false
            },
          })
        : []),
    ]

    // Managed gateway model; include capability composition so a flag/root change rebuilds the session.
    const resolveControlledResources = () => this.resolvePiControlledResources(projectRoot)
    const piExtensionsEnabled = this.piExtensionsEnabled
    const controlledResources = piExtensionsEnabled
      ? resolveControlledResources()
      : null
    // Pi 编程工具需要项目根目录作为 cwd;项目未绑定时不注册。
    const piCodingToolsActive = this.piCodingToolsEnabled && Boolean(projectRoot)
    // bash 解析:晓量托管 MinGit 优先,其次系统 Git Bash;一键准备完成后缓存重置,
    // fingerprint 覆盖来源与路径,下一次对话自动重建会话注册 bash,无需重启。
    const piBashRuntime = piCodingToolsActive ? resolvePiBashRuntime() : null
    const piBashAvailable = Boolean(piBashRuntime?.available)
    const createFingerprint = (mode: ThinkingMode) => {
      const baseFingerprint = getManagedLlmFingerprint(apiKey, 'default', mode)
      return createHash('sha256')
        .update(JSON.stringify({
          baseFingerprint,
          cadSubagentEnabled,
          projectId,
          projectRoot,
          piSessionId: preparedPiSession?.prepared.binding.piSessionId ?? null,
          piExtensionsEnabled,
          piCodingToolsActive,
          mainWebFetchEnabled: this.mainWebFetchEnabled,
          piBashAvailable,
          piBashSource: piBashRuntime?.source ?? 'none',
          piBashShellPath: piBashRuntime?.shellPath ?? null,
        }), 'utf8')
        .digest('hex')
    }
    // Keep both safe hashes so a synchronous settings change can refresh the
    // record without retaining the access token in a long-lived closure.
    const fingerprintsByThinkingMode: Record<ThinkingMode, string> = {
      fast: createFingerprint('fast'),
      deep: createFingerprint('deep'),
    }
    let fingerprint = fingerprintsByThinkingMode[thinkingMode]
    const existing = this.sessions.get(conversationId)
    if (existing?.piHost) {
      // Resource resolution above is asynchronous; a prompt may have settled and
      // committed its pending mode while this call was waiting.
      thinkingMode = existing.thinkingModeRef.current
      thinkingModeRef.current = thinkingMode
      fingerprint = fingerprintsByThinkingMode[thinkingMode]
    }
    let heldQueueItems = this.detachedQueueItems.get(conversationId) ?? []

    if (existing && existing.fingerprint === fingerprint) {
      if (
        controlledResources
        && existing.piHost
        && !existing.piHost.isBusy
        && existing.piHost.getResourceStatus().revision !== controlledResources.revision
      ) {
        await existing.piHost.reloadResources()
      }
      return existing
    }
    if (existing) {
      if (existing.piHost) {
        heldQueueItems = existing.piHost.getQueuedItems()
      }
      if (heldQueueItems.length > 0) {
        this.detachedQueueItems.set(conversationId, heldQueueItems)
      } else {
        this.detachedQueueItems.delete(conversationId)
      }
      this.sessions.delete(conversationId)
      await this.scheduleSessionRetirement(conversationId, existing)
      if (this.shuttingDown) throw createRequestedStopError()
    }

    const snapshot = getConversationSnapshot(conversationId)
    const model = buildManagedPiModel('default', 'main')
    const managedContextWindow = model.contextWindow
    const agentTools = await createAgentTools({
      subagentTools,
      conversationId,
      piCodingTools: piCodingToolsActive
        ? {
          cwd: projectRoot,
          includeBash: piBashAvailable,
          bashShellPath: piBashRuntime?.shellPath ?? null,
          bashBinDir: piBashRuntime?.binDir ?? null,
        }
        : null,
      // Without Pi coding tools, assembly adds one path-restricted `read` for web artifacts.
      projectRoot: projectRoot || null,
      mainWebFetchEnabled: this.mainWebFetchEnabled,
      webSearch: async (input, signal) => {
        try {
          return await this.searchWeb(buildWebSearchRequest(input), signal)
        } catch (error) {
          return {
            query_or_url: input.query,
            model: 'web-search-error',
            answer: '',
            sources: [],
            elapsed_ms: 0,
            warning: error instanceof Error ? error.message : String(error),
            status: 'error',
          }
        }
      },
      webFetchFallback: async (input, signal) => this.fetchWeb(input, signal),
      parseProjectDocument: async (input, signal) => {
        const projectId = conversation.projectId?.trim() || ''
        if (!projectId) {
          throw new Error('当前会话未归属项目，无法解析项目文档。')
        }
        if (isCadArtifactPath(input.path)) {
          throw new Error('CAD 产物不是富文档；evidence.md 用 read 读取，其余 CAD 内容由隔离子代理取证。')
        }
        await this.projectContextService.ensureFreshIndex(projectId, { maxAgeMs: 30_000, signal }).catch(() => undefined)
        return this.projectFileService.readFile({
          projectId,
          path: input.path,
          maxChars: input.max_chars,
          pageRange: input.page_range,
          sheetNames: input.sheet_names,
          maxRowsPerSheet: input.max_rows_per_sheet,
          maxColsPerSheet: input.max_cols_per_sheet,
          includeFormulas: input.include_formulas,
          mode: input.mode,
          signal,
        })
      },
      saveProjectComponents: async (input, signal) => {
        const projectId = conversation.projectId?.trim() || ''
        if (!projectId) {
          throw new Error('当前会话未归属项目，无法保存项目构件。')
        }
        const clientRunId = this.activeClientRunIds.get(conversationId)
        const components = input.components.map((component) => ({
          ...component,
          ...(clientRunId
            ? {
              provenance: {
                ...component.provenance,
                created_by: component.provenance?.created_by ?? 'agent',
                // Runtime provenance wins over model-supplied run ids.
                run_id: clientRunId,
              },
            }
            : {}),
        }))
        return this.projectComponentService.saveComponents(
          projectId,
          components,
          input.status,
          input.overwrite_confirmed ?? false,
          signal,
        )
      },
      queryProjectComponents: async (input, signal) => {
        const projectId = conversation.projectId?.trim() || ''
        if (!projectId) {
          throw new Error('当前会话未归属项目，无法查询项目构件。')
        }
        return this.projectComponentService.listComponents(projectId, input, signal)
      },
      getProjectComponent: async (componentId, signal) => {
        const projectId = conversation.projectId?.trim() || ''
        if (!projectId) {
          throw new Error('当前会话未归属项目，无法读取项目构件。')
        }
        return this.projectComponentService.getComponent(projectId, componentId, signal)
      },
      updateProjectComponent: async (input, signal) => {
        const projectId = conversation.projectId?.trim() || ''
        if (!projectId) {
          throw new Error('当前会话未归属项目，无法更新项目构件。')
        }
        return this.projectComponentService.updateComponent(
          projectId,
          input.component_id,
          input.patch,
          signal,
        )
      },
      deleteProjectComponent: async (componentId, signal) => {
        const projectId = conversation.projectId?.trim() || ''
        if (!projectId) {
          throw new Error('当前会话未归属项目，无法删除项目构件。')
        }
        return this.projectComponentService.deleteComponent(projectId, componentId, signal)
      },
      writeProjectTextArtifact: async (input, signal) => {
        const projectId = conversation.projectId?.trim() || ''
        if (!projectId) {
          throw new Error('当前会话未归属项目，无法写入项目产物。')
        }
        const result = await this.projectArtifactService.writeText(projectId, input, signal)
        await this.projectContextService.refreshIndex(projectId, signal).catch(() => undefined)
        return result
      },
      writeProjectExcelArtifact: async (input, signal) => {
        const projectId = conversation.projectId?.trim() || ''
        if (!projectId) {
          throw new Error('当前会话未归属项目，无法写入项目产物。')
        }
        const result = await this.projectArtifactService.writeExcel(projectId, input, signal)
        await this.projectContextService.refreshIndex(projectId, signal).catch(() => undefined)
        if (input.open_after_write === false || signal?.aborted) {
          return result
        }
        return openProjectArtifactWithDefaultApp(result)
      },
      writeProjectDocxArtifact: async (input, signal) => {
        const projectId = conversation.projectId?.trim() || ''
        if (!projectId) {
          throw new Error('当前会话未归属项目，无法写入项目产物。')
        }
        const result = await this.projectArtifactService.writeDocx(projectId, input, signal)
        await this.projectContextService.refreshIndex(projectId, signal).catch(() => undefined)
        if (input.open_after_write === false || signal?.aborted) {
          return result
        }
        return openProjectArtifactWithDefaultApp(result)
      },
      writeProjectPptxArtifact: async (input, signal) => {
        const projectId = conversation.projectId?.trim() || ''
        if (!projectId) {
          throw new Error('当前会话未归属项目，无法写入项目产物。')
        }
        const result = await this.projectArtifactService.writePptx(projectId, input, signal)
        await this.projectContextService.refreshIndex(projectId, signal).catch(() => undefined)
        if (input.open_after_write === false || signal?.aborted) {
          return result
        }
        return openProjectArtifactWithDefaultApp(result)
      },
      exportProjectAlgorithm: async (input, signal) => {
        const projectId = conversation.projectId?.trim() || ''
        if (!projectId) {
          throw new Error('当前会话未归属项目，无法导出算法产物。')
        }
        const result = await this.projectArtifactService.exportAlgorithm(projectId, input, signal)
        await this.projectContextService.refreshIndex(projectId, signal).catch(() => undefined)
        return result
      },
      consumeAlgorithmSaveApproval: () => this.consumeAlgorithmSaveApproval(conversationId),
      loadApprovedPlanMessage: async () => {
        const planContent = await readPlanDocument(this.resolvePlanFilePath(conversationId))
        const note = this.planApprovalNotes.get(conversationId)?.trim() || ''
        this.planApprovalNotes.delete(conversationId)
        return [
          '计划已批准，开始执行。',
          planContent.trim() ? `以下是已批准的计划正文：\n\n${planContent}` : '',
          note ? `用户批准时的补充：${note}` : '',
        ].filter(Boolean).join('\n\n')
      },
    })
    if (this.shuttingDown) throw createRequestedStopError()
    let agentRef: Agent | null = null
    let piHostRef: XiaoliangPiAgentHost | null = null
    const initialPlanState = loadPlanModeState(conversationId)
    const initialPlanFilePath = this.resolvePlanFilePath(conversationId)
    const initialSystemPrompt = buildSystemPrompt({
      now: new Date(),
      conversationTitle: '新对话',
      modelId: model.id,
      provider: model.provider,
      imageCount: 0,
      toolNames: listAgentToolNames(agentTools),
      piResourcesEnabled: this.piExtensionsEnabled,
      mode: initialPlanState.phase === 'active' ? 'plan' : 'agent',
      planFilePath: initialPlanFilePath,
      activeCadEvidenceTask: this.activeCadAnalystParents.has(conversationId),
      ...resolveComputerEnvironmentContext(),
    })
    const thinkingLevel = piThinkingLevelForMode(thinkingMode)
    const transformContext = async (messages: AgentMessage[]) => {
        // — CAD 上下文注入 —
        const providerLayers = await collectContextProviderLayers(
          [
            this.agentWorkspaceProvider,
            this.projectFilesProvider,
            this.cadSessionProvider,
          ],
          {
            now: new Date(),
            conversationId,
          },
        )
        const latestUserText = getLatestUserMessageText(messages)
        const recentUserQuery = getRecentUserMessageTextWindow(messages)
        const recentImageEvidence = getRecentUserImageEvidence(messages)
        const recentToolNames = getToolNamesSinceLatestUser(messages)
        const shouldEnterComponentWorkflow = hasComponentWorkflowIntent(latestUserText, recentUserQuery)
        const shouldOfferComponentSave = Boolean(
          detectComponent(recentUserQuery || latestUserText)
          && recentToolNames.has('delegate_cad')
          && recentToolNames.has('read')
          && !recentToolNames.has('component_save')
          && !COMPONENT_SAVE_OPT_OUT_PATTERN.test(recentUserQuery || latestUserText),
        )
        let componentPreflightLayer = null
        let componentPersistenceLayer = null
        let algorithmContext = ''
        let autoSkillContext = ''

        if (shouldOfferComponentSave) {
          componentPersistenceLayer = {
            key: 'component_persistence_followup',
            content: [
              '[component_persistence_followup]',
              '本轮 CAD evidence 已读取，且用户询问的是可复用构件。',
              '若 evidence 已足以形成结构化构件：先给出简洁结果，随后必须在结束本轮前直接调用 component_save(status=confirmed)，由运行时弹确认卡；不要停在文字回答，也不要询问用户是否保存。',
              '若 evidence 明确不足以形成构件，则说明缺失字段且不要调用保存。用户明确要求不保存时始终不保存。',
            ].join('\n'),
          }
        }

        if (shouldEnterComponentWorkflow) {
          if (cadSubagentEnabled) {
            const algorithmQuery = recentUserQuery || latestUserText
            algorithmContext = buildAvailableAlgorithmsContext({
              query: algorithmQuery,
              hasImages: recentImageEvidence.hasImages,
            })
            autoSkillContext = getSkillRegistry().buildAutoSkillContext({
              query: recentUserQuery || latestUserText,
              hasImages: recentImageEvidence.hasImages,
              mode: 'component_teaching',
            })
            componentPreflightLayer = {
              key: 'cad_evidence_preflight',
              content: [
                '[cad_evidence_preflight]',
                'status: delegate_required',
                '当前为隔离 CAD 证据模式：禁止读取当前 selection，也不要要求用户先点击“读取实体”或“视觉识图”。',
                '先调用 delegate_cad，并把图纸、构件/区域、要核验的字段以及用户已提供的图片信息整理成自包含任务。',
                'delegate_cad 完成后必须按顺序：先用 read 读取 canonical evidence.md，再用 cad_evidence_image 检查其中引用的图片；不得只抄路径或只信摘录里的字面观察就作答。',
                '只有在自动实体、全图/象限视觉和局部精读后仍存在多个无法区分的目标时，才向用户追问。',
                '算法入参必须来自 evidence pack 中的权威实体/文件摘录或用户明确给出的资料；视觉不得猜测精确工程值。',
              ].join('\n'),
            }
          } else {
            componentPreflightLayer = {
              key: 'cad_evidence_preflight',
              content: [
                '[cad_evidence_preflight]',
                'status: automation_disabled',
                'CAD 子代理当前被安全开关暂停；本轮没有 CAD 工具，也不得尝试读取 CAD artifact。',
                '不要要求用户手动选择实体、点击读取实体或启动视觉识图，也不要声称能够直连 AutoCAD。',
                '如回答依赖图纸证据，请明确说明 CAD 自动化暂不可用；仍可使用用户在消息中直接提供的图片或普通项目资料。',
              ].join('\n'),
            }
          }
        }
        const skillContext = [algorithmContext, autoSkillContext]
          .filter(Boolean)
          .join('\n\n')
        const planState = loadPlanModeState(conversationId)
        const planFilePath = this.resolvePlanFilePath(conversationId)
        const reminderKind = nextReminderKind(planState)
        const planReminderLayer = reminderKind
          ? {
              key: `plan_reminder_${reminderKind}`,
              content: buildPlanReminder(reminderKind, planFilePath),
            }
          : null
        // 易变运行时字段（时间、区域兜底、会话状态）走每轮层注入，
        // 让 system prompt 保持字节稳定、可命中网关前缀缓存。
        const runtimeReminderLayer = {
          key: 'runtime_reminder',
          content: buildRuntimeReminder({
            now: new Date(),
            conversationTitle: getConversationSummary(conversationId)?.title || '新对话',
            modelId: model.id,
            provider: model.provider,
            imageCount: getRecentUserImageEvidence(messages, 1).imageCount,
            toolNames: listAgentToolNames(agentTools),
            activeCadEvidenceTask: this.activeCadAnalystParents.has(conversationId),
            ...resolveComputerEnvironmentContext(),
          }),
        }
        const assembled = assembleContextLayers(
          {
            skillContext,
            providerLayers: [
              ...providerLayers,
              runtimeReminderLayer,
              ...(componentPreflightLayer ? [componentPreflightLayer] : []),
              ...(componentPersistenceLayer ? [componentPersistenceLayer] : []),
              ...(planReminderLayer ? [planReminderLayer] : []),
            ],
          },
          {
            maxTokens: Math.max(DEFAULT_CONTEXT_TOKEN_BUDGET, 12_000),
          },
        )

        if (assembled.layers.length === 0) {
          return messages
        }

        // 队尾注入而非队首：层里带当前时间等逐轮变化的字段，放在队首会让它后面的整段
        // 对话历史每轮都错开前缀，网关前缀缓存只能吃到 system + tools。挪到队尾后，
        // system、tools 和全部历史构成稳定前缀，未命中的只剩这一层自身。
        return [
          ...messages,
          {
            role: 'user',
            content: [CONTEXT_SNAPSHOT_PREFACE, renderContextLayers(assembled.layers)].join('\n\n'),
            timestamp: Date.now(),
          } satisfies AgentMessage,
        ]
    }

    let mainUsageCallIndex = 0
    let compactionUsageCallIndex = 0
    let lastEmittedContextUsageKey = ''
    const handleAgentEvent = async (event: AgentEvent | AgentSessionEvent) => {
      const activeClientRunId = this.activeClientRunIds.get(conversationId)
      if (activeClientRunId) {
        if (event.type === 'message_end') {
          stampAgentMessageRun(event.message, activeClientRunId)
        } else if (event.type === 'agent_end') {
          for (const message of event.messages) {
            stampAgentMessageRun(message, activeClientRunId)
          }
        }
      }

      const serialized = serializeAgentEvent(conversationId, event, {
        supportsQueueing: Boolean(piHostRef),
      })
      if (serialized) {
        this.emit(serialized)
      }

      const payload = event as {
        type?: string
        message?: {
          role?: string
          usage?: any
          customType?: string
          content?: unknown
          details?: unknown
        }
        result?: {
          usage?: any
          estimatedTokensAfter?: number
        }
      }
      const projectsFromPiJsonl = Boolean(preparedPiSession && piHostRef)
      const isSubagentCompletionMessageEnd = Boolean(
        payload.type === 'message_end'
        && payload.message?.role === 'custom'
        && payload.message.customType === SUBAGENT_COMPLETION_CUSTOM_TYPE,
      )
      if (
        projectsFromPiJsonl
        && (
          payload.type === 'message_end'
          || payload.type === 'agent_settled'
          || payload.type === 'compaction_end'
        )
        && piHostRef
      ) {
        const conversationSummary = getConversationSummary(conversationId)
        rebuildConversationPiProjection({
          conversationId,
          title: conversationSummary?.title || '新对话',
          sessionManager: piHostRef.session.sessionManager,
        })
      }
      if (payload.type === 'message_end' && payload.message?.role === 'user') {
        const conversationSummary = getConversationSummary(conversationId)
        const stateAgent = piHostRef?.agent ?? agentRef
        const stateMessages = [
          ...((stateAgent?.state.messages as AgentMessage[] | undefined) ?? []),
        ]
        if (!projectsFromPiJsonl) {
          persistConversationState(
            conversationId,
            conversationSummary?.title || '新对话',
            stateMessages,
          )
        }
        this.emitPersistedTranscriptMessage(conversationId, (message) => (
          message.role === 'user' && !message.hostNotice
        ))
        this.projectArchiveSyncService.scheduleConversation(conversationId)

        const userMessageCount = stateMessages.filter(
          (message) => (message as { role?: string }).role === 'user',
        ).length
        if (userMessageCount === 1 && conversationSummary?.title === '新对话') {
          const firstUserMessage = getDisplayMessageRecords(conversationId).find(
            (message) => message.role === 'user',
          )
          if (firstUserMessage) {
            this.scheduleConversationTitleGeneration({
              conversationId,
              firstUserMessageId: firstUserMessage.id,
              firstUserMessage: firstUserMessage.content,
              hasImages: (firstUserMessage.attachments?.length ?? 0) > 0,
            })
          }
        }
      }
      if (projectsFromPiJsonl && isSubagentCompletionMessageEnd && payload.message) {
        const rawDetails = payload.message.details
        const envelope = rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)
          ? rawDetails as { payload?: unknown }
          : null
        const completion = parseSubagentCompletionDeliveryDetails(envelope?.payload)
          ?? parseSubagentCompletionPrompt(extractMessageTextContent(payload.message.content))
        if (completion) {
          this.emitPersistedTranscriptMessage(conversationId, (message) => (
            message.hostNotice?.kind === 'subagent_completion'
            && message.hostNotice.taskId === completion.taskId
          ))
        }
        this.projectArchiveSyncService.scheduleConversation(conversationId)
      }
      if (
        payload.type === 'message_end' &&
        payload.message?.role === 'assistant' &&
        payload.message.usage
      ) {
        if (activeClientRunId) {
          mainUsageCallIndex += 1
          const rawUsage = payload.message.usage as {
            input?: number
            output?: number
            cacheRead?: number
            cacheWrite?: number
            totalTokens?: number
            cost?: { total?: number }
          }
          try {
            subagentRuntime.usageAggregator.record({
              clientRunId: activeClientRunId,
              contributionId: `main-call-${mainUsageCallIndex}`,
              callPurpose: 'main',
              usage: {
                input: rawUsage.input,
                output: rawUsage.output,
                cache_read: rawUsage.cacheRead,
                cache_write: rawUsage.cacheWrite,
                total: rawUsage.totalTokens,
                cost: rawUsage.cost?.total,
      },
    })
          } catch (error) {
            console.warn('[subagent] main usage aggregation failed', error instanceof Error ? error.message : String(error))
          }
        }
      }
      // Provider usage 之间也要把工具结果和子代理报告计入预计占用。
      if (payload.type === 'message_end' || payload.type === 'turn_end') {
        const stateMessages = (piHostRef?.agent ?? agentRef)?.state.messages as
          | AgentMessage[]
          | undefined
        if (stateMessages && stateMessages.length > 0) {
          const usageInfo = updateContextUsageFromMessages(
            conversationId,
            stateMessages,
            managedContextWindow,
            MANAGED_MODEL_ALIASES.default,
          )
          if (usageInfo) {
            const usageKey = contextUsageFingerprint(usageInfo)
            if (usageKey !== lastEmittedContextUsageKey) {
              lastEmittedContextUsageKey = usageKey
              updateConversationContextUsage(conversationId, usageInfo)
              this.emit({ type: 'context_usage', conversationId, usage: usageInfo })
            }
          }
        }
      }
      // Tool loops emit multiple turn_end events, and automatic retries emit
      // multiple agent_end events. Only agent_settled closes the whole host prompt.
      if (payload.type === 'agent_settled') {
        this.applyPendingThinkingMode(conversationId)
      }
      if (payload.type === 'compaction_end') {
        if (payload.result?.usage) {
          const rawUsage = payload.result.usage as {
            input?: number
            output?: number
            cacheRead?: number
            cacheWrite?: number
            totalTokens?: number
            cost?: { total?: number }
          }
          if (activeClientRunId) {
            compactionUsageCallIndex += 1
            try {
              subagentRuntime.usageAggregator.record({
                clientRunId: activeClientRunId,
                contributionId: `compaction-call-${compactionUsageCallIndex}`,
                callPurpose: 'compaction',
                usage: {
                  input: rawUsage.input,
                  output: rawUsage.output,
                  cache_read: rawUsage.cacheRead,
                  cache_write: rawUsage.cacheWrite,
                  total: rawUsage.totalTokens,
                  cost: rawUsage.cost?.total,
                },
              })
            } catch (error) {
              console.warn(
                '[agent] compaction usage aggregation failed',
                error instanceof Error ? error.message : String(error),
              )
            }
          }
        }

        const estimatedTokensAfter = payload.result?.estimatedTokensAfter
        if (Number.isFinite(estimatedTokensAfter)) {
          const usageInfo = updateContextUsageEstimate(
            conversationId,
            estimatedTokensAfter as number,
            managedContextWindow,
            MANAGED_MODEL_ALIASES.default,
          )
          lastEmittedContextUsageKey = contextUsageFingerprint(usageInfo)
          updateConversationContextUsage(conversationId, usageInfo)
          this.emit({ type: 'context_usage', conversationId, usage: usageInfo })
        }
      }
    }

    if (this.piRuntimeV2Enabled || preparedPiSession) {
      const { XiaoliangPiAgentHost: PiAgentHost } = await import(
        '../pi/xiaoliang-pi-agent-host'
      )
      if (this.shuttingDown) throw createRequestedStopError()
      const generation = (this.piSessionGenerations.get(conversationId) ?? 0) + 1
      let recordRef: SessionRecord | undefined
      const host = await PiAgentHost.create({
        cwd: projectRoot || app.getPath('userData'),
        agentDir: this.getPiAgentDir(),
        generation,
        model,
        thinkingLevel,
        thinkingLevelSource: 'caller',
        tools: agentTools,
        initialMessages: preparedPiSession ? undefined : snapshot.messages,
        initialHeldQueueItems: heldQueueItems,
        sessionManager: preparedPiSession?.prepared.sessionManager,
        systemPrompt: initialSystemPrompt,
        controlledResources: controlledResources
          ? {
              initial: controlledResources,
              resolve: resolveControlledResources,
            }
          : undefined,
        resolveApiKey: async () => this.resolveManagedApiKey(conversationId),
        beforeProviderHeaders: (headers) => {
          headers['X-Xiaoliang-Agent-Run-Id'] = this.activeClientRunIds.get(conversationId) ?? null
        },
        transformContext,
        transformPayload: (payload, currentModel) => (
          patchManagedThinkingPayload(payload, currentModel, thinkingModeRef.current)
        ),
        beforeToolCall: (toolCall: XiaoliangPiToolCall, signal) => (
          this.guardToolExecution(conversationId, {
            toolCall: { id: toolCall.id, name: toolCall.name },
            args: toolCall.args,
          }, signal)
        ),
        beforePersistMessage: (message) => {
          const activeClientRunId = this.activeClientRunIds.get(conversationId)
          if (activeClientRunId) {
            stampAgentMessageRun(message, activeClientRunId)
          }
        },
        onEvent: async (envelope: XiaoliangPiAgentHostEvent) => {
          const current = recordRef
          if (!current || this.sessions.get(conversationId) !== current) return
          if (!this.acceptPiHostEvent(conversationId, current, envelope)) return
          await handleAgentEvent(envelope.event)
        },
        onEventError: (error) => {
          console.warn(
            '[agent] Pi event projection failed',
            error instanceof Error ? error.message : String(error),
          )
        },
        onExtensionError: (error) => {
          console.warn(
            '[agent] Pi inline extension failed',
            error.extensionPath,
            error.event,
            error.error,
          )
        },
      })
      if (this.shuttingDown) {
        await host.dispose()
        throw createRequestedStopError()
      }
      piHostRef = host
      agentRef = host.agent
      const record: SessionRecord = {
        agent: host.agent,
        fingerprint,
        fingerprintsByThinkingMode,
        thinkingModeRef,
        tools: agentTools,
        piHost: host,
        piGeneration: host.currentGeneration,
        piLastSequence: 0,
      }
      recordRef = record
      this.piSessionGenerations.set(conversationId, host.currentGeneration)
      this.sessions.set(conversationId, record)
      this.detachedQueueItems.delete(conversationId)
      return record
    }

    const agent = new Agent({
      streamFn: legacyStreamSimple,
      initialState: {
        systemPrompt: initialSystemPrompt,
        model,
        thinkingLevel,
        tools: agentTools,
        messages: [],
      },
      getApiKey: async () => this.resolveManagedApiKey(conversationId),
      onPayload: (payload, currentModel) => (
        patchManagedThinkingPayload(payload, currentModel, thinkingModeRef.current)
      ),
      beforeToolCall: (context, signal) => (
        this.guardToolExecution(conversationId, context, signal)
      ),
      transformContext,
    })
    agentRef = agent
    if (snapshot.messages.length > 0) {
      ;(agent.state as AgentState).messages = snapshot.messages
    }
    const unsubscribe = agent.subscribe(handleAgentEvent)
    const record: SessionRecord = {
      agent,
      fingerprint,
      fingerprintsByThinkingMode,
      thinkingModeRef,
      tools: agentTools,
      unsubscribe,
    }
    this.sessions.set(conversationId, record)
    return record
  }

  private updateSystemPrompt(
    session: SessionRecord,
    input: {
      conversationId?: string
      conversationTitle: string
      imageCount: number
    },
  ) {
    const state = session.agent.state as AgentState
    const conversationId = input.conversationId
      || [...this.sessions.entries()].find(([, record]) => record === session)?.[0]
    const planState = conversationId ? loadPlanModeState(conversationId) : undefined
    const systemPrompt = buildSystemPrompt({
      now: new Date(),
      conversationTitle: input.conversationTitle || '新对话',
      modelId: state.model.id,
      provider: state.model.provider,
      imageCount: input.imageCount,
      toolNames: session.piHost
        ? session.piHost.session.getActiveToolNames()
        : listAgentToolNames(session.tools),
      piResourcesEnabled: this.piExtensionsEnabled,
      mode: planState?.phase === 'active' ? 'plan' : 'agent',
      planFilePath: conversationId ? this.resolvePlanFilePath(conversationId) : undefined,
      activeCadEvidenceTask: conversationId
        ? this.activeCadAnalystParents.has(conversationId)
        : false,
      ...resolveComputerEnvironmentContext(),
    })
    if (session.piHost) {
      session.piHost.setSystemPrompt(systemPrompt)
    } else {
      state.systemPrompt = systemPrompt
    }
  }


  async compactConversation(
    conversationId: string,
    instructions?: string,
  ): Promise<'completed' | 'stopped'> {
    if (this.shuttingDown) {
      throw new Error('应用正在退出，不能启动上下文压缩。')
    }
    const conversation = getConversationSummary(conversationId)
    if (!conversation) {
      throw new Error(`未找到会话: ${conversationId}`)
    }
    if (!this.shouldUseConversationPiSession(conversationId)) {
      throw new Error('当前会话尚未迁移到 Pi session，不能执行上下文压缩。')
    }
    if (this.activePromptConversations.has(conversationId)) {
      throw new Error('当前会话已有任务在运行，请先停止或等待任务完成。')
    }

    this.requestedStops.delete(conversationId)
    const promptActivity = this.beginActivePrompt(conversationId)
    const clientRunId = randomUUID()
    let accessToken = ''

    try {
      try {
        const backendSession = await this.getBackendSession()
        accessToken = backendSession?.access_token?.trim() || ''
        if (!accessToken) {
          throw new Error('请先登录后再压缩会话上下文。')
        }
        await agentUsageApiClient.startRun(accessToken, {
          client_run_id: clientRunId,
          source: 'desktop_chat',
          local_conversation_id: conversationId,
          original_question: null,
          task_preview: '手动压缩会话上下文',
          started_at: new Date().toISOString(),
        })
      } catch (error) {
        const quotaError = toQuotaExceededError(error)
        if (quotaError) {
          this.emit({ type: 'error', conversationId, error: quotaError.message })
          throw quotaError
        }
        throw error
      }

      this.registerManagedRun(conversationId, clientRunId)
      let finishStatus: 'completed' | 'stopped' | 'failed' = 'completed'
      let finishError: string | null = null
      let session: Awaited<ReturnType<AgentSessionManager['getOrCreateSession']>> | null = null
      let usageRuntime: SubagentRuntime | null = null
      let usageRunStarted = false

      try {
        if (this.requestedStops.has(conversationId)) {
          throw createRequestedStopError()
        }
        usageRuntime = await this.getSubagentRuntime()
        usageRuntime.usageAggregator.beginRun(clientRunId)
        usageRunStarted = true
        session = await this.getOrCreateSession(conversationId)
        if (!session.piHost) {
          throw new Error('当前会话没有可用的 Pi session。')
        }
        if (this.requestedStops.has(conversationId)) {
          throw createRequestedStopError()
        }

        await session.piHost.compact(instructions?.trim() || undefined)
        if (this.requestedStops.has(conversationId)) {
          finishStatus = 'stopped'
        }
      } catch (error) {
        const stopped = this.requestedStops.has(conversationId)
          || isAbortLikeError(error)
          || isCompactionCancelledError(error)
        if (stopped) {
          finishStatus = 'stopped'
        } else {
          finishStatus = 'failed'
          finishError = error instanceof Error ? error.message : String(error)
          this.emit({ type: 'error', conversationId, error: finishError })
          throw error
        }
      } finally {
        this.requestedStops.delete(conversationId)
        if (usageRuntime && usageRunStarted) {
          this.completeSubagentUsageRunWhenChildrenSettle(usageRuntime, clientRunId)
        }
        this.clearActiveManagedRun(conversationId, clientRunId)
        try {
          const finishToken =
            (await this.getBackendSession())?.access_token?.trim() || accessToken
          await agentUsageApiClient.finishRun(finishToken, clientRunId, {
            status: finishStatus,
            error_message: finishError,
            final_answer: null,
            ended_at: new Date().toISOString(),
          })
        } catch (finishErrorValue) {
          console.warn(
            '[agent] finish compaction usage run failed',
            finishErrorValue instanceof Error
              ? finishErrorValue.message
              : String(finishErrorValue),
          )
        }
        this.notifyManagedRunFinished(conversationId, clientRunId)
        this.releaseManagedRun(clientRunId)
      }

      if (session?.piHost && finishStatus === 'completed') {
        const latestConversation = getConversationSummary(conversationId)
        rebuildConversationPiProjection({
          conversationId,
          title: latestConversation?.title || conversation.title || '新对话',
          sessionManager: session.piHost.session.sessionManager,
        })
        this.projectArchiveSyncService.scheduleConversation(conversationId)
        if (conversation.projectId) {
          this.projectArchiveSyncService.scheduleProject(conversation.projectId)
        }
        this.emit({ type: 'messages_updated', conversationId })
      }
      return finishStatus === 'stopped' ? 'stopped' : 'completed'
    } finally {
      this.finishActivePrompt(conversationId, promptActivity)
    }
  }


  async sendPromptWhenIdle(
    conversationId: string,
    prompt: string,
    images: ImageAttachmentInput[] = [],
    options: AgentPromptOptions = {},
  ): Promise<AgentPromptRunResult> {
    while (true) {
      const active = this.activePromptSettlements.get(conversationId)
      if (!active) return this.sendPrompt(conversationId, prompt, images, options)
      await active.promise
    }
  }

  async sendPrompt(
    conversationId: string,
    prompt: string,
    images: ImageAttachmentInput[] = [],
    options: AgentPromptOptions = {},
  ): Promise<AgentPromptRunResult> {
    if (this.shuttingDown) {
      throw new Error('应用正在退出，不能启动新的 Agent 任务。')
    }
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt && images.length === 0) {
      throw new Error('Prompt 或图片至少提供一项。')
    }

    const conversation = getConversationSummary(conversationId)
    if (!conversation) {
      throw new Error(`未找到会话: ${conversationId}`)
    }

    if (this.activePromptConversations.has(conversationId)) {
      throw new Error('当前会话已有任务在运行；请排队发送，或在队列中改为立即引导。')
    }
    assertAgentConversationCapacity(this.activePromptConversations.size)
    this.requestedStops.delete(conversationId)
    const promptActivity = this.beginActivePrompt(conversationId)
    this.applyPendingThinkingMode(conversationId)

    const clientRunId = randomUUID()
    let accessToken = ''
    try {
      const backendSession = await this.getBackendSession()
      accessToken = backendSession?.access_token?.trim() || ''
      if (!accessToken) {
        throw new Error('请先登录后再使用 AI 对话。')
      }
      await agentUsageApiClient.startRun(accessToken, {
        client_run_id: clientRunId,
        source: toAgentRunSource(options.creationSource),
        local_conversation_id: conversationId,
        original_question: trimmedPrompt || null,
        task_preview: (trimmedPrompt || '图片对话').slice(0, 500),
        started_at: new Date().toISOString(),
      })
    } catch (error) {
      this.finishActivePrompt(conversationId, promptActivity)
      const quotaError = toQuotaExceededError(error)
      const reportedError = quotaError ?? error
      const reportedErrorText = reportedError instanceof Error
        ? reportedError.message
        : String(reportedError)
      notifyPromptSettled(options.onSettled, {
        clientRunId,
        status: 'failed',
        finalAnswer: null,
        errorText: reportedErrorText,
      })
      this.emit({
        type: 'error',
        conversationId,
        error: reportedErrorText,
      })
      if (quotaError) throw quotaError
      if (error instanceof BackendApiError) {
        throw error
      }
      throw error
    }

    let finishStatus: 'completed' | 'stopped' | 'failed' = 'completed'
    let finishError: string | null = null
    let session: Awaited<ReturnType<AgentSessionManager['getOrCreateSession']>> | null = null
    let finalAnswerForUsage: string | null = null
    try {
      // Charged run is live: every exit path after this must finish the run and clear binding.
      this.registerManagedRun(conversationId, clientRunId)
      this.activeInteractionModes.set(conversationId, options.interactionMode ?? 'unavailable')

    let subagentUsageRuntime: SubagentRuntime | null = null
    let subagentUsageRunStarted = false
    let approvedPlanActivated = false
    let promptInvocationStarted = false
    const resolvedConversation = getConversationSummary(conversationId) ?? conversation
    const resolvedProjectId = resolvedConversation.projectId?.trim() || ''
    const resolvedProject = resolvedProjectId ? getProjectSummary(resolvedProjectId) : null
    const resolvedProjectRoot = resolvedProject?.rootPathExists
      ? resolvedProject.rootPath?.trim() || ''
      : ''
    const turnStartedAt = new Date().toISOString()
    const resolvedInteractionMode = options.interactionMode ?? 'unavailable'

    try {
      if (this.requestedStops.has(conversationId)) {
        throw createRequestedStopError()
      }
      subagentUsageRuntime = await this.getSubagentRuntime()
      subagentUsageRuntime.usageAggregator.beginRun(clientRunId)
      subagentUsageRunStarted = true
      if (
        resolvedProjectRoot
        && this.isCadSubagentEnabledForProject(resolvedProjectId)
      ) {
        await this.refreshCadSessionSnapshot(conversationId, resolvedProjectRoot)
      } else {
        this.cadSessionSnapshots.delete(conversationId)
      }
      session = await this.getOrCreateSession(conversationId)
      if (this.requestedStops.has(conversationId)) {
        throw createRequestedStopError()
      }
      const planState = options.approvedPlan
        ? markPlanApproved(conversationId)
        : markPlanPromptStart(conversationId)
      approvedPlanActivated = options.approvedPlan === true
      this.emitConversationMode(conversationId, planState)
      if (planState.phase === 'active') {
        await ensurePlanDocument(this.resolvePlanFilePath(conversationId))
      }
      const imageContents: ImageContent[] = images.map((image) => ({
        type: 'image',
        data: image.data,
        mimeType: image.mimeType,
      }))
      this.updateSystemPrompt(session, {
        conversationId,
        conversationTitle: resolvedConversation.title,
        imageCount: imageContents.length,
      })
      const modelId = session.agent.state.model.id

      console.info('[agent] prompt start', {
        conversationId,
        modelId,
        managed: true,
        clientRunId,
        imageCount: imageContents.length,
      })
      promptInvocationStarted = true
      if (session.piHost) {
        if (
          options.creationSource === 'subagent_completion'
          && options.subagentTaskId?.trim()
        ) {
          await session.piHost.promptSystemMessage({
            id: `${SUBAGENT_COMPLETION_CUSTOM_TYPE}:${options.subagentTaskId.trim()}`,
            customType: SUBAGENT_COMPLETION_CUSTOM_TYPE,
            content: trimmedPrompt,
            details: options.subagentDeliveryContext,
          })
        } else {
          await session.piHost.prompt(
            trimmedPrompt,
            imageContents.length > 0 ? imageContents : undefined,
          )
        }
      } else {
        await session.agent.prompt(
          trimmedPrompt,
          imageContents.length > 0 ? imageContents : undefined,
        )
      }
      console.info('[agent] prompt done', { conversationId, modelId })

      if (this.requestedStops.has(conversationId)) {
        finishStatus = 'stopped'
      }

      const st = session.agent.state as AgentState

      let softError: string | null | undefined = st.errorMessage
      const msgs = st.messages as AgentMessage[]
      let lastAssistant: AgentMessage | undefined
      for (let index = msgs.length - 1; index >= 0; index -= 1) {
        if ((msgs[index] as { role?: string }).role !== 'assistant') continue
        lastAssistant = msgs[index]
        break
      }
      if (!softError) {
        if (
          lastAssistant
          && (lastAssistant as { stopReason?: string }).stopReason === 'error'
        ) {
          softError =
            typeof (lastAssistant as { errorMessage?: string }).errorMessage === 'string'
              ? (lastAssistant as { errorMessage: string }).errorMessage
              : '模型返回失败（stopReason: error）'
        }
      }
      const lastAborted = Boolean(
        lastAssistant
        && (lastAssistant as { stopReason?: string }).stopReason === 'aborted',
      )
      if (
        this.requestedStops.has(conversationId)
        || lastAborted
        || (softError && ABORT_SOFT_ERROR.test(String(softError)))
      ) {
        finishStatus = 'stopped'
        finishError = null
        softError = null
      }
      if (softError) {
        finishStatus = 'failed'
        finishError = String(softError)
        this.emit({
          type: 'error',
          conversationId,
          error: String(softError),
        })
      }
    } catch (error) {
      console.error('[agent] prompt failed', conversationId, error)
      const message = error instanceof Error ? error.message : String(error)
      if (approvedPlanActivated && !promptInvocationStarted) {
        const revised = markPlanRevised(conversationId)
        this.emitConversationMode(conversationId, revised)
        this.refreshLiveSystemPrompt(conversationId)
      }
      const isUserAbort =
        this.requestedStops.has(conversationId) || isAbortLikeError(error)

      if (!isUserAbort) {
        // Covers getOrCreateSession failures and model/tool failures after charge.
        finishStatus = 'failed'
        finishError = message
        this.emit({
          type: 'error',
          conversationId,
          error: message,
        })
        throw error
      }

      finishStatus = 'stopped'
      if (options.approvedPlan && !approvedPlanActivated) {
        // Let the detached approval follow-up restore its card. Returning as if
        // launch succeeded would leave awaiting_plan_approval without a row.
        throw error
      }
    } finally {
      if (session) {
        const finalAssistantMessage = findLastAssistantMessageForRun(
          session.agent.state.messages as AgentMessage[],
          clientRunId,
        )
        finalAnswerForUsage = finalAssistantMessage
          ? extractMessageTextContent((finalAssistantMessage as any).content) || null
          : null
      }
      this.requestedStops.delete(conversationId)
      this.interactionCoordinator.cancelConversation(conversationId)
      const endedPlan = markPlanTurnEnd(conversationId)
      this.emitConversationMode(conversationId, endedPlan)
      this.activeInteractionModes.delete(conversationId)
      this.structuredAlgorithmApprovalCounts.delete(conversationId)
      // Must run before the usage run is finished: the extraction call goes
      // through the gateway, which only accepts calls bound to a live run.
      if (session && finishStatus === 'completed') {
        try {
          await this.maybeStartComponentReview({
            conversationId,
            projectId: resolvedProjectId,
            messages: session.agent.state.messages as AgentMessage[],
            userText: getGenuineUserText(session.agent.state.messages) || trimmedPrompt,
            assistantText: collectTurnAssistantText(session.agent.state.messages)
              || finalAnswerForUsage
              || '',
            clientRunId,
            turnStartedAt,
            interactionMode: resolvedInteractionMode,
          })
        } catch (error) {
          console.warn(
            '[agent] component review failed',
            error instanceof Error ? error.message : String(error),
          )
        }
      }
      this.clearActiveManagedRun(conversationId, clientRunId)
      const finishUsageRun = async () => {
        try {
          // Prefer a fresh token in case access was refreshed during a long turn.
          const finishToken =
            (await this.getBackendSession())?.access_token?.trim() || accessToken
          await agentUsageApiClient.finishRun(finishToken, clientRunId, {
            status: finishStatus,
            error_message: finishError,
            final_answer: finalAnswerForUsage,
            ended_at: new Date().toISOString(),
          })
        } catch (finishErrorValue) {
          console.warn(
            '[agent] finish usage run failed',
            finishErrorValue instanceof Error ? finishErrorValue.message : String(finishErrorValue),
          )
        }
        this.notifyManagedRunFinished(conversationId, clientRunId)
        this.releaseManagedRun(clientRunId)
      }
      const usageFinishDeferred = Boolean(
        subagentUsageRuntime
        && subagentUsageRunStarted
        && this.completeSubagentUsageRunWhenChildrenSettle(
          subagentUsageRuntime,
          clientRunId,
          finishUsageRun,
        ),
      )
      if (!usageFinishDeferred) {
        await finishUsageRun()
      }
    }

    if (!session) {
      const result = {
        clientRunId,
        status: finishStatus,
        finalAnswer: finalAnswerForUsage,
        errorText: finishError,
      }
      notifyPromptSettled(options.onSettled, result)
      return result
    }

    const latestConversation = getConversationSummary(conversationId)
    if (getConversationPiSessionBinding(conversationId) && session.piHost) {
      rebuildConversationPiProjection({
        conversationId,
        title: latestConversation?.title || '新对话',
        sessionManager: session.piHost.session.sessionManager,
      })
    } else {
      persistConversationState(conversationId, latestConversation?.title || '新对话', [
        ...(session.agent.state.messages as AgentMessage[]),
      ])
    }
    this.projectArchiveSyncService.scheduleConversation(conversationId)
    if (resolvedProjectId) {
      this.projectArchiveSyncService.scheduleProject(resolvedProjectId)
    }
    this.emit({
      type: 'messages_updated',
      conversationId,
      promptSettled: true,
      ...(options.creationSource === 'subagent_completion' && options.subagentTaskId?.trim()
        ? { subagentTaskId: options.subagentTaskId.trim() }
        : {}),
    })

    const result = {
      clientRunId,
      status: finishStatus,
      finalAnswer: finalAnswerForUsage,
      errorText: finishError,
    }
    notifyPromptSettled(options.onSettled, result)
    return result
    } catch (error) {
      notifyPromptSettled(options.onSettled, {
        clientRunId,
        status: finishStatus === 'stopped' ? 'stopped' : 'failed',
        finalAnswer: finalAnswerForUsage,
        errorText: finishStatus === 'stopped'
          ? null
          : finishError || (error instanceof Error ? error.message : String(error)),
      })
      throw error
    } finally {
      this.finishActivePrompt(conversationId, promptActivity)
    }
  }
}

async function parseApiPayload(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()
  return text.length > 0 ? text : null
}


type ScreenshotEvidenceRole = 'construction' | 'dimension' | 'reference'

function inferScreenshotEvidenceRole(input: {
  messageText: string
  filename: string
  imageIndex: number
}): ScreenshotEvidenceRole {
  const text = `${input.messageText || ''} ${input.filename || ''}`.toLowerCase()
  if (/做法|构造|配筋|说明|剖面|section|method|rebar/.test(text)) {
    return 'construction'
  }
  if (/尺寸|标注|平面|截图|dimension|plan|size/.test(text)) {
    return 'dimension'
  }
  if (input.imageIndex === 0) {
    return 'dimension'
  }
  if (input.imageIndex === 1) {
    return 'construction'
  }
  return 'reference'
}

function extractApiError(payload: unknown): string | null {
  if (!payload) {
    return null
  }

  if (typeof payload === 'string') {
    return payload
  }

  if (typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  if (typeof record.error === 'string' && record.error.length > 0) {
    return record.error
  }
  if (typeof record.message === 'string' && record.message.length > 0) {
    return record.message
  }
  if (typeof record.detail === 'string' && record.detail.length > 0) {
    return record.detail
  }
  return null
}

function getBackendBaseUrl() {
  return (
    process.env.XIAOLIANG_BACKEND_BASE_URL?.trim()
    || process.env.VITE_BACKEND_BASE_URL?.trim()
    || FALLBACK_BACKEND_BASE_URL
  ).replace(/\/+$/, '')
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error('timeout'))
  }, timeoutMs)
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  return controller.signal
}

function mergeAbortSignals(primary: AbortSignal | undefined, secondary: AbortSignal): AbortSignal {
  if (!primary) {
    return secondary
  }
  if (primary.aborted) {
    return primary
  }
  if (secondary.aborted) {
    return secondary
  }

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([primary, secondary])
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  primary.addEventListener('abort', abort, { once: true })
  secondary.addEventListener('abort', abort, { once: true })
  return controller.signal
}

function getLatestUserMessageText(messages: unknown): string {
  return getGenuineUserText(messages)
}

function getToolNamesSinceLatestUser(messages: unknown): Set<string> {
  const names = new Set<string>()
  if (!Array.isArray(messages)) return names

  const start = findGenuineTurnStartIndex(messages)

  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index] as { role?: unknown; toolName?: unknown; content?: unknown }
    if (message.role === 'toolResult' && typeof message.toolName === 'string') {
      names.add(message.toolName)
    }
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue
      const candidate = block as { type?: unknown; name?: unknown }
      if (
        (candidate.type === 'toolCall' || candidate.type === 'tool')
        && typeof candidate.name === 'string'
      ) {
        names.add(candidate.name)
      }
    }
  }
  return names
}

interface RecentUserImageEvidence {
  hasImages: boolean
  imageTurns: number
  imageCount: number
  constructionImageCount: number
  dimensionImageCount: number
  referenceImageCount: number
}

function hasComponentWorkflowIntent(...texts: string[]) {
  const joined = texts
    .map((text) => String(text || '').trim())
    .filter(Boolean)
    .join('\n')
  if (!joined) {
    return false
  }
  return COMPONENT_WORKFLOW_INTENT_PATTERN.test(joined) || hasUserConfirmationSignal([joined])
}

function getRecentUserImageEvidence(messages: unknown, maxUserTurns = 3): RecentUserImageEvidence {
  if (!Array.isArray(messages)) {
    return {
      hasImages: false,
      imageTurns: 0,
      imageCount: 0,
      constructionImageCount: 0,
      dimensionImageCount: 0,
      referenceImageCount: 0,
    }
  }

  let remainingTurns = maxUserTurns
  let imageTurns = 0
  let imageCount = 0
  let constructionImageCount = 0
  let dimensionImageCount = 0
  let referenceImageCount = 0

  for (let index = messages.length - 1; index >= 0 && remainingTurns > 0; index -= 1) {
    const message = messages[index] as { role?: unknown; content?: unknown }
    if (message.role !== 'user') {
      continue
    }

    remainingTurns -= 1
    const evidence = extractMessageImageEvidence(message.content)
    if (evidence.imageCount > 0) {
      imageTurns += 1
      imageCount += evidence.imageCount
      constructionImageCount += evidence.constructionImageCount
      dimensionImageCount += evidence.dimensionImageCount
      referenceImageCount += evidence.referenceImageCount
    }
  }

  return {
    hasImages: imageCount > 0,
    imageTurns,
    imageCount,
    constructionImageCount,
    dimensionImageCount,
    referenceImageCount,
  }
}

function extractMessageImageEvidence(content: unknown) {
  if (!Array.isArray(content)) {
    return {
      imageCount: 0,
      constructionImageCount: 0,
      dimensionImageCount: 0,
      referenceImageCount: 0,
    }
  }

  const text = extractMessageTextContent(content)
  let imageCount = 0
  let constructionImageCount = 0
  let dimensionImageCount = 0
  let referenceImageCount = 0

  for (const block of content) {
    if (block?.type !== 'image') {
      continue
    }
    const role = inferScreenshotEvidenceRole({
      messageText: text,
      filename: '',
      imageIndex: imageCount,
    })
    imageCount += 1
    if (role === 'construction') {
      constructionImageCount += 1
    } else if (role === 'dimension') {
      dimensionImageCount += 1
    } else {
      referenceImageCount += 1
    }
  }

  return {
    imageCount,
    constructionImageCount,
    dimensionImageCount,
    referenceImageCount,
  }
}

function getRecentUserMessageTextWindow(messages: unknown, maxUserTurns = 3): string {
  return getGenuineUserTextWindow(messages, maxUserTurns)
}


async function openProjectArtifactWithDefaultApp(
  result: ProjectArtifactWriteResult,
): Promise<ProjectArtifactWriteResult> {
  try {
    const openError = await shell.openPath(result.absolutePath)
    if (openError) {
      return {
        ...result,
        opened: false,
        openError,
      }
    }
    return {
      ...result,
      opened: true,
      openError: null,
    }
  } catch (error) {
    return {
      ...result,
      opened: false,
      openError: error instanceof Error ? error.message : String(error),
    }
  }
}


function extractMessageTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  const chunks = content.flatMap((item) => {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      return trimmed ? [trimmed] : []
    }

    if (!item || typeof item !== 'object') {
      return []
    }

    const record = item as { type?: unknown; text?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') {
      const trimmed = record.text.trim()
      return trimmed ? [trimmed] : []
    }

    return []
  })

  return chunks.join('\n').trim()
}

function hasUserConfirmationSignal(texts: string[]): boolean {
  let confirmed = false
  for (const rawText of texts) {
    const text = String(rawText || '').trim()
    if (!text) {
      continue
    }
    if (USER_CONFIRM_NEGATIVE_PATTERN.test(text)) {
      confirmed = false
      continue
    }
    if (USER_CONFIRM_POSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
      confirmed = true
    }
  }
  return confirmed
}
