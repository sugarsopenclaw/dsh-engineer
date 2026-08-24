import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ThinkingOrb } from 'thinking-orbs'
import { AlertCircle, Coins, History, MessageSquarePlus, Sparkles, X } from 'lucide-react'
import { CadConnectionIndicator } from '@/components/chat/cad-connection-indicator'
import { ChatInputDock } from '@/components/chat/chat-input-dock'
import { ComposerUsageStats } from '@/components/chat/composer-usage-stats'
import { ConversationHistoryDialog } from '@/components/chat/conversation-history-dialog'
import { ContextUsageRing } from '@/components/chat/context-usage-ring'
import { MarkdownRender } from '@/components/chat/markdown-render'
import { MessageBubble } from '@/components/chat/message-bubble'
import { ThinkingBlock } from '@/components/chat/thinking-block'
import { ToolCallBlock } from '@/components/chat/tool-call-block'
import { Button } from '@/components/ui/button'
import { describeActiveSubagentRuns } from '@/hooks/conversation-runtime-buckets'
import { useAgentMessageFeedback } from '@/hooks/use-agent-message-feedback'
import { useLocalAgentChat, type StreamingPart } from '@/hooks/use-local-agent-chat'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { stripInlineImageReferences } from '@/lib/strip-inline-image-references'
import { cn } from '@/lib/utils'
import { electronBridge } from '@/services/electron-bridge'
import { creditsRemaining, formatCredits, isLowBalance } from '@/shared/billing-domain'
import { useCreditBalance } from '@/features/billing/use-credit-balance'
import { useConversationUsage } from '@/features/billing/use-run-usage'
import type {
  AgentCompactionState,
  AgentMessageRecord,
  AgentRetryState,
  ConversationTreeBranchResult,
  ImageAttachment,
} from '@/shared/local-agent'

const AUTO_SCROLL_STOP_DISTANCE_PX = 60
const AUTO_SCROLL_RESUME_DISTANCE_PX = 24
const SEARCH_HIGHLIGHT_DURATION_MS = 2400
// 确认卡最高 38vh，叠上排队预览后输入坞可能吃掉整屏，留出安全上限。
const COMPOSER_OVERLAY_MAX_RATIO = 0.72

function getMessageElementId(messageId: string) {
  return `conversation-message-${encodeURIComponent(messageId)}`
}

function getRetryStatusText(
  retry: AgentRetryState | null,
  secondsRemaining: number | null,
): string | null {
  if (!retry) return null
  const sourceLabel = {
    agent: '模型调用',
    summarization: '上下文摘要',
    compaction: '上下文压缩',
    branch_summary: '分支摘要',
  }[retry.source]
  const attemptLabel = retry.attempt
    ? `第 ${retry.attempt}${retry.maxAttempts ? `/${retry.maxAttempts}` : ''} 次`
    : '下一次'

  if (retry.phase === 'waiting') {
    return `${sourceLabel}将在 ${secondsRemaining ?? 0} 秒后进行${attemptLabel}重试…`
  }
  if (retry.phase === 'running') return `${sourceLabel}正在进行${attemptLabel}重试…`
  if (retry.phase === 'failed') return `${sourceLabel}重试失败。`
  if (retry.phase === 'cancelled') return `${sourceLabel}重试已停止。`
  return null
}

function getCompactionStatusText(compaction: AgentCompactionState | null): string | null {
  if (!compaction) return null
  const reasonLabel = {
    manual: '手动上下文压缩',
    threshold: '自动上下文压缩',
    overflow: '上下文溢出恢复',
  }[compaction.reason]

  if (compaction.phase === 'running') return `${reasonLabel}正在进行…`
  if (compaction.phase === 'failed') return `${reasonLabel}失败。`
  if (compaction.phase === 'cancelled') return `${reasonLabel}已停止。`
  if (compaction.willRetry) return `${reasonLabel}完成，正在恢复刚才的请求…`
  return `${reasonLabel}完成。`
}

const InteractionTray = lazy(() => (
  import('@/components/chat/interaction-tray').then((module) => ({
    default: module.InteractionTray,
  }))
))

const PlanApprovalOverlay = lazy(() => (
  import('@/components/runtime/plan-approval-overlay').then((module) => ({
    default: module.PlanApprovalOverlay,
  }))
))

const ComponentReviewOverlay = lazy(() => (
  import('@/components/runtime/component-review-overlay').then((module) => ({
    default: module.ComponentReviewOverlay,
  }))
))

const ConversationTreeDialog = lazy(() => (
  import('@/components/chat/conversation-tree-dialog').then((module) => ({
    default: module.ConversationTreeDialog,
  }))
))

function getDistanceToBottom(container: HTMLDivElement) {
  return container.scrollHeight - container.scrollTop - container.clientHeight
}

interface AgentChatPanelProps {
  focusConversation?: {
    id: string | null
    messageId?: string | null
    nonce: number
  } | null
  conversationScope?: {
    projectId?: string
    projectName?: string
    drawingId?: string
    drawingName?: string
  } | null
  externalConversationRevision?: number
  onConversationStateChange?: (state: {
    conversationId: string | null
    isAgentRunning: boolean
  }) => void
  onConversationsChanged?: () => void
  wideMode?: boolean
  onOpenSettings?: () => void
}

const StreamingPartBlock = memo(function StreamingPartBlock({
  part,
  isActive,
  isStreaming,
  isThinking,
  attachments,
}: {
  part: StreamingPart
  isActive: boolean
  isStreaming: boolean
  isThinking: boolean
  attachments: readonly ImageAttachment[]
}) {
  if (part.type === 'thinking') {
    return (
      <ThinkingBlock
        content={part.content}
        isThinking={isActive && isThinking}
      />
    )
  }

  if (part.type === 'tool') {
    const { toolCall } = part
    return (
      <ToolCallBlock
        name={toolCall.name}
        args={toolCall.args}
        result={toolCall.result}
        output={toolCall.output}
        startedAt={toolCall.startedAt}
        status={toolCall.status}
      />
    )
  }

  const hasAttachments = attachments.length > 0
  const content = hasAttachments
    ? stripInlineImageReferences(part.content, attachments)
    : part.content
  if (!content) {
    return isActive && isStreaming && !hasAttachments
      ? <div className="text-sm text-slate-400">等待响应...</div>
      : null
  }

  return <MarkdownRender content={content} final={!isActive || !isStreaming} />
})

export function AgentChatPanel({
  focusConversation,
  conversationScope,
  externalConversationRevision = 0,
  onConversationStateChange,
  onConversationsChanged,
  wideMode = false,
  onOpenSettings,
}: AgentChatPanelProps) {
  const {
    conversations,
    currentConversation,
    currentConversationId,
    conversationThinkingMode,
    messages,
    loading,
    statusText,
    streamError,
    isAgentRunning,
    agentQueue,
    canQueueAgentMessages,
    queueMutationPending,
    agentRetry,
    retrySecondsRemaining,
    agentCompaction,
    compactionMutationPending,
    operationAbortPending,
    pendingInteraction,
    interactionSubmitting,
    interactionError,
    streaming,
    input,
    attachedImages,
    canSend,
    setInput,
    createNewConversation,
    deleteConversation,
    renameConversation,
    searchConversations,
    refreshConversationList,
    setConversationPinned,
    openConversation,
    selectConversation,
    sendPrompt,
    followUpAgent,
    setQueueItemKind,
    editingQueueItemId,
    beginQueueEdit,
    saveQueueEdit,
    cancelQueueEdit,
    removeQueueItem,
    clearAgentQueue,
    compactContext,
    abortRetry,
    abortCompaction,
    stopAgent,
    cancelSubagents,
    respondToInteraction,
    addImageFiles,
    removeAttachedImage,
    handlePaste,
    handleDrop,
    dismissStreamError,
    contextUsage,
    cadAutomationStatus,
    subagentRun,
    activeSubagentRuns,
    setConversationThinkingMode,
  } = useLocalAgentChat({
    projectScopeId: conversationScope?.projectId ?? null,
    drawingScopeId: conversationScope?.drawingId ?? null,
  })
  const {
    feedbackByMessageId,
    loading: feedbackLoading,
    loadError: feedbackLoadError,
    retryFeedbackLoad,
    saveFeedback,
    deleteFeedback,
  } = useAgentMessageFeedback(currentConversationId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLElement>(null)
  const prevComposerHeightRef = useRef(0)
  const scrollAnimationRef = useRef<number | null>(null)
  const prevRunningRef = useRef(false)
  const branchActionInFlightRef = useRef(false)
  const pendingConversationScrollRef = useRef(true)
  const pendingMessageFocusRef = useRef<{
    conversationId: string
    messageId: string
  } | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const [composerHeight, setComposerHeight] = useState(0)
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const [branchingMessageId, setBranchingMessageId] = useState<string | null>(null)
  const [branchActionError, setBranchActionError] = useState<string | null>(null)
  const lastFocusNonceRef = useRef<number | null>(null)
  const refreshConversationListRef = useRef(refreshConversationList)
  refreshConversationListRef.current = refreshConversationList
  const thinkingMode = conversationThinkingMode
  const lastStreamingPartId = streaming.parts[streaming.parts.length - 1]?.id ?? null
  const conversationListSignature = useMemo(
    () => conversations
      .map((conversation) => (
        `${conversation.id}:${conversation.title}:${conversation.updatedAt}:${conversation.isPinned}:`
        + `${conversation.parentConversationId ?? ''}:${conversation.childConversationCount}`
      ))
      .join('\u0000'),
    [conversations],
  )
  const parentConversationTitle = useMemo(() => {
    const parentId = currentConversation?.parentConversationId
    if (!parentId) return null
    return conversations.find((conversation) => conversation.id === parentId)?.title.trim()
      || '原会话'
  }, [conversations, currentConversation?.parentConversationId])

  const ringUsage = contextUsage

  const ringPending = Boolean(isAgentRunning && !contextUsage)
  const runtimeStatusText = getRetryStatusText(agentRetry, retrySecondsRemaining)
    ?? getCompactionStatusText(agentCompaction)
    ?? statusText
  const cancellableOperation = agentCompaction?.phase === 'running'
    ? 'compaction'
    : agentRetry?.source === 'agent'
      && (agentRetry.phase === 'waiting' || agentRetry.phase === 'running')
      ? 'retry'
      : null
  const teachingModeHint = null
  const cadSubagentRun = subagentRun?.type === 'cad-analyst' ? subagentRun : null
  // Delegated children outlive the parent turn, so the banner must stay up while the user
  // keeps chatting. Hiding it whenever the main turn runs made live subagents look cancelled.
  const backgroundSubagentsRunning = activeSubagentRuns.length > 0
  const backgroundSubagentsText = describeActiveSubagentRuns(activeSubagentRuns)

  const creditQuota = useCreditBalance()
  const lowCreditBalance = isLowBalance(creditQuota)
  const conversationUsage = useConversationUsage(currentConversationId)

  const voiceInput = useVoiceInput({
    disabled: loading || isAgentRunning,
    onTranscribedText: (text) => {
      setInput((prev) => (prev.trim() ? `${prev}\n${text}` : text))
    },
  })

  const scopeLabel = useMemo(() => {
    if (!conversationScope) {
      return null
    }

    if (conversationScope.projectName?.trim()) {
      return conversationScope.drawingName?.trim()
        ? `${conversationScope.projectName} / ${conversationScope.drawingName}`
        : conversationScope.projectName
    }

    return conversationScope.drawingName ?? null
  }, [conversationScope])

  const handleConversationBranched = useCallback(async (
    result: ConversationTreeBranchResult,
  ) => {
    await openConversation(result.conversation.id)
    setInput(result.composerText)
  }, [openConversation, setInput])

  const runMessageBranchAction = useCallback(async (
    message: AgentMessageRecord,
    mode: 'fork-before' | 'clone-at',
  ) => {
    if (isAgentRunning || !message.piEntryId || branchActionInFlightRef.current) return
    branchActionInFlightRef.current = true
    setBranchingMessageId(message.id)
    setBranchActionError(null)
    try {
      const result = mode === 'fork-before'
        ? await electronBridge.forkConversationBefore(message.conversationId, message.piEntryId)
        : await electronBridge.cloneConversationAt(message.conversationId, message.piEntryId)
      await handleConversationBranched(result)
    } catch (error) {
      setBranchActionError(error instanceof Error ? error.message : String(error))
    } finally {
      branchActionInFlightRef.current = false
      setBranchingMessageId(null)
    }
  }, [handleConversationBranched, isAgentRunning])

  const handleMessageForkBefore = useCallback((message: AgentMessageRecord) => (
    runMessageBranchAction(message, 'fork-before')
  ), [runMessageBranchAction])

  const handleMessageCloneAt = useCallback((message: AgentMessageRecord) => (
    runMessageBranchAction(message, 'clone-at')
  ), [runMessageBranchAction])

  useEffect(() => {
    if (!focusConversation || loading) {
      return
    }

    if (lastFocusNonceRef.current === focusConversation.nonce) {
      return
    }

    lastFocusNonceRef.current = focusConversation.nonce
    if (focusConversation.id) {
      pendingMessageFocusRef.current = focusConversation.messageId
        ? {
            conversationId: focusConversation.id,
            messageId: focusConversation.messageId,
          }
        : null
      setFocusedMessageId(null)
      void openConversation(focusConversation.id)
      return
    }
    pendingMessageFocusRef.current = null
    setFocusedMessageId(null)
    void createNewConversation()
  }, [createNewConversation, focusConversation, loading, openConversation])

  useEffect(() => {
    onConversationStateChange?.({
      conversationId: currentConversationId,
      isAgentRunning,
    })
  }, [currentConversationId, isAgentRunning, onConversationStateChange])

  useEffect(() => {
    onConversationsChanged?.()
  }, [conversationListSignature, onConversationsChanged])

  useEffect(() => {
    if (externalConversationRevision <= 0) return
    void refreshConversationListRef.current()
  }, [externalConversationRevision])

  // 自定义缓动滚动：easeInOutCubic，比原生 smooth 更慢更柔和
  const scrollToBottomAnimated = useCallback((duration = 900) => {
    const container = scrollRef.current
    if (!container) return

    if (scrollAnimationRef.current != null) {
      cancelAnimationFrame(scrollAnimationRef.current)
      scrollAnimationRef.current = null
    }

    const start = container.scrollTop
    const target = container.scrollHeight - container.clientHeight
    const distance = target - start

    if (distance <= 1) {
      container.scrollTop = target
      return
    }

    const startTime = performance.now()
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration)
      // 每帧重算目标：输入坞高度变化或图片加载都会改变可滚动高度
      const currentTarget = container.scrollHeight - container.clientHeight
      container.scrollTop = start + (currentTarget - start) * easeInOutCubic(progress)
      if (progress < 1) {
        scrollAnimationRef.current = requestAnimationFrame(step)
      } else {
        scrollAnimationRef.current = null
      }
    }
    scrollAnimationRef.current = requestAnimationFrame(step)
  }, [])

  // 组件卸载时取消动画
  useEffect(() => {
    return () => {
      if (scrollAnimationRef.current != null) {
        cancelAnimationFrame(scrollAnimationRef.current)
      }
      if (highlightTimerRef.current != null) {
        window.clearTimeout(highlightTimerRef.current)
      }
    }
  }, [])

  // 切换对话时：等消息加载并渲染稳定后，丝滑滚到底部
  useEffect(() => {
    setAutoScrollEnabled(true)
    pendingConversationScrollRef.current = (
      pendingMessageFocusRef.current?.conversationId !== currentConversationId
    )
    setBranchActionError(null)
  }, [currentConversationId])

  useEffect(() => {
    const pendingFocus = pendingMessageFocusRef.current
    if (
      !pendingFocus
      || pendingFocus.conversationId !== currentConversationId
      || !messages.some((message) => message.id === pendingFocus.messageId)
    ) {
      return
    }

    pendingConversationScrollRef.current = false
    pendingMessageFocusRef.current = null
    setAutoScrollEnabled(false)

    let frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(() => {
        const element = document.getElementById(getMessageElementId(pendingFocus.messageId))
        if (!element) return
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        element.focus({ preventScroll: true })
        setFocusedMessageId(pendingFocus.messageId)
        if (highlightTimerRef.current != null) {
          window.clearTimeout(highlightTimerRef.current)
        }
        highlightTimerRef.current = window.setTimeout(() => {
          setFocusedMessageId(null)
          highlightTimerRef.current = null
        }, SEARCH_HIGHLIGHT_DURATION_MS)
      })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [currentConversationId, messages])

  useEffect(() => {
    if (!pendingConversationScrollRef.current || messages.length === 0) return
    pendingConversationScrollRef.current = false
    // 双 RAF 等 markstream 异步渲染稳定，再缓动滚到底部
    let frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(() => scrollToBottomAnimated())
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [messages, scrollToBottomAnimated])

  // 输入坞悬浮在列表之上，把它的高度同步成列表底部内边距，
  // 最后一条消息才能完整停在输入坞上方而不是被压在下面。
  useEffect(() => {
    const composer = composerRef.current
    const container = scrollRef.current
    if (!composer || !container) return

    const syncHeight = () => {
      const available = container.clientHeight
      const limit = available > 0
        ? Math.round(available * COMPOSER_OVERLAY_MAX_RATIO)
        : Number.POSITIVE_INFINITY
      const next = Math.min(composer.offsetHeight, limit)
      setComposerHeight((prev) => (prev === next ? prev : next))
    }

    syncHeight()
    const observer = new ResizeObserver(syncHeight)
    observer.observe(composer, { box: 'border-box' })
    observer.observe(container, { box: 'border-box' })
    return () => observer.disconnect()
  }, [])

  // 输入坞变高会撑高可滚动区域，但不会触发 scroll 事件，跟底时需要主动重新贴底
  useEffect(() => {
    const container = scrollRef.current
    const previousHeight = prevComposerHeightRef.current
    prevComposerHeightRef.current = composerHeight
    if (!container || !autoScrollEnabled || previousHeight === composerHeight) return
    container.scrollTop = container.scrollHeight - container.clientHeight
  }, [autoScrollEnabled, composerHeight])

  // 流式过程中即时跟底（仅 running 时）
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !autoScrollEnabled || !isAgentRunning) return

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'auto',
    })
  }, [autoScrollEnabled, isAgentRunning, messages, streaming.attachments, streaming.parts, streamError])

  // 对话结束（isAgentRunning: true → false）时无条件缓动滚到底部
  useEffect(() => {
    if (prevRunningRef.current && !isAgentRunning) {
      scrollToBottomAnimated()
      setAutoScrollEnabled(true)
    }
    prevRunningRef.current = isAgentRunning
  }, [isAgentRunning, scrollToBottomAnimated])

  const handleScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) {
      return
    }

    const distanceToBottom = getDistanceToBottom(container)
    if (distanceToBottom > AUTO_SCROLL_STOP_DISTANCE_PX && autoScrollEnabled) {
      setAutoScrollEnabled(false)
      return
    }

    if (distanceToBottom <= AUTO_SCROLL_RESUME_DISTANCE_PX && !autoScrollEnabled) {
      setAutoScrollEnabled(true)
    }
  }, [autoScrollEnabled])

  useEffect(() => {
    if (isAgentRunning && voiceInput.recording) {
      voiceInput.stopRecording()
    }
  }, [isAgentRunning, voiceInput.recording, voiceInput.stopRecording])

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white/92 backdrop-blur-sm">
      <header className="workspace-panel-header flex items-center gap-3 border-b border-slate-200/70 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
          <h2 className="min-w-0 truncate text-sm font-semibold text-slate-900">
            {currentConversation?.title || (conversationScope ? `${conversationScope.projectName || conversationScope.drawingName || '项目'} · 新对话` : '新对话')}
          </h2>
          {runtimeStatusText ? (
            <>
              <p
                className="min-w-0 truncate text-xs text-slate-500"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {runtimeStatusText}
              </p>
              {cancellableOperation ? (
                <button
                  type="button"
                  disabled={operationAbortPending !== null}
                  onClick={() => {
                    if (cancellableOperation === 'compaction') {
                      void abortCompaction()
                    } else {
                      void abortRetry()
                    }
                  }}
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-wait disabled:opacity-50"
                  aria-label={cancellableOperation === 'compaction' ? '取消本次上下文压缩' : '取消本次重试'}
                >
                  {operationAbortPending === cancellableOperation ? '正在取消…' : '取消'}
                </button>
              ) : null}
            </>
          ) : scopeLabel ? (
            <p className="min-w-0 truncate text-xs text-slate-500">当前项目：{scopeLabel}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-full border-slate-200 bg-white/85 text-xs"
            onClick={() => void createNewConversation()}
            disabled={loading}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            新对话
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 rounded-full text-xs"
            onClick={() => setHistoryOpen(true)}
            disabled={loading}
          >
            <History className="h-3.5 w-3.5" />
            历史
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col bg-slate-50/35">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            paddingBottom: composerHeight,
            scrollPaddingBottom: composerHeight,
          }}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-3 pt-4 sm:px-4"
        >
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              正在加载本地会话...
            </div>
          ) : messages.length === 0 &&
            !streamError &&
            !streaming.isStreaming &&
            streaming.parts.length === 0 ? (
            <div className="mx-auto flex h-full max-w-md flex-1 items-center justify-center px-2">
              <div className="border-y border-slate-200/60 bg-white/80 px-6 py-8 text-center sm:border sm:rounded-2xl sm:border-slate-200/50">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
                  <MessageSquarePlus className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">开始对话</h3>
                <p className="mt-2 text-sm text-slate-500">在下方输入消息即可。</p>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                'mx-auto flex w-full flex-col gap-4',
                wideMode ? 'max-w-[min(860px,100%)]' : 'max-w-[min(980px,100%)]',
              )}
            >
              {feedbackLoadError ? (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                  <span className="min-w-0 flex-1">
                    反馈加载失败。为避免覆盖已保存的意见，反馈入口已暂停。
                  </span>
                  <button
                    type="button"
                    disabled={feedbackLoading}
                    onClick={retryFeedbackLoad}
                    className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-medium transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50"
                  >
                    重试
                  </button>
                </div>
              ) : null}
              {messages.map((message) => (
                <div
                  id={getMessageElementId(message.id)}
                  key={message.id}
                  tabIndex={-1}
                  className={cn(
                    'scroll-m-4 rounded-[26px] outline-none transition-[background-color,box-shadow] duration-300',
                    focusedMessageId === message.id
                      ? 'bg-violet-50/80 ring-2 ring-violet-300 ring-offset-2'
                      : '',
                  )}
                >
                  <MessageBubble
                    message={message}
                    feedback={feedbackByMessageId.get(message.id)}
                    feedbackLoading={feedbackLoading}
                    feedbackUnavailable={Boolean(feedbackLoadError)}
                    branchActionsDisabled={branchingMessageId !== null}
                    branchActionPending={branchingMessageId === message.id}
                    onForkBefore={isAgentRunning ? undefined : handleMessageForkBefore}
                    onCloneAt={isAgentRunning ? undefined : handleMessageCloneAt}
                    onSaveFeedback={saveFeedback}
                    onDeleteFeedback={deleteFeedback}
                  />
                </div>
              ))}

              {(streaming.isStreaming || streaming.parts.length > 0) && (
                <div className="flex justify-start">
                  <article className="w-full min-w-0 rounded-[24px] border border-white/65 bg-white/86 px-4 py-3 text-slate-900 shadow-sm">
                    <div className="space-y-3">
                      {streaming.parts.map((part) => (
                        <StreamingPartBlock
                          key={part.id}
                          part={part}
                          isActive={part.id === lastStreamingPartId}
                          isStreaming={streaming.isStreaming}
                          isThinking={part.id === lastStreamingPartId && streaming.isThinking}
                          attachments={streaming.attachments}
                        />
                      ))}

                      {streaming.isStreaming && streaming.parts.length === 0 ? (
                        <div className="text-sm text-slate-400">等待响应...</div>
                      ) : null}

                    </div>
                  </article>
                </div>
              )}

              {streamError ? (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-2xl border border-rose-200/90 bg-rose-50/95 px-4 py-3 text-sm text-rose-900 shadow-sm"
                >
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-rose-950">请求失败</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-rose-900/95">{streamError}</p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg p-1 text-rose-700 transition hover:bg-rose-100/80"
                    aria-label="关闭错误提示"
                    onClick={() => dismissStreamError()}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <footer
          ref={composerRef}
          className="chat-composer-shelf pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[env(safe-area-inset-bottom,0px)] sm:px-4 sm:pb-[env(safe-area-inset-bottom,0px)]"
        >
          <div
            className={cn(
              'pointer-events-auto relative z-10 mx-auto w-full',
              wideMode ? 'max-w-[860px]' : 'max-w-[980px]',
            )}
          >
          {pendingInteraction?.kind === 'confirmation' ? (
            <Suspense
              fallback={(
                <div className="mx-auto mb-3 w-full max-w-[min(980px,100%)] rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-slate-600 shadow-sm">
                  正在加载交互卡片...
                </div>
              )}
            >
              <InteractionTray
                interaction={pendingInteraction}
                submitting={interactionSubmitting}
                error={interactionError}
                onRespond={respondToInteraction}
              />
            </Suspense>
          ) : null}
          {branchActionError ? (
            <div
              role="alert"
              className="mb-2 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
            >
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 break-words">创建分支失败：{branchActionError}</span>
              <button
                type="button"
                aria-label="关闭分支错误提示"
                onClick={() => setBranchActionError(null)}
                className="rounded-md p-1 text-rose-600 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : null}
          {backgroundSubagentsRunning ? (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
              <ThinkingOrb
                state="solving"
                size={20}
                theme="light"
                className="shrink-0"
                aria-label="后台子代理正在运行"
              />
              <span className="min-w-0 flex-1 truncate" title={backgroundSubagentsText}>
                {backgroundSubagentsText}
              </span>
              <button
                type="button"
                onClick={() => void cancelSubagents()}
                className="shrink-0 rounded-md px-2 py-1 font-medium text-violet-700 transition hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                全部停止
              </button>
            </div>
          ) : null}
          {lowCreditBalance ? (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <Coins className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 break-words">
                {creditsRemaining(creditQuota) <= 0
                  ? '算力已用尽，任务将在下一次模型调用时中断，请补充算力包。'
                  : `剩余 ${formatCredits(creditsRemaining(creditQuota))} Credits，长任务可能中途中断，建议先补充算力包。`}
              </span>
            </div>
          ) : null}
          <ChatInputDock
            conversationId={currentConversationId}
            input={input}
            attachedImages={attachedImages}
            isAgentRunning={isAgentRunning}
            agentQueue={agentQueue}
            canQueueAgentMessages={canQueueAgentMessages}
            queueMutationPending={queueMutationPending}
            canSend={canSend}
            contextUsageIndicator={
              ringUsage ? (
                <ContextUsageRing
                  usage={ringUsage}
                  pending={ringPending}
                  compacting={agentCompaction?.phase === 'running'}
                  disabled={isAgentRunning || compactionMutationPending || !currentConversationId}
                  onCompact={(instructions) => void compactContext(instructions)}
                />
              ) : undefined
            }
            cadConnectionIndicator={
              <CadConnectionIndicator
                automationStatus={cadAutomationStatus}
                subagentRun={cadSubagentRun}
              />
            }
            teachingModeHint={teachingModeHint}
            usageStatsLine={(
              <ComposerUsageStats
                usage={conversationUsage}
                remainingCredits={creditQuota ? creditsRemaining(creditQuota) : null}
                remainingLow={isLowBalance(creditQuota)}
                onOpenSettings={onOpenSettings}
              />
            )}
            conversationBranchControl={currentConversation ? {
              label: currentConversation.parentConversationId
                ? `分支自 ${parentConversationTitle || '原会话'}`
                : '主线',
              childCount: currentConversation.childConversationCount,
              disabled: loading || isAgentRunning || !currentConversationId,
              onOpen: () => setTreeOpen(true),
            } : undefined}
            onInputChange={setInput}
            onSend={() => void sendPrompt()}
            onQueue={() => void followUpAgent()}
            onChangeQueueItemKind={(id, kind) => void setQueueItemKind(id, kind)}
            onClearQueue={() => void clearAgentQueue()}
            editingQueueItemId={editingQueueItemId}
            onEditQueueItem={beginQueueEdit}
            onSaveQueueEdit={() => void saveQueueEdit()}
            onCancelQueueEdit={cancelQueueEdit}
            onRemoveQueueItem={(id) => void removeQueueItem(id)}
            onStop={() => void stopAgent()}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onAddImages={addImageFiles}
            onRemoveImage={removeAttachedImage}
            voiceInputControl={{
              supported: voiceInput.supported,
              recording: voiceInput.recording,
              transcribing: voiceInput.transcribing,
              durationSeconds: voiceInput.durationSeconds,
              statusMessage: voiceInput.statusMessage,
              disabled: loading || isAgentRunning || !voiceInput.supported,
              onToggle: voiceInput.toggleRecording,
            }}
            conversationThinkingSelect={{
              value: thinkingMode,
              disabled: loading,
              onChange: (mode) => void setConversationThinkingMode(mode),
            }}
          />
          </div>
        </footer>
      </div>
      <ConversationHistoryDialog
        open={historyOpen}
        conversations={conversations}
        currentConversationId={currentConversationId}
        onClose={() => setHistoryOpen(false)}
        onDelete={(conversationId) => deleteConversation(conversationId)}
        onRename={(conversationId, title) => renameConversation(conversationId, title)}
        onSearch={(query) => searchConversations(query)}
        onSetPinned={(conversationId, pinned) => setConversationPinned(conversationId, pinned)}
        onGetSessionInfo={(conversationId) => electronBridge.getConversationSessionInfo(conversationId)}
        onExportSession={(conversationId, format) =>
          electronBridge.exportConversationSession(conversationId, format)
        }
        onImportSession={async (conversationId) => {
          const result = await electronBridge.importConversationSession(conversationId)
          if (!result.cancelled) {
            await selectConversation(conversationId)
          }
          return result
        }}
        onSelect={(conversationId) => selectConversation(conversationId)}
      />
      <Suspense fallback={null}>
        <ConversationTreeDialog
          open={treeOpen}
          conversationId={currentConversationId}
          conversationTitle={currentConversation?.title ?? '当前会话'}
          onClose={() => setTreeOpen(false)}
          onLoad={(conversationId) => electronBridge.getConversationTree(conversationId)}
          onNavigate={(conversationId, targetEntryId, summarize) => (
            electronBridge.navigateConversationTree({
              conversationId,
              targetEntryId,
              summarize,
            })
          )}
          onForkBefore={(conversationId, targetEntryId) => (
            electronBridge.forkConversationBefore(conversationId, targetEntryId)
          )}
          onCloneAt={(conversationId, targetEntryId) => (
            electronBridge.cloneConversationAt(conversationId, targetEntryId)
          )}
          onNavigated={async (result) => {
            if (result.cancelled || !currentConversationId) return
            await openConversation(currentConversationId)
            if (result.editorText !== null) setInput(result.editorText)
          }}
          onBranched={handleConversationBranched}
          onAbortSummary={async (conversationId) => {
            await electronBridge.abortAgentBranchSummary(conversationId)
          }}
        />
      </Suspense>
      {pendingInteraction?.kind === 'plan_approval' ? (
        <Suspense fallback={null}>
          <PlanApprovalOverlay
            interaction={pendingInteraction}
            submitting={interactionSubmitting}
            error={interactionError}
            onRespond={respondToInteraction}
          />
        </Suspense>
      ) : null}
      {pendingInteraction?.kind === 'component_review' ? (
        <Suspense fallback={null}>
          <ComponentReviewOverlay
            interaction={pendingInteraction}
            submitting={interactionSubmitting}
            error={interactionError}
            onRespond={respondToInteraction}
          />
        </Suspense>
      ) : null}
    </section>
  )
}
