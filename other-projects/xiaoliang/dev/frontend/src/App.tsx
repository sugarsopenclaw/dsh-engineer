import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Settings } from 'lucide-react'
import { ResizableWorkspace } from '@/components/layout/resizable-workspace'
import { WorkspaceBreadcrumb } from '@/components/layout/workspace-breadcrumb'
import { WorkspaceSidebar } from '@/components/layout/workspace-sidebar'
import { WindowTitlebar } from '@/components/layout/window-titlebar'
import { ProjectWorkspace } from '@/components/project/project-workspace'
import { AgentChatPanel } from '@/components/runtime/agent-chat-panel'
import { LoginShell } from '@/components/runtime/login-shell'
import { LlmSettingsPanel } from '@/components/runtime/llm-settings-panel'
import { SessionLoadingScreen } from '@/components/runtime/session-loading-screen'
import { WorkbenchSidePanel } from '@/components/runtime/workbench-side-panel'
import { UpdateBanner } from '@/components/update/update-banner'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useThemeSync } from '@/hooks/useTheme'
import { useWindowControl } from '@/hooks/useWindowControl'
import { normalizeUpdateStatus } from '@/components/update/update-state.mts'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'
import type { ProjectSummary } from '@/shared/local-agent'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'
import { useCreditBalanceSync } from '@/features/billing/use-credit-balance'
import { useQuotaExceededListener } from '@/features/billing/use-quota-listener'
import { cn } from '@/lib/utils'

type ChatRuntimeState = {
  conversationId: string | null
  isAgentRunning: boolean
}

const EMPTY_CHAT_RUNTIME_STATE: ChatRuntimeState = {
  conversationId: null,
  isAgentRunning: false,
}

export default function App() {
  useThemeSync()
  const windowControl = useWindowControl()
  const setUpdateStatus = useUiStore((s) => s.setUpdateStatus)
  const session = useAuthStore((state) => state.session)
  const hydrated = useAuthStore((state) => state.hydrated)
  const setSession = useAuthStore((state) => state.setSession)
  const setHydrated = useAuthStore((state) => state.setHydrated)
  const clearSession = useAuthStore((state) => state.clearSession)
  const [showSettings, setShowSettings] = useState(false)
  useQuotaExceededListener(() => setShowSettings(true))
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null)
  const [projectChatOpen, setProjectChatOpen] = useState(false)
  const [chatFocusConversation, setChatFocusConversation] = useState<{
    id: string | null
    messageId: string | null
    nonce: number
  } | null>(null)
  const [chatRuntimeState, setChatRuntimeState] = useState<ChatRuntimeState>(EMPTY_CHAT_RUNTIME_STATE)
  const [workspaceRefreshNonce, setWorkspaceRefreshNonce] = useState(0)

  useCreditBalanceSync(chatRuntimeState.isAgentRunning, !!session)

  const showChat = !!selectedProject && projectChatOpen && !showSettings
  const showProjectWorkspace = !showSettings && !showChat
  const wideMode = windowControl.windowState.mode === 'wide'

  const notifyWorkspaceChanged = useCallback(() => {
    setWorkspaceRefreshNonce((current) => current + 1)
  }, [])

  const handleChatRuntimeStateChange = useCallback((next: ChatRuntimeState) => {
    setChatRuntimeState((current) => (
      current.conversationId === next.conversationId
      && current.isAgentRunning === next.isAgentRunning
        ? current
        : next
    ))
  }, [])

  const goHome = useCallback(() => {
    setShowSettings(false)
    setSelectedProject(null)
    setProjectChatOpen(false)
    setChatFocusConversation(null)
  }, [])

  const selectProject = useCallback((project: ProjectSummary) => {
    setShowSettings(false)
    setSelectedProject(project)
    setProjectChatOpen(false)
    setChatFocusConversation(null)
  }, [])

  const openProjectConversation = useCallback((
    project: ProjectSummary,
    conversationId?: string,
    messageId?: string,
  ) => {
    setShowSettings(false)
    setSelectedProject(project)
    setProjectChatOpen(true)
    setChatFocusConversation({
      id: conversationId ?? null,
      messageId: messageId ?? null,
      nonce: Date.now(),
    })
  }, [])

  useEffect(() => {
    if (!isElectronApp()) return
    const unsub = electronBridge.onUpdateStatus((payload) => {
      setUpdateStatus(normalizeUpdateStatus(payload))
    })
    return () => {
      unsub?.()
    }
  }, [setUpdateStatus])

  useEffect(() => {
    let active = true

    async function bootstrapSession() {
      if (!isElectronApp()) {
        setHydrated(true)
        return
      }

      try {
        const restoredSession = await electronBridge.getBackendSession()

        if (!active) {
          return
        }

        if (restoredSession) {
          setSession(restoredSession)
        } else {
          clearSession()
        }
      } catch {
        if (active) {
          setHydrated(true)
        }
      }
    }

    void bootstrapSession()

    return () => {
      active = false
    }
  }, [clearSession, setHydrated, setSession])

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="app-shell flex min-h-0 flex-col"
        data-app-window-mode={windowControl.windowState.mode}
      >
        <WindowTitlebar
          windowState={windowControl.windowState}
          onToggleAlwaysOnTop={windowControl.toggleAlwaysOnTop}
          onToggleWindowSize={windowControl.toggleWindowSize}
          onToggleMaximize={windowControl.toggleMaximizeWindow}
          onMinimize={windowControl.minimizeWindow}
          onClose={windowControl.closeWindow}
        />
        <UpdateBanner />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {!hydrated ? <SessionLoadingScreen /> : !session ? <LoginShell /> : (
            <>
              {!wideMode ? (
                <header className="shrink-0 border-b border-slate-200/70 bg-white/85 px-3 py-2 backdrop-blur">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <WorkspaceBreadcrumb
                        project={selectedProject}
                        drawing={null}
                        settingsOpen={showSettings}
                        onGoHome={goHome}
                        onGoProject={() => {
                          setShowSettings(false)
                          setProjectChatOpen(false)
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      aria-label="设置"
                      onClick={() => setShowSettings((previous) => !previous)}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                </header>
              ) : null}

              <ResizableWorkspace
                mode={windowControl.windowState.mode}
                left={(
                  <WorkspaceSidebar
                    selectedProject={selectedProject}
                    activeConversationId={showChat ? chatRuntimeState.conversationId : null}
                    refreshNonce={workspaceRefreshNonce}
                    settingsOpen={showSettings}
                    onGoHome={goHome}
                    onSelectProject={selectProject}
                    onOpenConversation={openProjectConversation}
                    onOpenSettings={() => setShowSettings(true)}
                    onWorkspaceChanged={notifyWorkspaceChanged}
                  />
                )}
                right={(
                  <WorkbenchSidePanel
                    project={selectedProject}
                    conversationId={showChat ? chatRuntimeState.conversationId : null}
                  />
                )}
              >
                <main
                  className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
                >
                  <section
                    id="workspace-panel-projects"
                    aria-hidden={!showProjectWorkspace}
                    aria-labelledby={selectedProject ? 'workspace-panel-project-title' : undefined}
                    className={cn(
                      showProjectWorkspace
                        ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
                        : 'hidden',
                    )}
                  >
                    {selectedProject ? (
                      <header className="workspace-panel-header flex items-center border-b border-slate-200/70 bg-white/92 px-4 backdrop-blur-sm">
                        <div className="mx-auto flex w-full min-w-0 max-w-4xl items-center gap-3">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 px-3"
                            aria-label="返回项目列表"
                            title="返回项目列表"
                            onClick={goHome}
                          >
                            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                            返回
                          </Button>
                          <h2
                            id="workspace-panel-project-title"
                            className="truncate text-sm font-semibold text-slate-900"
                          >
                            项目工作台
                          </h2>
                        </div>
                      </header>
                    ) : null}

                    <div
                      className={cn(
                        'min-h-0 flex-1 overflow-y-auto',
                        wideMode ? 'px-6 pb-5 pt-6' : 'px-4 pb-3 pt-4',
                      )}
                    >
                      <ProjectWorkspace
                        active={showProjectWorkspace}
                        selectedProject={selectedProject}
                        onSelectProject={(project) => {
                          setShowSettings(false)
                          setSelectedProject(project)
                          setProjectChatOpen(false)
                          setChatFocusConversation(null)
                        }}
                        onOpenProjectChat={(conversationId?: string) => {
                          setShowSettings(false)
                          setProjectChatOpen(true)
                          setChatFocusConversation({
                            id: conversationId ?? null,
                            messageId: null,
                            nonce: Date.now(),
                          })
                        }}
                        onWorkspaceChanged={notifyWorkspaceChanged}
                      />
                    </div>
                  </section>

                  <section
                    id="workspace-panel-chat"
                    aria-hidden={!showChat}
                    className={cn(
                      showChat ? 'flex min-h-0 flex-1 flex-col' : 'hidden',
                    )}
                  >
                    <AgentChatPanel
                      focusConversation={chatFocusConversation}
                      conversationScope={
                        selectedProject
                          ? {
                              projectId: selectedProject.id,
                              projectName: selectedProject.name,
                            }
                          : null
                      }
                      externalConversationRevision={workspaceRefreshNonce}
                      onConversationStateChange={handleChatRuntimeStateChange}
                      onConversationsChanged={notifyWorkspaceChanged}
                      wideMode={wideMode}
                      onOpenSettings={() => setShowSettings(true)}
                    />
                  </section>

                  <section
                    id="workspace-panel-settings"
                    aria-hidden={!showSettings}
                    aria-labelledby="workspace-panel-settings-title"
                    className={cn(
                      showSettings
                        ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
                        : 'hidden',
                    )}
                  >
                    <header className="workspace-panel-header flex items-center border-b border-slate-200/70 bg-white/92 px-4 backdrop-blur-sm">
                      <div className="mx-auto flex w-full min-w-0 max-w-[820px] items-center gap-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 px-3"
                          onClick={() => setShowSettings(false)}
                        >
                          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          返回
                        </Button>
                        <h2
                          id="workspace-panel-settings-title"
                          className="truncate text-sm font-semibold text-slate-900"
                        >
                          设置
                        </h2>
                      </div>
                    </header>

                    <div
                      className={cn(
                        'min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto',
                        wideMode ? 'px-6 pb-4 pt-4' : 'px-4 pb-2 pt-3',
                      )}
                    >
                      <div className="mx-auto w-full min-w-0 max-w-[820px] pb-1">
                        <div className="settings-page">
                          <LlmSettingsPanel visible={showSettings} />
                        </div>
                      </div>
                    </div>
                  </section>
                </main>
              </ResizableWorkspace>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
