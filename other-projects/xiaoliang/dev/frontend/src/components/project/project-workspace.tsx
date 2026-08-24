import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ExternalLink,
  FolderInput,
  FolderOpen,
  MessageSquarePlus,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { ConfirmDeleteDialog } from '@/components/common/confirm-delete-dialog'
import { Button } from '@/components/ui/button'
import { electronBridge } from '@/services/electron-bridge'
import type { ConversationSummary, ProjectSummary } from '@/shared/local-agent'

interface ProjectWorkspaceProps {
  active: boolean
  selectedProject: ProjectSummary | null
  onSelectProject: (project: ProjectSummary | null) => void
  onOpenProjectChat: (conversationId?: string) => void
  onWorkspaceChanged?: () => void
}

function normalizeWorkspaceName(value: string) {
  return value.trim().toLocaleLowerCase()
}

function getDuplicateNameMessage(names: string[], rawValue: string, kind: '项目' | '图纸') {
  const normalizedValue = normalizeWorkspaceName(rawValue)
  if (!normalizedValue) {
    return null
  }

  return names.some((name) => normalizeWorkspaceName(name) === normalizedValue)
    ? `已存在同名${kind}，请更换名称。`
    : null
}

function getRawErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function stripElectronInvokePrefix(message: string) {
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').trim()
}

function isProjectIndexRefreshTransientError(error: unknown) {
  const message = stripElectronInvokePrefix(getRawErrorMessage(error))
  return (
    /(?:EPERM|EACCES|EBUSY|ENOENT)/i.test(message) &&
    /rename/i.test(message) &&
    /(?:project-index\.json|PROJECT_INDEX\.md)/i.test(message)
  )
}

function getDisplayErrorMessage(error: unknown) {
  if (isProjectIndexRefreshTransientError(error)) {
    return '项目资料索引正在刷新，稍后会自动恢复。'
  }
  return stripElectronInvokePrefix(getRawErrorMessage(error)) || '操作失败，请稍后重试。'
}

type BusyAction =
  | 'create-project'
  | 'use-existing-folder'
  | 'delete-project'
  | 'create-conversation'
  | 'select-root'
  | 'open-root'
  | null

export function ProjectWorkspace({
  active,
  selectedProject,
  onSelectProject,
  onOpenProjectChat,
  onWorkspaceChanged,
}: ProjectWorkspaceProps) {
  if (!selectedProject) {
    return (
      <ProjectListStep
        onSelectProject={onSelectProject}
        onWorkspaceChanged={onWorkspaceChanged}
      />
    )
  }

  return (
    <ProjectConversationStep
      active={active}
      project={selectedProject}
      onProjectUpdated={onSelectProject}
      onOpenProjectChat={onOpenProjectChat}
      onWorkspaceChanged={onWorkspaceChanged}
    />
  )
}

function ProjectListStep({
  onSelectProject,
  onWorkspaceChanged,
}: {
  onSelectProject: (project: ProjectSummary | null) => void
  onWorkspaceChanged?: () => void
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [projectToDelete, setProjectToDelete] = useState<ProjectSummary | null>(null)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)

  const refreshProjects = useCallback(async () => {
    const nextProjects = await electronBridge.listProjects()
    setProjects(nextProjects)
    return nextProjects
  }, [])

  const createProjectValidationText = getDuplicateNameMessage(
    projects.map((project) => project.name),
    newProjectName,
    '项目',
  )

  useEffect(() => {
    let cancelled = false
    void refreshProjects().catch((error) => {
      if (!cancelled) {
        setErrorText(getDisplayErrorMessage(error))
      }
    })

    return () => {
      cancelled = true
    }
  }, [refreshProjects])

  async function handleCreateProject(rawName: string) {
    const normalizedName = rawName.trim()
    if (!normalizedName) return

    if (getDuplicateNameMessage(projects.map((project) => project.name), normalizedName, '项目')) {
      return
    }

    setBusy('create-project')
    setErrorText(null)
    try {
      const created = await electronBridge.createProjectFromDirectory(normalizedName)
      if (!created) {
        return
      }
      const wasExisting = projects.some((project) => project.id === created.id)
      await refreshProjects()
      onWorkspaceChanged?.()
      setCreateDialogOpen(false)
      setNewProjectName('')
      setStatusText(wasExisting ? `已打开项目：${created.name}` : `已创建项目：${created.name}`)
      onSelectProject(created)
    } catch (error) {
      setErrorText(getDisplayErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function handleUseExistingFolder() {
    setBusy('use-existing-folder')
    setErrorText(null)
    try {
      const project = await electronBridge.createProjectFromDirectory()
      if (!project) {
        return
      }
      const wasExisting = projects.some((candidate) => candidate.id === project.id)
      await refreshProjects()
      onWorkspaceChanged?.()
      setStatusText(wasExisting ? `已打开项目：${project.name}` : `已从文件夹创建项目：${project.name}`)
      onSelectProject(project)
    } catch (error) {
      setErrorText(getDisplayErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function handleDeleteProject(project: ProjectSummary) {
    setBusy('delete-project')
    setErrorText(null)
    try {
      await electronBridge.deleteProject(project.id)
      await refreshProjects()
      onWorkspaceChanged?.()
      setStatusText(`已删除项目：${project.name}`)
    } catch (error) {
      setErrorText(getDisplayErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center px-4 pt-16">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-900">
            <FolderOpen className="h-5 w-5 text-slate-500" />
            <h1 className="text-2xl font-semibold">项目列表</h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleUseExistingFolder()}
              disabled={busy !== null}
            >
              <FolderInput className="mr-1 h-4 w-4" />
              使用现有文件夹
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setNewProjectName('')
                setErrorText(null)
                setCreateDialogOpen(true)
              }}
              disabled={busy !== null}
            >
              <Plus className="mr-1 h-4 w-4" />
              新建项目
            </Button>
          </div>
        </div>

        {statusText ? <p className="mb-2 text-xs text-emerald-600">{statusText}</p> : null}
        {errorText ? <p className="mb-2 text-xs text-rose-600">{errorText}</p> : null}

        {projects.length === 0 ? (
          <div className="py-16 text-center text-slate-500">
            <FolderOpen className="mx-auto mb-3 h-12 w-12 opacity-30" />
            <p>暂无项目，先新建项目或使用现有文件夹。</p>
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((project) => (
              <div
                key={project.id}
                className="group flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3 py-3 transition-colors hover:bg-slate-50"
                onClick={() => onSelectProject(project)}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{project.name}</div>
                  {project.description ? (
                    <div className="mt-0.5 truncate text-xs text-slate-500">{project.description}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-md p-1 text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation()
                    setProjectToDelete(project)
                  }}
                  aria-label="删除项目"
                  disabled={busy === 'delete-project'}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDeleteDialog
        open={!!projectToDelete}
        title="确认删除项目"
        description={
          projectToDelete
            ? `确定删除项目“${projectToDelete.name}”吗？相关图纸和历史对话会一并删除，此操作不可撤销。`
            : ''
        }
        confirmLabel="删除项目"
        onOpenChange={(open) => {
          if (!open) setProjectToDelete(null)
        }}
        onConfirm={async () => {
          if (!projectToDelete) return
          await handleDeleteProject(projectToDelete)
          setProjectToDelete(null)
        }}
      />

      <CreateNameDialog
        open={createDialogOpen}
        title="新建项目"
        description="输入项目名称，随后选择项目文件夹。创建后会自动绑定该目录。"
        placeholder="输入项目名称"
        confirmLabel="选择文件夹并创建"
        value={newProjectName}
        busy={busy === 'create-project'}
        validationText={createProjectValidationText}
        onValueChange={(value) => {
          setNewProjectName(value)
          if (errorText) {
            setErrorText(null)
          }
        }}
        onOpenChange={(open) => {
          setCreateDialogOpen(open)
          if (!open && busy !== 'create-project') {
            setNewProjectName('')
          }
        }}
        onConfirm={async () => {
          await handleCreateProject(newProjectName)
        }}
      />
    </div>
  )
}

function ProjectConversationStep({
  active,
  project,
  onProjectUpdated,
  onOpenProjectChat,
  onWorkspaceChanged,
}: {
  active: boolean
  project: ProjectSummary
  onProjectUpdated: (project: ProjectSummary) => void
  onOpenProjectChat: (conversationId?: string) => void
  onWorkspaceChanged?: () => void
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [query, setQuery] = useState('')
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busyConversationId, setBusyConversationId] = useState<string | null>(null)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)

  const refreshConversations = useCallback(async (search = query) => {
    const nextConversations = await electronBridge.listProjectConversations(
      project.id,
      search.trim() || undefined,
    )
    setConversations(nextConversations)
    return nextConversations
  }, [project.id, query])

  useEffect(() => {
    if (!active) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      void refreshConversations().catch((error) => {
        if (!cancelled) {
          setErrorText(getDisplayErrorMessage(error))
        }
      })
    }, query.trim() ? 140 : 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, refreshConversations])

  function handleCreateConversation() {
    setErrorText(null)
    setStatusText('新对话将在发送首条消息时创建。')
    onOpenProjectChat()
  }

  async function handleSelectProjectRoot() {
    setBusy('select-root')
    setErrorText(null)
    try {
      const updated = await electronBridge.selectProjectRootDirectory(project.id)
      if (updated) {
        onProjectUpdated(updated)
        onWorkspaceChanged?.()
        setStatusText('已绑定项目资料与产物目录。')
      }
    } catch (error) {
      setErrorText(getDisplayErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function handleOpenProjectRoot() {
    setBusy('open-root')
    setErrorText(null)
    try {
      await electronBridge.openProjectRootDirectory(project.id)
    } catch (error) {
      setErrorText(getDisplayErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function handleRenameConversation(conversationId: string, title: string) {
    const nextTitle = title.trim()
    if (!nextTitle) return
    setBusyConversationId(conversationId)
    setErrorText(null)
    try {
      await electronBridge.renameConversation(conversationId, nextTitle)
      setEditingConversationId(null)
      setEditingTitle('')
      await refreshConversations()
      onWorkspaceChanged?.()
    } catch (error) {
      setErrorText(getDisplayErrorMessage(error))
    } finally {
      setBusyConversationId(null)
    }
  }

  async function handleSetPinned(conversation: ConversationSummary) {
    setBusyConversationId(conversation.id)
    setErrorText(null)
    try {
      await electronBridge.setConversationPinned(conversation.id, !conversation.isPinned)
      await refreshConversations()
      onWorkspaceChanged?.()
    } catch (error) {
      setErrorText(getDisplayErrorMessage(error))
    } finally {
      setBusyConversationId(null)
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    setBusyConversationId(conversationId)
    setErrorText(null)
    try {
      await electronBridge.deleteConversation(conversationId)
      setConfirmDeleteId(null)
      await refreshConversations()
      onWorkspaceChanged?.()
      setStatusText('已删除对话。')
    } catch (error) {
      setErrorText(getDisplayErrorMessage(error))
    } finally {
      setBusyConversationId(null)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center px-4 pt-12">
      <div className="w-full max-w-lg">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-slate-900">项目工作台</h1>
            <p className="mt-1 truncate text-xs text-slate-500">当前项目：{project.name}</p>
          </div>
          <Button size="sm" onClick={() => void handleCreateConversation()} disabled={busy === 'create-conversation'}>
            <MessageSquarePlus className="mr-1 h-4 w-4" />
            新对话
          </Button>
        </div>

        <div className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <FolderInput className="h-3.5 w-3.5 text-slate-400" />
                项目目录
              </div>
              {project.rootPath ? (
                <div
                  className={project.rootPathExists
                    ? 'mt-1 truncate text-sm font-medium text-slate-900'
                    : 'mt-1 truncate text-sm font-medium text-rose-600'}
                  title={project.rootPath}
                >
                  {project.rootPathExists ? getDirectoryLabel(project.rootPath) : '目录不可访问'}
                </div>
              ) : (
                <div className="mt-1 text-sm text-slate-500">未绑定，Agent 暂不能读资料或写产物。</div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {project.rootPath && project.rootPathExists ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  disabled={busy === 'open-root'}
                  onClick={() => void handleOpenProjectRoot()}
                >
                  <ExternalLink className="mr-1 h-3.5 w-3.5" />
                  打开
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant={project.rootPath ? 'outline' : 'default'}
                className="h-8 px-2 text-xs"
                disabled={busy === 'select-root'}
                onClick={() => void handleSelectProjectRoot()}
              >
                <FolderInput className="mr-1 h-3.5 w-3.5" />
                {project.rootPath ? '更改' : '绑定'}
              </Button>
            </div>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-inner shadow-white/70">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目会话"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>

        {statusText ? <p className="mb-2 text-xs text-emerald-600">{statusText}</p> : null}
        {errorText ? <p className="mb-2 text-xs text-rose-600">{errorText}</p> : null}

        {conversations.length === 0 ? (
          <div className="py-16 text-center text-slate-500">
            <MessageSquarePlus className="mx-auto mb-3 h-12 w-12 opacity-30" />
            <p>{query.trim() ? '没有匹配的项目会话。' : '暂无项目会话，先创建一个对话。'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {conversations.map((conversation) => {
              const editing = conversation.id === editingConversationId
              const confirmingDelete = conversation.id === confirmDeleteId
              const busyThis = conversation.id === busyConversationId
              return (
                <div
                  key={conversation.id}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-3 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className="block min-w-0 flex-1 text-left"
                      onClick={() => onOpenProjectChat(conversation.id)}
                      disabled={busyThis}
                    >
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                          {conversation.title}
                        </div>
                        {conversation.isPinned ? (
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                            置顶
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        更新于 {formatUpdatedAt(conversation.updatedAt)}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                        disabled={busyThis}
                        aria-label="重命名对话"
                        title="重命名"
                        onClick={() => {
                          setConfirmDeleteId(null)
                          setEditingConversationId(conversation.id)
                          setEditingTitle(conversation.title)
                        }}
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                        disabled={busyThis}
                        aria-label={conversation.isPinned ? '取消置顶对话' : '置顶对话'}
                        title={conversation.isPinned ? '取消置顶' : '置顶'}
                        onClick={() => void handleSetPinned(conversation)}
                      >
                        {conversation.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        disabled={busyThis}
                        aria-label="删除对话"
                        title="删除"
                        onClick={() => {
                          setEditingConversationId(null)
                          setConfirmDeleteId(conversation.id)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {editing ? (
                    <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        maxLength={60}
                        autoFocus
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400"
                        placeholder="输入对话标题"
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setEditingConversationId(null)
                            setEditingTitle('')
                          }
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void handleRenameConversation(conversation.id, editingTitle)
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        disabled={busyThis}
                        onClick={() => {
                          setEditingConversationId(null)
                          setEditingTitle('')
                        }}
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        disabled={busyThis || editingTitle.trim().length === 0}
                        onClick={() => void handleRenameConversation(conversation.id, editingTitle)}
                      >
                        保存
                      </Button>
                    </div>
                  ) : null}

                  {confirmingDelete ? (
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                      <p className="text-[11px] text-slate-600">删除后消息记录无法恢复。</p>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={busyThis}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          取消
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 bg-rose-600 px-2 text-xs hover:bg-rose-500"
                          disabled={busyThis}
                          onClick={() => void handleDeleteConversation(conversation.id)}
                        >
                          {busyThis ? '删除中' : '删除'}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface CreateNameDialogProps {
  open: boolean
  title: string
  description: string
  placeholder: string
  confirmLabel?: string
  value: string
  validationText?: string | null
  busy?: boolean
  onValueChange: (value: string) => void
  onConfirm: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
}

export function CreateNameDialog({
  open,
  title,
  description,
  placeholder,
  confirmLabel = '确认',
  value,
  validationText = null,
  busy = false,
  onValueChange,
  onConfirm,
  onOpenChange,
}: CreateNameDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const canConfirm = Boolean(value.trim()) && !validationText && !busy

  useEffect(() => {
    if (!open || busy) {
      return
    }

    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [busy, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onOpenChange, open])

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-4"
      onClick={() => {
        if (!busy) {
          onOpenChange(false)
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canConfirm) {
              event.preventDefault()
              void onConfirm()
            }
          }}
          placeholder={placeholder}
          className="mt-4 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-800 outline-none placeholder:text-slate-400"
        />
        {validationText ? <p className="mt-2 text-xs text-rose-600">{validationText}</p> : null}

        <div className="flex justify-end gap-2 pt-5">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void onConfirm()} disabled={!canConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getDirectoryLabel(rootPath: string): string {
  const normalized = rootPath.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).filter(Boolean).pop() || rootPath
}
