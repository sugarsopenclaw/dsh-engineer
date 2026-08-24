import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import {
  normalizeImageAttachmentPayload,
  type AgentQueuedMessage,
  type AgentQueueKind,
  type AgentUiEvent,
  type ImageAttachment,
} from '../../../../src/shared/local-agent'
import { stableImageAttachmentId } from '../image-attachment-id'

const QUEUE_PREVIEW_MAX_CHARS = 160

export interface SerializeAgentEventOptions {
  supportsQueueing?: boolean
}

function previewQueueText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, QUEUE_PREVIEW_MAX_CHARS)
}

function normalizeQueuedImages(value: unknown): ImageAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index): ImageAttachment[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as {
      id?: unknown
      data?: unknown
      mimeType?: unknown
      name?: unknown
    }
    if (typeof record.data !== 'string' || typeof record.mimeType !== 'string') return []
    const payload = normalizeImageAttachmentPayload(record.data, record.mimeType)
    if (!payload) return []
    return [{
      id: stableImageAttachmentId({
        id: typeof record.id === 'string' ? record.id : `queue-image-${index}`,
        data: payload.data,
        mimeType: payload.mimeType,
      }),
      ...payload,
      ...(typeof record.name === 'string' && record.name.trim()
        ? { name: record.name.trim() }
        : {}),
    }]
  })
}

function queuedMessageFromUnknown(
  value: unknown,
  fallbackKind: AgentQueueKind,
  index: number,
): AgentQueuedMessage | null {
  if (typeof value === 'string') {
    const preview = previewQueueText(value)
    if (!preview) return null
    return {
      id: `${fallbackKind}:${index}`,
      kind: fallbackKind,
      text: value,
      preview,
      images: [],
    }
  }
  if (!value || typeof value !== 'object') return null
  const record = value as {
    id?: unknown
    kind?: unknown
    text?: unknown
    images?: unknown
  }
  const kind: AgentQueueKind = record.kind === 'followUp' ? 'followUp' : fallbackKind
  const text = typeof record.text === 'string' ? record.text : ''
  const images = normalizeQueuedImages(record.images)
  const preview = previewQueueText(text) || (images.length > 0 ? `图片 ${images.length} 张` : '')
  if (!preview && !text && images.length === 0) return null
  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id : `${kind}:${index}`,
    kind,
    text,
    preview,
    images,
  }
}

function projectQueueItems(payload: {
  items?: unknown
  steering?: unknown
  followUp?: unknown
}): AgentQueuedMessage[] {
  if (Array.isArray(payload.items)) {
    return payload.items.flatMap((item, index) => {
      const kind: AgentQueueKind = item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'followUp'
        ? 'followUp'
        : 'steer'
      const projected = queuedMessageFromUnknown(item, kind, index)
      return projected ? [projected] : []
    })
  }

  const steering = Array.isArray(payload.steering) ? payload.steering : []
  const followUp = Array.isArray(payload.followUp) ? payload.followUp : []
  return [
    ...steering.flatMap((message, index) => {
      const projected = queuedMessageFromUnknown(message, 'steer', index)
      return projected ? [projected] : []
    }),
    ...followUp.flatMap((message, index) => {
      const projected = queuedMessageFromUnknown(message, 'followUp', index)
      return projected ? [projected] : []
    }),
  ]
}

function collectToolResultText(result: any) {
  if (typeof result === 'string') return result
  if (!Array.isArray(result?.content)) return JSON.stringify(result ?? {})

  return result.content
    .filter((item: any) => item?.type === 'text' && typeof item.text === 'string')
    .map((item: any) => item.text)
    .join('\n')
}

function collectToolResultImages(result: any): ImageAttachment[] {
  if (!Array.isArray(result?.content)) return []

  return result.content.flatMap((item: any): ImageAttachment[] => {
    if (
      item?.type !== 'image'
      || typeof item.data !== 'string'
      || typeof item.mimeType !== 'string'
    ) {
      return []
    }

    const payload = normalizeImageAttachmentPayload(item.data, item.mimeType)
    if (!payload) return []

    return [{
      id: stableImageAttachmentId({
        id: item.id,
        data: payload.data,
        mimeType: payload.mimeType,
      }),
      ...payload,
      ...(typeof item.name === 'string' && item.name.trim()
        ? { name: item.name.trim() }
        : {}),
    }]
  })
}

export function serializeAgentEvent(
  conversationId: string,
  event: AgentEvent | AgentSessionEvent,
  options: SerializeAgentEventOptions = {},
): AgentUiEvent | null {
  const payload = event as any

  switch (payload.type) {
    case 'agent_start':
      return {
        type: 'agent_start',
        conversationId,
        supportsQueueing: options.supportsQueueing === true,
      }

    case 'agent_end':
      return {
        type: 'agent_end',
        conversationId,
        willRetry: payload.willRetry === true,
      }

    case 'agent_settled':
      return { type: 'agent_settled', conversationId }

    case 'auto_retry_start':
      return {
        type: 'retry_update',
        conversationId,
        retry: {
          phase: 'waiting',
          source: 'agent',
          attempt: payload.attempt,
          maxAttempts: payload.maxAttempts,
          delayMs: payload.delayMs,
          scheduledAt: Date.now(),
        },
      }

    case 'auto_retry_end':
      return {
        type: 'retry_update',
        conversationId,
        retry: {
          phase: payload.success
            ? 'completed'
            : /cancelled|canceled|aborted/iu.test(payload.finalError ?? '')
              ? 'cancelled'
              : 'failed',
          source: 'agent',
          attempt: payload.attempt,
        },
      }

    case 'summarization_retry_scheduled':
      return {
        type: 'retry_update',
        conversationId,
        retry: {
          phase: 'waiting',
          source: 'summarization',
          attempt: payload.attempt,
          maxAttempts: payload.maxAttempts,
          delayMs: payload.delayMs,
          scheduledAt: Date.now(),
        },
      }

    case 'summarization_retry_attempt_start':
      return {
        type: 'retry_update',
        conversationId,
        retry: {
          phase: 'running',
          source: payload.source === 'branchSummary' ? 'branch_summary' : 'compaction',
        },
      }

    case 'summarization_retry_finished':
      return {
        type: 'retry_update',
        conversationId,
        retry: {
          phase: 'completed',
          source: 'summarization',
        },
      }

    case 'compaction_start':
      return {
        type: 'compaction_update',
        conversationId,
        compaction: {
          phase: 'running',
          reason: payload.reason,
        },
      }

    case 'compaction_end':
      return {
        type: 'compaction_update',
        conversationId,
        compaction: {
          phase: payload.aborted
            ? 'cancelled'
            : payload.errorMessage
              ? 'failed'
              : 'completed',
          reason: payload.reason,
          willRetry: payload.willRetry === true,
          ...(Number.isFinite(payload.result?.tokensBefore)
            ? { tokensBefore: payload.result.tokensBefore }
            : {}),
          ...(Number.isFinite(payload.result?.estimatedTokensAfter)
            ? { estimatedTokensAfter: payload.result.estimatedTokensAfter }
            : {}),
        },
      }

    case 'queue_update': {
      const items = projectQueueItems(payload)
      return {
        type: 'queue_update',
        conversationId,
        queue: {
          steeringCount: items.filter((item) => item.kind === 'steer').length,
          followUpCount: items.filter((item) => item.kind === 'followUp').length,
          items,
        },
      }
    }

    case 'message_update': {
      const messageEvent = payload.assistantMessageEvent
      if (!messageEvent) return null
      if (messageEvent.type === 'text_delta') {
        return {
          type: 'message_delta',
          conversationId,
          kind: 'text',
          contentIndex: Number.isInteger(messageEvent.contentIndex) ? messageEvent.contentIndex : 0,
          delta: typeof messageEvent.delta === 'string' ? messageEvent.delta : '',
        }
      }
      if (messageEvent.type === 'thinking_delta') {
        return {
          type: 'message_delta',
          conversationId,
          kind: 'thinking',
          contentIndex: Number.isInteger(messageEvent.contentIndex) ? messageEvent.contentIndex : 0,
          delta: typeof messageEvent.delta === 'string' ? messageEvent.delta : '',
        }
      }
      return null
    }

    case 'tool_execution_start':
      return {
        type: 'tool_start',
        conversationId,
        toolCallId: payload.toolCallId ?? '',
        toolName: payload.toolName ?? '',
        toolArgs:
          typeof payload.args === 'string' ? payload.args : JSON.stringify(payload.args ?? {}),
      }

    case 'tool_execution_update': {
      const partialResult = payload.partialResult
      if (!Array.isArray(partialResult?.content)) return null
      const textPart = partialResult.content.find(
        (item: any) => item?.type === 'text' && typeof item.text === 'string',
      )
      if (!textPart?.text) return null
      return {
        type: 'tool_update',
        conversationId,
        toolCallId: payload.toolCallId ?? undefined,
        toolName: payload.toolName ?? '',
        data: textPart.text,
        stream: partialResult?.details?.stream || 'stdout',
      }
    }

    case 'tool_execution_end':
      return {
        type: 'tool_end',
        conversationId,
        toolCallId: payload.toolCallId ?? '',
        toolName: payload.toolName ?? '',
        toolResult: collectToolResultText(payload.result),
        attachments: collectToolResultImages(payload.result),
      }

    default:
      return null
  }
}
