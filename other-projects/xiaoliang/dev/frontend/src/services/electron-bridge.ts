/**
 * 封装 preload 暴露的 `window.electronAPI`。
 * 仅包含当前 React UI 实际调用的方法（见 docs/electron-ipc.md）。
 */
import { IPC_INVOKE, IPC_ON, IPC_SEND } from '@/constants/ipc'
import {
  getDefaultAgentEnvironmentStatus,
  getDefaultBlenderMcpSettingsView,
  getDefaultFeishuSettingsView,
  getDefaultLlmSettingsView,
  getDefaultPowerSettingsView,
} from '@/shared/local-agent'
import type {
  AgentBashPrepareProgress,
  AgentBlenderMcpPrepareProgress,
  AgentEnvironmentStatus,
  AgentMessageRecord,
  AgentClearedQueue,
  AgentQueueKind,
  AgentInteractionResolution,
  AgentInteractionResponseInput,
  AgentStopScope,
  AgentPendingInteraction,
  AgentUiEvent,
  AgentWorkspaceCoreFileName,
  AgentWorkspaceStatus,
  BlenderMcpConnectionTestResult,
  BlenderMcpSettingsInput,
  BlenderMcpSettingsView,
  CadAutomationStatus,
  CadAutomationStatusRequest,
  CadAutomationDiagnostics,
  RestartCadAutomationBridgeRequest,
  RestartCadAutomationBridgeResult,
  InvalidateCadAutomationArtifactRequest,
  InvalidateCadAutomationArtifactResult,
  CadConnectRequest,
  CadConnectionInfo,
  CadSelectionInfo,
  CadDrawingArtifactStatus,
  ConversationCreationSource,
  AgentConversationRunSnapshot,
  ConversationPiSessionExportFormat,
  ConversationPiSessionExportResult,
  ConversationPiSessionImportResult,
  ConversationPiSessionInfo,
  PiRuntimeResourceStatus,
  ConversationAgentMode,
  ConversationSummary,
  PlanDocumentSnapshot,
  ConversationTreeBranchResult,
  ConversationTreeNavigateInput,
  ConversationTreeNavigateResult,
  ConversationTreeSnapshot,
  DrawingSummary,
  FeishuConnectionStatus,
  FeishuConnectionTestResult,
  FeishuSettingsInput,
  FeishuSettingsView,
  ImageAttachmentInput,
  LlmProfileSettingsInput,
  LlmSettingsView,
  PowerSettingsInput,
  PowerSettingsView,
  SkillInstallUpdateInput,
  SkillInstallUpdateResult,
  SkillRuntimeStatus,
  SkillUpdateCheckResult,
  UserSkillDeleteInput,
  UserSkillMutationResult,
  UserSkillReadResult,
  UserSkillSetEnabledInput,
  UserSkillUpsertInput,
  ProjectComponentFilter,
  ProjectComponentImageResult,
  ProjectComponentPatch,
  ProjectComponentRecord,
  ProjectComponentSummary,
  ProjectFilePreviewResult,
  ProjectPreviewDirectoryResult,
  ProjectSummary,
  ProjectContextStatus,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
  ExtractCadDrawingRequest,
  IndexCadDrawingVisualRequest,
  ReadCadDrawingRequest,
} from '@/shared/local-agent'
import type {
  AuthSessionData,
  AgentMessageFeedbackDeleteInput,
  AgentMessageFeedbackUpsertInput,
  AgentMessageFeedbackView,
  PromptTemplateView,
  PromptTemplateWriteInput,
  LoginRequest,
  LoginWithEmailCodeRequest,
  RegisterRequest,
  SendEmailCodeRequest,
  SendEmailCodeResponse,
} from '@/shared/backend-api'
import type { ThemeMode } from '@/types/render'
import type { UpdateStatusPayload } from '@/types/electron'
import { DEFAULT_WINDOW_STATE, type WindowMode, type WindowState } from '@/shared/window-state'
import type {
  SubagentTraceBlobData,
  SubagentTraceEvent,
  SubagentTracePage,
  SubagentTraceRunSummary,
} from '@/shared/subagent-trace'

export function isElectronApp(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

function getApi(): Window['electronAPI'] | undefined {
  if (!isElectronApp()) return undefined
  return window.electronAPI
}

const subagentTraceListeners = new Set<(event: SubagentTraceEvent) => void>()
let removeSubagentTraceSubscription: (() => void) | null = null

function subscribeToSubagentTrace(listener: (event: SubagentTraceEvent) => void): () => void {
  subagentTraceListeners.add(listener)
  if (!removeSubagentTraceSubscription) {
    removeSubagentTraceSubscription = getApi()?.on(IPC_ON.SUBAGENT_TRACE_EVENT, (event) => {
      for (const current of subagentTraceListeners) current(event)
    }) ?? null
  }
  return () => {
    subagentTraceListeners.delete(listener)
    if (subagentTraceListeners.size === 0) {
      removeSubagentTraceSubscription?.()
      removeSubagentTraceSubscription = null
    }
  }
}

function getDefaultAgentWorkspaceStatus(): AgentWorkspaceStatus {
  return {
    rootPath: null,
    rootExists: false,
    initialized: false,
    coreFiles: [],
    indexJsonPath: null,
    indexMarkdownPath: null,
    projectEntries: [],
    indexedProjectCount: 0,
    lastIndexedAt: null,
    warning: '当前不在 Electron 环境中。',
  }
}

export const electronBridge = {
  getBackendSession(): Promise<AuthSessionData | null> {
    const a = getApi()
    if (!a) return Promise.resolve(null)
    return a.invoke(IPC_INVOKE.AUTH_GET_SESSION)
  },

  loginBackend(payload: LoginRequest): Promise<AuthSessionData> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AUTH_LOGIN, payload)
  },

  sendBackendEmailCode(payload: SendEmailCodeRequest): Promise<SendEmailCodeResponse | undefined> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AUTH_SEND_EMAIL_CODE, payload)
  },

  loginBackendWithEmailCode(payload: LoginWithEmailCodeRequest): Promise<AuthSessionData> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AUTH_LOGIN_EMAIL_CODE, payload)
  },

  registerBackend(payload: RegisterRequest): Promise<AuthSessionData> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AUTH_REGISTER, payload)
  },

  logoutBackend(): Promise<{ ok: boolean }> {
    const a = getApi()
    if (!a) return Promise.resolve({ ok: true })
    return a.invoke(IPC_INVOKE.AUTH_LOGOUT)
  },

  syncBackendSession(): Promise<AuthSessionData | null> {
    const a = getApi()
    if (!a) return Promise.resolve(null)
    return a.invoke(IPC_INVOKE.AUTH_SYNC_PROFILE)
  },

  refreshBackendSession(): Promise<AuthSessionData | null> {
    const a = getApi()
    if (!a) return Promise.resolve(null)
    return a.invoke(IPC_INVOKE.AUTH_REFRESH_SESSION)
  },

  clearBackendSession(): Promise<{ ok: boolean }> {
    const a = getApi()
    if (!a) return Promise.resolve({ ok: true })
    return a.invoke(IPC_INVOKE.AUTH_CLEAR_SESSION)
  },

  getBillingProducts(): Promise<import('@/shared/backend-api').BillingProductView[]> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.BILLING_GET_PRODUCTS)
  },

  createBillingWeChatOrder(
    productId: string,
  ): Promise<import('@/shared/backend-api').WeChatNativeOrderView> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.BILLING_CREATE_WECHAT_ORDER, productId)
  },

  getBillingOrder(
    orderId: string,
  ): Promise<import('@/shared/backend-api').BillingOrderStatusView> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.BILLING_GET_ORDER, orderId)
  },

  syncBillingOrder(
    orderId: string,
  ): Promise<import('@/shared/backend-api').BillingOrderStatusView> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.BILLING_SYNC_ORDER, orderId)
  },

  getBillingQuota(): Promise<import('@/shared/backend-api').QuotaSummaryData | null> {
    const a = getApi()
    if (!a) return Promise.resolve(null)
    return a.invoke(IPC_INVOKE.BILLING_GET_QUOTA)
  },

  getConversationUsage(
    conversationId: string,
  ): Promise<import('@/shared/billing-domain').ConversationUsageChangedPayload | null> {
    const a = getApi()
    if (!a) return Promise.resolve(null)
    return a.invoke(IPC_INVOKE.BILLING_GET_CONVERSATION_USAGE, conversationId)
  },

  getSystemTheme(): Promise<ThemeMode> {
    const a = getApi()
    if (!a) return Promise.resolve('light')
    return a.invoke(IPC_INVOKE.THEME_GET_SYSTEM)
  },

  getLlmConfig(): Promise<LlmSettingsView> {
    const a = getApi()
    if (!a) return Promise.resolve(getDefaultLlmSettingsView())
    return a.invoke(IPC_INVOKE.SETTINGS_GET_LLM_CONFIG)
  },

  saveLlmConfig(input: LlmProfileSettingsInput): Promise<LlmSettingsView> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_SAVE_LLM_CONFIG, input)
  },

  getPowerConfig(): Promise<PowerSettingsView> {
    const a = getApi()
    if (!a) return Promise.resolve(getDefaultPowerSettingsView())
    return a.invoke(IPC_INVOKE.SETTINGS_GET_POWER_CONFIG)
  },

  savePowerConfig(input: PowerSettingsInput): Promise<PowerSettingsView> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_SAVE_POWER_CONFIG, input)
  },

  getFeishuConfig(): Promise<FeishuSettingsView> {
    const a = getApi()
    if (!a) return Promise.resolve(getDefaultFeishuSettingsView())
    return a.invoke(IPC_INVOKE.SETTINGS_GET_FEISHU_CONFIG)
  },

  saveFeishuConfig(input: FeishuSettingsInput): Promise<FeishuSettingsView> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_SAVE_FEISHU_CONFIG, input)
  },

  testFeishuConnection(input?: FeishuSettingsInput): Promise<FeishuConnectionTestResult> {
    const a = getApi()
    if (!a) {
      return Promise.resolve({
        success: false,
        latencyMs: 0,
        appId: input?.appId ?? '',
        error: '当前不在 Electron 环境中。',
      })
    }
    return a.invoke(IPC_INVOKE.SETTINGS_TEST_FEISHU_CONNECTION, input)
  },

  getFeishuStatus(): Promise<FeishuConnectionStatus> {
    const a = getApi()
    if (!a) {
      const fallback = getDefaultFeishuSettingsView()
      return Promise.resolve({
        enabled: fallback.enabled,
        configured: fallback.configured,
        running: false,
        phase: 'stopped',
        message: '当前不在 Electron 环境中。',
        updatedAt: new Date().toISOString(),
        lastEventAt: null,
        error: null,
      })
    }
    return a.invoke(IPC_INVOKE.SETTINGS_GET_FEISHU_STATUS)
  },

  getBlenderMcpConfig(): Promise<BlenderMcpSettingsView> {
    const a = getApi()
    if (!a) return Promise.resolve(getDefaultBlenderMcpSettingsView())
    return a.invoke(IPC_INVOKE.SETTINGS_GET_BLENDER_MCP_CONFIG)
  },

  saveBlenderMcpConfig(input: BlenderMcpSettingsInput): Promise<BlenderMcpSettingsView> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_SAVE_BLENDER_MCP_CONFIG, input)
  },

  testBlenderMcpConnection(): Promise<BlenderMcpConnectionTestResult> {
    const a = getApi()
    const fallback = getDefaultBlenderMcpSettingsView()
    if (!a) {
      return Promise.resolve({
        success: false,
        enabled: fallback.enabled,
        running: false,
        latencyMs: 0,
        host: fallback.host,
        port: fallback.port,
        command: fallback.command,
        args: fallback.args,
        toolCount: 0,
        tools: [],
        error: '当前不在 Electron 环境中。',
      })
    }
    return a.invoke(IPC_INVOKE.SETTINGS_TEST_BLENDER_MCP_CONNECTION)
  },

  getSkillStatus(): Promise<SkillRuntimeStatus> {
    const a = getApi()
    if (!a) {
      return Promise.resolve({
        releaseChannel: 'stable',
        skillPackVersion: '0.0.0',
        skillPackChecksum: '',
        builtAt: null,
        installedAt: null,
        source: 'bundled',
        skills: [],
        documentSkills: [],
        userSkills: [],
        userSkillRootPath: null,
        userSkillWarning: '当前不在 Electron 环境中。',
        algorithms: [],
      })
    }
    return a.invoke(IPC_INVOKE.SETTINGS_GET_SKILL_STATUS)
  },

  readUserSkill(slug: string): Promise<UserSkillReadResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_READ_USER_SKILL, slug)
  },

  upsertUserSkill(input: UserSkillUpsertInput): Promise<UserSkillMutationResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_UPSERT_USER_SKILL, input)
  },

  setUserSkillEnabled(input: UserSkillSetEnabledInput): Promise<UserSkillMutationResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_SET_USER_SKILL_ENABLED, input)
  },

  deleteUserSkill(input: UserSkillDeleteInput): Promise<UserSkillMutationResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_DELETE_USER_SKILL, input)
  },

  openUserSkillsDirectory(): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_OPEN_USER_SKILLS_DIRECTORY)
  },

  openUserSkillFile(slug: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_OPEN_USER_SKILL_FILE, slug)
  },

  checkSkillUpdates(releaseChannel = 'stable'): Promise<SkillUpdateCheckResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_CHECK_SKILL_UPDATES, releaseChannel)
  },

  installSkillUpdate(input?: SkillInstallUpdateInput): Promise<SkillInstallUpdateResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.SETTINGS_INSTALL_SKILL_UPDATE, input)
  },

  getAlwaysOnTop(): Promise<boolean> {
    const a = getApi()
    if (!a) return Promise.resolve(false)
    return a.invoke(IPC_INVOKE.WINDOW_GET_ALWAYS_ON_TOP)
  },

  getWindowState(): Promise<WindowState> {
    const a = getApi()
    if (!a) return Promise.resolve({ ...DEFAULT_WINDOW_STATE })
    return a.invoke(IPC_INVOKE.WINDOW_GET_STATE)
  },

  setWindowMode(mode: WindowMode): Promise<WindowState> {
    const a = getApi()
    if (!a) return Promise.resolve({ ...DEFAULT_WINDOW_STATE, mode })
    return a.invoke(IPC_INVOKE.WINDOW_SET_MODE, mode)
  },

  toggleMaximizeWindow(): Promise<WindowState> {
    const a = getApi()
    if (!a) return Promise.resolve({ ...DEFAULT_WINDOW_STATE })
    return a.invoke(IPC_INVOKE.WINDOW_TOGGLE_MAXIMIZE)
  },

  setWindowPinned(pinned: boolean): void {
    getApi()?.send(IPC_SEND.WINDOW_PIN, pinned)
  },

  minimizeWindow(): void {
    getApi()?.send(IPC_SEND.WINDOW_MINIMIZE)
  },

  closeWindow(): void {
    getApi()?.send(IPC_SEND.WINDOW_CLOSE)
  },

  toggleWindowSize(): void {
    getApi()?.send(IPC_SEND.WINDOW_TOGGLE_SIZE)
  },

  quitApp(): void {
    getApi()?.send(IPC_SEND.APP_QUIT)
  },

  openExternalUrl(url: string): Promise<{ ok: boolean }> {
    const a = getApi()
    if (!a) {
      window.open(url, '_blank', 'noopener,noreferrer')
      return Promise.resolve({ ok: true })
    }
    return a.invoke(IPC_INVOKE.APP_OPEN_EXTERNAL, url)
  },

  createConversation(
    creationSource: ConversationCreationSource = 'legacy_unknown',
  ): Promise<ConversationSummary> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_CREATE_CONVERSATION, creationSource)
  },

  createConversationInProject(
    projectId: string,
    title?: string,
    creationSource: ConversationCreationSource = 'legacy_unknown',
    thinkingMode?: 'fast' | 'deep',
  ): Promise<ConversationSummary> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(
      IPC_INVOKE.AGENT_CREATE_CONVERSATION_IN_PROJECT,
      projectId,
      title,
      creationSource,
      thinkingMode,
    )
  },

  createConversationInDrawing(
    drawingId: string,
    title?: string,
    creationSource: ConversationCreationSource = 'legacy_unknown',
    thinkingMode?: 'fast' | 'deep',
  ): Promise<ConversationSummary> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(
      IPC_INVOKE.AGENT_CREATE_CONVERSATION_IN_DRAWING,
      drawingId,
      title,
      creationSource,
      thinkingMode,
    )
  },

  listConversations(query?: string): Promise<ConversationSummary[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_LIST_CONVERSATIONS, query)
  },

  getRunningAgentConversations(): Promise<AgentConversationRunSnapshot[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_GET_RUNNING_CONVERSATIONS)
  },

  listProjectConversations(projectId: string, query?: string): Promise<ConversationSummary[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_LIST_PROJECT_CONVERSATIONS, projectId, query)
  },

  searchWorkspace(request: WorkspaceSearchRequest): Promise<WorkspaceSearchResult[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_SEARCH_WORKSPACE, request)
  },

  listProjects(): Promise<ProjectSummary[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_LIST_PROJECTS)
  },

  createProject(name: string, description?: string): Promise<ProjectSummary> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_CREATE_PROJECT, name, description)
  },

  createProjectFromDirectory(name?: string, description?: string): Promise<ProjectSummary | null> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_CREATE_PROJECT_FROM_DIRECTORY, name, description)
  },

  deleteProject(projectId: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_DELETE_PROJECT, projectId)
  },

  getAgentWorkspaceStatus(): Promise<AgentWorkspaceStatus> {
    const a = getApi()
    if (!a) return Promise.resolve(getDefaultAgentWorkspaceStatus())
    return a.invoke(IPC_INVOKE.AGENT_GET_WORKSPACE_STATUS)
  },

  selectAgentWorkspaceDirectory(): Promise<AgentWorkspaceStatus | null> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_SELECT_WORKSPACE_DIRECTORY)
  },

  clearAgentWorkspaceDirectory(): Promise<AgentWorkspaceStatus> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_CLEAR_WORKSPACE_DIRECTORY)
  },

  initializeAgentWorkspace(): Promise<AgentWorkspaceStatus> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_INITIALIZE_WORKSPACE)
  },

  refreshAgentWorkspaceIndex(): Promise<AgentWorkspaceStatus> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_REFRESH_WORKSPACE_INDEX)
  },

  openAgentWorkspaceDirectory(): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_OPEN_WORKSPACE_DIRECTORY)
  },

  openAgentWorkspaceFile(
    fileName: AgentWorkspaceCoreFileName | 'WORKSPACE_PROJECTS.md',
  ): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_OPEN_WORKSPACE_FILE, fileName)
  },

  selectProjectRootDirectory(projectId: string): Promise<ProjectSummary | null> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_SELECT_PROJECT_ROOT_DIRECTORY, projectId)
  },

  openProjectRootDirectory(projectId: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_OPEN_PROJECT_ROOT_DIRECTORY, projectId)
  },

  getProjectContextStatus(projectId: string): Promise<ProjectContextStatus> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_GET_PROJECT_CONTEXT_STATUS, projectId)
  },

  refreshProjectContextIndex(projectId: string): Promise<ProjectContextStatus> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_REFRESH_PROJECT_CONTEXT_INDEX, projectId)
  },

  createProjectAgentsFile(projectId: string): Promise<ProjectContextStatus> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_CREATE_PROJECT_AGENTS_FILE, projectId)
  },

  openProjectAgentsFile(projectId: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_OPEN_PROJECT_AGENTS_FILE, projectId)
  },

  openProjectIndexFile(projectId: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_OPEN_PROJECT_INDEX_FILE, projectId)
  },

  listProjectComponents(
    projectId: string,
    filter?: ProjectComponentFilter,
  ): Promise<ProjectComponentSummary[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_LIST_PROJECT_COMPONENTS, projectId, filter)
  },

  getProjectComponent(projectId: string, componentId: string): Promise<ProjectComponentRecord> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_GET_PROJECT_COMPONENT, projectId, componentId)
  },

  updateProjectComponent(
    projectId: string,
    componentId: string,
    patch: ProjectComponentPatch,
  ): Promise<ProjectComponentRecord> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_UPDATE_PROJECT_COMPONENT, projectId, componentId, patch)
  },

  confirmProjectComponents(
    projectId: string,
    componentIds: string[],
  ): Promise<ProjectComponentSummary[]> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_CONFIRM_PROJECT_COMPONENTS, projectId, componentIds)
  },

  deleteProjectComponent(projectId: string, componentId: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_DELETE_PROJECT_COMPONENT, projectId, componentId)
  },

  readProjectImage(projectId: string, relativePath: string): Promise<ProjectComponentImageResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_READ_PROJECT_IMAGE, projectId, relativePath)
  },

  listProjectPreviewDirectory(
    projectId: string,
    relativePath = '',
  ): Promise<ProjectPreviewDirectoryResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_LIST_PROJECT_PREVIEW_DIRECTORY, projectId, relativePath)
  },

  readProjectFilePreview(
    projectId: string,
    relativePath: string,
    offset = 0,
  ): Promise<ProjectFilePreviewResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_READ_PROJECT_FILE_PREVIEW, projectId, relativePath, offset)
  },

  listDrawings(projectId: string): Promise<DrawingSummary[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_LIST_DRAWINGS, projectId)
  },

  createDrawing(projectId: string, drawingName: string): Promise<DrawingSummary> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_CREATE_DRAWING, projectId, drawingName)
  },

  deleteDrawing(drawingId: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_DELETE_DRAWING, drawingId)
  },

  listDrawingConversations(drawingId: string): Promise<ConversationSummary[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_LIST_DRAWING_CONVERSATIONS, drawingId)
  },

  getConversationMessages(conversationId: string): Promise<AgentMessageRecord[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_GET_MESSAGES, conversationId)
  },

  getConversationSessionInfo(
    conversationId: string,
  ): Promise<ConversationPiSessionInfo | null> {
    const a = getApi()
    if (!a) return Promise.resolve(null)
    return a.invoke(IPC_INVOKE.AGENT_GET_SESSION_INFO, conversationId)
  },

  listConversationSessions(): Promise<ConversationPiSessionInfo[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_LIST_SESSIONS)
  },

  getConversationRuntimeResources(
    conversationId: string,
  ): Promise<PiRuntimeResourceStatus> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_GET_RUNTIME_RESOURCES, conversationId)
  },

  setConversationActiveTools(
    conversationId: string,
    toolNames: readonly string[],
  ): Promise<PiRuntimeResourceStatus> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_SET_ACTIVE_TOOLS, conversationId, [...toolNames])
  },

  exportConversationSession(
    conversationId: string,
    format: ConversationPiSessionExportFormat,
  ): Promise<ConversationPiSessionExportResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_EXPORT_SESSION, conversationId, format)
  },

  importConversationSession(
    conversationId: string,
  ): Promise<ConversationPiSessionImportResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_IMPORT_SESSION, conversationId)
  },

  getConversationTree(conversationId: string): Promise<ConversationTreeSnapshot> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_GET_SESSION_TREE, conversationId)
  },

  navigateConversationTree(
    input: ConversationTreeNavigateInput,
  ): Promise<ConversationTreeNavigateResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_NAVIGATE_SESSION_TREE, input)
  },

  forkConversationBefore(
    conversationId: string,
    targetEntryId: string,
  ): Promise<ConversationTreeBranchResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_FORK_CONVERSATION, conversationId, targetEntryId)
  },

  cloneConversationAt(
    conversationId: string,
    targetEntryId: string,
  ): Promise<ConversationTreeBranchResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_CLONE_CONVERSATION, conversationId, targetEntryId)
  },

  setConversationTreeLabel(
    conversationId: string,
    targetEntryId: string,
    label: string | null,
  ): Promise<ConversationTreeSnapshot> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(
      IPC_INVOKE.AGENT_SET_SESSION_ENTRY_LABEL,
      conversationId,
      targetEntryId,
      label,
    )
  },

  listSubagentRuns(conversationId: string): Promise<SubagentTraceRunSummary[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_LIST_SUBAGENT_RUNS, conversationId)
  },

  getSubagentTrace(
    childRunId: string,
    afterSequence = 0,
    limit = 200,
  ): Promise<SubagentTracePage> {
    const a = getApi()
    if (!a) {
      return Promise.resolve({ childRunId, events: [], nextSequence: afterSequence, hasMore: false })
    }
    return a.invoke(IPC_INVOKE.AGENT_GET_SUBAGENT_TRACE, childRunId, afterSequence, limit)
  },

  getSubagentTraceBlob(childRunId: string, sha256: string): Promise<SubagentTraceBlobData> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_GET_SUBAGENT_TRACE_BLOB, childRunId, sha256)
  },

  listAgentMessageFeedback(conversationId: string): Promise<AgentMessageFeedbackView[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.AGENT_LIST_MESSAGE_FEEDBACK, conversationId)
  },

  upsertAgentMessageFeedback(
    payload: AgentMessageFeedbackUpsertInput,
  ): Promise<AgentMessageFeedbackView> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_UPSERT_MESSAGE_FEEDBACK, payload)
  },

  deleteAgentMessageFeedback(
    payload: AgentMessageFeedbackDeleteInput,
  ): Promise<{ ok: boolean }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_DELETE_MESSAGE_FEEDBACK, payload)
  },

  listPromptTemplates(): Promise<PromptTemplateView[]> {
    const a = getApi()
    if (!a) return Promise.resolve([])
    return a.invoke(IPC_INVOKE.PROMPT_TEMPLATE_LIST)
  },

  createPromptTemplate(payload: PromptTemplateWriteInput): Promise<PromptTemplateView> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.PROMPT_TEMPLATE_CREATE, payload)
  },

  updatePromptTemplate(
    templateId: string,
    payload: PromptTemplateWriteInput,
  ): Promise<PromptTemplateView> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.PROMPT_TEMPLATE_UPDATE, templateId, payload)
  },

  deletePromptTemplate(templateId: string): Promise<{ ok: boolean }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.PROMPT_TEMPLATE_DELETE, templateId)
  },

  deleteConversation(conversationId: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_DELETE_CONVERSATION, conversationId)
  },

  renameConversation(conversationId: string, title: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_RENAME_CONVERSATION, conversationId, title)
  },

  sendAgentPrompt(
    conversationId: string,
    prompt: string,
    images?: ImageAttachmentInput[],
  ): Promise<{
    success: boolean
    error?: string
    code?: string
    status?: number
    details?: unknown
  }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_SEND_PROMPT, conversationId, prompt, images)
  },

  compactAgentContext(
    conversationId: string,
    instructions?: string,
  ): Promise<{ success: true; status: 'completed' | 'stopped' }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_COMPACT_CONTEXT, conversationId, instructions)
  },

  abortAgentCompaction(conversationId: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_ABORT_COMPACTION, conversationId)
  },

  abortAgentBranchSummary(conversationId: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_ABORT_BRANCH_SUMMARY, conversationId)
  },

  abortAgentRetry(conversationId: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_ABORT_RETRY, conversationId)
  },

  steerAgent(
    conversationId: string,
    text: string,
    images: ImageAttachmentInput[] = [],
  ): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_STEER, conversationId, text, images)
  },

  followUpAgent(
    conversationId: string,
    text: string,
    images: ImageAttachmentInput[] = [],
  ): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_FOLLOW_UP, conversationId, text, images)
  },

  removeQueueItem(conversationId: string, id: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_REMOVE_QUEUE_ITEM, conversationId, id)
  },

  updateQueueItem(
    conversationId: string,
    id: string,
    text: string,
    images: ImageAttachmentInput[] = [],
  ): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_UPDATE_QUEUE_ITEM, conversationId, id, text, images)
  },

  setQueueItemKind(
    conversationId: string,
    id: string,
    kind: AgentQueueKind,
  ): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_SET_QUEUE_ITEM_KIND, conversationId, id, kind)
  },

  clearAgentQueue(
    conversationId: string,
  ): Promise<{ success: true; cleared: AgentClearedQueue }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_CLEAR_QUEUE, conversationId)
  },

  getPendingAgentInteraction(conversationId: string): Promise<AgentPendingInteraction | null> {
    const a = getApi()
    if (!a) return Promise.resolve(null)
    return a.invoke(IPC_INVOKE.AGENT_GET_PENDING_INTERACTION, conversationId)
  },

  resolveAgentInteraction(
    input: AgentInteractionResponseInput,
  ): Promise<AgentInteractionResolution> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_RESOLVE_INTERACTION, input)
  },

  stopAgent(
    conversationId: string,
    scope: AgentStopScope = 'main',
  ): Promise<{ success: true; cleared: AgentClearedQueue }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_STOP, conversationId, scope)
  },

  cancelAgentSubagents(
    conversationId: string,
  ): Promise<{ success: true; cancelled: number }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_CANCEL_SUBAGENTS, conversationId)
  },

  resetConversation(conversationId: string): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_RESET_CONVERSATION, conversationId)
  },

  setConversationPinned(
    conversationId: string,
    pinned: boolean,
  ): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_SET_CONVERSATION_PINNED, conversationId, pinned)
  },

  setConversationPreferredModel(
    conversationId: string,
    modelId: string | null,
  ): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_SET_CONVERSATION_PREFERRED_MODEL, conversationId, modelId)
  },

  setConversationThinkingMode(
    conversationId: string,
    mode: 'fast' | 'deep',
  ): Promise<{ success: true; appliedAt: 'now' | 'next_turn' }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_SET_CONVERSATION_THINKING_MODE, conversationId, mode)
  },

  setConversationMode(
    conversationId: string,
    mode: ConversationAgentMode,
  ): Promise<{ success: true }> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_SET_CONVERSATION_MODE, conversationId, mode)
  },

  getPlanDocument(conversationId: string): Promise<PlanDocumentSnapshot> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_GET_PLAN_DOCUMENT, conversationId)
  },

  openPlanApproval(conversationId: string): Promise<AgentPendingInteraction> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_OPEN_PLAN_APPROVAL, conversationId)
  },

  getCadAutomationStatus(
    request: CadAutomationStatusRequest = {},
  ): Promise<CadAutomationStatus> {
    const a = getApi()
    if (!a) {
      return Promise.resolve({
        mode: 'disabled',
        featureFlag: 'off',
        projectId: request.projectId?.trim() || null,
        projectRootReady: false,
        automaticEntityExtraction: false,
        automaticVisualIndexing: false,
        automaticPreciseReading: false,
        requiresManualSelection: false,
        manualPreprocessingVisible: false,
        developerToolsAvailable: false,
        activeRun: null,
        activeRuns: [],
        readiness: null,
        message: '当前不在 Electron 环境中。',
        updatedAt: new Date().toISOString(),
      })
    }
    return a.invoke(IPC_INVOKE.AGENT_GET_CAD_AUTOMATION_STATUS, request)
  },

  getCadAutomationDiagnostics(
    request: CadAutomationStatusRequest = {},
  ): Promise<CadAutomationDiagnostics> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_GET_CAD_AUTOMATION_DIAGNOSTICS, request)
  },

  restartCadAutomationBridge(
    request: RestartCadAutomationBridgeRequest = {},
  ): Promise<RestartCadAutomationBridgeResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_RESTART_CAD_AUTOMATION_BRIDGE, request)
  },

  invalidateCadAutomationArtifact(
    request: InvalidateCadAutomationArtifactRequest,
  ): Promise<InvalidateCadAutomationArtifactResult> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_INVALIDATE_CAD_AUTOMATION_ARTIFACT, request)
  },

  getCadConnectionStatus(): Promise<CadConnectionInfo> {
    const a = getApi()
    if (!a) {
      return Promise.resolve({
        connected: false,
        message: '当前不在 Electron 环境中。',
        updatedAt: new Date().toISOString(),
      })
    }
    return a.invoke(IPC_INVOKE.AGENT_GET_CAD_CONNECTION_STATUS)
  },

  getCadSelectionStatus(): Promise<CadSelectionInfo> {
    const a = getApi()
    if (!a) {
      return Promise.resolve({
        ready: false,
        connected: false,
        count: 0,
        handles: [],
        message: '当前不在 Electron 环境中。',
        updatedAt: new Date().toISOString(),
      })
    }
    return a.invoke(IPC_INVOKE.AGENT_GET_CAD_SELECTION_STATUS)
  },

  connectCad(request?: CadConnectRequest): Promise<CadConnectionInfo> {
    const a = getApi()
    if (!a) {
      return Promise.resolve({
        connected: false,
        message: '当前不在 Electron 环境中。',
        updatedAt: new Date().toISOString(),
      })
    }
    return a.invoke(IPC_INVOKE.AGENT_CONNECT_CAD, request)
  },

  prepareCadDrawing(request?: CadConnectRequest): Promise<{ success: true; message: string }> {
    const a = getApi()
    if (!a) {
      return Promise.reject(new Error('当前不在 Electron 环境中。'))
    }
    return a.invoke(IPC_INVOKE.AGENT_PREPARE_CAD_DRAWING, request)
  },

  readCadDrawing(request: ReadCadDrawingRequest): Promise<CadDrawingArtifactStatus> {
    const a = getApi()
    if (!a) {
      return Promise.reject(new Error('当前不在 Electron 环境中。'))
    }
    return a.invoke(IPC_INVOKE.AGENT_READ_CAD_DRAWING, request)
  },

  extractCadDrawing(request: ExtractCadDrawingRequest): Promise<CadDrawingArtifactStatus> {
    const a = getApi()
    if (!a) {
      return Promise.reject(new Error('当前不在 Electron 环境中。'))
    }
    return a.invoke(IPC_INVOKE.AGENT_EXTRACT_CAD_DRAWING, request)
  },

  async indexCadDrawingVisual(
    request: IndexCadDrawingVisualRequest,
  ): Promise<CadDrawingArtifactStatus> {
    const a = getApi()
    if (!a) {
      return Promise.reject(new Error('当前不在 Electron 环境中。'))
    }
    const response = await a.invoke(IPC_INVOKE.AGENT_INDEX_CAD_DRAWING_VISUAL, request)
    if (response && typeof response === 'object' && 'success' in response) {
      if (response.success === false) {
        const err = new Error(response.error || '视觉识图失败。') as Error & {
          code?: string
          status?: number
          details?: unknown
        }
        err.code = response.code
        err.status = response.status
        err.details = response.details
        throw err
      }
      return response.result
    }
    // Backward-compat if main process still returns bare artifact.
    return response as CadDrawingArtifactStatus
  },

  getCadDrawingStatus(drawingId: string): Promise<CadDrawingArtifactStatus | null> {
    const a = getApi()
    if (!a) return Promise.resolve(null)
    return a.invoke(IPC_INVOKE.AGENT_GET_CAD_DRAWING_STATUS, drawingId)
  },

  onThemeChanged(cb: (theme: ThemeMode) => void): (() => void) | null {
    return getApi()?.on(IPC_ON.THEME_CHANGED, cb) ?? null
  },

  onWindowStateChanged(cb: (state: WindowState) => void): (() => void) | null {
    return getApi()?.on(IPC_ON.WINDOW_STATE_CHANGED, cb) ?? null
  },

  onUpdateStatus(cb: (payload: UpdateStatusPayload) => void): (() => void) | null {
    return getApi()?.on(IPC_ON.UPDATE_STATUS, cb) ?? null
  },

  onBillingQuotaChanged(
    cb: (quota: import('@/shared/backend-api').QuotaSummaryData) => void,
  ): (() => void) | null {
    return getApi()?.on(IPC_ON.BILLING_QUOTA_CHANGED, cb) ?? null
  },

  onBillingRunUsageChanged(
    cb: (payload: import('@/shared/billing-domain').ConversationUsageChangedPayload) => void,
  ): (() => void) | null {
    return getApi()?.on(IPC_ON.BILLING_RUN_USAGE_CHANGED, cb) ?? null
  },

  getAgentEnvironmentStatus(): Promise<AgentEnvironmentStatus> {
    const a = getApi()
    if (!a) return Promise.resolve(getDefaultAgentEnvironmentStatus())
    return a.invoke(IPC_INVOKE.AGENT_ENV_GET_STATUS)
  },

  prepareAgentBashRuntime(): Promise<AgentEnvironmentStatus> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_ENV_PREPARE_BASH)
  },

  onAgentBashPrepareProgress(
    cb: (progress: AgentBashPrepareProgress) => void,
  ): (() => void) | null {
    return getApi()?.on(IPC_ON.AGENT_ENV_BASH_PREPARE_PROGRESS, cb) ?? null
  },

  prepareAgentBlenderMcpRuntime(): Promise<AgentEnvironmentStatus> {
    const a = getApi()
    if (!a) return Promise.reject(new Error('当前不在 Electron 环境中。'))
    return a.invoke(IPC_INVOKE.AGENT_ENV_PREPARE_BLENDER_MCP)
  },

  onAgentBlenderMcpPrepareProgress(
    cb: (progress: AgentBlenderMcpPrepareProgress) => void,
  ): (() => void) | null {
    return getApi()?.on(IPC_ON.AGENT_ENV_BLENDER_MCP_PREPARE_PROGRESS, cb) ?? null
  },

  getAppUpdateStatus() {
    return getApi()?.invoke(IPC_INVOKE.APP_UPDATE_GET_STATUS) ?? Promise.resolve(null)
  },

  checkForAppUpdate() {
    return getApi()?.invoke(IPC_INVOKE.APP_UPDATE_CHECK) ?? Promise.resolve(null)
  },

  installAppUpdate() {
    return getApi()?.invoke(IPC_INVOKE.APP_UPDATE_INSTALL) ?? Promise.resolve(null)
  },

  onAgentEvent(cb: (payload: AgentUiEvent) => void): (() => void) | null {
    return getApi()?.on(IPC_ON.AGENT_EVENT, cb) ?? null
  },

  onSubagentTraceEvent(cb: (payload: SubagentTraceEvent) => void): () => void {
    return subscribeToSubagentTrace(cb)
  },

}
