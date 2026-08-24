import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  Bot,
  Boxes,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react'

import { MarkdownRender } from '@/components/chat/markdown-render'
import { Button } from '@/components/ui/button'
import { ProjectComponentsPanel } from '@/components/project/project-components-panel'
import { ProjectFilePreviewPanel } from '@/components/runtime/project-file-preview-panel'
import { cn } from '@/lib/utils'
import { electronBridge } from '@/services/electron-bridge'
import type { ProjectSummary, SubagentRunUpdate } from '@/shared/local-agent'
import type {
  SubagentTraceBlobRef,
  SubagentTraceEvent,
  SubagentTraceJsonValue,
  SubagentTraceRunStatus,
  SubagentTraceRunSummary,
} from '@/shared/subagent-trace'

type WorkbenchTab = 'files' | 'subagents' | 'components'

type TimelineItem =
  | { type: 'event'; event: SubagentTraceEvent }
  | {
      type: 'assistant_stream'
      key: string
      kind: 'text' | 'thinking' | 'tool_call'
      contentIndex: number
      firstSequence: number
      lastSequence: number
      at: string
      text: string
    }
  | {
      type: 'tool_call'
      key: string
      toolCallId: string
      toolName: string
      firstSequence: number
      lastSequence: number
      at: string
      args: SubagentTraceJsonValue | undefined
      updateCount: number
      partialResult: SubagentTraceJsonValue | undefined
      result: SubagentTraceJsonValue | undefined
      isError: boolean
      finished: boolean
    }

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: 0,
}

const STATUS_LABELS: Record<SubagentTraceRunStatus, string> = {
  queued: '排队中',
  initializing: '初始化',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const ACTIVE_RUN_STATUSES = new Set<SubagentTraceRunStatus>([
  'queued',
  'initializing',
  'running',
])

function formatRunError(errorCode: string | null, errorMessage: string | null): string | null {
  const code = errorCode?.trim()
  const message = errorMessage?.replace(/\s+/gu, ' ').trim().slice(0, 160)
  if (!code) return message || null
  return message ? `${code} · ${message}` : code
}

type DurationFields = Pick<
  SubagentTraceRunSummary,
  'status' | 'startedAt' | 'createdAt' | 'finishedAt' | 'durationMs'
>

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function resolveDisplayDurationMs(run: DurationFields, nowMs: number): number {
  if (ACTIVE_RUN_STATUSES.has(run.status)) {
    const origin = parseTimestampMs(run.startedAt) ?? parseTimestampMs(run.createdAt)
    if (origin == null) return 0
    return Math.max(0, nowMs - origin)
  }
  if (run.durationMs > 0) return run.durationMs
  const startedAt = parseTimestampMs(run.startedAt) ?? parseTimestampMs(run.createdAt)
  const finishedAt = parseTimestampMs(run.finishedAt)
  if (startedAt != null && finishedAt != null) return Math.max(0, finishedAt - startedAt)
  return Math.max(0, run.durationMs)
}

function useClock(enabled: boolean, intervalMs = 1_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, intervalMs])
  return nowMs
}

function mergeTraceEvents(
  current: readonly SubagentTraceEvent[],
  incoming: readonly SubagentTraceEvent[],
): SubagentTraceEvent[] {
  if (incoming.length === 0) return [...current]
  const events = new Map(current.map((event) => [event.sequence, event]))
  for (const event of incoming) events.set(event.sequence, event)
  return [...events.values()].sort((left, right) => left.sequence - right.sequence)
}

function summaryFromStart(event: Extract<SubagentTraceEvent, { type: 'run_started' }>): SubagentTraceRunSummary {
  return {
    childRunId: event.childRunId,
    agentType: event.agentType,
    description: event.description,
    taskPreview: event.task.slice(0, 500),
    conversationId: event.conversationId,
    parentPromptId: '',
    clientRunId: '',
    projectId: '',
    model: event.model,
    status: 'running',
    createdAt: event.at,
    startedAt: event.at,
    finishedAt: null,
    durationMs: 0,
    usage: { ...EMPTY_USAGE },
    toolCallCount: 0,
    artifactRefs: [],
    errorCode: null,
    errorMessage: null,
    eventCount: 1,
    lastSequence: event.sequence,
    traceAvailable: true,
    traceCompressed: false,
    traceSha256: null,
    traceSizeBytes: 0,
    uploadStatus: 'pending',
    remoteStorageKey: null,
    uploadedAt: null,
    uploadError: null,
  }
}

/**
 * A child holds a queue slot before it owns a trace file, and the run store only knows about
 * it once it starts. Without a placeholder the panel stays empty for the whole wait, which
 * reads as "the delegation never happened".
 */
function summaryFromRunUpdate(
  current: SubagentTraceRunSummary | undefined,
  update: SubagentRunUpdate,
): SubagentTraceRunSummary {
  const base = current ?? {
    childRunId: update.childRunId,
    agentType: update.type,
    description: update.description,
    taskPreview: '',
    conversationId: '',
    parentPromptId: '',
    clientRunId: '',
    projectId: '',
    model: '',
    status: update.status,
    createdAt: update.createdAt,
    startedAt: update.startedAt,
    finishedAt: update.finishedAt,
    durationMs: update.durationMs,
    usage: { ...EMPTY_USAGE },
    toolCallCount: 0,
    artifactRefs: [],
    errorCode: update.errorCode,
    errorMessage: null,
    eventCount: 0,
    lastSequence: 0,
    traceAvailable: false,
    traceCompressed: false,
    traceSha256: null,
    traceSizeBytes: 0,
    uploadStatus: 'pending' as const,
    remoteStorageKey: null,
    uploadedAt: null,
    uploadError: null,
  }
  // The trace stream is the finer-grained source once the run owns a file; snapshots only
  // fill what it cannot see yet.
  return {
    ...base,
    status: base.traceAvailable && base.status === 'running' ? base.status : update.status,
    startedAt: base.startedAt ?? update.startedAt,
    finishedAt: base.finishedAt ?? update.finishedAt,
    durationMs: Math.max(base.durationMs, update.durationMs),
    toolCallCount: Math.max(base.toolCallCount, update.progress.toolCallCount ?? 0),
    errorCode: base.errorCode ?? update.errorCode,
  }
}

function applyEventToSummary(
  current: SubagentTraceRunSummary | undefined,
  event: SubagentTraceEvent,
): SubagentTraceRunSummary | undefined {
  const base = current ?? (event.type === 'run_started' ? summaryFromStart(event) : undefined)
  if (!base) return undefined
  const finished = event.type === 'run_finished'
  const startedAt = Date.parse(base.startedAt ?? base.createdAt)
  return {
    ...base,
    status: finished ? event.status : base.status,
    finishedAt: finished ? event.at : base.finishedAt,
    durationMs: finished ? Math.max(0, Date.parse(event.at) - startedAt) : base.durationMs,
    errorCode: finished ? event.errorCode : base.errorCode,
    eventCount: Math.max(base.eventCount, event.sequence),
    lastSequence: Math.max(base.lastSequence, event.sequence),
    traceAvailable: true,
  }
}

type ToolCallTimelineItem = Extract<TimelineItem, { type: 'tool_call' }>

/**
 * tool_start / tool_update / tool_end belong to one call; keeping them as separate cards
 * triples the visual noise. They merge into a single card keyed by toolCallId, created at
 * whichever event arrives first so replay order never matters.
 */
function buildTimeline(events: readonly SubagentTraceEvent[]): TimelineItem[] {
  const items: TimelineItem[] = []
  const toolItems = new Map<string, ToolCallTimelineItem>()
  const ensureToolItem = (
    toolCallId: string,
    toolName: string,
    sequence: number,
    at: string,
  ): ToolCallTimelineItem => {
    const existing = toolItems.get(toolCallId)
    if (existing) {
      existing.lastSequence = Math.max(existing.lastSequence, sequence)
      return existing
    }
    const item: ToolCallTimelineItem = {
      type: 'tool_call',
      key: `tool-${toolCallId || sequence}`,
      toolCallId,
      toolName,
      firstSequence: sequence,
      lastSequence: sequence,
      at,
      args: undefined,
      updateCount: 0,
      partialResult: undefined,
      result: undefined,
      isError: false,
      finished: false,
    }
    toolItems.set(toolCallId, item)
    items.push(item)
    return item
  }
  for (const event of events) {
    const previous = items.at(-1)
    if (event.type === 'assistant_delta') {
      if (
        previous?.type === 'assistant_stream'
        && previous.kind === event.kind
        && previous.contentIndex === event.contentIndex
        && previous.lastSequence + 1 === event.sequence
      ) {
        previous.text += event.delta
        previous.lastSequence = event.sequence
      } else {
        items.push({
          type: 'assistant_stream',
          key: `assistant-${event.sequence}`,
          kind: event.kind,
          contentIndex: event.contentIndex,
          firstSequence: event.sequence,
          lastSequence: event.sequence,
          at: event.at,
          text: event.delta,
        })
      }
      continue
    }
    if (event.type === 'tool_start') {
      ensureToolItem(event.toolCallId, event.toolName, event.sequence, event.at).args = event.args
      continue
    }
    if (event.type === 'tool_update') {
      const item = ensureToolItem(event.toolCallId, event.toolName, event.sequence, event.at)
      item.updateCount += 1
      item.partialResult = event.partialResult
      continue
    }
    if (event.type === 'tool_end') {
      const item = ensureToolItem(event.toolCallId, event.toolName, event.sequence, event.at)
      item.result = event.result
      item.isError = event.isError
      item.finished = true
      continue
    }
    items.push({ type: 'event', event })
  }
  return items
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatDuration(milliseconds: number, options?: { live?: boolean }): string {
  const safe = Math.max(0, milliseconds)
  if (options?.live) {
    const seconds = Math.floor(safe / 1_000)
    if (seconds < 60) return `${seconds} 秒`
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  }
  if (safe < 1_000) return `${Math.round(safe)} ms`
  if (safe < 60_000) return `${(safe / 1_000).toFixed(1)} 秒`
  return `${Math.floor(safe / 60_000)} 分 ${Math.round((safe % 60_000) / 1_000)} 秒`
}

function RunDuration({ run, nowMs }: { run: DurationFields; nowMs: number }) {
  const live = ACTIVE_RUN_STATUSES.has(run.status)
  return (
    <span className="tabular-nums">
      {formatDuration(resolveDisplayDurationMs(run, nowMs), { live })}
    </span>
  )
}

function agentTypeLabel(agentType: string): string {
  if (agentType === 'cad-analyst') return 'CAD 取证'
  if (agentType === 'cad-drafter') return 'CAD 取证'
  if (agentType === 'research-analyst') return '调研取证'
  if (agentType === 'blender-modeler') return 'Blender 建模'
  return agentType
}

function statusClass(status: SubagentTraceRunStatus): string {
  if (status === 'completed') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 ring-rose-200'
  if (status === 'cancelled') return 'bg-slate-100 text-slate-600 ring-slate-200'
  return 'bg-sky-50 text-sky-700 ring-sky-200'
}

function isBlobRef(value: unknown): value is SubagentTraceBlobRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<SubagentTraceBlobRef>
  return record.type === 'blob_ref'
    && typeof record.sha256 === 'string'
    && typeof record.mimeType === 'string'
    && typeof record.sizeBytes === 'number'
}

function collectBlobRefs(
  value: SubagentTraceJsonValue,
  output: SubagentTraceBlobRef[] = [],
  depth = 0,
): SubagentTraceBlobRef[] {
  if (depth > 8 || output.length >= 16) return output
  if (isBlobRef(value)) {
    if (!output.some((candidate) => candidate.sha256 === value.sha256)) output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    for (const child of value) collectBlobRefs(child, output, depth + 1)
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectBlobRefs(child, output, depth + 1)
  }
  return output
}

function TraceBlobPreview({ childRunId, blob }: { childRunId: string; blob: SubagentTraceBlobRef }) {
  const [source, setSource] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    if (loading || source) return
    setLoading(true)
    setError(false)
    try {
      const result = await electronBridge.getSubagentTraceBlob(childRunId, blob.sha256)
      setSource(`data:${result.mimeType};base64,${result.data}`)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [blob.sha256, childRunId, loading, source])

  if (source) {
    return (
      <img
        src={source}
        alt="子代理工具生成的截图"
        className="mt-2 max-h-56 w-full rounded-lg border border-slate-200 bg-white object-contain"
      />
    )
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="mt-2 h-7 max-w-full gap-1.5 px-2 text-[11px]"
      onClick={() => void load()}
      disabled={loading}
    >
      {loading ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
      {error ? '重试加载截图' : `查看截图 · ${Math.ceil(blob.sizeBytes / 1024)} KB`}
    </Button>
  )
}

function TracePayload({ childRunId, value }: { childRunId: string; value: SubagentTraceJsonValue }) {
  const blobs = useMemo(() => collectBlobRefs(value), [value])
  const text = useMemo(() => {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    } catch {
      return '[无法展示此结构化结果]'
    }
  }, [value])
  return (
    <div className="min-w-0">
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950/[0.035] p-2 font-mono text-[11px] leading-5 text-slate-700">
        {text}
      </pre>
      {blobs.map((blob) => (
        <TraceBlobPreview key={blob.sha256} childRunId={childRunId} blob={blob} />
      ))}
    </div>
  )
}

function EventTime({ at }: { at: string }) {
  return <time dateTime={at} className="shrink-0 text-[10px] tabular-nums text-slate-400">{formatTime(at)}</time>
}

function ThinkingStreamCard({
  item,
  streaming,
}: {
  item: Extract<TimelineItem, { type: 'assistant_stream' }>
  streaming: boolean
}) {
  const [open, setOpen] = useState(streaming)
  const contentRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (!streaming || !open) return
    const node = contentRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [item.text, streaming, open])

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200/70 bg-slate-50/60 [content-visibility:auto] [contain-intrinsic-size:80px]">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left text-[11px] font-medium text-slate-500 transition hover:bg-slate-100/70"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform', open && 'rotate-90')} />
        <Brain className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span>{streaming ? '思考中…' : '思考过程'}</span>
        <span className="ml-auto"><EventTime at={item.at} /></span>
      </button>
      {open ? (
        <div className="border-t border-slate-200/60 px-2.5 py-2">
          <p
            ref={contentRef}
            className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-500"
          >
            {item.text}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function AssistantStreamCard({
  item,
  streaming,
}: {
  item: Extract<TimelineItem, { type: 'assistant_stream' }>
  streaming: boolean
}) {
  if (item.kind === 'thinking') return <ThinkingStreamCard item={item} streaming={streaming} />
  if (item.kind === 'tool_call') {
    return (
      <article className="rounded-lg border border-slate-200/70 bg-slate-50/60 p-2.5 [content-visibility:auto] [contain-intrinsic-size:80px]">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-slate-500">工具调用参数</span>
          <EventTime at={item.at} />
        </div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-slate-500">{item.text}</pre>
      </article>
    )
  }
  return (
    <article className="rounded-lg border border-slate-200/80 bg-white p-2.5 [content-visibility:auto] [contain-intrinsic-size:100px]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-500">回复</span>
        <EventTime at={item.at} />
      </div>
      <MarkdownRender
        content={item.text}
        final={!streaming}
        className="text-xs leading-6 text-slate-700"
      />
    </article>
  )
}

function ToolCallTraceCard({ item, childRunId }: { item: ToolCallTimelineItem; childRunId: string }) {
  const statusLabel = !item.finished
    ? item.updateCount > 0 ? `执行中 · ${item.updateCount} 次更新` : '执行中'
    : item.isError ? '执行失败' : '执行完成'
  const payload = item.result !== undefined ? item.result : item.partialResult
  return (
    <details className={cn(
      'group rounded-lg border bg-white [content-visibility:auto] [contain-intrinsic-size:70px]',
      item.isError ? 'border-rose-200/90' : 'border-slate-200/80',
    )}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
        {!item.finished ? (
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" />
        ) : item.isError ? (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        )}
        <span className="min-w-0 truncate text-xs font-medium text-slate-700">{item.toolName}</span>
        <span className={cn('ml-auto shrink-0 text-[10px]', item.isError ? 'text-rose-600' : 'text-slate-400')}>{statusLabel}</span>
        <EventTime at={item.at} />
      </summary>
      <div className="space-y-2 border-t border-slate-100 px-2.5 py-2">
        {item.args !== undefined ? (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">参数</p>
            <TracePayload childRunId={childRunId} value={item.args} />
          </div>
        ) : null}
        {payload !== undefined ? (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
              {item.result !== undefined ? '结果' : '流式输出'}
            </p>
            <TracePayload childRunId={childRunId} value={payload} />
          </div>
        ) : null}
      </div>
    </details>
  )
}

function TimelineEvent({
  item,
  childRunId,
  streaming,
}: {
  item: TimelineItem
  childRunId: string
  streaming: boolean
}) {
  if (item.type === 'assistant_stream') {
    return <AssistantStreamCard item={item} streaming={streaming} />
  }
  if (item.type === 'tool_call') {
    return <ToolCallTraceCard item={item} childRunId={childRunId} />
  }

  const event = item.event
  if (event.type === 'run_started') {
    return (
      <article className="rounded-lg border border-slate-200/80 bg-white p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Bot className="h-3.5 w-3.5 text-slate-400" />
            任务已委派
          </span>
          <EventTime at={event.at} />
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-600">{event.description}</p>
        <details className="mt-1.5 text-[11px] text-slate-500">
          <summary className="cursor-pointer select-none text-slate-400 transition-colors hover:text-slate-600">查看完整任务</summary>
          <p className="mt-1.5 whitespace-pre-wrap break-words leading-5">{event.task}</p>
        </details>
      </article>
    )
  }
  if (event.type === 'assistant_message') {
    return (
      <details className="rounded-lg border border-slate-200/70 bg-white p-2.5 [content-visibility:auto] [contain-intrinsic-size:58px]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-medium text-slate-500">
          <span>完整回复快照{event.usage ? ` · ${event.usage.totalTokens} tokens` : ''}</span>
          <EventTime at={event.at} />
        </summary>
        <div className="mt-2"><TracePayload childRunId={childRunId} value={event.content} /></div>
      </details>
    )
  }
  if (event.type === 'run_finished') {
    const tone = event.status === 'completed'
      ? { Icon: CheckCircle2, className: 'text-emerald-600', label: '子代理已完成' }
      : event.status === 'cancelled'
        ? { Icon: CircleSlash, className: 'text-slate-500', label: '子代理已取消' }
        : { Icon: XCircle, className: 'text-rose-600', label: '子代理运行失败' }
    return (
      <article className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/70 bg-slate-50/60 px-2.5 py-2">
        <span className={cn('flex items-center gap-1.5 text-xs font-medium', tone.className)}>
          <tone.Icon className="h-3.5 w-3.5" />
          {tone.label}
        </span>
        <EventTime at={event.at} />
      </article>
    )
  }
  let label = '过程事件'
  if (event.type === 'agent_start') label = '代理启动'
  else if (event.type === 'agent_end') label = '代理结束'
  else if (event.type === 'turn_start') label = `第 ${event.turnCount} 轮开始`
  else if (event.type === 'turn_end') label = `第 ${event.turnCount} 轮结束`
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-0.5 text-[10px] text-slate-400">
      <span>{label}</span>
      <EventTime at={event.at} />
    </div>
  )
}

export function WorkbenchSidePanel({
  project,
  conversationId,
}: {
  project: ProjectSummary | null
  conversationId: string | null
}) {
  const [tab, setTab] = useState<WorkbenchTab>('files')
  const [runs, setRuns] = useState<SubagentTraceRunSummary[]>([])
  const [queuePositions, setQueuePositions] = useState<Record<string, number>>({})
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [eventsByRun, setEventsByRun] = useState<Record<string, SubagentTraceEvent[]>>({})
  const [nextSequenceByRun, setNextSequenceByRun] = useState<Record<string, number>>({})
  const [hasMoreByRun, setHasMoreByRun] = useState<Record<string, boolean>>({})
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [loadingTrace, setLoadingTrace] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const filesTabRef = useRef<HTMLButtonElement>(null)
  const subagentsTabRef = useRef<HTMLButtonElement>(null)
  const componentsTabRef = useRef<HTMLButtonElement>(null)
  const pendingEventsRef = useRef<SubagentTraceEvent[]>([])
  const loadedTraceRunIdsRef = useRef(new Set<string>())
  const animationFrameRef = useRef<number | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const followTailRef = useRef(true)
  const nowMs = useClock(
    tab === 'subagents' && runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status)),
  )

  const loadRuns = useCallback(async () => {
    if (!conversationId) {
      setRuns([])
      return
    }
    setLoadingRuns(true)
    setError(null)
    try {
      const loaded = await electronBridge.listSubagentRuns(conversationId)
      setRuns((current) => {
        const prior = new Map(current.map((run) => [run.childRunId, run]))
        const next = loaded.map((run) => {
          const live = prior.get(run.childRunId)
          return live && live.lastSequence > run.lastSequence
            ? { ...run, status: live.status, finishedAt: live.finishedAt, errorCode: live.errorCode, eventCount: live.eventCount, lastSequence: live.lastSequence }
            : run
        })
        const loadedIds = new Set(loaded.map((run) => run.childRunId))
        next.push(...current.filter((run) => !loadedIds.has(run.childRunId)))
        return next.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      })
      setSelectedRunId((current) => (
        current && loaded.some((run) => run.childRunId === current)
          ? current
          : null
      ))
    } catch {
      setError('无法读取子代理记录。')
    } finally {
      setLoadingRuns(false)
    }
  }, [conversationId])

  useEffect(() => {
    setSelectedRunId(null)
    setEventsByRun({})
    loadedTraceRunIdsRef.current.clear()
    setNextSequenceByRun({})
    setHasMoreByRun({})
    void loadRuns()
  }, [loadRuns])

  useEffect(() => electronBridge.onSubagentTraceEvent((event) => {
    if (!conversationId || event.conversationId !== conversationId) return
    pendingEventsRef.current.push(event)
    if (animationFrameRef.current !== null) return
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      const batch = pendingEventsRef.current
      pendingEventsRef.current = []
      if (batch.length === 0) return
      setEventsByRun((current) => {
        const next = { ...current }
        const grouped = new Map<string, SubagentTraceEvent[]>()
        for (const candidate of batch) {
          grouped.set(candidate.childRunId, [...(grouped.get(candidate.childRunId) ?? []), candidate])
        }
        for (const [childRunId, incoming] of grouped) {
          next[childRunId] = mergeTraceEvents(current[childRunId] ?? [], incoming)
        }
        return next
      })
      setRuns((current) => {
        const byId = new Map(current.map((run) => [run.childRunId, run]))
        for (const candidate of batch) {
          const next = applyEventToSummary(byId.get(candidate.childRunId), candidate)
          if (next) byId.set(candidate.childRunId, next)
        }
        return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      })
      if (batch.some((event) => event.type === 'run_started' || event.type === 'run_finished')) {
        window.setTimeout(() => void loadRuns(), 0)
      }
    })
  }), [conversationId, loadRuns])

  useEffect(() => electronBridge.onAgentEvent((event) => {
    if (
      event.type !== 'subagent_run'
      || !conversationId
      || event.conversationId !== conversationId
    ) return
    const updates = event.updates?.length ? event.updates : [event.update]
    setRuns((current) => {
      const byId = new Map(current.map((run) => [run.childRunId, run]))
      for (const update of updates) {
        byId.set(update.childRunId, summaryFromRunUpdate(byId.get(update.childRunId), update))
      }
      return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    })
    setQueuePositions((current) => {
      const next = { ...current }
      for (const update of updates) {
        if (update.status === 'queued' && update.queuePosition) next[update.childRunId] = update.queuePosition
        else delete next[update.childRunId]
      }
      return next
    })
  }) ?? undefined, [conversationId])

  useEffect(() => () => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current)
  }, [])

  useEffect(() => {
    if (!selectedRunId || loadedTraceRunIdsRef.current.has(selectedRunId)) return
    let cancelled = false
    setLoadingTrace(true)
    setError(null)
    void electronBridge.getSubagentTrace(selectedRunId, 0, 500)
      .then((page) => {
        if (cancelled) return
        setEventsByRun((current) => ({
          ...current,
          [selectedRunId]: mergeTraceEvents(current[selectedRunId] ?? [], page.events),
        }))
        setNextSequenceByRun((current) => ({ ...current, [selectedRunId]: page.nextSequence }))
        setHasMoreByRun((current) => ({ ...current, [selectedRunId]: page.hasMore }))
        loadedTraceRunIdsRef.current.add(selectedRunId)
      })
      .catch(() => {
        if (!cancelled) setError('无法回放这次子代理轨迹。')
      })
      .finally(() => {
        if (!cancelled) setLoadingTrace(false)
      })
    return () => { cancelled = true }
  }, [selectedRunId])

  const loadMore = useCallback(async () => {
    if (!selectedRunId || loadingTrace) return
    setLoadingTrace(true)
    try {
      const page = await electronBridge.getSubagentTrace(
        selectedRunId,
        nextSequenceByRun[selectedRunId] ?? 0,
        500,
      )
      setEventsByRun((current) => ({
        ...current,
        [selectedRunId]: mergeTraceEvents(current[selectedRunId] ?? [], page.events),
      }))
      setNextSequenceByRun((current) => ({ ...current, [selectedRunId]: page.nextSequence }))
      setHasMoreByRun((current) => ({ ...current, [selectedRunId]: page.hasMore }))
    } catch {
      setError('继续加载轨迹失败。')
    } finally {
      setLoadingTrace(false)
    }
  }, [loadingTrace, nextSequenceByRun, selectedRunId])

  const selectedRun = runs.find((run) => run.childRunId === selectedRunId) ?? null
  const selectedEvents = selectedRunId ? eventsByRun[selectedRunId] ?? [] : []
  const timeline = useMemo(() => buildTimeline(selectedEvents), [selectedEvents])

  useEffect(() => {
    if (!followTailRef.current || !selectedRun || selectedRun.status !== 'running') return
    const node = timelineRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [selectedRun, timeline.length])

  const selectTab = (next: WorkbenchTab) => {
    setTab(next)
    window.requestAnimationFrame(() => {
      const target = next === 'files'
        ? filesTabRef
        : next === 'subagents'
          ? subagentsTabRef
          : componentsTabRef
      target.current?.focus()
    })
  }

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: WorkbenchTab,
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const enabledTabs: WorkbenchTab[] = ['files', 'subagents', 'components']
    const currentIndex = enabledTabs.indexOf(currentTab)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? enabledTabs.length - 1
        : event.key === 'ArrowLeft'
          ? (currentIndex - 1 + enabledTabs.length) % enabledTabs.length
          : (currentIndex + 1) % enabledTabs.length
    selectTab(enabledTabs[nextIndex])
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div role="tablist" aria-label="右侧工作区" className="workspace-panel-header grid grid-cols-3 items-center gap-1 border-b border-slate-200/70 bg-white px-1.5">
        <button
          ref={filesTabRef}
          id="workbench-tab-files"
          type="button"
          role="tab"
          aria-selected={tab === 'files'}
          aria-controls="workbench-panel-files"
          tabIndex={tab === 'files' ? 0 : -1}
          className={cn('flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors', tab === 'files' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800')}
          onClick={() => setTab('files')}
          onKeyDown={(event) => handleTabKeyDown(event, 'files')}
        >
          <FileText className="h-3.5 w-3.5" />文件预览
        </button>
        <button
          ref={subagentsTabRef}
          id="workbench-tab-subagents"
          type="button"
          role="tab"
          aria-selected={tab === 'subagents'}
          aria-controls="workbench-panel-subagents"
          tabIndex={tab === 'subagents' ? 0 : -1}
          className={cn('flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors', tab === 'subagents' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800')}
          onClick={() => setTab('subagents')}
          onKeyDown={(event) => handleTabKeyDown(event, 'subagents')}
        >
          <Bot className="h-3.5 w-3.5" />子代理
          {runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status)) ? <span className="h-1.5 w-1.5 rounded-full bg-sky-500" aria-label="有子代理正在运行" /> : null}
        </button>
        <button
          ref={componentsTabRef}
          id="workbench-tab-components"
          type="button"
          role="tab"
          aria-selected={tab === 'components'}
          aria-controls="workbench-panel-components"
          tabIndex={tab === 'components' ? 0 : -1}
          className={cn('flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors', tab === 'components' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800')}
          onClick={() => setTab('components')}
          onKeyDown={(event) => handleTabKeyDown(event, 'components')}
        >
          <Boxes className="h-3.5 w-3.5" />构件数据
        </button>
      </div>

      <section
        id="workbench-panel-files"
        role="tabpanel"
        aria-labelledby="workbench-tab-files"
        hidden={tab !== 'files'}
        className={cn('min-h-0 flex-1', tab === 'files' ? 'flex flex-col' : 'hidden')}
      >
        <ProjectFilePreviewPanel project={project} active={tab === 'files'} />
      </section>

      <section
        id="workbench-panel-subagents"
        role="tabpanel"
        aria-labelledby="workbench-tab-subagents"
        hidden={tab !== 'subagents'}
        className={cn('min-h-0 flex-1 flex-col', tab === 'subagents' ? 'flex' : 'hidden')}
      >
        {!conversationId ? (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center">
            <Bot className="mb-2 h-6 w-6 text-slate-300" />
            <p className="text-xs font-medium text-slate-600">暂无会话</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">打开项目会话后，可查看子代理工作过程。</p>
          </div>
        ) : selectedRun ? (
          <>
            <header className="shrink-0 border-b border-slate-200/70 bg-white/70 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label="返回子代理运行列表"
                  onClick={() => setSelectedRunId(null)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-900">{selectedRun.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                    <span>{agentTypeLabel(selectedRun.agentType)}</span>
                    <span aria-hidden="true">·</span>
                    <RunDuration run={selectedRun} nowMs={nowMs} />
                    <span className={cn('rounded-full px-1.5 py-0.5 ring-1 ring-inset', statusClass(selectedRun.status))}>{STATUS_LABELS[selectedRun.status]}</span>
                  </div>
                </div>
              </div>
            </header>
            <div
              ref={timelineRef}
              className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-2.5"
              onScroll={(event) => {
                const node = event.currentTarget
                followTailRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
              }}
            >
              {loadingTrace && timeline.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400" role="status">
                  <LoaderCircle className="h-4 w-4 animate-spin" />读取轨迹…
                </div>
              ) : timeline.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">轨迹尚未写入。</p>
              ) : timeline.map((item, index) => (
                <TimelineEvent
                  key={item.type === 'event' ? item.event.sequence : item.key}
                  item={item}
                  childRunId={selectedRun.childRunId}
                  streaming={ACTIVE_RUN_STATUSES.has(selectedRun.status) && index === timeline.length - 1}
                />
              ))}
              {hasMoreByRun[selectedRun.childRunId] ? (
                <Button type="button" variant="outline" size="sm" className="h-8 w-full text-xs" disabled={loadingTrace} onClick={() => void loadMore()}>
                  {loadingTrace ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  加载后续轨迹
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <header className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200/70 px-3">
              <div>
                <p className="text-xs font-semibold text-slate-800">运行记录</p>
                <p className="text-[10px] text-slate-400">{runs.length} 次委派</p>
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="刷新子代理运行记录" disabled={loadingRuns} onClick={() => void loadRuns()}>
                <RefreshCw className={cn('h-3.5 w-3.5', loadingRuns && 'animate-spin')} />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {error ? <p className="mb-2 rounded-md bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700" role="alert">{error}</p> : null}
              {loadingRuns && runs.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400" role="status">
                  <LoaderCircle className="h-4 w-4 animate-spin" />读取记录…
                </div>
              ) : runs.length === 0 ? (
                <div className="px-3 py-10 text-center">
                  <Bot className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                  <p className="text-xs font-medium text-slate-600">尚无子代理记录</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">CAD 取证或三维建模任务启动后会出现在这里。</p>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {runs.map((run) => (
                    <li key={run.childRunId}>
                      <button
                        type="button"
                        disabled={!run.traceAvailable}
                        title={run.traceAvailable ? undefined : '子代理尚未开始，暂无轨迹可回放。'}
                        className="w-full rounded-lg border border-slate-200/80 bg-white px-2.5 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-default disabled:bg-slate-50/70 disabled:hover:border-slate-200/80"
                        onClick={() => {
                          followTailRef.current = true
                          setSelectedRunId(run.childRunId)
                        }}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">{run.description}</span>
                          <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9px] ring-1 ring-inset', statusClass(run.status))}>
                            {run.status === 'queued' && queuePositions[run.childRunId]
                              ? `${STATUS_LABELS[run.status]} · 第 ${queuePositions[run.childRunId]} 位`
                              : STATUS_LABELS[run.status]}
                          </span>
                        </span>
                        <span className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                          <span className="truncate">
                            {agentTypeLabel(run.agentType)} · {run.toolCallCount} 个工具 · <RunDuration run={run} nowMs={nowMs} />
                          </span>
                          <time dateTime={run.createdAt}>{formatTime(run.createdAt)}</time>
                        </span>
                        {run.status === 'failed' && formatRunError(run.errorCode, run.errorMessage) ? (
                          <span
                            className="mt-1 block truncate text-[10px] text-rose-600"
                            title={formatRunError(run.errorCode, run.errorMessage) ?? undefined}
                          >
                            {formatRunError(run.errorCode, run.errorMessage)}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      <section
        id="workbench-panel-components"
        role="tabpanel"
        aria-labelledby="workbench-tab-components"
        hidden={tab !== 'components'}
        className={cn('min-h-0 flex-1', tab === 'components' ? 'flex flex-col' : 'hidden')}
      >
        {project ? (
          <ProjectComponentsPanel key={project.id} projectId={project.id} active={tab === 'components'} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center">
            <Boxes className="mb-2 h-6 w-6 text-slate-300" />
            <p className="text-xs font-medium text-slate-600">尚未选择项目</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">从左侧选择项目后，可查看并复核构件数据。</p>
          </div>
        )}
      </section>
    </div>
  )
}
