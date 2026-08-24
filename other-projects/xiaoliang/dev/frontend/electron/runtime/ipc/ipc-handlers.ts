import { app, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import type {
  AgentUiEvent,
  AgentInteractionResponseInput,
  AgentStopScope,
  CadAutomationStatusRequest,
  RestartCadAutomationBridgeRequest,
  InvalidateCadAutomationArtifactRequest,
  BlenderMcpSettingsInput,
  ConversationCreationSource,
  ConversationPiSessionExportFormat,
  ConversationTreeNavigateInput,
  FeishuSettingsInput,
  ImageAttachmentInput,
  LlmProfileSettingsInput,
  PowerSettingsInput,
  SkillInstallUpdateInput,
  AgentWorkspaceCoreFileName,
  UserSkillDeleteInput,
  UserSkillSetEnabledInput,
  UserSkillUpsertInput,
  ProjectComponentFilter,
  ProjectComponentPatch,
  WorkspaceSearchRequest,
  SubagentRunUpdate,
} from '../../../src/shared/local-agent'
import { IPC_INVOKE, IPC_ON, IPC_SEND } from '../../../src/shared/ipc-contract'
import type {
  AgentMessageFeedbackDeleteInput,
  AgentMessageFeedbackUpsertInput,
  PromptTemplateWriteInput,
  QuotaSummaryData,
} from '../../../src/shared/backend-api'
import type { SubagentTraceEvent } from '../../../src/shared/subagent-trace'
import { isWindowMode } from '../../../src/shared/window-state'
import type { ThemeMode } from '../../../src/types/render'
import type { ScreenshotManager } from '../../shell/screenshot-manager'
import type { ThemeManager } from '../../shell/theme-manager'
import type { TrayManager } from '../../shell/tray-manager'
import type { WindowManager } from '../../shell/window-manager'
import type { AppUpdateManager } from '../../shell/auto-update-manager'
import { AgentSessionManager } from '../agent/sessions/agent-session-manager'
import { ProjectComponentService } from '../project-files/project-component-service'
import { CadPreviewService } from '../cad/mlight/cad-preview-service'
import { ProjectFileService } from '../project-files/project-file-service'
import { AuthSessionService } from '../auth/auth-session-service'
import { billingApiClient } from '../backend/billing-client'
import { agentFeedbackApiClient } from '../backend/agent-feedback-client'
import { promptTemplateApiClient } from '../backend/prompt-template-client'
import { BackendApiError, setBackendTokenRefresher } from '../backend/http'
import { serializeAgentError } from '../billing/quota-errors'
import { CreditBalanceMonitor } from '../billing/credit-balance-monitor'
import { RunUsageMonitor } from '../billing/run-usage-monitor'
import {
  readConversationUsage,
  upsertConversationUsageRun,
} from '../billing/run-usage-store'
import { agentUsageApiClient } from '../backend/agent-usage-client'
import type { ConversationUsageChangedPayload } from '../../../src/shared/billing-domain'
import { closeDB } from '../db'
import {
  getConversationSummary,
  resolveCanonicalMessageId,
  resolveExternalMessageId,
} from '../conversations/conversation-repository'
import { SecretStore } from '../secrets/secret-store'
import { SkillPackSyncService } from '../agent/skills/sync/skill-pack-sync-service'
import {
  describePiBashEnvironment,
  getSearchToolsStatus,
  isBashPreparationInflight,
  prepareManagedBashRuntime,
} from '../agent/pi/pi-bash-runtime'
import { isPiFeatureEnabled } from '../agent/pi/feature-flags'
import { userSkillService } from '../agent/user-skills/service'
import { blenderMcpClientManager } from '../agent/mcp/blender-mcp-service'
import {
  describeBlenderMcpRuntime,
  isBlenderMcpPreparationInflight,
  prepareBlenderMcpRuntime,
  resolvePackageSpec,
} from '../agent/mcp/blender-mcp-runtime'
import { FeishuChannelService } from '../feishu/feishu-channel-service'
import { AgentNotificationDeduplicator } from './agent-notification-deduplicator'
import {
  getBlenderMcpSettingsView,
  saveBlenderMcpSettings,
} from '../settings/blender-mcp-settings-repository'
import {
  getFeishuAppSecretRef,
  getFeishuSettingsView,
  upsertFeishuSettings,
} from '../settings/feishu-settings-repository'
import {
  getLlmSettingsView,
  getStoredApiKeyRef,
  upsertLlmProfileSettings,
} from '../settings/settings-repository'
import {
  getPowerSettings,
  savePowerSettings,
} from '../settings/power-settings-repository'
import { syncPowerSaveBlocker } from '../power/power-save-manager'

const SUBAGENT_TRAY_COMPLETION_COPY: Record<SubagentRunUpdate['type'], string> = {
  'cad-analyst': 'CAD 子代理取证已完成。',
  'cad-drafter': 'CAD 子代理取证已完成。',
  'blender-modeler': 'Blender 子代理任务已完成。',
  'research-analyst': '调研取证已完成。',
}

const AGENT_WORKSPACE_OPENABLE_FILES = new Set<AgentWorkspaceCoreFileName>([
  'AGENTS.md',
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'TOOLS.md',
  'BOOTSTRAP.md',
])

function legacyCadManualDisabled(): never {
  throw new BackendApiError(
    '手动 CAD 通道已停用；请在算量识图或设计会话中让 CAD 子代理自动取证。',
    409,
    'legacy_cad_manual_disabled',
  )
}

function resolveAgentEventProjectId(conversationId: string): string | null {
  try {
    return getConversationSummary(conversationId)?.projectId ?? null
  } catch {
    // Shutdown or database teardown must not turn a best-effort UI annotation
    // into an Agent event delivery failure.
    return null
  }
}

export class IPCHandlers {
  private readonly secretStore = new SecretStore()
  private readonly authSessionService = new AuthSessionService()
  private readonly skillPackSyncService = new SkillPackSyncService(async () => {
    const session = await this.authSessionService.getSession()
    return session?.access_token?.trim() || null
  })
  private readonly projectComponentService = new ProjectComponentService()
  private readonly cadPreviewService = new CadPreviewService()
  private readonly projectFileService = new ProjectFileService(
    undefined,
    (request) => this.cadPreviewService.grant(request),
  )
  private readonly agentNotificationDeduplicator = new AgentNotificationDeduplicator()
  private readonly agentSessionManager: AgentSessionManager
  private readonly creditBalanceMonitor: CreditBalanceMonitor<QuotaSummaryData>
  private readonly runUsageMonitor: RunUsageMonitor
  private feishuChannelService: FeishuChannelService | null = null

  constructor(
    private readonly windowManager: WindowManager,
    private readonly trayManager: TrayManager,
    private readonly themeManager: ThemeManager,
    private readonly screenshotManager: ScreenshotManager,
    private readonly appUpdateManager: AppUpdateManager | null = null,
  ) {
    setBackendTokenRefresher(async () => {
      const refreshed = await this.authSessionService.refreshSession()
      return refreshed?.access_token?.trim() || null
    })
    this.creditBalanceMonitor = new CreditBalanceMonitor({
      readQuota: async () => (await this.authSessionService.readQuotaSnapshot())?.quota ?? null,
      publish: (quota) => this.emitBillingQuotaChanged(quota),
    })
    this.runUsageMonitor = new RunUsageMonitor({
      readUsage: async (clientRunId) => {
        const token = this.authSessionService.peekAccessToken()
        if (!token) return null
        return agentUsageApiClient.getRunUsage(token, clientRunId)
      },
      persist: (conversationId, detail) => upsertConversationUsageRun(conversationId, detail),
      publish: (payload) => this.emitBillingRunUsageChanged(payload),
    })
    this.agentSessionManager = new AgentSessionManager(
      (event) => {
        this.emitAgentEvent(event)
      },
      {
        screenshotManager: this.screenshotManager,
        getBackendSession: () => this.authSessionService.getSession(),
        emitSubagentTrace: (event) => this.emitSubagentTraceEvent(event),
        onManagedCallSettled: (settlement) => {
          this.creditBalanceMonitor.notifySpend()
          if (settlement.conversationId) {
            this.runUsageMonitor.notifySettled(settlement.conversationId, settlement.clientRunId)
          }
        },
        onManagedRunFinished: (conversationId, clientRunId) => {
          this.runUsageMonitor.flushFinal(conversationId, clientRunId)
        },
        onSubagentWakeSettled: (settlement) => {
          this.feishuChannelService?.handleSubagentWakeSettled(settlement)
        },
      },
    )
    this.feishuChannelService = new FeishuChannelService({
      agent: this.agentSessionManager,
      secretStore: this.secretStore,
      getBackendSession: () => this.authSessionService.getSession(),
    })
    this.setupIPCHandlers()
    void this.feishuChannelService.startIfEnabled()
  }

  private emitAgentEvent(event: AgentUiEvent) {
    const win = this.windowManager.getMainWindow()
    const rendererEvent: AgentUiEvent = (
      event.type === 'agent_settled'
      || event.type === 'error'
      || event.type === 'messages_updated'
    )
      ? {
          ...event,
          projectId: resolveAgentEventProjectId(event.conversationId),
        }
      : event
    const windowUnfocused = !win || win.isDestroyed() || !win.isFocused()
    const isPromptSettlementRefresh = event.type === 'messages_updated'
      && event.promptSettled === true
    const isDuplicateSubagentWake = isPromptSettlementRefresh
      && this.agentNotificationDeduplicator.consumeSubagentWakeDuplicate(event.subagentTaskId)
    if (!win || win.isDestroyed()) {
      console.warn('[ipc] AGENT_EVENT skipped: main window missing or destroyed', event.type)
    } else {
      win.webContents.send(IPC_ON.AGENT_EVENT, rendererEvent)
    }
    if (windowUnfocused) {
      if (isPromptSettlementRefresh && !isDuplicateSubagentWake) {
        this.trayManager.showTrayNotification('晓量任务已完成', '后台会话已生成回复。')
      } else if (event.type === 'subagent_run' && event.update.status === 'completed') {
        const notificationShown = this.trayManager.showTrayNotification(
          '晓量子代理已完成',
          SUBAGENT_TRAY_COMPLETION_COPY[event.update.type],
        )
        if (notificationShown) {
          this.agentNotificationDeduplicator.markSubagentCompletionNotified(event.update.childRunId)
        }
      }
    }
    this.feishuChannelService?.handleAgentEvent(event)
  }

  private emitSubagentTraceEvent(event: SubagentTraceEvent) {
    const win = this.windowManager.getMainWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(IPC_ON.SUBAGENT_TRACE_EVENT, event)
  }

  private emitBillingQuotaChanged(quota: QuotaSummaryData) {
    const win = this.windowManager.getMainWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(IPC_ON.BILLING_QUOTA_CHANGED, quota)
  }

  private emitBillingRunUsageChanged(payload: ConversationUsageChangedPayload) {
    const win = this.windowManager.getMainWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(IPC_ON.BILLING_RUN_USAGE_CHANGED, payload)
  }

  private setupIPCHandlers() {
    this.setupWindowHandlers()
    this.setupThemeHandlers()
    this.setupAuthHandlers()
    this.setupBillingHandlers()
    this.setupScreenshotHandlers()
    this.setupSettingsHandlers()
    this.setupAgentHandlers()
    this.setupEnvironmentHandlers()
    this.setupAppHandlers()
  }

  /** 设置页「环境检测与准备」:bash / Blender MCP 依赖状态与一键准备。 */
  private setupEnvironmentHandlers() {
    const buildEnvironmentStatus = () => {
      const bash = describePiBashEnvironment()
      const blenderSettings = getBlenderMcpSettingsView()
      const blenderRuntime = describeBlenderMcpRuntime(blenderSettings)
      return {
        piCodingToolsEnabled: isPiFeatureEnabled('pi_runtime_v2')
          && isPiFeatureEnabled('pi_coding_tools'),
        bash: { ...bash, preparing: isBashPreparationInflight() },
        searchTools: getSearchToolsStatus(),
        blenderMcp: { ...blenderRuntime, preparing: isBlenderMcpPreparationInflight() },
      }
    }

    ipcMain.handle(IPC_INVOKE.AGENT_ENV_GET_STATUS, () => buildEnvironmentStatus())

    ipcMain.handle(IPC_INVOKE.AGENT_ENV_PREPARE_BASH, async () => {
      await prepareManagedBashRuntime({
        onProgress: (progress) => {
          const win = this.windowManager.getMainWindow()
          if (!win || win.isDestroyed()) return
          win.webContents.send(IPC_ON.AGENT_ENV_BASH_PREPARE_PROGRESS, progress)
        },
      })
      return buildEnvironmentStatus()
    })

    ipcMain.handle(IPC_INVOKE.AGENT_ENV_PREPARE_BLENDER_MCP, async () => {
      const settings = getBlenderMcpSettingsView()
      await prepareBlenderMcpRuntime({
        packageSpec: resolvePackageSpec(settings.args),
        onProgress: (progress) => {
          const win = this.windowManager.getMainWindow()
          if (!win || win.isDestroyed()) return
          win.webContents.send(IPC_ON.AGENT_ENV_BLENDER_MCP_PREPARE_PROGRESS, progress)
        },
      })
      return buildEnvironmentStatus()
    })
  }

  private setupWindowHandlers() {
    ipcMain.on(IPC_SEND.WINDOW_PIN, (_event, shouldPin: boolean) => {
      this.windowManager.setWindowPin(shouldPin)
    })

    ipcMain.handle(IPC_INVOKE.WINDOW_GET_ALWAYS_ON_TOP, () => {
      return this.windowManager.isWindowAlwaysOnTop()
    })

    ipcMain.handle(IPC_INVOKE.WINDOW_GET_STATE, () => {
      return this.windowManager.getWindowState()
    })

    ipcMain.handle(IPC_INVOKE.WINDOW_SET_MODE, (_event, mode: unknown) => {
      if (!isWindowMode(mode)) {
        throw new Error('无效的窗口模式。')
      }
      return this.windowManager.setWindowMode(mode)
    })

    ipcMain.handle(IPC_INVOKE.WINDOW_TOGGLE_MAXIMIZE, () => {
      return this.windowManager.toggleMaximize()
    })

    ipcMain.on(IPC_SEND.WINDOW_MINIMIZE, () => {
      this.windowManager.minimizeWindow()
    })

    ipcMain.on(IPC_SEND.WINDOW_CLOSE, (event) => {
      event.preventDefault()
      this.windowManager.hideWindow()
    })

    ipcMain.on(IPC_SEND.WINDOW_TOGGLE_SIZE, () => {
      this.windowManager.toggleWindowSize()
    })
  }

  private setupThemeHandlers() {
    ipcMain.handle(IPC_INVOKE.THEME_GET_SYSTEM, () => {
      return this.themeManager.getSystemTheme()
    })

    ipcMain.handle(IPC_INVOKE.THEME_SET, (_event, theme: ThemeMode) => {
      return this.themeManager.setTheme(theme)
    })
  }

  private setupAppHandlers() {
    ipcMain.handle(IPC_INVOKE.APP_OPEN_EXTERNAL, async (_event, url: string) => {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        console.warn('[ipc] blocked malformed external URL')
        return { ok: false as const }
      }
      if (!new Set(['https:', 'http:', 'mailto:']).has(parsed.protocol)) {
        console.warn('[ipc] blocked external URL protocol', { protocol: parsed.protocol })
        return { ok: false as const }
      }
      await shell.openExternal(parsed.href)
      return { ok: true as const }
    })

    ipcMain.handle(IPC_INVOKE.APP_UPDATE_GET_STATUS, () => {
      return this.appUpdateManager?.getStatus() ?? null
    })

    ipcMain.handle(IPC_INVOKE.APP_UPDATE_CHECK, async () => {
      return (await this.appUpdateManager?.checkForUpdates()) ?? null
    })

    ipcMain.handle(IPC_INVOKE.APP_UPDATE_INSTALL, () => {
      return this.appUpdateManager?.installUpdate() ?? null
    })

    ipcMain.on(IPC_SEND.APP_QUIT, () => {
      app.quit()
    })
  }

  private setupAuthHandlers() {
    ipcMain.handle(IPC_INVOKE.AUTH_GET_SESSION, async () => {
      return this.authSessionService.getSession()
    })

    ipcMain.handle(IPC_INVOKE.AUTH_LOGIN, async (_event, payload) => {
      const session = await this.authSessionService.login(payload)
      this.agentSessionManager.scheduleAllProjectArchiveSync()
      return session
    })

    ipcMain.handle(IPC_INVOKE.AUTH_SEND_EMAIL_CODE, async (_event, payload) => {
      return this.authSessionService.sendEmailLoginCode(payload)
    })

    ipcMain.handle(IPC_INVOKE.AUTH_LOGIN_EMAIL_CODE, async (_event, payload) => {
      const session = await this.authSessionService.loginWithEmailCode(payload)
      this.agentSessionManager.scheduleAllProjectArchiveSync()
      return session
    })

    ipcMain.handle(IPC_INVOKE.AUTH_REGISTER, async (_event, payload) => {
      const session = await this.authSessionService.register(payload)
      this.agentSessionManager.scheduleAllProjectArchiveSync()
      return session
    })

    ipcMain.handle(IPC_INVOKE.AUTH_LOGOUT, async () => {
      return this.authSessionService.logout()
    })

    ipcMain.handle(IPC_INVOKE.AUTH_SYNC_PROFILE, async () => {
      return this.authSessionService.syncProfile()
    })

    ipcMain.handle(IPC_INVOKE.AUTH_REFRESH_SESSION, async () => {
      return this.authSessionService.refreshSession()
    })

    ipcMain.handle(IPC_INVOKE.AUTH_CLEAR_SESSION, async () => {
      return this.authSessionService.clearSession()
    })
  }

  private setupBillingHandlers() {
    ipcMain.handle(IPC_INVOKE.BILLING_GET_PRODUCTS, async () => {
      return billingApiClient.listProducts()
    })

    ipcMain.handle(IPC_INVOKE.BILLING_CREATE_WECHAT_ORDER, async (_event, productId: string) => {
      const session = await this.authSessionService.getSession()
      const token = session?.access_token?.trim()
      if (!token) throw new Error('请先登录。')
      return billingApiClient.createWeChatNativeOrder(token, productId)
    })

    ipcMain.handle(IPC_INVOKE.BILLING_GET_ORDER, async (_event, orderId: string) => {
      const session = await this.authSessionService.getSession()
      const token = session?.access_token?.trim()
      if (!token) throw new Error('请先登录。')
      return billingApiClient.getOrder(token, orderId)
    })

    ipcMain.handle(IPC_INVOKE.BILLING_SYNC_ORDER, async (_event, orderId: string) => {
      const session = await this.authSessionService.getSession()
      const token = session?.access_token?.trim()
      if (!token) throw new Error('请先登录。')
      return billingApiClient.syncOrder(token, orderId)
    })

    ipcMain.handle(IPC_INVOKE.BILLING_GET_QUOTA, async () => {
      const session = await this.authSessionService.readQuotaSnapshot()
      return session?.quota ?? null
    })

    ipcMain.handle(IPC_INVOKE.BILLING_GET_CONVERSATION_USAGE, (_event, conversationId: string) => {
      try {
        return readConversationUsage(conversationId)
      } catch {
        return null
      }
    })
  }

  private setupScreenshotHandlers() {
    ipcMain.handle(IPC_INVOKE.SCREENSHOT_GET_SCREEN_SOURCES, async () => {
      try {
        return await this.screenshotManager.getScreenSources()
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    })

    ipcMain.handle(IPC_INVOKE.SCREENSHOT_GET_WINDOW_SOURCES, async () => {
      try {
        return await this.screenshotManager.getWindowSources()
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    })

    ipcMain.handle(
      IPC_INVOKE.SCREENSHOT_CAPTURE_SOURCE,
      async (_event, sourceId: string, options?: Record<string, unknown>) => {
        return this.screenshotManager.captureScreenshot(sourceId, options)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.SCREENSHOT_CAPTURE_DESKTOP,
      async (_event, options?: Record<string, unknown>) => {
        return this.screenshotManager.captureDesktop(options)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.SCREENSHOT_CAPTURE_ALL_SCREENS,
      async (_event, options?: Record<string, unknown>) => {
        return this.screenshotManager.captureAllScreens(options)
      },
    )

    ipcMain.handle(IPC_INVOKE.SCREENSHOT_GET_STATUS, () => {
      return this.screenshotManager.getStatus()
    })
  }

  private setupSettingsHandlers() {
    ipcMain.handle(IPC_INVOKE.SETTINGS_GET_LLM_CONFIG, async () => {
      return getLlmSettingsView()
    })

    ipcMain.handle(IPC_INVOKE.SETTINGS_GET_POWER_CONFIG, async () => {
      return getPowerSettings()
    })

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_SAVE_POWER_CONFIG,
      async (_event, input: PowerSettingsInput = {}) => {
        const next = savePowerSettings(input)
        syncPowerSaveBlocker(next.preventSleep)
        return next
      },
    )

    ipcMain.handle(IPC_INVOKE.SETTINGS_GET_BLENDER_MCP_CONFIG, async () => {
      return getBlenderMcpSettingsView()
    })

    ipcMain.handle(IPC_INVOKE.SETTINGS_GET_FEISHU_CONFIG, async () => {
      return getFeishuSettingsView()
    })

    ipcMain.handle(IPC_INVOKE.SETTINGS_GET_FEISHU_STATUS, async () => {
      return this.feishuChannelService?.getStatus()
    })

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_SAVE_FEISHU_CONFIG,
      async (_event, input: FeishuSettingsInput) => {
        const current = getFeishuSettingsView()
        const secretRef = getFeishuAppSecretRef()
        let nextSecretRef = current.hasAppSecret ? secretRef : null

        if (typeof input.appSecret === 'string' && input.appSecret.trim()) {
          nextSecretRef = secretRef
          await this.secretStore.setSecret(secretRef, input.appSecret.trim())
        }

        const { appSecret: _appSecret, ...settingsInput } = input
        const next = upsertFeishuSettings({
          ...settingsInput,
          secretRef: nextSecretRef,
        })
        await this.feishuChannelService?.restart()
        return next
      },
    )

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_TEST_FEISHU_CONNECTION,
      async (_event, input?: FeishuSettingsInput) => {
        return this.feishuChannelService?.testConnection(input)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_SAVE_BLENDER_MCP_CONFIG,
      async (_event, input: BlenderMcpSettingsInput) => {
        await blenderMcpClientManager.close()
        return saveBlenderMcpSettings(input)
      },
    )

    ipcMain.handle(IPC_INVOKE.SETTINGS_TEST_BLENDER_MCP_CONNECTION, async () => {
      return blenderMcpClientManager.testConnection()
    })

    ipcMain.handle(IPC_INVOKE.SETTINGS_GET_SKILL_STATUS, async () => {
      return this.skillPackSyncService.getStatus()
    })

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_READ_USER_SKILL,
      async (_event, slug: string) => {
        return userSkillService.readSkill(slug)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_UPSERT_USER_SKILL,
      async (_event, input: UserSkillUpsertInput) => {
        const skill = userSkillService.upsertSkill(input)
        return {
          status: this.skillPackSyncService.getStatus(),
          skill,
        }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_SET_USER_SKILL_ENABLED,
      async (_event, input: UserSkillSetEnabledInput) => {
        const skill = userSkillService.setEnabled(input)
        return {
          status: this.skillPackSyncService.getStatus(),
          skill,
        }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_DELETE_USER_SKILL,
      async (_event, input: UserSkillDeleteInput) => {
        userSkillService.deleteSkill(input)
        return {
          status: this.skillPackSyncService.getStatus(),
          skill: null,
        }
      },
    )

    ipcMain.handle(IPC_INVOKE.SETTINGS_OPEN_USER_SKILLS_DIRECTORY, async () => {
      const rootPath = userSkillService.ensureSkillsRoot()
      const error = await shell.openPath(rootPath)
      if (error) throw new Error(error)
      return { success: true }
    })

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_OPEN_USER_SKILL_FILE,
      async (_event, slug: string) => {
        const skillPath = userSkillService.getSkillFilePath(slug)
        if (!fs.existsSync(skillPath)) {
          throw new Error(`用户 skill 不存在：${slug}`)
        }
        const error = await shell.openPath(skillPath)
        if (error) throw new Error(error)
        return { success: true }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_CHECK_SKILL_UPDATES,
      async (_event, releaseChannel?: string) => {
        return this.skillPackSyncService.checkUpdates(releaseChannel)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_INSTALL_SKILL_UPDATE,
      async (_event, input?: SkillInstallUpdateInput) => {
        const result = await this.skillPackSyncService.installUpdate(input)
        await this.agentSessionManager.reloadActivePiResources()
        return result
      },
    )

    ipcMain.handle(
      IPC_INVOKE.SETTINGS_SAVE_LLM_CONFIG,
      async (_event, input: LlmProfileSettingsInput) => {
        const currentSecretRef = getStoredApiKeyRef(input.profileId)

        return upsertLlmProfileSettings({
          profileId: input.profileId,
          model: input.model,
          reasoningLevel: input.reasoningLevel,
          makeActive: input.makeActive,
          secretRef: currentSecretRef,
        })
      },
    )
  }

  private setupAgentHandlers() {
    ipcMain.handle(
      IPC_INVOKE.AGENT_CREATE_CONVERSATION,
      async (_event, creationSource?: ConversationCreationSource) => {
        return this.agentSessionManager.createConversation(creationSource)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_CREATE_CONVERSATION_IN_PROJECT,
      async (
        _event,
        projectId: string,
        title?: string,
        creationSource?: ConversationCreationSource,
        thinkingMode?: 'fast' | 'deep',
      ) => {
        return this.agentSessionManager.createConversationInProject(
          projectId,
          title,
          creationSource,
          thinkingMode,
        )
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_CREATE_CONVERSATION_IN_DRAWING,
      async (
        _event,
        drawingId: string,
        title?: string,
        creationSource?: ConversationCreationSource,
        thinkingMode?: 'fast' | 'deep',
      ) => {
        return this.agentSessionManager.createConversationInDrawing(
          drawingId,
          title,
          creationSource,
          thinkingMode,
        )
      },
    )

    ipcMain.handle(IPC_INVOKE.AGENT_LIST_CONVERSATIONS, async (_event, query?: string) => {
      return this.agentSessionManager.listConversations(query)
    })

    ipcMain.handle(IPC_INVOKE.AGENT_GET_RUNNING_CONVERSATIONS, async () => {
      return this.agentSessionManager.getRunningConversations()
    })

    ipcMain.handle(
      IPC_INVOKE.AGENT_LIST_PROJECT_CONVERSATIONS,
      async (_event, projectId: string, query?: string) => {
        return this.agentSessionManager.listProjectConversations(projectId, query)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_SEARCH_WORKSPACE,
      async (_event, input: WorkspaceSearchRequest) => {
        return this.agentSessionManager.searchWorkspace(input)
      },
    )

    ipcMain.handle(IPC_INVOKE.AGENT_LIST_PROJECTS, async () => {
      return this.agentSessionManager.listProjects()
    })

    ipcMain.handle(
      IPC_INVOKE.AGENT_CREATE_PROJECT,
      async (_event, name: string, description?: string) => {
        return this.agentSessionManager.createProject(name, description)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_CREATE_PROJECT_FROM_DIRECTORY,
      async (_event, name?: string, description?: string) => {
        const mainWindow = this.windowManager.getMainWindow()
        const hasProjectName = typeof name === 'string' && name.trim().length > 0
        const options: Electron.OpenDialogOptions = {
          title: hasProjectName ? '选择项目文件夹' : '使用现有文件夹',
          buttonLabel: hasProjectName ? '选择并创建' : '使用此文件夹',
          properties: ['openDirectory', 'createDirectory'],
        }
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options)
        if (result.canceled || result.filePaths.length === 0) {
          return null
        }

        const rootPath = await fs.promises.realpath(result.filePaths[0])
        const stat = await fs.promises.stat(rootPath)
        if (!stat.isDirectory()) {
          throw new Error('选择的路径不是文件夹。')
        }

        const project = this.agentSessionManager.createOrOpenProjectFromDirectory(
          rootPath,
          name,
          description,
        )
        await this.agentSessionManager.refreshProjectContextIndex(project.id).catch(() => undefined)
        return project
      },
    )

    ipcMain.handle(IPC_INVOKE.AGENT_DELETE_PROJECT, async (_event, projectId: string) => {
      await this.agentSessionManager.deleteProject(projectId)
      return { success: true }
    })

    ipcMain.handle(IPC_INVOKE.AGENT_GET_WORKSPACE_STATUS, async () => {
      return this.agentSessionManager.getAgentWorkspaceStatus()
    })

    ipcMain.handle(IPC_INVOKE.AGENT_SELECT_WORKSPACE_DIRECTORY, async () => {
      const mainWindow = this.windowManager.getMainWindow()
      const options: Electron.OpenDialogOptions = {
        title: '选择 Agent Workspace 文件夹',
        properties: ['openDirectory'],
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      const rootPath = await fs.promises.realpath(result.filePaths[0])
      return this.agentSessionManager.setAgentWorkspaceRootDirectory(rootPath)
    })

    ipcMain.handle(IPC_INVOKE.AGENT_CLEAR_WORKSPACE_DIRECTORY, async () => {
      return this.agentSessionManager.clearAgentWorkspaceRootDirectory()
    })

    ipcMain.handle(IPC_INVOKE.AGENT_INITIALIZE_WORKSPACE, async () => {
      return this.agentSessionManager.initializeAgentWorkspace()
    })

    ipcMain.handle(IPC_INVOKE.AGENT_REFRESH_WORKSPACE_INDEX, async () => {
      return this.agentSessionManager.refreshAgentWorkspaceIndex()
    })

    ipcMain.handle(IPC_INVOKE.AGENT_OPEN_WORKSPACE_DIRECTORY, async () => {
      const workspacePath = await this.agentSessionManager.getAgentWorkspaceDirectoryPath()
      const error = await shell.openPath(workspacePath)
      if (error) {
        throw new Error(error)
      }
      return { success: true as const }
    })

    ipcMain.handle(
      IPC_INVOKE.AGENT_OPEN_WORKSPACE_FILE,
      async (_event, fileName: AgentWorkspaceCoreFileName | 'WORKSPACE_PROJECTS.md') => {
        const targetPath = fileName === 'WORKSPACE_PROJECTS.md'
          ? await this.agentSessionManager.getAgentWorkspaceIndexMarkdownPath()
          : AGENT_WORKSPACE_OPENABLE_FILES.has(fileName)
            ? await this.agentSessionManager.getAgentWorkspaceCoreFilePath(fileName)
            : null
        if (!targetPath) {
          throw new Error('不支持打开该 agent workspace 文件。')
        }
        const error = await shell.openPath(targetPath)
        if (error) {
          throw new Error(error)
        }
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_SELECT_PROJECT_ROOT_DIRECTORY,
      async (_event, projectId: string) => {
        const mainWindow = this.windowManager.getMainWindow()
        const options: Electron.OpenDialogOptions = {
          title: '选择项目资料目录',
          properties: ['openDirectory'],
        }
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options)
        if (result.canceled || result.filePaths.length === 0) {
          return null
        }

        const rootPath = await fs.promises.realpath(result.filePaths[0])
        const project = this.agentSessionManager.updateProjectRootDirectory(projectId, rootPath)
        await this.agentSessionManager.refreshProjectContextIndex(projectId).catch(() => undefined)
        return project
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_OPEN_PROJECT_ROOT_DIRECTORY,
      async (_event, projectId: string) => {
        const project = this.agentSessionManager.getProject(projectId)
        if (!project?.rootPath) {
          throw new Error('当前项目尚未绑定本地资料目录。')
        }
        if (!project.rootPathExists) {
          throw new Error('项目资料目录不可访问。')
        }
        const error = await shell.openPath(project.rootPath)
        if (error) {
          throw new Error(error)
        }
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_PROJECT_CONTEXT_STATUS,
      async (_event, projectId: string) => {
        return this.agentSessionManager.getProjectContextStatus(projectId)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_REFRESH_PROJECT_CONTEXT_INDEX,
      async (_event, projectId: string) => {
        return this.agentSessionManager.refreshProjectContextIndex(projectId)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_CREATE_PROJECT_AGENTS_FILE,
      async (_event, projectId: string) => {
        return this.agentSessionManager.createProjectAgentsFile(projectId)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_OPEN_PROJECT_AGENTS_FILE,
      async (_event, projectId: string) => {
        const agentsPath = await this.agentSessionManager.getProjectAgentsFilePath(projectId)
        const error = await shell.openPath(agentsPath)
        if (error) {
          throw new Error(error)
        }
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_OPEN_PROJECT_INDEX_FILE,
      async (_event, projectId: string) => {
        const indexPath = await this.agentSessionManager.getProjectIndexMarkdownPath(projectId)
        const error = await shell.openPath(indexPath)
        if (error) {
          throw new Error(error)
        }
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_LIST_PROJECT_COMPONENTS,
      async (_event, projectId: string, filter?: ProjectComponentFilter) => {
        return this.projectComponentService.listComponents(projectId, filter)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_PROJECT_COMPONENT,
      async (_event, projectId: string, componentId: string) => {
        return this.projectComponentService.getComponent(projectId, componentId)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_UPDATE_PROJECT_COMPONENT,
      async (_event, projectId: string, componentId: string, patch: ProjectComponentPatch) => {
        return this.projectComponentService.updateComponent(projectId, componentId, patch)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_CONFIRM_PROJECT_COMPONENTS,
      async (_event, projectId: string, componentIds: string[]) => {
        return this.projectComponentService.confirmComponents(projectId, componentIds)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_DELETE_PROJECT_COMPONENT,
      async (_event, projectId: string, componentId: string) => {
        await this.projectComponentService.deleteComponent(projectId, componentId)
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_READ_PROJECT_IMAGE,
      async (_event, projectId: string, relativePath: string) => {
        return this.projectComponentService.readProjectImage(projectId, relativePath)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_LIST_PROJECT_PREVIEW_DIRECTORY,
      async (_event, projectId: string, relativePath?: string) => {
        return this.projectFileService.listPreviewDirectory(projectId, relativePath)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_READ_PROJECT_FILE_PREVIEW,
      async (_event, projectId: string, relativePath: string, offset?: number) => {
        return this.projectFileService.readFilePreview({
          projectId,
          path: relativePath,
          offset,
        })
      },
    )

    ipcMain.handle(IPC_INVOKE.AGENT_LIST_DRAWINGS, async (_event, projectId: string) => {
      return this.agentSessionManager.listDrawings(projectId)
    })

    ipcMain.handle(
      IPC_INVOKE.AGENT_CREATE_DRAWING,
      async (_event, projectId: string, drawingName: string) => {
        return this.agentSessionManager.createDrawing(projectId, drawingName)
      },
    )

    ipcMain.handle(IPC_INVOKE.AGENT_DELETE_DRAWING, async (_event, drawingId: string) => {
      await this.agentSessionManager.deleteDrawing(drawingId)
      return { success: true }
    })

    ipcMain.handle(IPC_INVOKE.AGENT_LIST_DRAWING_CONVERSATIONS, async (_event, drawingId: string) => {
      return this.agentSessionManager.listDrawingConversations(drawingId)
    })

    ipcMain.handle(IPC_INVOKE.AGENT_GET_MESSAGES, async (_event, conversationId: string) => {
      return this.agentSessionManager.getMessages(conversationId)
    })

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_SESSION_INFO,
      async (_event, conversationId: string) => {
        return this.agentSessionManager.getConversationSessionInfo(conversationId)
      },
    )

    ipcMain.handle(IPC_INVOKE.AGENT_LIST_SESSIONS, async () => {
      return this.agentSessionManager.listConversationSessions()
    })

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_RUNTIME_RESOURCES,
      async (_event, conversationId: string) => {
        return this.agentSessionManager.getConversationPiResourceStatus(conversationId)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_SET_ACTIVE_TOOLS,
      async (_event, conversationId: string, toolNames: unknown) => {
        if (!Array.isArray(toolNames) || toolNames.some((name) => typeof name !== 'string')) {
          throw new Error('工具列表格式无效。')
        }
        return this.agentSessionManager.setConversationPiActiveTools(conversationId, toolNames)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_EXPORT_SESSION,
      async (
        _event,
        conversationId: string,
        format: ConversationPiSessionExportFormat,
      ) => {
        if (format !== 'jsonl' && format !== 'html') {
          throw new Error(`不支持的 session 导出格式: ${String(format)}`)
        }
        const info = this.agentSessionManager.getConversationSessionInfo(conversationId)
        if (!info) throw new Error('当前会话尚未启用 Pi JSONL session。')
        const extension = format === 'jsonl' ? 'jsonl' : 'html'
        const safeName = (info.name || 'xiaoliang-session')
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
          .slice(0, 80)
        const options = {
          title: format === 'jsonl' ? '导出 Pi Session' : '导出会话 HTML',
          defaultPath: `${safeName || 'xiaoliang-session'}.${extension}`,
          filters: [{
            name: format === 'jsonl' ? 'Pi Session JSONL' : 'HTML',
            extensions: [extension],
          }],
        }
        const mainWindow = this.windowManager.getMainWindow()
        const selected = mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options)
        if (selected.canceled || !selected.filePath) {
          return { cancelled: true, format, outputPath: null }
        }
        const outputPath = await this.agentSessionManager.exportConversationSession(
          conversationId,
          format,
          selected.filePath,
        )
        return { cancelled: false, format, outputPath }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_IMPORT_SESSION,
      async (_event, conversationId: string) => {
        const options: Electron.OpenDialogOptions = {
          title: '导入 Pi Session',
          properties: ['openFile'],
          filters: [{ name: 'Pi Session JSONL', extensions: ['jsonl'] }],
        }
        const mainWindow = this.windowManager.getMainWindow()
        const selected = mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options)
        const sourcePath = selected.filePaths[0]
        if (selected.canceled || !sourcePath) {
          return {
            cancelled: true,
            conversationId,
            sessionId: null,
            sourcePath: null,
          }
        }
        const info = await this.agentSessionManager.importConversationSession(
          conversationId,
          sourcePath,
        )
        return {
          cancelled: false,
          conversationId,
          sessionId: info.sessionId,
          sourcePath,
        }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_SESSION_TREE,
      async (_event, conversationId: string) => {
        return this.agentSessionManager.getConversationTree(conversationId)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_NAVIGATE_SESSION_TREE,
      async (_event, input: ConversationTreeNavigateInput) => {
        return this.agentSessionManager.navigateConversationTree(input)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_FORK_CONVERSATION,
      async (_event, conversationId: string, targetEntryId: string) => {
        return this.agentSessionManager.forkConversationBefore(
          conversationId,
          targetEntryId,
        )
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_CLONE_CONVERSATION,
      async (_event, conversationId: string, targetEntryId: string) => {
        return this.agentSessionManager.cloneConversationAt(
          conversationId,
          targetEntryId,
        )
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_SET_SESSION_ENTRY_LABEL,
      async (
        _event,
        conversationId: string,
        targetEntryId: string,
        label: string | null,
      ) => {
        return this.agentSessionManager.setConversationTreeLabel(
          conversationId,
          targetEntryId,
          label,
        )
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_LIST_SUBAGENT_RUNS,
      async (_event, conversationId: string) => {
        return this.agentSessionManager.listSubagentRuns(conversationId)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_SUBAGENT_TRACE,
      async (_event, childRunId: string, afterSequence?: number, limit?: number) => {
        return this.agentSessionManager.getSubagentTrace(childRunId, afterSequence, limit)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_SUBAGENT_TRACE_BLOB,
      async (_event, childRunId: string, sha256: string) => {
        return this.agentSessionManager.getSubagentTraceBlob(childRunId, sha256)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_LIST_MESSAGE_FEEDBACK,
      async (_event, conversationId: string) => {
        const session = await this.authSessionService.getSession()
        const token = session?.access_token?.trim()
        if (!token) throw new Error('请先登录。')
        const items = await agentFeedbackApiClient.listForConversation(token, conversationId)
        return items.map((item) => ({
          ...item,
          local_message_id: resolveCanonicalMessageId(
            conversationId,
            item.local_message_id,
          ),
        }))
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_UPSERT_MESSAGE_FEEDBACK,
      async (_event, payload: AgentMessageFeedbackUpsertInput) => {
        const session = await this.authSessionService.getSession()
        const token = session?.access_token?.trim()
        if (!token) throw new Error('请先登录。')
        const externalMessageId = resolveExternalMessageId(
          payload.local_conversation_id,
          payload.local_message_id,
        )
        const result = await agentFeedbackApiClient.upsert(token, {
          ...payload,
          local_message_id: externalMessageId,
          app_version: app.getVersion(),
        })
        return {
          ...result,
          local_message_id: resolveCanonicalMessageId(
            payload.local_conversation_id,
            result.local_message_id,
          ),
        }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_DELETE_MESSAGE_FEEDBACK,
      async (_event, payload: AgentMessageFeedbackDeleteInput) => {
        const session = await this.authSessionService.getSession()
        const token = session?.access_token?.trim()
        if (!token) throw new Error('请先登录。')
        return agentFeedbackApiClient.delete(token, {
          ...payload,
          local_message_id: resolveExternalMessageId(
            payload.local_conversation_id,
            payload.local_message_id,
          ),
        })
      },
    )

    ipcMain.handle(IPC_INVOKE.PROMPT_TEMPLATE_LIST, async () => {
      const session = await this.authSessionService.getSession()
      const token = session?.access_token?.trim()
      if (!token) throw new Error('请先登录。')
      return promptTemplateApiClient.list(token)
    })

    ipcMain.handle(
      IPC_INVOKE.PROMPT_TEMPLATE_CREATE,
      async (_event, payload: PromptTemplateWriteInput) => {
        const session = await this.authSessionService.getSession()
        const token = session?.access_token?.trim()
        if (!token) throw new Error('请先登录。')
        return promptTemplateApiClient.create(token, payload)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.PROMPT_TEMPLATE_UPDATE,
      async (_event, templateId: string, payload: PromptTemplateWriteInput) => {
        const session = await this.authSessionService.getSession()
        const token = session?.access_token?.trim()
        if (!token) throw new Error('请先登录。')
        return promptTemplateApiClient.update(token, templateId, payload)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.PROMPT_TEMPLATE_DELETE,
      async (_event, templateId: string) => {
        const session = await this.authSessionService.getSession()
        const token = session?.access_token?.trim()
        if (!token) throw new Error('请先登录。')
        return promptTemplateApiClient.delete(token, templateId)
      },
    )

    ipcMain.handle(IPC_INVOKE.AGENT_DELETE_CONVERSATION, async (_event, conversationId: string) => {
      await this.agentSessionManager.deleteConversation(conversationId)
      return { success: true }
    })

    ipcMain.handle(
      IPC_INVOKE.AGENT_RENAME_CONVERSATION,
      async (_event, conversationId: string, title: string) => {
        this.agentSessionManager.renameConversation(conversationId, title)
        return { success: true }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_SEND_PROMPT,
      async (
        _event,
        conversationId: string,
        prompt: string,
        images?: ImageAttachmentInput[],
      ) => {
        try {
          await this.agentSessionManager.sendPrompt(
            conversationId,
            prompt,
            images ?? [],
            { interactionMode: 'a2ui' },
          )
          return { success: true as const }
        } catch (error) {
          const serialized = serializeAgentError(error)
          return {
            success: false as const,
            error: serialized.message,
            code: serialized.code,
            status: serialized.status,
            details: serialized.details,
          }
        }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_PENDING_INTERACTION,
      async (_event, conversationId: string) => {
        return this.agentSessionManager.getPendingInteraction(conversationId)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_COMPACT_CONTEXT,
      async (_event, conversationId: string, instructions?: unknown) => {
        if (instructions !== undefined && typeof instructions !== 'string') {
          throw new Error('压缩重点格式无效。')
        }
        const status = await this.agentSessionManager.compactConversation(
          conversationId,
          instructions,
        )
        return { success: true as const, status }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_ABORT_COMPACTION,
      async (_event, conversationId: string) => {
        this.agentSessionManager.abortConversationCompaction(conversationId)
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_ABORT_BRANCH_SUMMARY,
      async (_event, conversationId: string) => {
        this.agentSessionManager.abortConversationBranchSummary(conversationId)
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_ABORT_RETRY,
      async (_event, conversationId: string) => {
        this.agentSessionManager.abortConversationRetry(conversationId)
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_STEER,
      async (
        _event,
        conversationId: string,
        text: string,
        images: ImageAttachmentInput[] = [],
      ) => {
        await this.agentSessionManager.steerConversation(conversationId, text, images)
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_FOLLOW_UP,
      async (
        _event,
        conversationId: string,
        text: string,
        images: ImageAttachmentInput[] = [],
      ) => {
        await this.agentSessionManager.followUpConversation(conversationId, text, images)
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_REMOVE_QUEUE_ITEM,
      async (_event, conversationId: string, id: string) => {
        await this.agentSessionManager.removeConversationQueueItem(conversationId, id)
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_UPDATE_QUEUE_ITEM,
      async (
        _event,
        conversationId: string,
        id: string,
        text: string,
        images: ImageAttachmentInput[] = [],
      ) => {
        await this.agentSessionManager.updateConversationQueueItem(
          conversationId,
          id,
          text,
          images,
        )
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_SET_QUEUE_ITEM_KIND,
      async (
        _event,
        conversationId: string,
        id: string,
        kind: 'steer' | 'followUp',
      ) => {
        await this.agentSessionManager.setConversationQueueItemKind(
          conversationId,
          id,
          kind,
        )
        return { success: true as const }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_CLEAR_QUEUE,
      async (_event, conversationId: string) => ({
        success: true as const,
        cleared: await this.agentSessionManager.clearConversationQueue(conversationId),
      }),
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_RESOLVE_INTERACTION,
      async (_event, input: AgentInteractionResponseInput) => {
        return this.agentSessionManager.resolveInteraction(input)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_STOP,
      async (_event, conversationId: string, scope: AgentStopScope = 'main') => {
        const cleared = await this.agentSessionManager.stopConversation(conversationId, {
          includeSubagents: scope === 'all',
        })
        return { success: true, cleared }
      },
    )

    ipcMain.handle(IPC_INVOKE.AGENT_CANCEL_SUBAGENTS, async (_event, conversationId: string) => {
      const cancelled = await this.agentSessionManager.cancelConversationSubagents(conversationId)
      return { success: true, cancelled }
    })

    ipcMain.handle(IPC_INVOKE.AGENT_RESET_CONVERSATION, async (_event, conversationId: string) => {
      await this.agentSessionManager.resetConversation(conversationId)
      return { success: true }
    })

    ipcMain.handle(
      IPC_INVOKE.AGENT_SET_CONVERSATION_PINNED,
      async (_event, conversationId: string, pinned: boolean) => {
        this.agentSessionManager.setConversationPinned(conversationId, pinned)
        return { success: true }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_SET_CONVERSATION_PREFERRED_MODEL,
      (_event, conversationId: string, modelId: string | null) => {
        this.agentSessionManager.setConversationPreferredModel(conversationId, modelId)
        return { success: true }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_SET_CONVERSATION_THINKING_MODE,
      (_event, conversationId: string, mode: 'fast' | 'deep') => {
        const { appliedAt } = this.agentSessionManager.setConversationThinkingMode(
          conversationId,
          mode,
        )
        return { success: true, appliedAt }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_SET_CONVERSATION_MODE,
      (_event, conversationId: string, mode: 'agent' | 'plan') => {
        this.agentSessionManager.setConversationMode(conversationId, mode)
        return { success: true }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_PLAN_DOCUMENT,
      async (_event, conversationId: string) => {
        return this.agentSessionManager.getPlanDocument(conversationId)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_OPEN_PLAN_APPROVAL,
      async (_event, conversationId: string) => {
        return this.agentSessionManager.openPlanApproval(conversationId)
      },
    )

    ipcMain.handle(IPC_INVOKE.AGENT_GET_CAD_CONNECTION_STATUS, async () => {
      return legacyCadManualDisabled()
    })

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_CAD_AUTOMATION_STATUS,
      async (_event, request?: CadAutomationStatusRequest) => {
        return this.agentSessionManager.getCadAutomationStatus(request)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_CAD_AUTOMATION_DIAGNOSTICS,
      async (_event, request?: CadAutomationStatusRequest) => {
        return this.agentSessionManager.getCadAutomationDiagnostics(request)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_RESTART_CAD_AUTOMATION_BRIDGE,
      async (_event, request?: RestartCadAutomationBridgeRequest) => {
        return this.agentSessionManager.restartCadAutomationBridge(request)
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_INVALIDATE_CAD_AUTOMATION_ARTIFACT,
      async (_event, request: InvalidateCadAutomationArtifactRequest) => {
        return this.agentSessionManager.invalidateCadAutomationArtifact(request)
      },
    )

    ipcMain.handle(IPC_INVOKE.AGENT_GET_CAD_SELECTION_STATUS, async () => {
      return legacyCadManualDisabled()
    })

    ipcMain.handle(IPC_INVOKE.AGENT_CONNECT_CAD, async () => {
      return legacyCadManualDisabled()
    })

    ipcMain.handle(
      IPC_INVOKE.AGENT_PREPARE_CAD_DRAWING,
      async () => {
        return legacyCadManualDisabled()
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_READ_CAD_DRAWING,
      async () => {
        return legacyCadManualDisabled()
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_EXTRACT_CAD_DRAWING,
      async () => {
        return legacyCadManualDisabled()
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_INDEX_CAD_DRAWING_VISUAL,
      async () => {
        try {
          return legacyCadManualDisabled()
        } catch (error) {
          const serialized = serializeAgentError(error)
          return {
            success: false as const,
            error: serialized.message,
            code: serialized.code,
            status: serialized.status,
            details: serialized.details,
          }
        }
      },
    )

    ipcMain.handle(
      IPC_INVOKE.AGENT_GET_CAD_DRAWING_STATUS,
      async () => {
        return legacyCadManualDisabled()
      },
    )
  }

  async prepareToQuit(): Promise<void> {
    this.creditBalanceMonitor.dispose()
    this.runUsageMonitor.dispose()
    this.feishuChannelService?.dispose()
    await this.agentSessionManager.dispose()
    await this.cadPreviewService.dispose()
  }

  dispose() {
    this.creditBalanceMonitor.dispose()
    this.runUsageMonitor.dispose()
    this.feishuChannelService?.dispose()
    void this.agentSessionManager.dispose()
    void this.cadPreviewService.dispose()
    closeDB()
    ipcMain.removeHandler(IPC_INVOKE.WINDOW_GET_ALWAYS_ON_TOP)
    ipcMain.removeHandler(IPC_INVOKE.THEME_GET_SYSTEM)
    ipcMain.removeHandler(IPC_INVOKE.THEME_SET)
    ipcMain.removeHandler(IPC_INVOKE.APP_OPEN_EXTERNAL)
    ipcMain.removeHandler(IPC_INVOKE.AUTH_GET_SESSION)
    ipcMain.removeHandler(IPC_INVOKE.AUTH_LOGIN)
    ipcMain.removeHandler(IPC_INVOKE.AUTH_REGISTER)
    ipcMain.removeHandler(IPC_INVOKE.AUTH_LOGOUT)
    ipcMain.removeHandler(IPC_INVOKE.AUTH_SYNC_PROFILE)
    ipcMain.removeHandler(IPC_INVOKE.AUTH_REFRESH_SESSION)
    ipcMain.removeHandler(IPC_INVOKE.AUTH_CLEAR_SESSION)
    ipcMain.removeHandler(IPC_INVOKE.BILLING_GET_PRODUCTS)
    ipcMain.removeHandler(IPC_INVOKE.BILLING_CREATE_WECHAT_ORDER)
    ipcMain.removeHandler(IPC_INVOKE.BILLING_GET_ORDER)
    ipcMain.removeHandler(IPC_INVOKE.BILLING_SYNC_ORDER)
    ipcMain.removeHandler(IPC_INVOKE.BILLING_GET_QUOTA)
    ipcMain.removeHandler(IPC_INVOKE.BILLING_GET_CONVERSATION_USAGE)
    ipcMain.removeHandler(IPC_INVOKE.SCREENSHOT_GET_SCREEN_SOURCES)
    ipcMain.removeHandler(IPC_INVOKE.SCREENSHOT_GET_WINDOW_SOURCES)
    ipcMain.removeHandler(IPC_INVOKE.SCREENSHOT_CAPTURE_SOURCE)
    ipcMain.removeHandler(IPC_INVOKE.SCREENSHOT_CAPTURE_DESKTOP)
    ipcMain.removeHandler(IPC_INVOKE.SCREENSHOT_CAPTURE_ALL_SCREENS)
    ipcMain.removeHandler(IPC_INVOKE.SCREENSHOT_GET_STATUS)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_GET_LLM_CONFIG)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_GET_POWER_CONFIG)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_SAVE_POWER_CONFIG)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_GET_FEISHU_CONFIG)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_SAVE_FEISHU_CONFIG)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_TEST_FEISHU_CONNECTION)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_GET_FEISHU_STATUS)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_GET_BLENDER_MCP_CONFIG)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_SAVE_BLENDER_MCP_CONFIG)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_TEST_BLENDER_MCP_CONNECTION)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_GET_SKILL_STATUS)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_READ_USER_SKILL)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_UPSERT_USER_SKILL)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_SET_USER_SKILL_ENABLED)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_DELETE_USER_SKILL)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_OPEN_USER_SKILLS_DIRECTORY)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_OPEN_USER_SKILL_FILE)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_CHECK_SKILL_UPDATES)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_INSTALL_SKILL_UPDATE)
    ipcMain.removeHandler(IPC_INVOKE.SETTINGS_SAVE_LLM_CONFIG)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_CREATE_CONVERSATION)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_CREATE_CONVERSATION_IN_DRAWING)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_LIST_CONVERSATIONS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_RUNNING_CONVERSATIONS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_SEARCH_WORKSPACE)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_LIST_PROJECTS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_CREATE_PROJECT)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_CREATE_PROJECT_FROM_DIRECTORY)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_DELETE_PROJECT)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_SELECT_PROJECT_ROOT_DIRECTORY)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_OPEN_PROJECT_ROOT_DIRECTORY)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_LIST_PROJECT_COMPONENTS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_PROJECT_COMPONENT)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_UPDATE_PROJECT_COMPONENT)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_CONFIRM_PROJECT_COMPONENTS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_DELETE_PROJECT_COMPONENT)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_READ_PROJECT_IMAGE)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_LIST_PROJECT_PREVIEW_DIRECTORY)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_READ_PROJECT_FILE_PREVIEW)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_LIST_DRAWINGS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_CREATE_DRAWING)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_DELETE_DRAWING)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_LIST_DRAWING_CONVERSATIONS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_MESSAGES)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_SESSION_INFO)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_LIST_SESSIONS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_RUNTIME_RESOURCES)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_SET_ACTIVE_TOOLS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_EXPORT_SESSION)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_IMPORT_SESSION)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_SESSION_TREE)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_NAVIGATE_SESSION_TREE)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_FORK_CONVERSATION)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_CLONE_CONVERSATION)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_SET_SESSION_ENTRY_LABEL)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_LIST_SUBAGENT_RUNS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_SUBAGENT_TRACE)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_SUBAGENT_TRACE_BLOB)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_LIST_MESSAGE_FEEDBACK)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_UPSERT_MESSAGE_FEEDBACK)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_DELETE_MESSAGE_FEEDBACK)
    ipcMain.removeHandler(IPC_INVOKE.PROMPT_TEMPLATE_LIST)
    ipcMain.removeHandler(IPC_INVOKE.PROMPT_TEMPLATE_CREATE)
    ipcMain.removeHandler(IPC_INVOKE.PROMPT_TEMPLATE_UPDATE)
    ipcMain.removeHandler(IPC_INVOKE.PROMPT_TEMPLATE_DELETE)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_DELETE_CONVERSATION)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_RENAME_CONVERSATION)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_SEND_PROMPT)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_COMPACT_CONTEXT)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_ABORT_COMPACTION)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_ABORT_BRANCH_SUMMARY)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_ABORT_RETRY)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_STEER)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_FOLLOW_UP)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_REMOVE_QUEUE_ITEM)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_UPDATE_QUEUE_ITEM)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_SET_QUEUE_ITEM_KIND)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_CLEAR_QUEUE)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_PENDING_INTERACTION)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_RESOLVE_INTERACTION)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_STOP)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_CANCEL_SUBAGENTS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_RESET_CONVERSATION)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_SET_CONVERSATION_PINNED)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_SET_CONVERSATION_PREFERRED_MODEL)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_SET_CONVERSATION_THINKING_MODE)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_SET_CONVERSATION_MODE)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_PLAN_DOCUMENT)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_OPEN_PLAN_APPROVAL)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_CAD_AUTOMATION_STATUS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_CAD_AUTOMATION_DIAGNOSTICS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_RESTART_CAD_AUTOMATION_BRIDGE)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_INVALIDATE_CAD_AUTOMATION_ARTIFACT)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_CAD_CONNECTION_STATUS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_CAD_SELECTION_STATUS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_CONNECT_CAD)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_PREPARE_CAD_DRAWING)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_READ_CAD_DRAWING)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_EXTRACT_CAD_DRAWING)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_INDEX_CAD_DRAWING_VISUAL)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_GET_CAD_DRAWING_STATUS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_ENV_GET_STATUS)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_ENV_PREPARE_BASH)
    ipcMain.removeHandler(IPC_INVOKE.AGENT_ENV_PREPARE_BLENDER_MCP)
  }
}
