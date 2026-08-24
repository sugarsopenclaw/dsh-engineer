import { useCallback, useEffect, useRef, useState } from 'react'
import { electronBridge } from '@/services/electron-bridge'
import type {
  AgentFeedbackIssueCode,
  AgentFeedbackOutcome,
  AgentFeedbackVote,
  AgentMessageFeedbackView,
} from '@/shared/backend-api'
import type { AgentMessageRecord } from '@/shared/local-agent'
import { KeyedSerialTaskQueue } from './keyed-serial-task-queue'

export interface AgentMessageFeedbackDraft {
  vote: AgentFeedbackVote | null
  outcome: AgentFeedbackOutcome | null
  issueCodes: AgentFeedbackIssueCode[]
  comment: string
}

export function useAgentMessageFeedback(conversationId: string | null) {
  const activeConversationRef = useRef({ id: conversationId, generation: 0 })
  if (activeConversationRef.current.id !== conversationId) {
    activeConversationRef.current = {
      id: conversationId,
      generation: activeConversationRef.current.generation + 1,
    }
  }
  const writeQueueRef = useRef(new KeyedSerialTaskQueue())
  const writeRevisionByMessageRef = useRef(new Map<string, number>())
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<
    ReadonlyMap<string, AgentMessageFeedbackView>
  >(new Map())
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadGeneration, setReloadGeneration] = useState(0)

  useEffect(() => {
    let active = true
    setFeedbackByMessageId(new Map())
    setLoadError(null)

    if (!conversationId) {
      setLoading(false)
      return () => {
        active = false
      }
    }

    setLoading(true)
    void electronBridge.listAgentMessageFeedback(conversationId)
      .then((items) => {
        if (!active) return
        setFeedbackByMessageId(new Map(
          items.map((item) => [item.local_message_id, item]),
        ))
      })
      .catch((error) => {
        if (!active) return
        const message = error instanceof Error ? error.message : '反馈加载失败，请重试。'
        setLoadError(message)
        console.warn(
          '[agent-feedback] load failed',
          message,
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [conversationId, reloadGeneration])

  const retryFeedbackLoad = useCallback(() => {
    setReloadGeneration((current) => current + 1)
  }, [])

  const saveFeedback = useCallback(async (
    message: AgentMessageRecord,
    draft: AgentMessageFeedbackDraft,
  ) => {
    if (!conversationId || message.conversationId !== conversationId) {
      throw new Error('当前会话已切换，请重新提交反馈。')
    }

    const writeKey = `${conversationId}\u0000${message.id}`
    const revision = (writeRevisionByMessageRef.current.get(writeKey) ?? 0) + 1
    const conversationGeneration = activeConversationRef.current.generation
    writeRevisionByMessageRef.current.set(writeKey, revision)
    try {
      const saved = await writeQueueRef.current.enqueue(
        writeKey,
        () => electronBridge.upsertAgentMessageFeedback({
          local_conversation_id: conversationId,
          local_message_id: message.id,
          client_run_id: message.clientRunId ?? null,
          pi_session_id: message.piSessionId ?? null,
          pi_entry_id: message.piEntryId ?? null,
          vote: draft.vote,
          outcome: draft.outcome,
          issue_codes: draft.issueCodes,
          comment: draft.comment.trim() || null,
        }),
      )
      if (
        activeConversationRef.current.id === conversationId
        && activeConversationRef.current.generation === conversationGeneration
        && writeRevisionByMessageRef.current.get(writeKey) === revision
      ) {
        setFeedbackByMessageId((current) => {
          const next = new Map(current)
          next.set(message.id, saved)
          return next
        })
      }
      return saved
    } catch (error) {
      if (
        activeConversationRef.current.id === conversationId
        && activeConversationRef.current.generation === conversationGeneration
        && writeRevisionByMessageRef.current.get(writeKey) === revision
      ) {
        // The backend may have committed even when the response was lost. Re-read
        // authoritative state instead of rolling the UI back to a stale snapshot.
        setReloadGeneration((current) => current + 1)
      }
      throw error
    } finally {
      if (writeRevisionByMessageRef.current.get(writeKey) === revision) {
        writeRevisionByMessageRef.current.delete(writeKey)
      }
    }
  }, [conversationId])

  const deleteFeedback = useCallback(async (message: AgentMessageRecord) => {
    if (!conversationId || message.conversationId !== conversationId) {
      throw new Error('当前会话已切换，请重新操作。')
    }

    const writeKey = `${conversationId}\u0000${message.id}`
    const revision = (writeRevisionByMessageRef.current.get(writeKey) ?? 0) + 1
    const conversationGeneration = activeConversationRef.current.generation
    writeRevisionByMessageRef.current.set(writeKey, revision)
    try {
      await writeQueueRef.current.enqueue(
        writeKey,
        () => electronBridge.deleteAgentMessageFeedback({
          local_conversation_id: conversationId,
          local_message_id: message.id,
        }),
      )
      if (
        activeConversationRef.current.id === conversationId
        && activeConversationRef.current.generation === conversationGeneration
        && writeRevisionByMessageRef.current.get(writeKey) === revision
      ) {
        setFeedbackByMessageId((current) => {
          const next = new Map(current)
          next.delete(message.id)
          return next
        })
      }
    } catch (error) {
      if (
        activeConversationRef.current.id === conversationId
        && activeConversationRef.current.generation === conversationGeneration
        && writeRevisionByMessageRef.current.get(writeKey) === revision
      ) {
        setReloadGeneration((current) => current + 1)
      }
      throw error
    } finally {
      if (writeRevisionByMessageRef.current.get(writeKey) === revision) {
        writeRevisionByMessageRef.current.delete(writeKey)
      }
    }
  }, [conversationId])

  return {
    feedbackByMessageId,
    loading,
    loadError,
    retryFeedbackLoad,
    saveFeedback,
    deleteFeedback,
  }
}
