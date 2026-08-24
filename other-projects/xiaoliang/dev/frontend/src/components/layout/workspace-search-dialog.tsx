import { createPortal } from 'react-dom'
import {
  Brain,
  FolderOpen,
  Loader2,
  MessageSquare,
  Search,
  Wrench,
  X,
} from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import type {
  AgentMessageRole,
  WorkspaceSearchMatchType,
  WorkspaceSearchResult,
} from '@/shared/local-agent'

const SEARCH_DEBOUNCE_MS = 150
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface WorkspaceSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearch: (query: string) => Promise<WorkspaceSearchResult[]>
  onSelectResult: (result: WorkspaceSearchResult) => void
}

function getRoleLabel(role: AgentMessageRole | null) {
  if (role === 'user') return '用户消息'
  if (role === 'assistant') return '助手消息'
  if (role === 'tool') return '工具消息'
  return '消息'
}

function getMatchLabel(matchType: WorkspaceSearchMatchType, role: AgentMessageRole | null) {
  if (matchType === 'project') return '项目'
  if (matchType === 'title') return '标题'
  if (matchType === 'thinking') return '思考过程'
  if (matchType === 'tool') return '工具内容'
  return getRoleLabel(role)
}

function MatchIcon({ matchType }: { matchType: WorkspaceSearchMatchType }) {
  if (matchType === 'project') return <FolderOpen className="h-4 w-4" aria-hidden="true" />
  if (matchType === 'thinking') return <Brain className="h-4 w-4" aria-hidden="true" />
  if (matchType === 'tool') return <Wrench className="h-4 w-4" aria-hidden="true" />
  return <MessageSquare className="h-4 w-4" aria-hidden="true" />
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const keyword = query.trim()
  if (!keyword || !text) return <>{text}</>

  const normalizedText = text.toLocaleLowerCase('zh-CN')
  const normalizedKeyword = keyword.toLocaleLowerCase('zh-CN')
  const parts: ReactNode[] = []
  let cursor = 0
  let matchIndex = normalizedText.indexOf(normalizedKeyword)

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex))
    }
    const matchEnd = matchIndex + keyword.length
    parts.push(
      <mark
        key={`${matchIndex}-${matchEnd}`}
        className="rounded-sm bg-amber-100 px-0.5 text-inherit"
      >
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    )
    cursor = matchEnd
    matchIndex = normalizedText.indexOf(normalizedKeyword, cursor)
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }
  return <>{parts}</>
}

function formatSearchTime(value: string | null) {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function WorkspaceSearchDialog({
  open,
  onOpenChange,
  onSearch,
  onSelectResult,
}: WorkspaceSearchDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const latestSearchRef = useRef(onSearch)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WorkspaceSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  useEffect(() => {
    latestSearchRef.current = onSearch
  }, [onSearch])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setSearching(false)
    setSearched(false)
    setErrorText(null)
  }, [open])

  useEffect(() => {
    if (!open) return

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frameId = window.requestAnimationFrame(() => inputRef.current?.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(frameId)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      window.requestAnimationFrame(() => previousFocus?.focus())
    }
  }, [onOpenChange, open])

  useEffect(() => {
    if (!open) return
    const keyword = query.trim()
    if (!keyword) {
      setResults([])
      setSearching(false)
      setSearched(false)
      setErrorText(null)
      return
    }

    let cancelled = false
    const handle = window.setTimeout(() => {
      setSearching(true)
      setErrorText(null)
      void latestSearchRef.current(keyword)
        .then((nextResults) => {
          if (!cancelled) {
            setResults(nextResults)
            setSearched(true)
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setResults([])
            setSearched(true)
            setErrorText(error instanceof Error ? error.message : String(error))
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [open, query])

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    )
    if (focusable.length === 0) {
      event.preventDefault()
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

  if (!open) return null

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/32 px-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === overlayRef.current) onOpenChange(false)
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="grid max-h-[min(720px,88vh)] w-full max-w-[640px] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_28px_100px_rgba(15,23,42,0.28)]"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-slate-900">
              <Search className="h-4 w-4 text-violet-500" aria-hidden="true" />
              <h2 id={titleId} className="text-sm font-semibold">全局搜索</h2>
            </div>
            <p id={descriptionId} className="mt-1 text-xs text-slate-500">
              查找项目、会话标题、消息、思考过程和工具内容。
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            aria-label="关闭全局搜索"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="border-b border-slate-200/80 px-5 py-3">
          <label className="relative block">
            <span className="sr-only">搜索项目、对话或消息内容</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目、对话或消息内容"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100"
            />
            {searching ? (
              <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-violet-500" aria-hidden="true" />
            ) : null}
          </label>
          <div
            className="mt-2 min-h-4 text-[11px] text-slate-500"
            role="status"
            aria-live="polite"
            aria-busy={searching}
          >
            {searching
              ? '搜索中…'
              : errorText
                ? `搜索失败：${errorText}`
                : searched
                  ? `找到 ${results.length} 个结果`
                  : ''}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-2">
          {!query.trim() ? (
            <div className="grid min-h-52 place-items-center px-6 text-center">
              <div>
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-violet-50 text-violet-500">
                  <Search className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="mt-4 text-sm font-medium text-slate-800">输入关键词开始搜索</p>
                <p className="mt-1 text-xs text-slate-500">可搜索项目名以及所有项目会话内容。</p>
              </div>
            </div>
          ) : errorText ? (
            <div className="grid min-h-52 place-items-center px-6 text-center text-sm text-rose-600">
              搜索暂时不可用，请稍后重试。
            </div>
          ) : !searching && searched && results.length === 0 ? (
            <div className="grid min-h-52 place-items-center px-6 text-center">
              <div>
                <p className="text-sm font-medium text-slate-800">没有找到相关结果</p>
                <p className="mt-1 text-xs text-slate-500">试试更短或不同的关键词。</p>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((result, index) => {
                const title = result.kind === 'project'
                  ? result.projectName
                  : result.conversationTitle || '新对话'
                const timestamp = result.matchedAt ?? result.updatedAt
                return (
                  <button
                    key={`${result.kind}-${result.projectId}-${result.conversationId ?? 'project'}-${result.matchedMessageId ?? result.matchType}-${index}`}
                    type="button"
                    className="grid w-full gap-1.5 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                    onClick={() => {
                      onSelectResult(result)
                      onOpenChange(false)
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-slate-400">
                        <MatchIcon matchType={result.matchType} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                        <HighlightedText text={title} query={query} />
                      </span>
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        {getMatchLabel(result.matchType, result.matchedRole)}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]">
                      <HighlightedText text={result.snippet || title} query={query} />
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span className="truncate">{result.projectName}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={timestamp}>{formatSearchTime(timestamp)}</time>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}
