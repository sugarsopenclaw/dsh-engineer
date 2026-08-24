import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Database,
  Download,
  GitFork,
  History,
  Pin,
  PinOff,
  PencilLine,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ConversationPiSessionExportFormat,
  ConversationPiSessionExportResult,
  ConversationPiSessionImportResult,
  ConversationPiSessionInfo,
  ConversationSummary,
} from '@/shared/local-agent'

interface ConversationHistoryDialogProps {
  open: boolean
  conversations: ConversationSummary[]
  currentConversationId: string | null
  deleting?: boolean
  onClose: () => void
  onSelect: (conversationId: string) => void
  onDelete: (conversationId: string) => Promise<void>
  onRename: (conversationId: string, title: string) => Promise<void>
  onSearch: (query: string) => Promise<ConversationSummary[]>
  onSetPinned: (conversationId: string, pinned: boolean) => Promise<void>
  onGetSessionInfo: (conversationId: string) => Promise<ConversationPiSessionInfo | null>
  onExportSession: (
    conversationId: string,
    format: ConversationPiSessionExportFormat,
  ) => Promise<ConversationPiSessionExportResult>
  onImportSession: (conversationId: string) => Promise<ConversationPiSessionImportResult>
}

export function ConversationHistoryDialog({
  open,
  conversations,
  currentConversationId,
  deleting = false,
  onClose,
  onSelect,
  onDelete,
  onRename,
  onSearch,
  onSetPinned,
  onGetSessionInfo,
  onExportSession,
  onImportSession,
}: ConversationHistoryDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const latestSearchRef = useRef(onSearch)
  const [query, setQuery] = useState('')
  const [visibleConversations, setVisibleConversations] = useState(conversations)
  const [searching, setSearching] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [busyConversationId, setBusyConversationId] = useState<string | null>(null)
  const [sessionConversationId, setSessionConversationId] = useState<string | null>(null)
  const [sessionInfo, setSessionInfo] = useState<ConversationPiSessionInfo | null>(null)
  const [sessionNotice, setSessionNotice] = useState('')
  const [confirmImportId, setConfirmImportId] = useState<string | null>(null)

  const confirmDeleteConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === confirmDeleteId) ?? null,
    [confirmDeleteId, conversations],
  )
  const conversationTitleById = useMemo(
    () => new Map(conversations.map((conversation) => [conversation.id, conversation.title] as const)),
    [conversations],
  )

  useEffect(() => {
    latestSearchRef.current = onSearch
  }, [onSearch])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      setQuery('')
      setVisibleConversations(conversations)
      setConfirmDeleteId(null)
      setEditingConversationId(null)
      setEditingTitle('')
      setBusyConversationId(null)
      setSessionConversationId(null)
      setSessionInfo(null)
      setSessionNotice('')
      setConfirmImportId(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    const keyword = query.trim()
    if (!keyword) {
      setVisibleConversations(conversations)
      setSearching(false)
      return
    }

    let cancelled = false
    const handle = window.setTimeout(() => {
      setSearching(true)
      void latestSearchRef.current(keyword)
        .then((results) => {
          if (!cancelled) {
            setVisibleConversations(results)
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearching(false)
          }
        })
    }, 140)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [conversations, open, query])

  if (!open) {
    return null
  }

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/32 px-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === overlayRef.current) {
          onClose()
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="历史对话"
        className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_28px_100px_rgba(15,23,42,0.28)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-4 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-slate-900">
              <History className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-semibold">历史对话</h3>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            aria-label="关闭历史对话弹窗"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-b border-slate-200/80 px-4 py-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 shadow-inner shadow-white/60">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题或消息内容"
              className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="mt-2 flex items-center justify-end text-[11px] text-slate-400">
            {searching ? <span>搜索中...</span> : null}
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2">
          {visibleConversations.length > 0 ? (
            <div className="space-y-1">
              {visibleConversations.map((conversation) => {
                const active = conversation.id === currentConversationId
                const confirmingDelete = conversation.id === confirmDeleteId
                const editingThisConversation = conversation.id === editingConversationId
                const busyThisConversation = conversation.id === busyConversationId
                const showingSession = conversation.id === sessionConversationId
                const confirmingImport = conversation.id === confirmImportId

                return (
                  <div
                    key={conversation.id}
                    className={cn(
                      'rounded-xl transition',
                      active
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-slate-50/70 text-slate-800 hover:bg-slate-100',
                    )}
                  >
                    <div className="flex items-start gap-3 px-3 py-3">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          onSelect(conversation.id)
                          onClose()
                        }}
                        disabled={deleting || busyThisConversation}
                      >
                        <div className="flex items-center gap-2">
                          {conversation.parentConversationId ? (
                            <GitFork className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-violet-200' : 'text-violet-500')} aria-hidden />
                          ) : null}
                          <div className="truncate text-sm font-medium">{conversation.title}</div>
                          {conversation.isPinned ? (
                            <span
                              className={cn(
                                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-[0.04em]',
                                active ? 'bg-white/14 text-white/88' : 'bg-slate-200 text-slate-600',
                              )}
                            >
                              置顶
                            </span>
                          ) : null}
                          {conversation.childConversationCount > 0 ? (
                            <span
                              className={cn(
                                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                                active ? 'bg-white/14 text-white/88' : 'bg-violet-100 text-violet-700',
                              )}
                            >
                              {conversation.childConversationCount} 个分支
                            </span>
                          ) : null}
                        </div>
                        <div
                          className={cn(
                            'mt-1 truncate text-[11px]',
                            active ? 'text-white/72' : 'text-slate-500',
                          )}
                        >
                          最近更新 {formatUpdatedAt(conversation.updatedAt)}
                          {conversation.parentConversationId
                            ? ` · 分支自 ${conversationTitleById.get(conversation.parentConversationId) ?? '父会话'}`
                            : ''}
                        </div>
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'rounded-full px-2.5 py-1 transition',
                          active
                            ? 'bg-white/10 hover:bg-white/16'
                            : 'bg-white hover:bg-slate-100',
                        )}
                        disabled={deleting || busyThisConversation}
                        aria-expanded={showingSession}
                        onClick={async () => {
                          if (showingSession) {
                            setSessionConversationId(null)
                            setSessionInfo(null)
                            setSessionNotice('')
                            setConfirmImportId(null)
                            return
                          }
                          try {
                            setBusyConversationId(conversation.id)
                            setSessionConversationId(conversation.id)
                            setSessionInfo(null)
                            setSessionNotice('')
                            setConfirmImportId(null)
                            setSessionInfo(await onGetSessionInfo(conversation.id))
                          } catch (error) {
                            setSessionNotice(error instanceof Error ? error.message : String(error))
                          } finally {
                            setBusyConversationId(null)
                          }
                        }}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Database className="h-3.5 w-3.5" />
                          <span>Session</span>
                        </span>
                      </button>

                      <div className="flex shrink-0 items-center gap-2">
                        {active ? (
                          <span className="rounded-full bg-white/14 px-2 py-0.5 text-[10px] font-medium tracking-[0.04em] text-white/92">
                            当前
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className={cn(
                        'flex flex-wrap items-center gap-2 px-3 pb-3 text-[11px]',
                        active ? 'text-white/82' : 'text-slate-500',
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          'rounded-full px-2.5 py-1 transition',
                          active
                            ? 'bg-white/10 hover:bg-white/16'
                            : 'bg-white hover:bg-slate-100',
                        )}
                        disabled={deleting || busyThisConversation}
                        onClick={() => {
                          setConfirmDeleteId(null)
                          setEditingConversationId(conversation.id)
                          setEditingTitle(conversation.title)
                        }}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <PencilLine className="h-3.5 w-3.5" />
                          <span>重命名</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'rounded-full px-2.5 py-1 transition',
                          active
                            ? 'bg-white/10 hover:bg-white/16'
                            : 'bg-white hover:bg-slate-100',
                        )}
                        disabled={deleting || busyThisConversation}
                        onClick={async () => {
                          try {
                            setBusyConversationId(conversation.id)
                            setConfirmDeleteId(null)
                            setEditingConversationId(null)
                            await onSetPinned(conversation.id, !conversation.isPinned)
                          } finally {
                            setBusyConversationId(null)
                          }
                        }}
                      >
                        {busyThisConversation ? (
                          '处理中...'
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            {conversation.isPinned ? (
                              <PinOff className="h-3.5 w-3.5" />
                            ) : (
                              <Pin className="h-3.5 w-3.5" />
                            )}
                            <span>{conversation.isPinned ? '取消置顶' : '置顶'}</span>
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'rounded-full px-2.5 py-1 transition',
                          active
                            ? 'bg-white/10 text-white hover:bg-white/16'
                            : 'bg-white text-rose-600 hover:bg-rose-50',
                        )}
                        disabled={deleting || busyThisConversation}
                        onClick={() => {
                          setEditingConversationId(null)
                          setConfirmDeleteId(conversation.id)
                        }}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>删除</span>
                        </span>
                      </button>
                    </div>

                    {editingThisConversation ? (
                      <div
                        className={cn(
                          'flex items-center gap-2 border-t px-3 py-2.5',
                          active
                            ? 'border-white/10 bg-white/6'
                            : 'border-slate-200/80 bg-slate-100/80',
                        )}
                      >
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          maxLength={60}
                          autoFocus
                          className={cn(
                            'min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none',
                            active
                              ? 'border-white/12 bg-white/10 text-white placeholder:text-white/36'
                              : 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400',
                          )}
                          placeholder="输入对话标题"
                          onKeyDown={async (event) => {
                            if (event.key === 'Escape') {
                              setEditingConversationId(null)
                              setEditingTitle('')
                            }
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              const nextTitle = editingTitle.trim()
                              if (!nextTitle || busyThisConversation) return
                              try {
                                setBusyConversationId(conversation.id)
                                await onRename(conversation.id, nextTitle)
                                setEditingConversationId(null)
                                setEditingTitle('')
                              } finally {
                                setBusyConversationId(null)
                              }
                            }
                          }}
                        />
                        <button
                          type="button"
                          className={cn(
                            'rounded-lg px-2.5 py-1 text-[11px] transition',
                            active
                              ? 'bg-white/10 text-white hover:bg-white/16'
                              : 'bg-white text-slate-600 hover:bg-slate-50',
                          )}
                          disabled={deleting || busyThisConversation}
                          onClick={() => {
                            setEditingConversationId(null)
                            setEditingTitle('')
                          }}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className={cn(
                            'rounded-lg px-2.5 py-1 text-[11px] transition',
                            active
                              ? 'bg-white text-slate-900 hover:bg-slate-100'
                              : 'bg-slate-900 text-white hover:bg-slate-800',
                          )}
                          disabled={deleting || busyThisConversation || editingTitle.trim().length === 0}
                          onClick={async () => {
                            const nextTitle = editingTitle.trim()
                            if (!nextTitle) return
                            try {
                              setBusyConversationId(conversation.id)
                              await onRename(conversation.id, nextTitle)
                              setEditingConversationId(null)
                              setEditingTitle('')
                            } finally {
                              setBusyConversationId(null)
                            }
                          }}
                        >
                          保存
                        </button>
                      </div>
                    ) : null}

                    {confirmingDelete ? (
                      <div
                        className={cn(
                          'flex items-center justify-between gap-3 border-t px-3 py-2.5',
                          active
                            ? 'border-white/10 bg-white/6'
                            : 'border-slate-200/80 bg-slate-100/80',
                        )}
                      >
                        <p className={cn('text-[11px]', active ? 'text-white/78' : 'text-slate-600')}>
                          删除后消息记录无法恢复，确认删除这条对话？
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            className={cn(
                              'rounded-lg px-2.5 py-1 text-[11px] transition',
                              active
                                ? 'bg-white/10 text-white hover:bg-white/16'
                                : 'bg-white text-slate-600 hover:bg-slate-50',
                            )}
                            disabled={deleting || busyThisConversation}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            className={cn(
                              'rounded-lg px-2.5 py-1 text-[11px] transition',
                              active
                                ? 'bg-rose-500 text-white hover:bg-rose-400'
                                : 'bg-rose-600 text-white hover:bg-rose-500',
                            )}
                            disabled={deleting || busyThisConversation}
                            onClick={async () => {
                              try {
                                setBusyConversationId(conversation.id)
                                await onDelete(conversation.id)
                                setConfirmDeleteId(null)
                              } finally {
                                setBusyConversationId(null)
                              }
                            }}
                          >
                            {busyThisConversation ? '删除中...' : '删除'}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {showingSession ? (
                      <div
                        className={cn(
                          'border-t px-3 py-3 text-[11px]',
                          active
                            ? 'border-white/10 bg-white/6 text-white/82'
                            : 'border-slate-200/80 bg-slate-100/80 text-slate-600',
                        )}
                      >
                        {sessionInfo ? (
                          <>
                            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                              <dt>Session</dt>
                              <dd className="truncate font-mono" title={sessionInfo.sessionId}>
                                {sessionInfo.sessionId}
                              </dd>
                              <dt>状态</dt>
                              <dd>
                                {sessionInfo.migrationStatus === 'ready'
                                  ? '已同步'
                                  : sessionInfo.migrationStatus === 'migrating'
                                    ? '迁移中'
                                    : '恢复失败'}
                              </dd>
                              <dt>模型</dt>
                              <dd className="truncate">
                                {sessionInfo.modelProvider && sessionInfo.modelId
                                  ? `${sessionInfo.modelProvider}/${sessionInfo.modelId}`
                                  : '未记录'}
                              </dd>
                              <dt>消息</dt>
                              <dd>
                                {sessionInfo.stats.totalMessages} 条 · {sessionInfo.stats.toolCalls} 次工具调用
                              </dd>
                              <dt>Token</dt>
                              <dd>{sessionInfo.stats.tokens.total.toLocaleString('zh-CN')}</dd>
                            </dl>
                            {sessionInfo.migrationError ? (
                              <p
                                className={cn(
                                  'mt-2 break-all rounded-lg px-2 py-1.5',
                                  active
                                    ? 'bg-rose-400/15 text-rose-100'
                                    : 'bg-rose-50 text-rose-700',
                                )}
                              >
                                {sessionInfo.migrationError}
                              </p>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(['jsonl', 'html'] as const).map((format) => (
                                <button
                                  key={format}
                                  type="button"
                                  className={cn(
                                    'rounded-lg px-2.5 py-1 transition',
                                    active
                                      ? 'bg-white/10 text-white hover:bg-white/16'
                                      : 'bg-white text-slate-600 hover:bg-slate-50',
                                  )}
                                  disabled={
                                    busyThisConversation
                                    || sessionInfo.migrationStatus !== 'ready'
                                  }
                                  onClick={async () => {
                                    try {
                                      setBusyConversationId(conversation.id)
                                      setSessionNotice('')
                                      const result = await onExportSession(conversation.id, format)
                                      if (!result.cancelled && result.outputPath) {
                                        setSessionNotice(`已导出：${result.outputPath}`)
                                      }
                                    } catch (error) {
                                      setSessionNotice(error instanceof Error ? error.message : String(error))
                                    } finally {
                                      setBusyConversationId(null)
                                    }
                                  }}
                                >
                                  <span className="inline-flex items-center gap-1.5">
                                    <Download className="h-3.5 w-3.5" />
                                    导出 {format.toUpperCase()}
                                  </span>
                                </button>
                              ))}
                              <button
                                type="button"
                                className={cn(
                                  'rounded-lg px-2.5 py-1 transition',
                                  confirmingImport
                                    ? 'bg-amber-500 text-white hover:bg-amber-400'
                                    : active
                                      ? 'bg-white/10 text-white hover:bg-white/16'
                                      : 'bg-white text-slate-600 hover:bg-slate-50',
                                )}
                                disabled={busyThisConversation}
                                onClick={async () => {
                                  if (!confirmingImport) {
                                    setConfirmImportId(conversation.id)
                                    setSessionNotice('导入会替换当前活动路径；原 JSONL 仍会保留。再次点击确认。')
                                    return
                                  }
                                  try {
                                    setBusyConversationId(conversation.id)
                                    setSessionNotice('')
                                    const result = await onImportSession(conversation.id)
                                    if (!result.cancelled) {
                                      setSessionInfo(await onGetSessionInfo(conversation.id))
                                      setSessionNotice('Session 已导入。')
                                    }
                                  } catch (error) {
                                    setSessionNotice(error instanceof Error ? error.message : String(error))
                                  } finally {
                                    setConfirmImportId(null)
                                    setBusyConversationId(null)
                                  }
                                }}
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  <Upload className="h-3.5 w-3.5" />
                                  {confirmingImport ? '确认导入' : '导入 JSONL'}
                                </span>
                              </button>
                            </div>
                          </>
                        ) : sessionNotice ? null : (
                          <p>Pi JSONL session 未启用或尚未建立绑定。</p>
                        )}
                        {sessionNotice ? (
                          <p className={cn('mt-2 break-all', active ? 'text-white/72' : 'text-slate-500')}>
                            {sessionNotice}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : conversations.length > 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <div className="rounded-full bg-slate-100 p-3 text-slate-400">
                <Search className="h-5 w-5" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-800">没有匹配的对话</p>
              <p className="mt-1 text-xs text-slate-500">
                {query.trim() ? `没有找到包含“${query.trim()}”的标题或消息内容。` : '试试换个关键词。'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <div className="rounded-full bg-slate-100 p-3 text-slate-400">
                <History className="h-5 w-5" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-800">还没有历史对话</p>
              <p className="mt-1 text-xs text-slate-500">先创建一条新对话，后续就可以在这里切换。</p>
            </div>
          )}
        </div>

        {confirmDeleteConversation ? (
          <footer className="border-t border-slate-200/80 bg-slate-50/80 px-4 py-3 text-[11px] text-slate-500">
            当前待删除：<span className="font-medium text-slate-700">{confirmDeleteConversation.title}</span>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value || '未知时间'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
