import {
  ChevronDown,
  FolderInput,
  FolderOpen,
  GitFork,
  Home,
  LoaderCircle,
  Clock3,
  MessageSquare,
  MessageSquarePlus,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDeleteDialog } from '@/components/common/confirm-delete-dialog'
import { WorkspaceSearchDialog } from '@/components/layout/workspace-search-dialog'
import { CreateNameDialog } from '@/components/project/project-workspace'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { electronBridge } from '@/services/electron-bridge'
import type {
  ConversationSummary,
  ProjectSummary,
  WorkspaceSearchResult,
  AgentConversationRunStatus,
} from '@/shared/local-agent'

interface WorkspaceSidebarProps {
  selectedProject: ProjectSummary | null
  activeConversationId: string | null
  refreshNonce: number
  settingsOpen: boolean
  onGoHome: () => void
  onSelectProject: (project: ProjectSummary) => void
  onOpenConversation: (
    project: ProjectSummary,
    conversationId?: string,
    messageId?: string,
  ) => void
  onOpenSettings: () => void
  onWorkspaceChanged: () => void
}

type WorkspaceData = {
  projects: ProjectSummary[]
  conversationsByProjectId: Record<string, ConversationSummary[]>
}

type ConversationDeleteTarget = {
  project: ProjectSummary
  conversation: ConversationSummary
}

type SidebarConversationRun = {
  status: AgentConversationRunStatus
  promptRunning: boolean
  subagentStatus: 'running' | 'queued' | null
  unreadCompletion: boolean
  needsInput: boolean
}

function getErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/i, '').trim()
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function WorkspaceSidebar({
  selectedProject,
  activeConversationId,
  refreshNonce,
  settingsOpen,
  onGoHome,
  onSelectProject,
  onOpenConversation,
  onOpenSettings,
  onWorkspaceChanged,
}: WorkspaceSidebarProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [conversationsByProjectId, setConversationsByProjectId] = useState<Record<string, ConversationSummary[]>>({})
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ConversationDeleteTarget | null>(null)
  const [conversationRuns, setConversationRuns] = useState<Record<string, SidebarConversationRun>>({})
  const activeConversationIdRef = useRef(activeConversationId)
  activeConversationIdRef.current = activeConversationId

  const loadWorkspace = useCallback(async (): Promise<WorkspaceData> => {
    const nextProjects = await electronBridge.listProjects()
    const conversationEntries = await Promise.all(
      nextProjects.map(async (project) => [
        project.id,
        await electronBridge.listProjectConversations(project.id),
      ] as const),
    )
    return {
      projects: nextProjects,
      conversationsByProjectId: Object.fromEntries(conversationEntries),
    }
  }, [])

  const applyWorkspaceData = useCallback((data: WorkspaceData) => {
    setProjects(data.projects)
    setConversationsByProjectId(data.conversationsByProjectId)
    setExpandedProjectIds((current) => {
      const availableIds = new Set(data.projects.map((project) => project.id))
      const next = current.filter((id) => availableIds.has(id))
      const preferredId = selectedProject?.id ?? data.projects[0]?.id
      if (preferredId && !next.includes(preferredId)) {
        next.push(preferredId)
      }
      return next
    })
  }, [selectedProject?.id])

  const refreshWorkspace = useCallback(async () => {
    const data = await loadWorkspace()
    applyWorkspaceData(data)
    return data
  }, [applyWorkspaceData, loadWorkspace])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void loadWorkspace()
      .then((data) => {
        if (!cancelled) {
          applyWorkspaceData(data)
          setErrorText(null)
        }
      })
      .catch((error) => {
        if (!cancelled) setErrorText(getErrorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [applyWorkspaceData, loadWorkspace, refreshNonce])

  useEffect(() => {
    if (!selectedProject) return
    setExpandedProjectIds((current) => (
      current.includes(selectedProject.id) ? current : [...current, selectedProject.id]
    ))
  }, [selectedProject])

  useEffect(() => {
    let cancelled = false
    void electronBridge.getRunningAgentConversations().then((snapshots) => {
      if (cancelled) return
      setConversationRuns((current) => {
        const next = { ...current }
        for (const snapshot of snapshots) {
          if (next[snapshot.conversationId]) continue
          next[snapshot.conversationId] = {
          status: snapshot.status,
          promptRunning: snapshot.promptRunning,
          subagentStatus: snapshot.subagentRuns.some((run) => (
            run.status === 'initializing' || run.status === 'running'
          ))
            ? 'running'
            : snapshot.subagentRuns.some((run) => run.status === 'queued')
              ? 'queued'
              : null,
          unreadCompletion: false,
          needsInput: false,
          }
        }
        return next
      })
    }).catch(() => undefined)

    const unsubscribe = electronBridge.onAgentEvent((event) => {
      if (event.type === 'conversation_updated' || event.type === 'context_usage' || event.type === 'conversation_mode') return
      const conversationId = event.conversationId
      setConversationRuns((current) => {
        const previous = current[conversationId] ?? {
          status: 'completed' as const,
          promptRunning: false,
          subagentStatus: null,
          unreadCompletion: false,
          needsInput: false,
        }
        let next = previous
        if (event.type === 'interaction_requested') {
          next = { ...previous, needsInput: true }
        } else if (event.type === 'interaction_resolved') {
          next = { ...previous, needsInput: false }
        } else if (event.type === 'agent_start') {
          next = {
            status: 'running',
            promptRunning: true,
            subagentStatus: previous.subagentStatus,
            unreadCompletion: false,
            needsInput: previous.needsInput,
          }
        } else if (event.type === 'subagent_run') {
          const updates = event.updates?.length ? event.updates : [event.update]
          const hasRunning = updates.some((update) => (
            update.status === 'initializing' || update.status === 'running'
          ))
          const hasQueued = updates.some((update) => update.status === 'queued')
          const terminal = event.update.status === 'completed'
            || event.update.status === 'failed'
            || event.update.status === 'cancelled'
          next = {
            status: previous.promptRunning || hasRunning
              ? 'running'
              : hasQueued
                ? 'queued'
                : 'completed',
            promptRunning: previous.promptRunning,
            subagentStatus: hasRunning ? 'running' : hasQueued ? 'queued' : null,
            unreadCompletion: previous.unreadCompletion
              || (terminal && activeConversationIdRef.current !== conversationId),
            needsInput: previous.needsInput,
          }
        } else if (
          event.type === 'agent_settled'
          || (event.type === 'messages_updated' && event.promptSettled === true)
          || event.type === 'error'
        ) {
          next = {
            status: previous.subagentStatus ?? 'completed',
            promptRunning: false,
            subagentStatus: previous.subagentStatus,
            unreadCompletion: activeConversationIdRef.current !== conversationId,
            needsInput: previous.needsInput,
          }
        }
        if (next === previous) return current
        return { ...current, [conversationId]: next }
      })
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!activeConversationId) return
    setConversationRuns((current) => {
      const active = current[activeConversationId]
      if (!active?.unreadCompletion) return current
      return {
        ...current,
        [activeConversationId]: { ...active, unreadCompletion: false },
      }
    })
  }, [activeConversationId])

  const visibleProjects = useMemo(() => {
    return projects.map((project) => ({
      project,
      conversations: conversationsByProjectId[project.id] ?? [],
    }))
  }, [conversationsByProjectId, projects])
  const conversationTitleById = useMemo(() => new Map(
    Object.values(conversationsByProjectId)
      .flat()
      .map((conversation) => [conversation.id, conversation.title] as const),
  ), [conversationsByProjectId])

  const searchWorkspace = useCallback((searchQuery: string) => (
    electronBridge.searchWorkspace({ query: searchQuery, limit: 50 })
  ), [])

  const handleSelectSearchResult = useCallback((result: WorkspaceSearchResult) => {
    const project = projects.find((candidate) => candidate.id === result.projectId)
    if (!project) {
      setErrorText('搜索结果所属项目已不存在，请刷新后重试。')
      return
    }

    if (result.kind === 'project' || !result.conversationId) {
      onSelectProject(project)
      return
    }

    onOpenConversation(
      project,
      result.conversationId,
      result.matchedMessageId ?? undefined,
    )
  }, [onOpenConversation, onSelectProject, projects])

  const createProjectValidationText = useMemo(() => {
    const normalized = normalizeName(newProjectName).toLocaleLowerCase('zh-CN')
    if (!normalized) return null
    return projects.some((project) => project.name.toLocaleLowerCase('zh-CN') === normalized)
      ? '已存在同名项目。'
      : null
  }, [newProjectName, projects])

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjectIds((current) => (
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    ))
  }

  async function handleOpenProjectFromDirectory() {
    setBusyKey('open-project')
    setErrorText(null)
    try {
      const project = await electronBridge.createProjectFromDirectory()
      if (!project) return
      await refreshWorkspace()
      onWorkspaceChanged()
      onSelectProject(project)
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleCreateProject() {
    const normalizedName = normalizeName(newProjectName)
    if (!normalizedName || createProjectValidationText) return
    setBusyKey('create-project')
    setErrorText(null)
    try {
      const project = await electronBridge.createProjectFromDirectory(normalizedName)
      if (!project) return
      await refreshWorkspace()
      setCreateProjectOpen(false)
      setNewProjectName('')
      onWorkspaceChanged()
      onSelectProject(project)
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setBusyKey(null)
    }
  }

  function handleCreateConversation(project: ProjectSummary) {
    setErrorText(null)
    onOpenConversation(project)
  }

  async function handleOpenProjectDirectory(project: ProjectSummary) {
    setBusyKey(`open-root:${project.id}`)
    setErrorText(null)
    try {
      await electronBridge.openProjectRootDirectory(project.id)
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleRenameConversation(conversationId: string) {
    const nextTitle = editingTitle.trim()
    if (!nextTitle) {
      setEditingConversationId(null)
      setEditingTitle('')
      return
    }
    if (conversationRuns[conversationId]?.promptRunning || busyKey !== null) return
    setBusyKey(`rename:${conversationId}`)
    setErrorText(null)
    try {
      await electronBridge.renameConversation(conversationId, nextTitle)
      setEditingConversationId(null)
      setEditingTitle('')
      await refreshWorkspace()
      onWorkspaceChanged()
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleTogglePinned(conversation: ConversationSummary) {
    if (conversationRuns[conversation.id]?.promptRunning) return
    setBusyKey(`pin:${conversation.id}`)
    setErrorText(null)
    try {
      await electronBridge.setConversationPinned(conversation.id, !conversation.isPinned)
      await refreshWorkspace()
      onWorkspaceChanged()
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleDeleteConversation(target: ConversationDeleteTarget) {
    setBusyKey(`delete:${target.conversation.id}`)
    setErrorText(null)
    try {
      await electronBridge.deleteConversation(target.conversation.id)
      await refreshWorkspace()
      onWorkspaceChanged()
      if (activeConversationId === target.conversation.id) {
        onSelectProject(target.project)
      }
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setBusyKey(null)
    }
  }

  const busy = busyKey !== null

  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-slate-50 text-slate-700"
      aria-label="项目与历史对话"
      aria-busy={loading}
    >
      <div className="shrink-0 border-b border-slate-200/80 p-3">
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full justify-start px-2.5 text-sm"
            disabled={busy}
            aria-label="新建项目"
            title="新建项目"
            onClick={() => {
              setNewProjectName('')
              setCreateProjectOpen(true)
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            <span className="truncate">新建项目</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full justify-start px-2.5 text-sm"
            disabled={busy}
            aria-label="从目录创建项目"
            title="从目录创建项目"
            onClick={() => void handleOpenProjectFromDirectory()}
          >
            <FolderInput className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            <span className="truncate">从目录创建项目</span>
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 h-8 w-full justify-start px-2.5 text-sm focus-visible:border-violet-300 focus-visible:ring-violet-100 focus-visible:ring-offset-0"
          disabled={false}
          aria-haspopup="dialog"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">搜索项目、对话和消息</span>
        </Button>
        {errorText ? (
          <p className="mt-2 text-[11px] leading-4 text-rose-600" role="alert">
            {errorText}
          </p>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="项目导航">
        <button
          type="button"
          className={cn(
            'mb-1 flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors',
            !selectedProject && !settingsOpen
              ? 'bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200/70'
              : 'text-slate-600 hover:bg-white/80 hover:text-slate-900',
          )}
          onClick={onGoHome}
        >
          <Home className="h-4 w-4 shrink-0" />
          <span className="truncate">项目工作台</span>
        </button>

        {visibleProjects.length === 0 ? (
          <p className="px-2.5 py-8 text-center text-xs leading-5 text-slate-400">
            暂无项目，请新建项目或从目录创建。
          </p>
        ) : (
          <div className="space-y-1">
            {visibleProjects.map(({ project, conversations }) => {
              const expanded = expandedProjectIds.includes(project.id)
              const projectActive = selectedProject?.id === project.id && !settingsOpen
              return (
                <section key={project.id} aria-labelledby={`workspace-project-${project.id}`}>
                  <div
                    className={cn(
                      'group/project flex h-9 items-center rounded-lg transition-colors',
                      projectActive ? 'bg-violet-50 text-violet-950' : 'text-slate-700 hover:bg-white/80',
                    )}
                  >
                    <button
                      type="button"
                      className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700"
                      aria-label={expanded ? `折叠项目 ${project.name}` : `展开项目 ${project.name}`}
                      aria-expanded={expanded}
                      aria-controls={`workspace-project-conversations-${project.id}`}
                      onClick={() => toggleProjectExpanded(project.id)}
                    >
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !expanded && '-rotate-90')} />
                    </button>
                    <button
                      id={`workspace-project-${project.id}`}
                      type="button"
                      className="flex h-9 min-w-0 flex-1 items-center gap-1.5 text-left text-sm"
                      title={project.name}
                      onClick={() => onSelectProject(project)}
                    >
                      <FolderOpen className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="truncate">{project.name}</span>
                    </button>
                    {project.rootPath && project.rootPathExists ? (
                      <button
                        type="button"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-white hover:text-slate-700 focus:opacity-100 group-hover/project:opacity-100"
                        aria-label={`打开项目目录 ${project.name}`}
                        title="打开项目目录"
                        disabled={busyKey === `open-root:${project.id}`}
                        onClick={() => void handleOpenProjectDirectory(project)}
                      >
                        <FolderInput className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-white hover:text-violet-700"
                      aria-label={`在 ${project.name} 中新建对话`}
                      title="新建对话"
                      disabled={busy}
                      onClick={() => void handleCreateConversation(project)}
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {expanded ? (
                    <div
                      id={`workspace-project-conversations-${project.id}`}
                      className="ml-4 border-l border-slate-200 pl-2 pt-0.5"
                    >
                      {conversations.length === 0 ? (
                        <p className="px-2 py-2 text-[11px] text-slate-400">暂无对话</p>
                      ) : conversations.map((conversation) => {
                        const active = activeConversationId === conversation.id && projectActive
                        const editing = editingConversationId === conversation.id
                        const run = conversationRuns[conversation.id]
                        const actionDisabled = busy || run?.promptRunning === true
                        return (
                          <div
                            key={conversation.id}
                            className={cn(
                              'group/conversation relative mb-0.5 flex min-h-8 items-center rounded-md text-xs transition-colors',
                              conversation.parentConversationId ? 'ml-2' : '',
                              active ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white/75 hover:text-slate-900',
                            )}
                          >
                            {editing ? (
                              <input
                                type="text"
                                value={editingTitle}
                                autoFocus
                                maxLength={60}
                                aria-label={`重命名对话 ${conversation.title}`}
                                className="mx-1 min-w-0 flex-1 rounded-md border border-violet-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none ring-2 ring-violet-100"
                                onChange={(event) => setEditingTitle(event.target.value)}
                                onBlur={() => void handleRenameConversation(conversation.id)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void handleRenameConversation(conversation.id)
                                  } else if (event.key === 'Escape') {
                                    event.preventDefault()
                                    setEditingConversationId(null)
                                    setEditingTitle('')
                                  }
                                }}
                              />
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 pr-[72px] text-left"
                                  disabled={false}
                                  title={conversation.parentConversationId
                                    ? `${conversation.title} · 分支自 ${conversationTitleById.get(conversation.parentConversationId) ?? '父会话'}`
                                    : conversation.childConversationCount > 0
                                      ? `${conversation.title} · ${conversation.childConversationCount} 个子会话`
                                      : conversation.title}
                                  onClick={() => onOpenConversation(project, conversation.id)}
                                  onDoubleClick={() => {
                                    if (actionDisabled) return
                                    setEditingConversationId(conversation.id)
                                    setEditingTitle(conversation.title)
                                  }}
                                >
                                  {conversation.isPinned ? (
                                    <Pin className="h-3 w-3 shrink-0 text-violet-500" />
                                  ) : conversation.parentConversationId ? (
                                    <GitFork className="h-3 w-3 shrink-0 text-violet-500" />
                                  ) : (
                                    <MessageSquare className="h-3 w-3 shrink-0 text-slate-400" />
                                  )}
                                  {conversation.hasPendingInteraction || run?.needsInput ? (
                                    <span
                                      className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
                                      data-conversation-needs-input
                                      aria-label="待确认"
                                      title="待确认"
                                    />
                                  ) : run?.status === 'running' ? (
                                    <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-violet-500" aria-label="运行中" />
                                  ) : run?.status === 'queued' ? (
                                    <Clock3 className="h-3 w-3 shrink-0 text-amber-500" aria-label="排队中" />
                                  ) : run?.unreadCompletion ? (
                                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-label="后台任务已完成" />
                                  ) : null}
                                  <span className="truncate">{conversation.title || '新对话'}</span>
                                  {conversation.childConversationCount > 0 ? (
                                    <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-700" aria-label={`${conversation.childConversationCount} 个子会话`}>
                                      +{conversation.childConversationCount}
                                    </span>
                                  ) : null}
                                </button>
                                <div className="pointer-events-none absolute right-1 flex items-center rounded-md bg-white/95 opacity-0 shadow-sm transition group-focus-within/conversation:pointer-events-auto group-focus-within/conversation:opacity-100 group-hover/conversation:pointer-events-auto group-hover/conversation:opacity-100">
                                  <button
                                    type="button"
                                    className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-violet-700"
                                    aria-label={conversation.isPinned ? '取消置顶对话' : '置顶对话'}
                                    title={conversation.isPinned ? '取消置顶' : '置顶'}
                                    disabled={actionDisabled}
                                    onClick={() => void handleTogglePinned(conversation)}
                                  >
                                    {conversation.isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                                  </button>
                                  <button
                                    type="button"
                                    className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-800"
                                    aria-label="重命名对话"
                                    title="重命名"
                                    disabled={actionDisabled}
                                    onClick={() => {
                                      setEditingConversationId(conversation.id)
                                      setEditingTitle(conversation.title)
                                    }}
                                  >
                                    <PencilLine className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                    aria-label="删除对话"
                                    title="删除"
                                    disabled={busy}
                                    onClick={() => setDeleteTarget({ project, conversation })}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>
        )}
      </nav>

      <div className="shrink-0 border-t border-slate-200/80 p-2">
        <button
          type="button"
          className={cn(
            'flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors',
            settingsOpen
              ? 'bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200/70'
              : 'text-slate-600 hover:bg-white/80 hover:text-slate-900',
          )}
          onClick={onOpenSettings}
        >
          <Settings className="h-4 w-4 shrink-0" />
          设置
        </button>
      </div>

      <WorkspaceSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSearch={searchWorkspace}
        onSelectResult={handleSelectSearchResult}
      />

      <CreateNameDialog
        open={createProjectOpen}
        title="新建项目"
        description="输入项目名称，随后选择项目文件夹。创建后会自动绑定该目录。"
        placeholder="输入项目名称"
        confirmLabel="选择文件夹并创建"
        value={newProjectName}
        busy={busyKey === 'create-project'}
        validationText={createProjectValidationText}
        onValueChange={setNewProjectName}
        onOpenChange={(open) => {
          setCreateProjectOpen(open)
          if (!open && busyKey !== 'create-project') setNewProjectName('')
        }}
        onConfirm={handleCreateProject}
      />

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title="确认删除对话"
        description={deleteTarget ? `确定删除“${deleteTarget.conversation.title}”吗？消息记录删除后无法恢复。` : ''}
        confirmLabel="删除对话"
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={async () => {
          if (!deleteTarget) return
          await handleDeleteConversation(deleteTarget)
          setDeleteTarget(null)
        }}
      />
    </aside>
  )
}
