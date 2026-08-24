// Electron preload API（与 electron/preload.js 对齐）
import type {
  AgentBashPrepareProgress,
  AgentBlenderMcpPrepareProgress,
  AgentEnvironmentStatus,
  AgentMessageRecord,
  AgentClearedQueue,
  AgentConversationRunSnapshot,
  AgentInteractionResolution,
  AgentInteractionResponseInput,
  AgentStopScope,
  AgentPendingInteraction,
  AgentQueueKind,
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
  ConversationAgentMode,
  ConversationCreationSource,
  PlanDocumentSnapshot,
  ConversationPiSessionExportFormat,
  ConversationPiSessionExportResult,
  ConversationPiSessionImportResult,
  ConversationPiSessionInfo,
  PiRuntimeResourceStatus,
  ConversationSummary,
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
  BillingOrderStatusView,
  BillingProductView,
  AgentMessageFeedbackDeleteInput,
  AgentMessageFeedbackUpsertInput,
  AgentMessageFeedbackView,
  PromptTemplateView,
  PromptTemplateWriteInput,
  LoginRequest,
  LoginWithEmailCodeRequest,
  QuotaSummaryData,
  RegisterRequest,
  SendEmailCodeRequest,
  SendEmailCodeResponse,
  WeChatNativeOrderView,
} from '@/shared/backend-api'
import type { ConversationUsageChangedPayload } from '@/shared/billing-domain'
import type { ThemeMode } from './render'
import type { WindowMode, WindowState } from '@/shared/window-state'
import type {
  SubagentTraceBlobData,
  SubagentTraceEvent,
  SubagentTracePage,
  SubagentTraceRunSummary,
} from '@/shared/subagent-trace'

export type WindowSendChannel =
  | 'window:minimize'
  | 'window:close'
  | 'window:pin'
  | 'window:toggle-size'
  | 'app:quit'

export interface ScreenshotSource {
  id: string
  name: string
  thumbnail: string
}

export interface ScreenDisplay {
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  size?: { width: number; height: number }
  workArea?: { x: number; y: number; width: number; height: number }
  internal?: boolean
}

export interface ScreenshotData {
  id: string
  name: string
  thumbnail: string
  display: ScreenDisplay
}

export interface ScreenshotResult {
  success: boolean
  data?: ScreenshotData | ScreenshotData[]
  count?: number
  error?: string
  timestamp: number
}

export interface ScreenshotStatus {
  isCapturing: boolean
  timestamp: number
}

export interface ScreenshotOptions {
  thumbnailWidth?: number
  thumbnailHeight?: number
}

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateStatusPayload {
  phase: UpdatePhase
  version?: string | null
  percent?: number | null
  message?: string | null
  forceUpdate?: boolean | null
  forceUpdateMessage?: string | null
}

export interface ElectronAPI {
  invoke(channel: 'theme:getSystemTheme'): Promise<ThemeMode>
  invoke(channel: 'theme:setTheme', theme: ThemeMode): Promise<'light' | 'dark'>
  invoke(channel: 'window:getAlwaysOnTopStatus'): Promise<boolean>
  invoke(channel: 'window:getState'): Promise<WindowState>
  invoke(channel: 'window:setMode', mode: WindowMode): Promise<WindowState>
  invoke(channel: 'window:toggleMaximize'): Promise<WindowState>
  invoke(channel: 'app:openExternal', url: string): Promise<{ ok: boolean }>
  invoke(channel: 'appUpdate:getStatus'): Promise<unknown>
  invoke(channel: 'appUpdate:check'): Promise<unknown>
  invoke(channel: 'appUpdate:install'): Promise<unknown>
  invoke(channel: 'auth:getSession'): Promise<AuthSessionData | null>
  invoke(channel: 'auth:login', payload: LoginRequest): Promise<AuthSessionData>
  invoke(channel: 'auth:sendEmailCode', payload: SendEmailCodeRequest): Promise<SendEmailCodeResponse | undefined>
  invoke(channel: 'auth:loginEmailCode', payload: LoginWithEmailCodeRequest): Promise<AuthSessionData>
  invoke(channel: 'auth:register', payload: RegisterRequest): Promise<AuthSessionData>
  invoke(channel: 'auth:logout'): Promise<{ ok: boolean }>
  invoke(channel: 'auth:syncProfile'): Promise<AuthSessionData | null>
  invoke(channel: 'auth:refreshSession'): Promise<AuthSessionData | null>
  invoke(channel: 'auth:clearSession'): Promise<{ ok: boolean }>
  invoke(channel: 'screenshot:getScreenSources'): Promise<ScreenshotSource[] | { success: false; error: string }>
  invoke(channel: 'screenshot:getWindowSources'): Promise<ScreenshotSource[] | { success: false; error: string }>
  invoke(
    channel: 'screenshot:captureSource',
    sourceId: string,
    options?: ScreenshotOptions
  ): Promise<ScreenshotResult>
  invoke(channel: 'screenshot:captureDesktop', options?: ScreenshotOptions): Promise<ScreenshotResult>
  invoke(channel: 'screenshot:captureAllScreens', options?: ScreenshotOptions): Promise<ScreenshotResult>
  invoke(channel: 'screenshot:getStatus'): Promise<ScreenshotStatus>
  invoke(channel: 'settings:getLlmConfig'): Promise<LlmSettingsView>
  invoke(channel: 'settings:saveLlmConfig', input: LlmProfileSettingsInput): Promise<LlmSettingsView>
  invoke(channel: 'settings:getPowerConfig'): Promise<PowerSettingsView>
  invoke(channel: 'settings:savePowerConfig', input: PowerSettingsInput): Promise<PowerSettingsView>
  invoke(channel: 'settings:getFeishuConfig'): Promise<FeishuSettingsView>
  invoke(channel: 'settings:saveFeishuConfig', input: FeishuSettingsInput): Promise<FeishuSettingsView>
  invoke(
    channel: 'settings:testFeishuConnection',
    input?: FeishuSettingsInput
  ): Promise<FeishuConnectionTestResult>
  invoke(channel: 'settings:getFeishuStatus'): Promise<FeishuConnectionStatus>
  invoke(channel: 'settings:getBlenderMcpConfig'): Promise<BlenderMcpSettingsView>
  invoke(
    channel: 'settings:saveBlenderMcpConfig',
    input: BlenderMcpSettingsInput
  ): Promise<BlenderMcpSettingsView>
  invoke(channel: 'settings:testBlenderMcpConnection'): Promise<BlenderMcpConnectionTestResult>
  invoke(channel: 'settings:getSkillStatus'): Promise<SkillRuntimeStatus>
  invoke(channel: 'settings:readUserSkill', slug: string): Promise<UserSkillReadResult>
  invoke(
    channel: 'settings:upsertUserSkill',
    input: UserSkillUpsertInput
  ): Promise<UserSkillMutationResult>
  invoke(
    channel: 'settings:setUserSkillEnabled',
    input: UserSkillSetEnabledInput
  ): Promise<UserSkillMutationResult>
  invoke(
    channel: 'settings:deleteUserSkill',
    input: UserSkillDeleteInput
  ): Promise<UserSkillMutationResult>
  invoke(channel: 'settings:openUserSkillsDirectory'): Promise<{ success: true }>
  invoke(channel: 'settings:openUserSkillFile', slug: string): Promise<{ success: true }>
  invoke(channel: 'settings:checkSkillUpdates', releaseChannel?: string): Promise<SkillUpdateCheckResult>
  invoke(
    channel: 'settings:installSkillUpdate',
    input?: SkillInstallUpdateInput
  ): Promise<SkillInstallUpdateResult>
  invoke(
    channel: 'agent:createConversation',
    creationSource?: ConversationCreationSource
  ): Promise<ConversationSummary>
  invoke(
    channel: 'agent:createConversationInProject',
    projectId: string,
    title?: string,
    creationSource?: ConversationCreationSource,
    thinkingMode?: 'fast' | 'deep'
  ): Promise<ConversationSummary>
  invoke(
    channel: 'agent:createConversationInDrawing',
    drawingId: string,
    title?: string,
    creationSource?: ConversationCreationSource,
    thinkingMode?: 'fast' | 'deep'
  ): Promise<ConversationSummary>
  invoke(channel: 'agent:listConversations', query?: string): Promise<ConversationSummary[]>
  invoke(channel: 'agent:getRunningConversations'): Promise<AgentConversationRunSnapshot[]>
  invoke(
    channel: 'agent:listProjectConversations',
    projectId: string,
    query?: string
  ): Promise<ConversationSummary[]>
  invoke(
    channel: 'agent:searchWorkspace',
    request: WorkspaceSearchRequest
  ): Promise<WorkspaceSearchResult[]>
  invoke(channel: 'agent:listProjects'): Promise<ProjectSummary[]>
  invoke(channel: 'agent:createProject', name: string, description?: string): Promise<ProjectSummary>
  invoke(
    channel: 'agent:createProjectFromDirectory',
    name?: string,
    description?: string
  ): Promise<ProjectSummary | null>
  invoke(channel: 'agent:deleteProject', projectId: string): Promise<{ success: true }>
  invoke(channel: 'agent:getWorkspaceStatus'): Promise<AgentWorkspaceStatus>
  invoke(channel: 'agent:selectWorkspaceDirectory'): Promise<AgentWorkspaceStatus | null>
  invoke(channel: 'agent:clearWorkspaceDirectory'): Promise<AgentWorkspaceStatus>
  invoke(channel: 'agent:initializeWorkspace'): Promise<AgentWorkspaceStatus>
  invoke(channel: 'agent:refreshWorkspaceIndex'): Promise<AgentWorkspaceStatus>
  invoke(channel: 'agent:openWorkspaceDirectory'): Promise<{ success: true }>
  invoke(
    channel: 'agent:openWorkspaceFile',
    fileName: AgentWorkspaceCoreFileName | 'WORKSPACE_PROJECTS.md'
  ): Promise<{ success: true }>
  invoke(channel: 'agent:selectProjectRootDirectory', projectId: string): Promise<ProjectSummary | null>
  invoke(channel: 'agent:openProjectRootDirectory', projectId: string): Promise<{ success: true }>
  invoke(channel: 'agent:getProjectContextStatus', projectId: string): Promise<ProjectContextStatus>
  invoke(channel: 'agent:refreshProjectContextIndex', projectId: string): Promise<ProjectContextStatus>
  invoke(channel: 'agent:createProjectAgentsFile', projectId: string): Promise<ProjectContextStatus>
  invoke(channel: 'agent:openProjectAgentsFile', projectId: string): Promise<{ success: true }>
  invoke(channel: 'agent:openProjectIndexFile', projectId: string): Promise<{ success: true }>
  invoke(
    channel: 'agent:listProjectComponents',
    projectId: string,
    filter?: ProjectComponentFilter
  ): Promise<ProjectComponentSummary[]>
  invoke(
    channel: 'agent:getProjectComponent',
    projectId: string,
    componentId: string
  ): Promise<ProjectComponentRecord>
  invoke(
    channel: 'agent:updateProjectComponent',
    projectId: string,
    componentId: string,
    patch: ProjectComponentPatch
  ): Promise<ProjectComponentRecord>
  invoke(
    channel: 'agent:confirmProjectComponents',
    projectId: string,
    componentIds: string[]
  ): Promise<ProjectComponentSummary[]>
  invoke(
    channel: 'agent:deleteProjectComponent',
    projectId: string,
    componentId: string
  ): Promise<{ success: true }>
  invoke(
    channel: 'agent:readProjectImage',
    projectId: string,
    relativePath: string
  ): Promise<ProjectComponentImageResult>
  invoke(
    channel: 'agent:listProjectPreviewDirectory',
    projectId: string,
    relativePath?: string
  ): Promise<ProjectPreviewDirectoryResult>
  invoke(
    channel: 'agent:readProjectFilePreview',
    projectId: string,
    relativePath: string,
    offset?: number
  ): Promise<ProjectFilePreviewResult>
  invoke(channel: 'agent:listDrawings', projectId: string): Promise<DrawingSummary[]>
  invoke(channel: 'agent:createDrawing', projectId: string, drawingName: string): Promise<DrawingSummary>
  invoke(channel: 'agent:deleteDrawing', drawingId: string): Promise<{ success: true }>
  invoke(channel: 'agent:listDrawingConversations', drawingId: string): Promise<ConversationSummary[]>
  invoke(channel: 'agent:getMessages', conversationId: string): Promise<AgentMessageRecord[]>
  invoke(
    channel: 'agent:getSessionInfo',
    conversationId: string
  ): Promise<ConversationPiSessionInfo | null>
  invoke(channel: 'agent:listSessions'): Promise<ConversationPiSessionInfo[]>
  invoke(
    channel: 'agent:getRuntimeResources',
    conversationId: string
  ): Promise<PiRuntimeResourceStatus>
  invoke(
    channel: 'agent:setActiveTools',
    conversationId: string,
    toolNames: string[]
  ): Promise<PiRuntimeResourceStatus>
  invoke(
    channel: 'agent:exportSession',
    conversationId: string,
    format: ConversationPiSessionExportFormat
  ): Promise<ConversationPiSessionExportResult>
  invoke(
    channel: 'agent:importSession',
    conversationId: string
  ): Promise<ConversationPiSessionImportResult>
  invoke(
    channel: 'agent:getSessionTree',
    conversationId: string
  ): Promise<ConversationTreeSnapshot>
  invoke(
    channel: 'agent:navigateSessionTree',
    input: ConversationTreeNavigateInput
  ): Promise<ConversationTreeNavigateResult>
  invoke(
    channel: 'agent:forkConversation',
    conversationId: string,
    targetEntryId: string
  ): Promise<ConversationTreeBranchResult>
  invoke(
    channel: 'agent:cloneConversation',
    conversationId: string,
    targetEntryId: string
  ): Promise<ConversationTreeBranchResult>
  invoke(
    channel: 'agent:setSessionEntryLabel',
    conversationId: string,
    targetEntryId: string,
    label: string | null
  ): Promise<ConversationTreeSnapshot>
  invoke(channel: 'agent:listSubagentRuns', conversationId: string): Promise<SubagentTraceRunSummary[]>
  invoke(
    channel: 'agent:getSubagentTrace',
    childRunId: string,
    afterSequence?: number,
    limit?: number
  ): Promise<SubagentTracePage>
  invoke(
    channel: 'agent:getSubagentTraceBlob',
    childRunId: string,
    sha256: string
  ): Promise<SubagentTraceBlobData>
  invoke(channel: 'agent:listMessageFeedback', conversationId: string): Promise<AgentMessageFeedbackView[]>
  invoke(channel: 'agent:upsertMessageFeedback', payload: AgentMessageFeedbackUpsertInput): Promise<AgentMessageFeedbackView>
  invoke(channel: 'agent:deleteMessageFeedback', payload: AgentMessageFeedbackDeleteInput): Promise<{ ok: boolean }>
  invoke(channel: 'promptTemplate:list'): Promise<PromptTemplateView[]>
  invoke(channel: 'promptTemplate:create', payload: PromptTemplateWriteInput): Promise<PromptTemplateView>
  invoke(channel: 'promptTemplate:update', templateId: string, payload: PromptTemplateWriteInput): Promise<PromptTemplateView>
  invoke(channel: 'promptTemplate:delete', templateId: string): Promise<{ ok: boolean }>
  invoke(channel: 'agent:deleteConversation', conversationId: string): Promise<{ success: true }>
  invoke(channel: 'agent:renameConversation', conversationId: string, title: string): Promise<{ success: true }>
  invoke(channel: 'billing:getProducts'): Promise<BillingProductView[]>
  invoke(channel: 'billing:createWeChatOrder', productId: string): Promise<WeChatNativeOrderView>
  invoke(channel: 'billing:getOrder', orderId: string): Promise<BillingOrderStatusView>
  invoke(channel: 'billing:syncOrder', orderId: string): Promise<BillingOrderStatusView>
  invoke(channel: 'billing:getQuota'): Promise<QuotaSummaryData | null>
  invoke(
    channel: 'billing:getConversationUsage',
    conversationId: string
  ): Promise<ConversationUsageChangedPayload | null>
  invoke(
    channel: 'agent:sendPrompt',
    conversationId: string,
    prompt: string,
    images?: ImageAttachmentInput[]
  ): Promise<{
    success: boolean
    error?: string
    code?: string
    status?: number
    details?: unknown
  }>
  invoke(
    channel: 'agent:compactContext',
    conversationId: string,
    instructions?: string
  ): Promise<{ success: true; status: 'completed' | 'stopped' }>
  invoke(channel: 'agent:abortCompaction', conversationId: string): Promise<{ success: true }>
  invoke(channel: 'agent:abortBranchSummary', conversationId: string): Promise<{ success: true }>
  invoke(channel: 'agent:abortRetry', conversationId: string): Promise<{ success: true }>
  invoke(
    channel: 'agent:steer',
    conversationId: string,
    text: string,
    images?: ImageAttachmentInput[],
  ): Promise<{ success: true }>
  invoke(
    channel: 'agent:followUp',
    conversationId: string,
    text: string,
    images?: ImageAttachmentInput[],
  ): Promise<{ success: true }>
  invoke(
    channel: 'agent:removeQueueItem',
    conversationId: string,
    id: string,
  ): Promise<{ success: true }>
  invoke(
    channel: 'agent:updateQueueItem',
    conversationId: string,
    id: string,
    text: string,
    images?: ImageAttachmentInput[],
  ): Promise<{ success: true }>
  invoke(
    channel: 'agent:setQueueItemKind',
    conversationId: string,
    id: string,
    kind: AgentQueueKind,
  ): Promise<{ success: true }>
  invoke(
    channel: 'agent:clearQueue',
    conversationId: string
  ): Promise<{ success: true; cleared: AgentClearedQueue }>
  invoke(
    channel: 'agent:getPendingInteraction',
    conversationId: string
  ): Promise<AgentPendingInteraction | null>
  invoke(
    channel: 'agent:resolveInteraction',
    input: AgentInteractionResponseInput
  ): Promise<AgentInteractionResolution>
  invoke(
    channel: 'agent:stop',
    conversationId: string,
    scope?: AgentStopScope
  ): Promise<{ success: true; cleared: AgentClearedQueue }>
  invoke(
    channel: 'agent:cancelSubagents',
    conversationId: string
  ): Promise<{ success: true; cancelled: number }>
  invoke(channel: 'agent:resetConversation', conversationId: string): Promise<{ success: true }>
  invoke(channel: 'agent:setConversationPinned', conversationId: string, pinned: boolean): Promise<{ success: true }>
  invoke(
    channel: 'agent:setConversationPreferredModel',
    conversationId: string,
    modelId: string | null
  ): Promise<{ success: true }>
  invoke(
    channel: 'agent:setConversationThinkingMode',
    conversationId: string,
    mode: 'fast' | 'deep'
  ): Promise<{ success: true; appliedAt: 'now' | 'next_turn' }>
  invoke(
    channel: 'agent:setConversationMode',
    conversationId: string,
    mode: ConversationAgentMode
  ): Promise<{ success: true }>
  invoke(
    channel: 'agent:getPlanDocument',
    conversationId: string
  ): Promise<PlanDocumentSnapshot>
  invoke(
    channel: 'agent:openPlanApproval',
    conversationId: string
  ): Promise<AgentPendingInteraction>
  invoke(
    channel: 'agent:getCadAutomationStatus',
    request?: CadAutomationStatusRequest
  ): Promise<CadAutomationStatus>
  invoke(
    channel: 'agent:getCadAutomationDiagnostics',
    request?: CadAutomationStatusRequest
  ): Promise<CadAutomationDiagnostics>
  invoke(
    channel: 'agent:restartCadAutomationBridge',
    request?: RestartCadAutomationBridgeRequest
  ): Promise<RestartCadAutomationBridgeResult>
  invoke(
    channel: 'agent:invalidateCadAutomationArtifact',
    request: InvalidateCadAutomationArtifactRequest
  ): Promise<InvalidateCadAutomationArtifactResult>
  invoke(channel: 'agent:getCadConnectionStatus'): Promise<CadConnectionInfo>
  invoke(channel: 'agent:getCadSelectionStatus'): Promise<CadSelectionInfo>
  invoke(channel: 'agent:connectCad', request?: CadConnectRequest): Promise<CadConnectionInfo>
  invoke(
    channel: 'agent:prepareCadDrawing',
    request?: CadConnectRequest
  ): Promise<{ success: true; message: string }>
  invoke(
    channel: 'agent:readCadDrawing',
    request: ReadCadDrawingRequest
  ): Promise<CadDrawingArtifactStatus>
  invoke(
    channel: 'agent:extractCadDrawing',
    request: ExtractCadDrawingRequest
  ): Promise<CadDrawingArtifactStatus>
  invoke(
    channel: 'agent:indexCadDrawingVisual',
    request: IndexCadDrawingVisualRequest
  ): Promise<
    | { success: true; result: CadDrawingArtifactStatus }
    | { success: false; error: string; code?: string; status?: number; details?: unknown }
  >
  invoke(
    channel: 'agent:getCadDrawingStatus',
    drawingId: string
  ): Promise<CadDrawingArtifactStatus | null>
  invoke(channel: 'agentEnv:getStatus'): Promise<AgentEnvironmentStatus>
  invoke(channel: 'agentEnv:prepareBash'): Promise<AgentEnvironmentStatus>
  invoke(channel: 'agentEnv:prepareBlenderMcp'): Promise<AgentEnvironmentStatus>
  send(channel: WindowSendChannel, ...args: unknown[]): void

  on(channel: 'theme:changed', callback: (theme: ThemeMode) => void): (() => void) | null
  on(channel: 'window:stateChanged', callback: (state: WindowState) => void): (() => void) | null
  on(channel: 'update:status', callback: (payload: UpdateStatusPayload) => void): (() => void) | null
  on(
    channel: 'billing:quotaChanged',
    callback: (quota: QuotaSummaryData) => void
  ): (() => void) | null
  on(
    channel: 'billing:runUsageChanged',
    callback: (payload: ConversationUsageChangedPayload) => void
  ): (() => void) | null
  on(channel: 'agent:event', callback: (payload: AgentUiEvent) => void): (() => void) | null
  on(
    channel: 'subagent:traceEvent',
    callback: (payload: SubagentTraceEvent) => void
  ): (() => void) | null
  on(
    channel: 'agentEnv:bashPrepareProgress',
    callback: (progress: AgentBashPrepareProgress) => void
  ): (() => void) | null
  on(
    channel: 'agentEnv:blenderMcpPrepareProgress',
    callback: (progress: AgentBlenderMcpPrepareProgress) => void
  ): (() => void) | null

  environment: {
    readonly versions: {
      readonly chrome: string
      readonly node: string
      readonly electron: string
    }
    readonly platform: NodeJS.Platform
  }
}

declare global {
  interface Window {
    readonly electronAPI: ElectronAPI
  }
}

export {}
