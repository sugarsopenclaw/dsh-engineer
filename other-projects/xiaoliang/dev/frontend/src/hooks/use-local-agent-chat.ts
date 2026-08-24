import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentMessageRecord,
  AgentInteractionResponseInput,
  AgentQueueKind,
  AgentQueuedMessage,
  AgentUiEvent,
  CadAutomationStatus,
  ConversationCreationSource,
  AgentStopScope,
  ConversationSummary,
  ImageAttachment,
  LlmReasoningLevel,
  LlmSettingsView,
  SubagentRunUpdate,
} from '@/shared/local-agent'
import { LLM_CONFIG_UPDATED_EVENT } from '@/shared/local-agent'
import {
  DEFAULT_THINKING_MODE,
  thinkingModeLabel,
  type ThinkingMode,
} from '@/shared/billing-domain'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'
import { createSmoothMarkdownStream, type SmoothMarkdownStreamController } from '@/lib/smooth-markdown-stream'
import {
  applyPersistedTranscriptMessage,
  createConversationRuntimeBucket,
  deriveConversationRunStatus,
  emptyAgentQueue,
  EMPTY_STREAMING,
  isActiveSubagentRun,
  OPTIMISTIC_USER_MESSAGE_PREFIX,
  reduceConversationRuntimeEvent,
  resolveContextUsage,
  updateStreamingMarkdownPart,
  type ConversationRuntimeBucket,
  type StreamingState,
} from './conversation-runtime-buckets'

export type {
  StreamingPart,
  StreamingState,
  ToolCallState,
} from './conversation-runtime-buckets'

type StreamingMarkdownKind = 'thinking' | 'text'
type StateUpdater<Value> = Value | ((current: Value) => Value)

type SmoothPartCursor = {
  conversationId: string
  partId: string
  baseContent: string
}

export interface UseLocalAgentChatOptions {
  drawingScopeId?: string | null
  projectScopeId?: string | null
}

function cloneComposerImages(images: ImageAttachment[]): ImageAttachment[] {
  return images.map((image) => ({ ...image }))
}

function createOptimisticUserMessage(
  conversationId: string,
  content: string,
  attachments: ImageAttachment[],
): AgentMessageRecord {
  return {
    id: `${OPTIMISTIC_USER_MESSAGE_PREFIX}${Date.now()}`,
    conversationId,
    role: 'user',
    content,
    toolName: '',
    toolArgs: '',
    toolResult: '',
    thinking: '',
    attachments,
    createdAt: new Date().toISOString(),
  }
}

function parseDataUrl(value: string, fallbackName?: string): ImageAttachment | null {
  const match = /^data:(.+?);base64,(.+)$/s.exec(value)
  if (!match) return null

  return {
    id: crypto.randomUUID(),
    mimeType: match[1],
    data: match[2],
    name: fallbackName,
  }
}

function readImageFile(file: File): Promise<ImageAttachment | null> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      resolve(null)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(parseDataUrl(result, file.name))
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error(`读取图片失败: ${file.name}`))
    }
    reader.readAsDataURL(file)
  })
}

export function useLocalAgentChat(options: UseLocalAgentChatOptions = {}) {
  const drawingScopeId = options.drawingScopeId?.trim() || null
  const projectScopeId = options.projectScopeId?.trim() || null
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AgentMessageRecord[]>([])
  const messagesRef = useRef<AgentMessageRecord[]>([])
  messagesRef.current = messages
  const [loading, setLoading] = useState(true)
  const [retrySecondsRemaining, setRetrySecondsRemaining] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([])
  const [draftThinkingMode, setDraftThinkingMode] = useState<ThinkingMode>(DEFAULT_THINKING_MODE)
  const draftThinkingModeRef = useRef<ThinkingMode>(DEFAULT_THINKING_MODE)
  const [editingQueueItemId, setEditingQueueItemId] = useState<string | null>(null)
  const editingQueueConversationIdRef = useRef<string | null>(null)
  const editingStashRef = useRef<{ text: string; images: ImageAttachment[] } | null>(null)
  const queueEditRemovalPendingRef = useRef<string | null>(null)
  const [llmConfig, setLlmConfig] = useState<LlmSettingsView | null>(null)
  const [savingReasoning, setSavingReasoning] = useState(false)
  const [cadAutomationStatus, setCadAutomationStatus] = useState<CadAutomationStatus | null>(null)
  const runtimeBucketsRef = useRef(new Map<string, ConversationRuntimeBucket>())
  const draftRuntimeRef = useRef(createConversationRuntimeBucket())
  const [activeRuntime, setActiveRuntime] = useState<ConversationRuntimeBucket>(
    () => draftRuntimeRef.current,
  )
  const interactionSubmittingIdsRef = useRef(new Map<string, string>())
  const interactionStateRevisionRef = useRef(0)
  const stopRequestedConversationsRef = useRef(new Set<string>())
  const currentConversationIdRef = useRef<string | null>(null)
  const draftCreationSourceRef = useRef<ConversationCreationSource>('desktop_first_message')
  const sendInFlightConversationsRef = useRef(new Set<string>())
  const conversationSelectionRevisionRef = useRef(0)
  const messageLoadRevisionRef = useRef(0)
  const runtimeEventRevisionsRef = useRef(new Map<string, number>())

  const resolveUpdate = <Value,>(current: Value, update: StateUpdater<Value>): Value => (
    typeof update === 'function'
      ? (update as (value: Value) => Value)(current)
      : update
  )

  const runtimeForConversation = (conversationId: string): ConversationRuntimeBucket => (
    runtimeBucketsRef.current.get(conversationId) ?? createConversationRuntimeBucket()
  )

  const updateConversationRuntime = (
    conversationId: string,
    update: (current: ConversationRuntimeBucket) => ConversationRuntimeBucket,
  ): ConversationRuntimeBucket => {
    const current = runtimeForConversation(conversationId)
    const next = update(current)
    if (next === current) return current
    runtimeBucketsRef.current.set(conversationId, next)
    if (currentConversationIdRef.current === conversationId) setActiveRuntime(next)
    return next
  }

  const updateCurrentRuntime = (
    update: (current: ConversationRuntimeBucket) => ConversationRuntimeBucket,
  ): ConversationRuntimeBucket => {
    const conversationId = currentConversationIdRef.current
    if (conversationId) return updateConversationRuntime(conversationId, update)
    const current = draftRuntimeRef.current
    const next = update(current)
    draftRuntimeRef.current = next
    setActiveRuntime(next)
    return next
  }

  const setStatusText = (update: StateUpdater<string | null>) => updateCurrentRuntime((current) => ({
    ...current,
    statusText: resolveUpdate(current.statusText, update),
  }))
  const setIsAgentRunning = (update: StateUpdater<boolean>) => updateCurrentRuntime((current) => {
    const isAgentRunning = resolveUpdate(current.isAgentRunning, update)
    return {
      ...current,
      isAgentRunning,
      runStatus: isAgentRunning ? 'running' : current.runStatus,
    }
  })
  const setQueueingSupported = (update: StateUpdater<boolean>) => updateCurrentRuntime((current) => ({
    ...current,
    queueingSupported: resolveUpdate(current.queueingSupported, update),
  }))
  const setAgentRetry = (update: StateUpdater<ConversationRuntimeBucket['retry']>) => (
    updateCurrentRuntime((current) => ({
      ...current,
      retry: resolveUpdate(current.retry, update),
    }))
  )
  const setAgentCompaction = (update: StateUpdater<ConversationRuntimeBucket['compaction']>) => (
    updateCurrentRuntime((current) => ({
      ...current,
      compaction: resolveUpdate(current.compaction, update),
    }))
  )
  const setOperationAbortPending = (
    update: StateUpdater<ConversationRuntimeBucket['operationAbortPending']>,
  ) => updateCurrentRuntime((current) => ({
    ...current,
    operationAbortPending: resolveUpdate(current.operationAbortPending, update),
  }))
  const setStreaming = (update: StateUpdater<StreamingState>) => updateCurrentRuntime((current) => ({
    ...current,
    streaming: resolveUpdate(current.streaming, update),
  }))
  const setStreamError = (update: StateUpdater<string | null>) => updateCurrentRuntime((current) => ({
    ...current,
    streamError: resolveUpdate(current.streamError, update),
  }))
  const setContextUsage = (update: StateUpdater<ConversationRuntimeBucket['contextUsage']>) => (
    updateCurrentRuntime((current) => ({
      ...current,
      contextUsage: resolveUpdate(current.contextUsage, update),
    }))
  )
  const setSubagentRuns = (update: StateUpdater<SubagentRunUpdate[]>) => updateCurrentRuntime((current) => ({
    ...current,
    subagentRuns: resolveUpdate(current.subagentRuns, update),
  }))
  const setPendingInteraction = (
    update: StateUpdater<ConversationRuntimeBucket['pendingInteraction']>,
  ) => updateCurrentRuntime((current) => ({
    ...current,
    pendingInteraction: resolveUpdate(current.pendingInteraction, update),
  }))
  const setInteractionSubmitting = (update: StateUpdater<boolean>) => updateCurrentRuntime((current) => ({
    ...current,
    interactionSubmitting: resolveUpdate(current.interactionSubmitting, update),
  }))
  const setInteractionError = (update: StateUpdater<string | null>) => updateCurrentRuntime((current) => ({
    ...current,
    interactionError: resolveUpdate(current.interactionError, update),
  }))

  const {
    statusText,
    isAgentRunning,
    queue: agentQueue,
    queueingSupported,
    queueMutationPending,
    retry: agentRetry,
    compaction: agentCompaction,
    compactionMutationPending,
    operationAbortPending,
    streaming,
    streamError,
    contextUsage,
    subagentRuns,
    pendingInteraction,
    interactionSubmitting,
    interactionError,
  } = activeRuntime
  const activeSubagentRuns = subagentRuns.filter(isActiveSubagentRun)
  const subagentRun = [...activeSubagentRuns].at(-1)
    ?? subagentRuns.at(-1)
    ?? null

  // ── 平滑流控制器：将 token 到达与渲染节奏解耦 ──
  const smoothContentRef = useRef<SmoothMarkdownStreamController | null>(null)
  const smoothThinkingRef = useRef<SmoothMarkdownStreamController | null>(null)
  const contentPartCursorRef = useRef<SmoothPartCursor | null>(null)
  const thinkingPartCursorRef = useRef<SmoothPartCursor | null>(null)
  const activeStreamingPartRef = useRef<{
    id: string
    type: StreamingMarkdownKind
    contentIndex: number
  } | null>(null)
  const streamingPartSequenceRef = useRef(0)

  const ensureSmoothContent = () => {
    if (!smoothContentRef.current) {
      smoothContentRef.current = createSmoothMarkdownStream(
        {
          maxCharsPerSecond: 1200,
          targetLatencyMs: 800,
          catchUpLatencyMs: 280,
          maxCommitFps: 30,
          maxCharsPerCommit: 100,
          startDelayMs: 60,
        },
        () => {
          const ctrl = smoothContentRef.current
          const cursor = contentPartCursorRef.current
          if (!ctrl || !cursor) return
          const { visible } = ctrl.getSnapshot()
          updateConversationRuntime(cursor.conversationId, (current) => ({
            ...current,
            streaming: updateStreamingMarkdownPart(
              current.streaming,
              cursor.partId,
              cursor.baseContent + visible,
            ),
          }))
        },
      )
    }
    return smoothContentRef.current
  }

  const ensureSmoothThinking = () => {
    if (!smoothThinkingRef.current) {
      smoothThinkingRef.current = createSmoothMarkdownStream(
        {
          maxCharsPerSecond: 1200,
          targetLatencyMs: 800,
          catchUpLatencyMs: 280,
          maxCommitFps: 30,
          maxCharsPerCommit: 100,
          startDelayMs: 60,
        },
        () => {
          const ctrl = smoothThinkingRef.current
          const cursor = thinkingPartCursorRef.current
          if (!ctrl || !cursor) return
          const { visible } = ctrl.getSnapshot()
          updateConversationRuntime(cursor.conversationId, (current) => ({
            ...current,
            streaming: updateStreamingMarkdownPart(
              current.streaming,
              cursor.partId,
              cursor.baseContent + visible,
            ),
          }))
        },
      )
    }
    return smoothThinkingRef.current
  }

  const flushSmoothStreams = () => {
    smoothContentRef.current?.flush()
    smoothThinkingRef.current?.flush()
  }

  const resetSmoothStreams = () => {
    activeStreamingPartRef.current = null
    contentPartCursorRef.current = null
    thinkingPartCursorRef.current = null
    smoothContentRef.current?.reset()
    smoothThinkingRef.current?.reset()
  }

  const enqueueMarkdownDelta = (
    conversationId: string,
    kind: StreamingMarkdownKind,
    contentIndex: number,
    delta: string,
  ) => {
    if (!delta) return

    const activePart = activeStreamingPartRef.current
    const continuesActivePart = activePart?.type === kind && activePart.contentIndex === contentIndex
    const controller = kind === 'thinking' ? ensureSmoothThinking() : ensureSmoothContent()
    const currentStreaming = runtimeForConversation(conversationId).streaming
    const lastPart = currentStreaming.parts.at(-1)
    const resumesBufferedPart = !activePart
      && lastPart?.type === kind
      && lastPart.contentIndex === contentIndex

    if (!continuesActivePart && !resumesBufferedPart) {
      flushSmoothStreams()
      controller.reset()
      const partId = `stream-${++streamingPartSequenceRef.current}`
      const cursor = {
        conversationId,
        partId,
        baseContent: '',
      }

      if (kind === 'thinking') {
        thinkingPartCursorRef.current = cursor
      } else {
        contentPartCursorRef.current = cursor
      }
      activeStreamingPartRef.current = { id: partId, type: kind, contentIndex }
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        runStatus: 'running',
        isAgentRunning: true,
        streaming: {
          ...current.streaming,
          isStreaming: true,
          isThinking: kind === 'thinking',
          parts: [
            ...current.streaming.parts,
            { id: partId, type: kind, content: '', contentIndex },
          ],
        },
      }))
    } else {
      const resumedPart = resumesBufferedPart && lastPart?.type === kind ? lastPart : null
      const partId = continuesActivePart && activePart ? activePart.id : resumedPart?.id
      if (!partId) return
      if (!continuesActivePart) {
        controller.reset()
        const cursor = {
          conversationId,
          partId,
          baseContent: resumedPart?.content ?? '',
        }
        if (kind === 'thinking') thinkingPartCursorRef.current = cursor
        else contentPartCursorRef.current = cursor
        activeStreamingPartRef.current = { id: partId, type: kind, contentIndex }
      }
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        runStatus: 'running',
        isAgentRunning: true,
        streaming: {
          ...current.streaming,
          isStreaming: true,
          isThinking: kind === 'thinking',
        },
      }))
    }

    controller.enqueue(delta)
  }

  function setActiveConversationId(conversationId: string | null) {
    if (currentConversationIdRef.current !== conversationId) {
      flushSmoothStreams()
      resetSmoothStreams()
      discardQueueEdit()
    }
    currentConversationIdRef.current = conversationId
    if (conversationId) {
      const current = runtimeForConversation(conversationId)
      const next = current.unreadCompletion ? { ...current, unreadCompletion: false } : current
      runtimeBucketsRef.current.set(conversationId, next)
      setActiveRuntime(next)
    } else {
      setActiveRuntime(draftRuntimeRef.current)
    }
    setCurrentConversationId(conversationId)
  }

  function beginExplicitConversationSelection(conversationId: string) {
    conversationSelectionRevisionRef.current += 1
    setActiveConversationId(conversationId)
    return conversationSelectionRevisionRef.current
  }

  const currentConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === currentConversationId) ?? null,
    [conversations, currentConversationId],
  )
  const conversationThinkingMode = currentConversation?.preferredThinkingMode ?? draftThinkingMode
  const canSend = input.trim().length > 0 || attachedImages.length > 0
  const canQueueAgentMessages = isAgentRunning && queueingSupported

  useEffect(() => {
    if (!editingQueueItemId) return
    if (editingQueueConversationIdRef.current !== currentConversationId) {
      discardQueueEdit()
      return
    }
    if ((agentQueue.items ?? []).some((item) => item.id === editingQueueItemId)) return
    if (queueEditRemovalPendingRef.current === editingQueueItemId) return
    const consumed = isAgentRunning || (agentQueue.items ?? []).length > 0
    setEditingQueueItemId(null)
    restoreComposerStash()
    if (consumed) setStatusText('该条排队消息已发送。')
  }, [agentQueue.items, currentConversationId, editingQueueItemId, isAgentRunning])
  const retryPhase = agentRetry?.phase
  const retryScheduledAt = agentRetry?.scheduledAt
  const retryDelayMs = agentRetry?.delayMs

  useEffect(() => {
    if (
      retryPhase !== 'waiting'
      || !Number.isFinite(retryScheduledAt)
      || !Number.isFinite(retryDelayMs)
    ) {
      setRetrySecondsRemaining(null)
      return
    }

    const updateCountdown = () => {
      const remainingMs = (retryScheduledAt as number) + (retryDelayMs as number) - Date.now()
      setRetrySecondsRemaining(Math.max(0, Math.ceil(remainingMs / 1_000)))
    }
    updateCountdown()
    const interval = window.setInterval(updateCountdown, 250)
    return () => window.clearInterval(interval)
  }, [retryDelayMs, retryPhase, retryScheduledAt])

  useEffect(() => {
    if (
      operationAbortPending === 'retry'
      && agentRetry?.phase !== 'waiting'
      && agentRetry?.phase !== 'running'
    ) {
      setOperationAbortPending(null)
    }
    if (operationAbortPending === 'compaction' && agentCompaction?.phase !== 'running') {
      setOperationAbortPending(null)
    }
  }, [agentCompaction?.phase, agentRetry?.phase, operationAbortPending])

  async function listScopedConversations(query?: string): Promise<ConversationSummary[]> {
    if (projectScopeId) {
      return electronBridge.listProjectConversations(projectScopeId, query)
    }

    if (!drawingScopeId) {
      return electronBridge.listConversations(query)
    }

    const scoped = await electronBridge.listDrawingConversations(drawingScopeId)
    const normalizedQuery = query?.trim().toLowerCase()
    if (!normalizedQuery) {
      return scoped
    }

    return scoped.filter((conversation) => {
      const haystack = `${conversation.title} ${conversation.id}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }

  async function createScopedConversation(
    title?: string,
    creationSource: ConversationCreationSource = 'legacy_unknown',
    thinkingMode?: ThinkingMode,
  ): Promise<ConversationSummary> {
    if (projectScopeId) {
      return electronBridge.createConversationInProject(
        projectScopeId,
        title,
        creationSource,
        thinkingMode,
      )
    }

    if (drawingScopeId) {
      return electronBridge.createConversationInDrawing(
        drawingScopeId,
        title,
        creationSource,
        thinkingMode,
      )
    }

    throw new Error('当前未选择项目，无法创建对话。')
  }

  async function ensureConversation(): Promise<string | null> {
    if (!isElectronApp()) return null

    const selectionRevisionAtStart = conversationSelectionRevisionRef.current
    const list = await listScopedConversations()
    if (conversationSelectionRevisionRef.current !== selectionRevisionAtStart) {
      setConversations(list)
      const activeId = currentConversationIdRef.current
      setContextUsage((current) => (
        activeId
          ? resolveContextUsage(current, list.find((item) => item.id === activeId)?.contextUsage)
          : null
      ))
      return activeId
    }

    if (list.length > 0) {
      setConversations(list)
      const activeId = currentConversationIdRef.current
      const latestId =
        activeId && list.some((item) => item.id === activeId)
          ? activeId
          : list[0].id
      setActiveConversationId(latestId)
      setContextUsage((current) => (
        resolveContextUsage(current, list.find((item) => item.id === latestId)?.contextUsage)
      ))
      return latestId
    }

    setConversations([])
    setActiveConversationId(null)
    setContextUsage(null)
    return null
  }

  async function loadMessages(conversationId: string, options: { clear?: boolean } = {}) {
    const targetId = conversationId.trim()
    if (!targetId) {
      return []
    }

    const loadRevision = messageLoadRevisionRef.current + 1
    messageLoadRevisionRef.current = loadRevision
    if (options.clear) {
      setMessages([])
    }

    const nextMessages = await electronBridge.getConversationMessages(targetId)
    if (
      messageLoadRevisionRef.current === loadRevision &&
      currentConversationIdRef.current === targetId
    ) {
      setMessages(nextMessages)
    }
    return nextMessages
  }

  async function refreshConversationList() {
    const list = await listScopedConversations()
    setConversations(list)
    const activeId = currentConversationIdRef.current
    if (activeId) {
      setContextUsage((current) => (
        resolveContextUsage(current, list.find((item) => item.id === activeId)?.contextUsage)
      ))
    }
  }

  async function restoreRunningConversations() {
    const revisionAtRequest = new Map(runtimeEventRevisionsRef.current)
    const snapshots = await electronBridge.getRunningAgentConversations()
    for (const snapshot of snapshots) {
      if (
        (runtimeEventRevisionsRef.current.get(snapshot.conversationId) ?? 0)
        !== (revisionAtRequest.get(snapshot.conversationId) ?? 0)
      ) continue
      updateConversationRuntime(snapshot.conversationId, (current) => ({
        ...current,
        runStatus: snapshot.status,
        isAgentRunning: snapshot.promptRunning,
        queueingSupported: snapshot.promptRunning && snapshot.supportsQueueing,
        streaming: snapshot.promptRunning
          ? { ...current.streaming, isStreaming: true }
          : current.streaming,
        subagentRuns: snapshot.subagentRuns,
      }))
    }
    return snapshots
  }

  async function searchConversations(query: string) {
    return listScopedConversations(query)
  }

  async function refreshLlmConfig() {
    if (!isElectronApp()) return
    const next = await electronBridge.getLlmConfig()
    setLlmConfig(next)
  }

  async function setConversationModel(modelId: string) {
    if (!currentConversationId) return
    const cfg = llmConfig ?? (await electronBridge.getLlmConfig())
    const globalModel =
      cfg.profiles.find((p) => p.profileId === cfg.activeProfileId)?.model ?? ''
    await electronBridge.setConversationPreferredModel(
      currentConversationId,
      modelId === globalModel ? null : modelId,
    )
    await refreshConversationList()
    await refreshLlmConfig()
  }

  function rememberDraftThinkingMode(mode: ThinkingMode) {
    draftThinkingModeRef.current = mode
    setDraftThinkingMode(mode)
  }

  async function setConversationThinkingMode(mode: ThinkingMode) {
    rememberDraftThinkingMode(mode)
    if (!currentConversationId) return
    try {
      const result = await electronBridge.setConversationThinkingMode(currentConversationId, mode)
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === currentConversationId
            ? { ...conversation, preferredThinkingMode: mode }
            : conversation,
        ),
      )
      if (result.appliedAt === 'next_turn') {
        setStatusText(`已切到${thinkingModeLabel(mode)}，当前回合结束后生效。`)
      }
      await refreshConversationList()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusText(`切换思考模式失败：${message}`)
    }
  }

  async function setConversationAgentMode(mode: 'agent' | 'plan') {
    if (!currentConversationId) return
    await electronBridge.setConversationMode(currentConversationId, mode)
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === currentConversationId
          ? {
              ...conversation,
              preferredAgentMode: mode,
              planPhase: mode === 'plan'
                ? (conversation.planPhase === 'active' || conversation.planPhase === 'exit_pending'
                    ? 'active'
                    : 'pending')
                : (conversation.planPhase === 'active' || conversation.planPhase === 'exit_pending'
                    ? 'active'
                    : 'inactive'),
            }
          : conversation,
      ),
    )
    await refreshConversationList()
  }

  async function openPlanApproval() {
    if (!currentConversationId) return
    const interaction = await electronBridge.openPlanApproval(currentConversationId)
    setPendingInteraction(interaction)
    setStatusText('等待您确认计划...')
  }

  async function setProfileReasoningLevel(reasoningLevel: LlmReasoningLevel) {
    const cfg = llmConfig ?? (await electronBridge.getLlmConfig())
    const activeProfile = cfg.profiles.find((profile) => profile.profileId === cfg.activeProfileId)
    if (!activeProfile) return

    setSavingReasoning(true)
    try {
      const next = await electronBridge.saveLlmConfig({
        profileId: activeProfile.profileId,
        model: activeProfile.model,
        reasoningLevel,
      })
      setLlmConfig(next)
      setStatusText('Reasoning level updated for the active profile.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStreamError(message)
      setStatusText(message)
      throw error
    } finally {
      setSavingReasoning(false)
    }
  }

  useEffect(() => {
    if (!isElectronApp()) {
      setLoading(false)
      return
    }

    setLoading(true)
    setConversations([])
    draftRuntimeRef.current = createConversationRuntimeBucket()
    rememberDraftThinkingMode(DEFAULT_THINKING_MODE)
    setActiveConversationId(null)
    draftCreationSourceRef.current = 'desktop_first_message'
    sendInFlightConversationsRef.current.clear()
    conversationSelectionRevisionRef.current += 1
    messageLoadRevisionRef.current += 1
    setMessages([])
    setInput('')
    setAttachedImages([])
    setStreaming({ ...EMPTY_STREAMING })
    setStreamError(null)
    setStatusText(null)
    setContextUsage(null)
    setCadAutomationStatus(null)

    void refreshLlmConfig()

    let cancelled = false
    void Promise.all([ensureConversation(), restoreRunningConversations()])
      .then(([conversationId]) => {
        if (!conversationId || cancelled) return
        return loadMessages(conversationId)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [drawingScopeId, projectScopeId])

  useEffect(() => {
    if (!isElectronApp()) return

    const refreshFromRuntime = () => {
      void refreshLlmConfig().catch(() => undefined)
    }
    const handleConfigUpdated = (event: Event) => {
      const detail = (event as CustomEvent<LlmSettingsView>).detail
      if (detail) {
        setLlmConfig(detail)
        return
      }
      refreshFromRuntime()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshFromRuntime()
      }
    }

    window.addEventListener(LLM_CONFIG_UPDATED_EVENT, handleConfigUpdated)
    window.addEventListener('focus', refreshFromRuntime)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener(LLM_CONFIG_UPDATED_EVENT, handleConfigUpdated)
      window.removeEventListener('focus', refreshFromRuntime)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!currentConversationId) {
      setContextUsage(null)
      setSubagentRuns([])
      return
    }

    const matched = conversations.find((conversation) => conversation.id === currentConversationId)
    setContextUsage((current) => resolveContextUsage(current, matched?.contextUsage))
  }, [conversations, currentConversationId])

  useEffect(() => {
    if (!isElectronApp()) {
      setCadAutomationStatus(null)
      return
    }

    let cancelled = false
    let refreshing = false
    const refreshCadAutomationStatus = () => {
      if (refreshing || cancelled) return
      refreshing = true
      electronBridge.getCadAutomationStatus({
        ...(currentConversationId ? { conversationId: currentConversationId } : {}),
        ...(currentConversation?.projectId || projectScopeId
          ? { projectId: currentConversation?.projectId || projectScopeId || undefined }
          : {}),
      }).then((next) => {
        if (cancelled) return
        setCadAutomationStatus(next)
        const activeRuns = next.activeRuns ?? (next.activeRun ? [next.activeRun] : [])
        if (currentConversationId) {
          updateConversationRuntime(currentConversationId, (current) => {
            const subagentRuns = [
              ...current.subagentRuns.filter((run) => run.type !== 'cad-analyst'),
              ...activeRuns,
            ]
            return {
              ...current,
              runStatus: deriveConversationRunStatus(
                current.isAgentRunning,
                subagentRuns,
                current.runStatus === 'error' ? 'error' : 'completed',
              ),
              subagentRuns,
            }
          })
        } else {
          setSubagentRuns(activeRuns)
        }
      }).catch(() => {
        if (!cancelled) setCadAutomationStatus(null)
      }).finally(() => {
        refreshing = false
      })
    }
    refreshCadAutomationStatus()
    const refreshTimer = window.setInterval(refreshCadAutomationStatus, 15_000)

    return () => {
      cancelled = true
      window.clearInterval(refreshTimer)
    }
  }, [currentConversation?.projectId, currentConversationId, projectScopeId])

  useEffect(() => {
    const restoreRevision = ++interactionStateRevisionRef.current
    if (!currentConversationId || !isElectronApp()) return

    updateConversationRuntime(currentConversationId, (current) => ({
      ...current,
      interactionSubmitting: interactionSubmittingIdsRef.current.has(currentConversationId),
    }))

    let cancelled = false
    electronBridge.getPendingAgentInteraction(currentConversationId)
      .then((interaction) => {
        if (
          cancelled
          || interactionStateRevisionRef.current !== restoreRevision
          || currentConversationIdRef.current !== currentConversationId
        ) return
        setPendingInteraction(interaction)
        if (interaction) {
          if (interaction.kind === 'component_review') {
            setStatusText('请复核本轮构件')
          } else if (interaction.kind === 'plan_approval') {
            setStatusText('等待您确认计划...')
          } else {
            setIsAgentRunning(true)
            setStatusText('等待您确认后继续...')
          }
        }
      })
      .catch((error) => {
        if (cancelled) return
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn('[chat] failed to restore pending interaction', error)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentConversationId])

  useEffect(() => {
    if (!isElectronApp()) return

    const unsubscribe = electronBridge.onAgentEvent((event: AgentUiEvent) => {
      if (event.type === 'conversation_mode') {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === event.conversationId
              ? {
                  ...conversation,
                  preferredAgentMode: event.mode,
                  planPhase: event.phase,
                }
              : conversation,
          ),
        )
        return
      }
      if (event.type === 'conversation_updated') {
        void refreshConversationList().catch((error) => {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn('[chat:event] failed to refresh conversation', error)
          }
        })
        return
      }

      const isActive = event.conversationId === currentConversationIdRef.current
      runtimeEventRevisionsRef.current.set(
        event.conversationId,
        (runtimeEventRevisionsRef.current.get(event.conversationId) ?? 0) + 1,
      )

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug('[chat:event]', event.type, event)
      }

      if (event.type === 'message_delta' && isActive) {
        enqueueMarkdownDelta(
          event.conversationId,
          event.kind,
          event.contentIndex,
          event.delta,
        )
        return
      }

      if (
        isActive
        && (
          event.type === 'tool_start'
          || event.type === 'tool_end'
          || event.type === 'agent_end'
          || event.type === 'agent_settled'
          || event.type === 'messages_updated'
          || event.type === 'error'
        )
      ) {
        flushSmoothStreams()
      }
      if (isActive && event.type === 'agent_start') {
        stopRequestedConversationsRef.current.delete(event.conversationId)
        resetSmoothStreams()
      } else if (
        isActive
        && (
          event.type === 'tool_start'
          || event.type === 'agent_settled'
          || event.type === 'messages_updated'
          || event.type === 'error'
        )
      ) {
        activeStreamingPartRef.current = null
      }

      updateConversationRuntime(event.conversationId, (current) => (
        reduceConversationRuntimeEvent(current, event, {
          isActive,
          createPartId: () => `stream-${++streamingPartSequenceRef.current}`,
        })
      ))

      if (
        event.type === 'error'
        || event.type === 'interaction_requested'
        || event.type === 'interaction_resolved'
      ) {
        interactionSubmittingIdsRef.current.delete(event.conversationId)
        if (isActive) interactionStateRevisionRef.current += 1
      }

      if (event.type === 'subagent_run' && isActive) {
        const updates = event.updates?.length ? event.updates : [event.update]
        const activeCadRuns = updates.filter((update) => (
          update.type === 'cad-analyst'
          && (update.status === 'queued' || update.status === 'initializing' || update.status === 'running')
        ))
        setCadAutomationStatus((current) => current
          ? {
              ...current,
              activeRun: activeCadRuns.at(-1) ?? null,
              activeRuns: activeCadRuns,
              updatedAt: new Date().toISOString(),
            }
          : current)
      }

      if (event.type === 'transcript_message' && isActive) {
        flushSmoothStreams()
        const currentStreaming = runtimeForConversation(event.conversationId).streaming
        const applied = applyPersistedTranscriptMessage(
          messagesRef.current,
          event.message,
          currentStreaming,
        )
        messagesRef.current = applied.messages
        setMessages(applied.messages)
        if (applied.streaming !== currentStreaming) {
          resetSmoothStreams()
          updateConversationRuntime(event.conversationId, (current) => (
            current.streaming === applied.streaming
              ? current
              : { ...current, streaming: applied.streaming }
          ))
        }
      }

      if (event.type === 'messages_updated') {
        const refreshes: Promise<unknown>[] = [refreshConversationList()]
        if (isActive) refreshes.push(loadMessages(event.conversationId))
        void Promise.all(refreshes).catch((error) => {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn('[chat:event] failed to refresh messages', error)
          }
        })
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [drawingScopeId, projectScopeId])

  // 组件卸载时销毁平滑流控制器，释放 RAF
  useEffect(() => {
    return () => {
      smoothContentRef.current?.destroy()
      smoothThinkingRef.current?.destroy()
      smoothContentRef.current = null
      smoothThinkingRef.current = null
    }
  }, [])

  async function createNewConversation() {
    if (loading) return

    conversationSelectionRevisionRef.current += 1
    messageLoadRevisionRef.current += 1
    draftCreationSourceRef.current = 'desktop_new_button'
    rememberDraftThinkingMode(
      conversations.find((conversation) => conversation.id === currentConversationIdRef.current)
        ?.preferredThinkingMode
      ?? draftThinkingModeRef.current,
    )
    draftRuntimeRef.current = createConversationRuntimeBucket({
      statusText: '新对话将在发送首条消息时创建。',
    })
    setActiveConversationId(null)
    setMessages([])
    setInput('')
    setAttachedImages([])
  }

  async function deleteConversation(conversationId: string) {
    await electronBridge.deleteConversation(conversationId)
    runtimeBucketsRef.current.delete(conversationId)
    const nextConversations = await listScopedConversations()
    setConversations(nextConversations)

    const deletedCurrent = conversationId === currentConversationId
    const fallbackConversationId = deletedCurrent ? (nextConversations[0]?.id ?? null) : currentConversationId

    if (deletedCurrent) {
      conversationSelectionRevisionRef.current += 1
      if (!fallbackConversationId) {
        draftCreationSourceRef.current = 'desktop_first_message'
      }
    }
    setActiveConversationId(fallbackConversationId)

    if (deletedCurrent) {
      setInput('')
      setAttachedImages([])
      setContextUsage((current) => (
        fallbackConversationId
          ? resolveContextUsage(
            current,
            nextConversations.find((item) => item.id === fallbackConversationId)?.contextUsage,
          )
          : null
      ))

      if (fallbackConversationId) {
        await loadMessages(fallbackConversationId, { clear: true })
        setStatusText('已删除当前对话，并切换到最近一条历史对话。')
      } else {
        setMessages([])
        setStatusText('已删除当前对话。')
      }
      return
    }

    setStatusText('已删除对话。')
  }

  async function renameConversation(conversationId: string, title: string) {
    await electronBridge.renameConversation(conversationId, title)
    await refreshConversationList()
    setStatusText('已重命名对话。')
  }

  async function setConversationPinned(conversationId: string, pinned: boolean) {
    await electronBridge.setConversationPinned(conversationId, pinned)
    await refreshConversationList()
    setStatusText(pinned ? '已置顶对话。' : '已取消置顶。')
  }

  async function selectConversation(conversationId: string) {
    const targetId = conversationId.trim()
    if (!targetId) return

    beginExplicitConversationSelection(targetId)
    setInput('')
    setAttachedImages([])
    setContextUsage((current) => resolveContextUsage(
      current,
      conversations.find((conversation) => conversation.id === targetId)?.contextUsage,
    ))
    setStatusText(targetId === currentConversationId ? '已刷新历史对话。' : '已切换到历史对话。')
    await loadMessages(targetId, { clear: true })
  }

  async function openConversation(conversationId: string) {
    const targetId = conversationId.trim()
    if (!targetId) return

    const selectionRevision = beginExplicitConversationSelection(targetId)
    let target = conversations.find((conversation) => conversation.id === targetId) ?? null
    if (isElectronApp()) {
      const refreshed = await listScopedConversations()
      if (conversationSelectionRevisionRef.current !== selectionRevision) {
        return
      }
      setConversations(refreshed)
      target = refreshed.find((conversation) => conversation.id === targetId) ?? null
    }

    setInput('')
    setAttachedImages([])
    setContextUsage((current) => resolveContextUsage(current, target?.contextUsage))
    setStatusText('已切换到指定对话。')
    await loadMessages(targetId, { clear: true })
  }

  async function resetCurrentConversation() {
    if (!currentConversationId) return
    await electronBridge.resetConversation(currentConversationId)
    runtimeBucketsRef.current.set(currentConversationId, createConversationRuntimeBucket())
    setActiveRuntime(runtimeBucketsRef.current.get(currentConversationId)!)
    await refreshConversationList()
    await loadMessages(currentConversationId, { clear: true })
    setContextUsage(null)
    setStatusText('当前会话已清空。')
  }

  async function addImageFiles(files: File[]) {
    const nextImages = (await Promise.all(files.map((file) => readImageFile(file)))).filter(
      (item): item is ImageAttachment => !!item,
    )

    if (nextImages.length === 0) return
    setAttachedImages((current) => [...current, ...nextImages])
  }

  async function sendPrompt() {
    const initialConversationId = currentConversationIdRef.current
    if (
      editingQueueConversationIdRef.current !== null
      && editingQueueConversationIdRef.current === initialConversationId
    ) return
    const inFlightKey = initialConversationId ?? '__draft__'
    if (sendInFlightConversationsRef.current.has(inFlightKey) || isAgentRunning || !canSend) return
    sendInFlightConversationsRef.current.add(inFlightKey)

    const selectionRevisionAtStart = conversationSelectionRevisionRef.current
    let conversationId = currentConversationIdRef.current
    let materializedDraft = false
    let composerCleared = false
    const nextImages = [...attachedImages]
    // Managed gateway models always accept images; do not gate on local profile catalog.
    const nextInput = input.trim()

    try {
      if (!conversationId) {
        const created = await createScopedConversation(
          undefined,
          draftCreationSourceRef.current,
          draftThinkingModeRef.current,
        )
        materializedDraft = true
        conversationId = created.id
        sendInFlightConversationsRef.current.add(created.id)
        const draftRuntime = draftRuntimeRef.current
        runtimeBucketsRef.current.set(created.id, {
          ...draftRuntime,
          contextUsage: created.contextUsage ?? null,
        })
        if (
          currentConversationIdRef.current === null
          && conversationSelectionRevisionRef.current === selectionRevisionAtStart
        ) {
          beginExplicitConversationSelection(created.id)
        }
        setConversations((current) => [
          created,
          ...current.filter((conversation) => conversation.id !== created.id),
        ])
      }
      if (!conversationId) {
        throw new Error('无法创建新对话。')
      }
      const activeConversationId = conversationId
      stopRequestedConversationsRef.current.delete(activeConversationId)
      updateConversationRuntime(activeConversationId, (current) => ({
        ...current,
        runStatus: 'running',
        isAgentRunning: true,
        statusText: '正在发送请求...',
        streamError: null,
        queueingSupported: false,
        streaming: { ...EMPTY_STREAMING, isStreaming: true, parts: [], attachments: [] },
        unreadCompletion: false,
      }))
      if (currentConversationIdRef.current === activeConversationId) {
        setMessages((current) => [
          ...current,
          createOptimisticUserMessage(activeConversationId, nextInput, nextImages),
        ])
      }
      setInput('')
      setAttachedImages([])
      composerCleared = true

      const result = await electronBridge.sendAgentPrompt(
        activeConversationId,
        nextInput,
        nextImages,
      )
      if (result && result.success === false) {
        const errMsg = result.error || '发送失败。'
        if (result.code === 'quota_exceeded' || result.status === 402) {
          window.dispatchEvent(
            new CustomEvent('xiaoliang:quota-exceeded', {
              detail: { message: errMsg, details: result.details },
            }),
          )
        }
        throw new Error(errMsg)
      }
      await Promise.all([refreshConversationList(), loadMessages(activeConversationId)])
      updateConversationRuntime(activeConversationId, (current) => ({
        ...current,
        streamError: stopRequestedConversationsRef.current.has(activeConversationId)
          ? null
          : current.streamError,
        statusText: stopRequestedConversationsRef.current.has(activeConversationId)
          ? '已停止生成。'
          : '本轮已完成。',
      }))
    } catch (error) {
      let persistedMessages: AgentMessageRecord[] | null = null
      if (conversationId) {
        persistedMessages = await electronBridge
          .getConversationMessages(conversationId)
          .catch(() => null)
      }

      if (materializedDraft && conversationId && persistedMessages?.length === 0) {
        let discarded = false
        try {
          await electronBridge.deleteConversation(conversationId)
          discarded = true
        } catch {
          // Keep the materialized conversation selected if cleanup cannot be verified.
        }
        if (discarded) {
          runtimeBucketsRef.current.delete(conversationId)
          const nextConversations = await listScopedConversations().catch(() => [])
          setConversations(nextConversations)
          if (currentConversationIdRef.current === conversationId) {
            conversationSelectionRevisionRef.current += 1
            messageLoadRevisionRef.current += 1
            draftRuntimeRef.current = createConversationRuntimeBucket()
            setActiveConversationId(null)
            setMessages([])
            if (composerCleared) {
              setInput(nextInput)
              setAttachedImages(nextImages)
            }
          }
        } else {
          await Promise.all([refreshConversationList(), loadMessages(conversationId)])
        }
      } else if (conversationId) {
        await Promise.all([refreshConversationList(), loadMessages(conversationId)])
      }

      const errMsg = error instanceof Error ? error.message : String(error)
      if (conversationId) {
        const stopped = stopRequestedConversationsRef.current.has(conversationId)
        updateConversationRuntime(conversationId, (current) => ({
          ...current,
          runStatus: stopped ? 'completed' : 'error',
          isAgentRunning: false,
          streamError: stopped ? null : errMsg,
          statusText: stopped ? '已停止生成。' : errMsg,
        }))
      } else {
        setStreamError(errMsg)
        setStatusText(errMsg)
      }
    } finally {
      sendInFlightConversationsRef.current.delete(inFlightKey)
      if (conversationId) {
        sendInFlightConversationsRef.current.delete(conversationId)
        stopRequestedConversationsRef.current.delete(conversationId)
      }
      // 推迟到微任务之后，避免在 invoke 刚返回时早于主进程发来的 error/agent_end 事件，
      // 从而把 streamError 与流式区状态错序清掉；同时让 IPC 的 setState 先落盘。
      queueMicrotask(() => {
        if (conversationId && currentConversationIdRef.current === conversationId) {
          resetSmoothStreams()
        }
        if (conversationId) {
          updateConversationRuntime(conversationId, (current) => ({
            ...current,
            isAgentRunning: false,
            runStatus: deriveConversationRunStatus(
              false,
              current.subagentRuns,
              current.runStatus === 'error' ? 'error' : 'completed',
            ),
            streaming: { ...EMPTY_STREAMING, parts: [], attachments: [] },
          }))
        }
      })
    }
  }

  function restoreComposerStash() {
    editingQueueConversationIdRef.current = null
    const stash = editingStashRef.current
    editingStashRef.current = null
    if (!stash) return
    setInput(stash.text)
    setAttachedImages(cloneComposerImages(stash.images))
  }

  function discardQueueEdit() {
    editingQueueConversationIdRef.current = null
    editingStashRef.current = null
    queueEditRemovalPendingRef.current = null
    setEditingQueueItemId(null)
  }

  function cancelQueueEdit() {
    if (!editingQueueItemId) return
    setEditingQueueItemId(null)
    restoreComposerStash()
  }

  function beginQueueEdit(item: AgentQueuedMessage) {
    const conversationId = currentConversationIdRef.current
    if (!conversationId || runtimeForConversation(conversationId).queueMutationPending) return
    if (editingQueueItemId === item.id) return
    if (!editingQueueItemId) {
      editingStashRef.current = {
        text: input,
        images: cloneComposerImages(attachedImages),
      }
    }
    editingQueueConversationIdRef.current = conversationId
    setEditingQueueItemId(item.id)
    setInput(item.text)
    setAttachedImages(cloneComposerImages(item.images))
    setStreamError(null)
  }

  async function queuePrompt() {
    const conversationId = currentConversationIdRef.current
    const queuedText = input.trim()
    const queuedImages = cloneComposerImages(attachedImages)
    if (
      !conversationId
      || !canQueueAgentMessages
      || editingQueueItemId
      || (!queuedText && queuedImages.length === 0)
      || runtimeForConversation(conversationId).queueMutationPending
    ) {
      return
    }

    updateConversationRuntime(conversationId, (current) => ({
      ...current,
      queueMutationPending: true,
    }))
    setInput('')
    setAttachedImages([])
    setStreamError(null)
    try {
      await electronBridge.followUpAgent(conversationId, queuedText, queuedImages)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        statusText: '已排到本轮结束后。点队列中的「下一轮」可改为立即引导。',
      }))
    } catch (error) {
      if (currentConversationIdRef.current === conversationId) {
        setInput((current) => current.trim() ? `${queuedText}\n\n${current}` : queuedText)
        setAttachedImages((current) => current.length > 0 ? current : queuedImages)
      }
      const message = error instanceof Error ? error.message : String(error)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        streamError: message,
        statusText: message,
      }))
    } finally {
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        queueMutationPending: false,
      }))
    }
  }

  async function followUpAgent() {
    await queuePrompt()
  }

  async function setQueueItemKind(id: string, kind: AgentQueueKind) {
    const conversationId = currentConversationIdRef.current
    if (!conversationId || runtimeForConversation(conversationId).queueMutationPending) return

    updateConversationRuntime(conversationId, (current) => ({
      ...current,
      queueMutationPending: true,
    }))
    try {
      await electronBridge.setQueueItemKind(conversationId, id, kind)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        statusText: kind === 'steer'
          ? '已改为立即引导，将在下一次模型调用前生效。'
          : '已改回本轮结束后继续。',
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        streamError: message,
        statusText: message,
      }))
    } finally {
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        queueMutationPending: false,
      }))
    }
  }

  async function saveQueueEdit() {
    const conversationId = currentConversationIdRef.current
    const itemId = editingQueueItemId
    const nextText = input.trim()
    const nextImages = cloneComposerImages(attachedImages)
    if (
      !conversationId
      || !itemId
      || editingQueueConversationIdRef.current !== conversationId
      || (!nextText && nextImages.length === 0)
      || runtimeForConversation(conversationId).queueMutationPending
    ) {
      return
    }

    updateConversationRuntime(conversationId, (current) => ({
      ...current,
      queueMutationPending: true,
    }))
    try {
      await electronBridge.updateQueueItem(conversationId, itemId, nextText, nextImages)
      setEditingQueueItemId(null)
      restoreComposerStash()
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        statusText: '已更新排队消息。',
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        streamError: message,
        statusText: message,
      }))
    } finally {
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        queueMutationPending: false,
      }))
    }
  }

  async function removeQueueItem(id: string) {
    const conversationId = currentConversationIdRef.current
    if (!conversationId || runtimeForConversation(conversationId).queueMutationPending) return

    updateConversationRuntime(conversationId, (current) => ({
      ...current,
      queueMutationPending: true,
    }))
    try {
      const removingEditedItem = editingQueueItemId === id
        && editingQueueConversationIdRef.current === conversationId
      if (removingEditedItem) queueEditRemovalPendingRef.current = id
      await electronBridge.removeQueueItem(conversationId, id)
      if (removingEditedItem) {
        setEditingQueueItemId(null)
        restoreComposerStash()
      }
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        statusText: '已删除一条排队消息。',
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        streamError: message,
        statusText: message,
      }))
    } finally {
      if (queueEditRemovalPendingRef.current === id) {
        queueEditRemovalPendingRef.current = null
      }
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        queueMutationPending: false,
      }))
    }
  }

  async function clearAgentQueue() {
    const conversationId = currentConversationIdRef.current
    if (!conversationId || runtimeForConversation(conversationId).queueMutationPending) return
    if ((agentQueue.items ?? []).length === 0) return

    updateConversationRuntime(conversationId, (current) => ({
      ...current,
      queueMutationPending: true,
    }))
    try {
      const editingItemId = editingQueueConversationIdRef.current === conversationId
        ? editingQueueItemId
        : null
      if (editingItemId) queueEditRemovalPendingRef.current = editingItemId
      await electronBridge.clearAgentQueue(conversationId)
      if (editingItemId) {
        setEditingQueueItemId(null)
        restoreComposerStash()
      }
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        queue: emptyAgentQueue(),
        statusText: '已删除尚未执行的排队消息。',
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        streamError: message,
        statusText: message,
      }))
    } finally {
      queueEditRemovalPendingRef.current = null
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        queueMutationPending: false,
      }))
    }
  }

  async function compactContext(instructions?: string) {
    const conversationId = currentConversationIdRef.current
    if (
      !conversationId
      || isAgentRunning
      || runtimeForConversation(conversationId).compactionMutationPending
    ) {
      return
    }

    updateConversationRuntime(conversationId, (current) => ({
      ...current,
      compactionMutationPending: true,
    }))
    setStreamError(null)
    setAgentRetry(null)
    setAgentCompaction({ phase: 'running', reason: 'manual' })
    setIsAgentRunning(true)
    setQueueingSupported(false)
    setStatusText('正在压缩会话上下文...')

    try {
      const result = await electronBridge.compactAgentContext(
        conversationId,
        instructions?.trim() || undefined,
      )
      await Promise.all([refreshConversationList(), loadMessages(conversationId)])
      if (result.status === 'stopped') {
        updateConversationRuntime(conversationId, (current) => ({
          ...current,
          compaction: { phase: 'cancelled', reason: 'manual' },
          statusText: '上下文压缩已停止。',
        }))
      } else {
        updateConversationRuntime(conversationId, (current) => ({
          ...current,
          compaction: current.compaction?.reason === 'manual'
            && current.compaction.phase !== 'failed'
            ? { ...current.compaction, phase: 'completed' }
            : current.compaction,
          statusText: '上下文压缩完成。',
        }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        compaction: { phase: 'failed', reason: 'manual' },
        streamError: message,
        statusText: message,
      }))
    } finally {
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        compactionMutationPending: false,
        isAgentRunning: false,
        runStatus: deriveConversationRunStatus(
          false,
          current.subagentRuns,
          current.runStatus === 'error' ? 'error' : 'completed',
        ),
      }))
    }
  }

  async function abortRetry() {
    const conversationId = currentConversationIdRef.current
    if (!conversationId || runtimeForConversation(conversationId).operationAbortPending) return
    updateConversationRuntime(conversationId, (current) => ({
      ...current,
      operationAbortPending: 'retry',
    }))
    setStreamError(null)
    setStatusText('正在取消本次重试…')
    try {
      await electronBridge.abortAgentRetry(conversationId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        operationAbortPending: null,
        streamError: message,
        statusText: message,
      }))
    }
  }

  async function abortCompaction() {
    const conversationId = currentConversationIdRef.current
    if (!conversationId || runtimeForConversation(conversationId).operationAbortPending) return
    updateConversationRuntime(conversationId, (current) => ({
      ...current,
      operationAbortPending: 'compaction',
    }))
    setStreamError(null)
    setStatusText('正在取消本次上下文压缩…')
    try {
      await electronBridge.abortAgentCompaction(conversationId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        operationAbortPending: null,
        streamError: message,
        statusText: message,
      }))
    }
  }

  async function stopAgent(scope: AgentStopScope = 'main') {
    if (!currentConversationId || !isAgentRunning) return
    const conversationId = currentConversationId
    stopRequestedConversationsRef.current.add(conversationId)
    updateConversationRuntime(conversationId, (current) => ({
      ...current,
      queueingSupported: false,
      statusText: '正在停止生成...',
    }))
    try {
      await electronBridge.stopAgent(conversationId, scope)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        statusText: current.queue.items.length > 0
          ? `已停止生成。还有 ${current.queue.items.length} 条排队消息可编辑或删除。`
          : current.statusText,
      }))
    } catch (error) {
      stopRequestedConversationsRef.current.delete(conversationId)
      const message = error instanceof Error ? error.message : String(error)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        streamError: message,
        statusText: message,
      }))
    }
  }

  /**
   * Cancels the background subagents this conversation delegated. Stopping the main
   * turn leaves them running, so this is the explicit way to abandon them too.
   */
  async function cancelSubagents() {
    const conversationId = currentConversationId
    if (!conversationId) return
    updateConversationRuntime(conversationId, (current) => ({
      ...current,
      statusText: '正在停止后台子代理...',
    }))
    try {
      await electronBridge.cancelAgentSubagents(conversationId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        statusText: message,
      }))
    }
  }

  async function respondToInteraction(
    response: Omit<AgentInteractionResponseInput, 'conversationId'>,
  ) {
    const conversationId = currentConversationId
    if (
      !conversationId
      || !pendingInteraction
      || pendingInteraction.id !== response.interactionId
      || interactionSubmittingIdsRef.current.has(conversationId)
    ) {
      return
    }

    interactionSubmittingIdsRef.current.set(conversationId, response.interactionId)
    setInteractionSubmitting(true)
    setInteractionError(null)
    try {
      const resolution = await electronBridge.resolveAgentInteraction({
        ...response,
        conversationId,
      })
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        pendingInteraction: current.pendingInteraction?.id === resolution.interactionId
          ? null
          : current.pendingInteraction,
        statusText: resolution.status === 'confirmed'
          ? '已确认，正在继续执行...'
          : '已取消，本次操作未执行。',
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateConversationRuntime(conversationId, (current) => ({
        ...current,
        interactionError: message,
        statusText: message,
      }))
    } finally {
      if (interactionSubmittingIdsRef.current.get(conversationId) === response.interactionId) {
        interactionSubmittingIdsRef.current.delete(conversationId)
        updateConversationRuntime(conversationId, (current) => ({
          ...current,
          interactionSubmitting: false,
        }))
      }
    }
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (isAgentRunning && !canQueueAgentMessages && !editingQueueItemId) return
    const items = Array.from(event.clipboardData?.items ?? [])
    const imageFiles = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file)

    if (imageFiles.length === 0) return
    event.preventDefault()
    await addImageFiles(imageFiles)
  }

  async function handleDrop(event: React.DragEvent<HTMLTextAreaElement>) {
    event.preventDefault()
    if (isAgentRunning && !canQueueAgentMessages && !editingQueueItemId) return
    const imageFiles = Array.from(event.dataTransfer.files).filter((file) =>
      file.type.startsWith('image/'),
    )

    if (imageFiles.length === 0) return
    await addImageFiles(imageFiles)
  }

  function removeAttachedImage(id: string) {
    setAttachedImages((current) => current.filter((image) => image.id !== id))
  }

  function dismissStreamError() {
    setStreamError(null)
  }

  return {
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
    llmConfig,
    savingReasoning,
    contextUsage,
    setInput,
    createNewConversation,
    deleteConversation,
    renameConversation,
    setConversationPinned,
    searchConversations,
    refreshConversationList,
    selectConversation,
    openConversation,
    resetCurrentConversation,
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
    setConversationModel,
    setConversationThinkingMode,
    setConversationAgentMode,
    openPlanApproval,
    setProfileReasoningLevel,
    cadAutomationStatus,
    subagentRun,
    activeSubagentRuns,
    addImageFiles,
    removeAttachedImage,
    handlePaste,
    handleDrop,
    dismissStreamError,
  }
}
