import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  Bookmark,
  Circle,
  Copy,
  Cpu,
  FileText,
  Gauge,
  GitBranch,
  GitFork,
  Info,
  LoaderCircle,
  MessageSquare,
  Route,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  ConversationTreeBranchResult,
  ConversationTreeNavigateResult,
  ConversationTreeNode,
  ConversationTreeSnapshot,
} from '@/shared/local-agent'

export interface ConversationTreeDialogProps {
  open: boolean
  conversationId: string | null
  conversationTitle: string
  onClose: () => void
  onLoad: (conversationId: string) => Promise<ConversationTreeSnapshot>
  onNavigate: (
    conversationId: string,
    targetEntryId: string,
    summarize: boolean,
  ) => Promise<ConversationTreeNavigateResult>
  onForkBefore: (
    conversationId: string,
    targetEntryId: string,
  ) => Promise<ConversationTreeBranchResult>
  onCloneAt: (
    conversationId: string,
    targetEntryId: string,
  ) => Promise<ConversationTreeBranchResult>
  onNavigated: (result: ConversationTreeNavigateResult) => Promise<void> | void
  onBranched: (result: ConversationTreeBranchResult) => Promise<void> | void
  onAbortSummary: (conversationId: string) => Promise<void>
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const ENTRY_TYPE_LABELS: Record<ConversationTreeNode['type'], string> = {
  message: '消息',
  thinking_level_change: '思考级别',
  model_change: '模型',
  compaction: '上下文压缩',
  branch_summary: '分支摘要',
  custom: '路径记录',
  custom_message: '上下文消息',
  label: '书签记录',
  session_info: '会话信息',
}

function NodeIcon({ node }: { node: ConversationTreeNode }) {
  const iconClass = 'h-3.5 w-3.5'
  if (node.role === 'user') return <MessageSquare className={iconClass} aria-hidden />
  if (node.role === 'assistant') return <Bot className={iconClass} aria-hidden />
  if (node.role === 'tool') return <Wrench className={iconClass} aria-hidden />
  if (node.type === 'thinking_level_change') return <Gauge className={iconClass} aria-hidden />
  if (node.type === 'model_change') return <Cpu className={iconClass} aria-hidden />
  if (node.type === 'session_info') return <Info className={iconClass} aria-hidden />
  if (node.type === 'compaction' || node.type === 'branch_summary') {
    return <Sparkles className={iconClass} aria-hidden />
  }
  if (node.type === 'custom_message') return <FileText className={iconClass} aria-hidden />
  if (node.type === 'custom') return <Route className={iconClass} aria-hidden />
  if (node.type === 'label') return <Bookmark className={iconClass} aria-hidden />
  return <Circle className="h-3 w-3" aria-hidden />
}

function nodeKindLabel(node: ConversationTreeNode) {
  if (node.role === 'user') return '用户'
  if (node.role === 'assistant') return '助手'
  if (node.role === 'tool') return '工具结果'
  return ENTRY_TYPE_LABELS[node.type]
}

function formatNodeTime(timestamp: string) {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return timestamp
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ConversationTreeDialog({
  open,
  conversationId,
  conversationTitle,
  onClose,
  onLoad,
  onNavigate,
  onForkBefore,
  onCloneAt,
  onNavigated,
  onBranched,
  onAbortSummary,
}: ConversationTreeDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const latestLoadRef = useRef(onLoad)
  latestLoadRef.current = onLoad
  const [tree, setTree] = useState<ConversationTreeSnapshot | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<'navigate' | 'fork' | 'clone' | null>(null)
  const [summarize, setSummarize] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [summaryAbortPending, setSummaryAbortPending] = useState(false)

  const selectedNode = useMemo(
    () => tree?.nodes.find((node) => node.id === selectedEntryId) ?? null,
    [selectedEntryId, tree],
  )

  useEffect(() => {
    if (!open || !conversationId) return
    let cancelled = false
    setTree(null)
    setSelectedEntryId(null)
    setSummarize(false)
    setError('')
    setNotice('')
    setSummaryAbortPending(false)
    setLoading(true)
    void latestLoadRef.current(conversationId)
      .then((snapshot) => {
        if (cancelled) return
        setTree(snapshot)
        setSelectedEntryId(snapshot.leafId ?? snapshot.nodes.at(-1)?.id ?? null)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, open])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  const busy = busyAction !== null

  function requestClose() {
    if (!busy) onClose()
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      requestClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (!focusable?.length) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function runAction(
    action: NonNullable<typeof busyAction>,
    operation: () => Promise<void>,
  ) {
    setBusyAction(action)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    } finally {
      setBusyAction(null)
      setSummaryAbortPending(false)
    }
  }

  async function abortBranchSummary() {
    if (!conversationId || summaryAbortPending) return
    setSummaryAbortPending(true)
    setError('')
    try {
      await onAbortSummary(conversationId)
    } catch (abortError) {
      setSummaryAbortPending(false)
      setError(abortError instanceof Error ? abortError.message : String(abortError))
    }
  }

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10020] flex items-center justify-center bg-slate-950/38 px-3 py-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === overlayRef.current) requestClose()
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={loading || busy}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_30px_110px_rgba(15,23,42,0.32)] outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-4 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-slate-900">
              <GitBranch className="h-4 w-4 text-violet-600" aria-hidden />
              <h2 id={titleId} className="truncate text-sm font-semibold">会话分支</h2>
            </div>
            <p id={descriptionId} className="mt-1 truncate text-xs text-slate-500">
              {conversationTitle || '当前会话'}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭会话分支"
            disabled={busy}
            onClick={requestClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="min-h-[280px] p-2">
              {loading ? (
                <div className="flex h-full min-h-[228px] items-center justify-center gap-2 text-sm text-slate-500">
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  正在读取分支记录…
                </div>
              ) : tree?.nodes.length ? (
                <ol aria-label="会话分支节点" className="space-y-1">
                  {tree.nodes.map((node) => {
                    const selected = node.id === selectedEntryId
                    return (
                      <li key={node.id}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            setSelectedEntryId(node.id)
                            setError('')
                            setNotice('')
                          }}
                          className={cn(
                            'relative flex min-h-9 w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
                            node.isLeaf
                              ? 'border-violet-300 bg-violet-50 text-violet-950'
                              : selected
                                ? 'border-slate-300 bg-white text-slate-800'
                                : 'border-transparent bg-slate-50/70 text-slate-700 hover:border-slate-200 hover:bg-slate-100',
                          )}
                        >
                          <span className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg',
                            node.isLeaf ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600',
                          )}>
                            <NodeIcon node={node} />
                          </span>
                          <span className="shrink-0 text-[10px] font-medium text-slate-500">{nodeKindLabel(node)}</span>
                          {node.forkedChildCount > 0 ? (
                            <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                              {node.forkedChildCount} 个分支
                            </span>
                          ) : null}
                          {node.childCount > 1 && node.forkedChildCount === 0 ? (
                            <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">分叉</span>
                          ) : null}
                          {node.isLeaf ? (
                            <span className="shrink-0 rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-medium text-white">当前</span>
                          ) : null}
                          <span className="min-w-0 flex-1 truncate text-xs leading-5">{node.preview}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{formatNodeTime(node.timestamp)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              ) : error ? null : (
                <div className="flex h-full min-h-[228px] items-center justify-center px-6 text-center text-sm text-slate-400">
                  还没有分支记录。
                </div>
              )}
          </div>
        </div>

        <footer
          className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 bg-white px-4 py-3"
          aria-label="分支节点操作"
        >
          <div className="mr-auto min-w-0 text-xs" aria-live="polite" aria-atomic="true">
            {error ? (
              <p role="alert" className="truncate text-rose-600">{error}</p>
            ) : notice ? (
              <p className="truncate text-emerald-700">{notice}</p>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={summarize}
              disabled={busy || !selectedNode || selectedNode.isLeaf}
              onChange={(event) => setSummarize(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
            />
            <span className="whitespace-nowrap">切换时生成分支摘要</span>
          </label>
          {busyAction === 'navigate' && summarize && conversationId ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={summaryAbortPending}
              onClick={() => void abortBranchSummary()}
            >
              {summaryAbortPending ? '正在停止…' : '停止摘要'}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !selectedNode?.canForkBefore}
            onClick={() => {
              if (!conversationId || !selectedNode) return
              void runAction('fork', async () => {
                const result = await onForkBefore(conversationId, selectedNode.id)
                await onBranched(result)
                onClose()
              })
            }}
            className="h-8 gap-1.5 px-2.5 text-xs"
          >
            {busyAction === 'fork' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <GitFork className="h-3.5 w-3.5" aria-hidden />}
            消息前分叉
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !selectedNode?.canCloneAt}
            onClick={() => {
              if (!conversationId || !selectedNode) return
              void runAction('clone', async () => {
                const result = await onCloneAt(conversationId, selectedNode.id)
                await onBranched(result)
                onClose()
              })
            }}
            className="h-8 gap-1.5 px-2.5 text-xs"
          >
            {busyAction === 'clone' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            克隆到此处
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !selectedNode || selectedNode.isLeaf}
            onClick={() => {
              if (!conversationId || !selectedNode) return
              void runAction('navigate', async () => {
                const result = await onNavigate(
                  conversationId,
                  selectedNode.id,
                  summarize,
                )
                setTree(result.tree)
                await onNavigated(result)
                if (!result.cancelled) onClose()
              })
            }}
            className="h-8 gap-1.5 px-2.5 text-xs"
          >
            {busyAction === 'navigate' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Route className="h-3.5 w-3.5" aria-hidden />}
            切换到此路径
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
