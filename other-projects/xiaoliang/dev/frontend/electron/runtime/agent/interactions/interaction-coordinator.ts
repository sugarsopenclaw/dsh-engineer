import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type {
  AgentInteractionKind,
  AgentInteractionResolution,
  AgentInteractionResolutionStatus,
  AgentInteractionResponseInput,
  AgentPendingInteraction,
  AgentUiEvent,
  ComponentReviewPayload,
  PlanApprovalPayload,
} from '../../../../src/shared/local-agent'
import {
  INTERACTION_CANCEL_ACTION,
  INTERACTION_CONFIRM_ACTION,
  INTERACTION_PLAN_ABANDON_ACTION,
  INTERACTION_PLAN_APPROVE_ACTION,
  INTERACTION_PLAN_REVISE_ACTION,
  INTERACTION_REVIEW_CONFIRM_ACTION,
  INTERACTION_REVIEW_REVISE_ACTION,
  INTERACTION_REVIEW_SKIP_ACTION,
  isPersistentInteractionKind,
} from '../../../../src/shared/local-agent'
import type { ToolConfirmationRequest } from '../policy/approval-gates'
import type { PersistentInteractionStore } from './pending-interaction-store'

export const A2UI_BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json'
export {
  INTERACTION_CANCEL_ACTION,
  INTERACTION_CONFIRM_ACTION,
  INTERACTION_PLAN_ABANDON_ACTION,
  INTERACTION_PLAN_APPROVE_ACTION,
  INTERACTION_PLAN_REVISE_ACTION,
  INTERACTION_REVIEW_CONFIRM_ACTION,
  INTERACTION_REVIEW_REVISE_ACTION,
  INTERACTION_REVIEW_SKIP_ACTION,
}

const DEFAULT_INTERACTION_TIMEOUT_MS = 15 * 60 * 1000
const PERSISTENT_EXPIRES_AT = '2099-01-01T00:00:00.000Z'

interface PendingInteractionRecord {
  interaction: AgentPendingInteraction
  responseToken: string
  allowedActions: ReadonlySet<string>
  persistence: 'ephemeral' | 'persistent'
  timer?: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  abortHandler?: () => void
  finish: (
    status: AgentInteractionResolutionStatus,
    actionId: string,
    data?: Record<string, unknown>,
  ) => AgentInteractionResolution | null
}

export interface ConfirmationWaitResult {
  approved: boolean
  reason: string
  resolution?: AgentInteractionResolution
}

export interface ConfirmationWaitInput {
  conversationId: string
  toolCallId: string
  toolName: string
  payloadHash: string
  request: ToolConfirmationRequest
  signal?: AbortSignal
}

export interface PersistentDecision {
  actionId: string
  status: AgentInteractionResolutionStatus
  data?: Record<string, unknown>
  resolution: AgentInteractionResolution
}

export interface PersistentInteractionInput {
  conversationId: string
  kind: 'plan_approval' | 'component_review'
  title: string
  description: string
  toolCallId?: string
  toolName?: string
  payload: PlanApprovalPayload | ComponentReviewPayload
  signal?: AbortSignal
}

export interface InteractionAuditSink {
  recordRequested: (interaction: AgentPendingInteraction) => void
  recordResolved: (resolution: AgentInteractionResolution) => void
}

function createA2UIConfirmationMessages(input: {
  interactionId: string
  surfaceId: string
  responseToken: string
  request: ToolConfirmationRequest
}): Array<Record<string, unknown>> {
  const detailComponentIds = input.request.details.map((_, index) => `detail-${index}`)
  const contentChildren = [
    'title',
    'description',
    ...detailComponentIds,
    'risk',
    'actions',
  ]

  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: input.surfaceId,
        catalogId: A2UI_BASIC_CATALOG_ID,
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: input.surfaceId,
        components: [
          {
            id: 'root',
            component: 'Column',
            children: contentChildren,
            justify: 'start',
            align: 'stretch',
          },
          { id: 'title', component: 'Text', text: input.request.title, variant: 'h3' },
          { id: 'description', component: 'Text', text: input.request.description, variant: 'body' },
          ...input.request.details.map((detail, index) => ({
            id: detailComponentIds[index],
            component: 'Text',
            text: `${detail.label}：${detail.value}`,
            variant: index === 0 ? 'body' : 'caption',
          })),
          {
            id: 'risk',
            component: 'Text',
            text: input.request.risk === 'high'
              ? '高风险操作：请确认目标与覆盖/删除范围。'
              : '确认后写入，取消则不保存。',
            variant: 'caption',
          },
          {
            id: 'actions',
            component: 'Row',
            children: ['cancel-button', 'confirm-button'],
            justify: 'end',
            align: 'center',
          },
          { id: 'cancel-label', component: 'Text', text: input.request.cancelLabel, variant: 'body' },
          {
            id: 'cancel-button',
            component: 'Button',
            child: 'cancel-label',
            variant: 'default',
            action: {
              event: {
                name: INTERACTION_CANCEL_ACTION,
                context: {
                  interactionId: input.interactionId,
                  responseToken: input.responseToken,
                },
              },
            },
          },
          { id: 'confirm-label', component: 'Text', text: input.request.confirmLabel, variant: 'body' },
          {
            id: 'confirm-button',
            component: 'Button',
            child: 'confirm-label',
            variant: 'primary',
            action: {
              event: {
                name: INTERACTION_CONFIRM_ACTION,
                context: {
                  interactionId: input.interactionId,
                  responseToken: input.responseToken,
                },
              },
            },
          },
        ],
      },
    },
  ]
}

function safeTokenEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer)
}

function requiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function allowedActionsFor(kind: AgentInteractionKind): string[] {
  if (kind === 'plan_approval') {
    return [
      INTERACTION_PLAN_APPROVE_ACTION,
      INTERACTION_PLAN_REVISE_ACTION,
      INTERACTION_PLAN_ABANDON_ACTION,
    ]
  }
  if (kind === 'component_review') {
    return [
      INTERACTION_REVIEW_CONFIRM_ACTION,
      INTERACTION_REVIEW_SKIP_ACTION,
      INTERACTION_REVIEW_REVISE_ACTION,
    ]
  }
  return [INTERACTION_CONFIRM_ACTION, INTERACTION_CANCEL_ACTION]
}

function statusForAction(actionId: string): AgentInteractionResolutionStatus {
  if (
    actionId === INTERACTION_CONFIRM_ACTION
    || actionId === INTERACTION_PLAN_APPROVE_ACTION
    || actionId === INTERACTION_REVIEW_CONFIRM_ACTION
  ) {
    return 'confirmed'
  }
  return 'cancelled'
}

export class InteractionCoordinator {
  private readonly pendingById = new Map<string, PendingInteractionRecord>()
  private readonly ephemeralByConversation = new Map<string, string>()
  private readonly persistentByConversation = new Map<string, string>()

  constructor(
    private readonly emit: (event: AgentUiEvent) => void,
    private readonly timeoutMs = DEFAULT_INTERACTION_TIMEOUT_MS,
    private readonly auditSink?: InteractionAuditSink,
    private readonly persistentStore?: PersistentInteractionStore,
  ) {}

  private emitSafely(event: AgentUiEvent) {
    try {
      this.emit(event)
    } catch (error) {
      console.warn(
        '[agent-interaction] failed to emit event',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private auditSafely(operation: 'requested' | 'resolved', value: AgentPendingInteraction | AgentInteractionResolution) {
    try {
      if (operation === 'requested') {
        this.auditSink?.recordRequested(value as AgentPendingInteraction)
      } else {
        this.auditSink?.recordResolved(value as AgentInteractionResolution)
      }
    } catch (error) {
      console.warn(
        `[agent-interaction] failed to persist ${operation} audit`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private persistSafely(record: PendingInteractionRecord) {
    if (record.persistence !== 'persistent') return
    try {
      this.persistentStore?.upsert({
        conversationId: record.interaction.conversationId,
        interaction: record.interaction,
        responseToken: record.responseToken,
        allowedActions: [...record.allowedActions],
      })
    } catch (error) {
      console.warn(
        '[agent-interaction] failed to persist live pending',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private unpersistSafely(conversationId: string) {
    try {
      this.persistentStore?.remove(conversationId)
    } catch (error) {
      console.warn(
        '[agent-interaction] failed to clear live pending',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private conversationSlot(persistence: 'ephemeral' | 'persistent') {
    return persistence === 'persistent'
      ? this.persistentByConversation
      : this.ephemeralByConversation
  }

  getPendingInteraction(conversationId: string): AgentPendingInteraction | null {
    const persistentId = this.persistentByConversation.get(conversationId)
    if (persistentId) {
      return this.pendingById.get(persistentId)?.interaction ?? null
    }
    const ephemeralId = this.ephemeralByConversation.get(conversationId)
    if (!ephemeralId) return null
    return this.pendingById.get(ephemeralId)?.interaction ?? null
  }

  async waitForConfirmation(input: ConfirmationWaitInput): Promise<ConfirmationWaitResult> {
    if (input.signal?.aborted) {
      return { approved: false, reason: '操作已停止，未执行写入。' }
    }
    if (this.ephemeralByConversation.has(input.conversationId)) {
      return { approved: false, reason: '当前对话已有一个待处理确认，请先完成或取消。' }
    }

    const createdAtMs = Date.now()
    const interactionId = `interaction-${randomUUID()}`
    const surfaceId = `approval-${randomUUID()}`
    const responseToken = randomBytes(24).toString('base64url')
    const interaction: AgentPendingInteraction = {
      id: interactionId,
      conversationId: input.conversationId,
      surfaceId,
      kind: 'confirmation',
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      payloadHash: input.payloadHash,
      title: input.request.title,
      description: input.request.description,
      risk: input.request.risk,
      details: input.request.details,
      a2uiMessages: createA2UIConfirmationMessages({
        interactionId,
        surfaceId,
        responseToken,
        request: input.request,
      }),
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + this.timeoutMs).toISOString(),
      persistence: 'ephemeral',
    }

    return new Promise<ConfirmationWaitResult>((resolve) => {
      const finish = this.createFinisher({
        interaction,
        responseToken,
        persistence: 'ephemeral',
        onSettled: (resolution) => {
          resolve({
            approved: resolution.status === 'confirmed',
            reason: resolution.status === 'confirmed'
              ? '用户已通过确认卡批准本次操作。'
              : resolution.status === 'expired'
                ? '确认已超时，本次操作未执行。'
                : resolution.status === 'aborted'
                  ? '操作已停止，本次写入未执行。'
                  : '用户已取消，本次操作未执行。',
            resolution,
          })
        },
      })

      const abortHandler = () => finish('aborted', 'system.abort')
      const timer = setTimeout(
        () => finish('expired', 'system.expire'),
        this.timeoutMs,
      )
      const record: PendingInteractionRecord = {
        interaction,
        responseToken,
        allowedActions: new Set(allowedActionsFor('confirmation')),
        persistence: 'ephemeral',
        timer,
        signal: input.signal,
        abortHandler,
        finish,
      }
      this.pendingById.set(interactionId, record)
      this.ephemeralByConversation.set(input.conversationId, interactionId)
      input.signal?.addEventListener('abort', abortHandler, { once: true })
      this.auditSafely('requested', interaction)

      if (input.signal?.aborted) {
        abortHandler()
        return
      }
      this.emitSafely({
        type: 'interaction_requested',
        conversationId: input.conversationId,
        interaction,
      })
    })
  }

  async waitForPersistentDecision(input: PersistentInteractionInput): Promise<PersistentDecision> {
    return new Promise<PersistentDecision>((resolve) => {
      this.parkPersistentInteraction(input, (resolution) => {
        resolve({
          actionId: resolution.actionId,
          status: resolution.status,
          data: resolution.data,
          resolution,
        })
      })
    })
  }

  parkPersistentInteraction(
    input: PersistentInteractionInput,
    onSettled?: (resolution: AgentInteractionResolution) => void,
  ): AgentPendingInteraction {
    const existingId = this.persistentByConversation.get(input.conversationId)
    if (existingId) {
      this.pendingById.get(existingId)?.finish('aborted', 'system.replace')
    }

    const createdAtMs = Date.now()
    const interactionId = `interaction-${randomUUID()}`
    const surfaceId = `${input.kind}-${randomUUID()}`
    const responseToken = randomBytes(24).toString('base64url')
    const interaction: AgentPendingInteraction = {
      id: interactionId,
      conversationId: input.conversationId,
      surfaceId,
      kind: input.kind,
      toolCallId: input.toolCallId || `runtime-${input.kind}`,
      toolName: input.toolName || input.kind,
      payloadHash: createPayloadHash(input.payload),
      title: input.title,
      description: input.description,
      risk: 'medium',
      details: [],
      a2uiMessages: [],
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: PERSISTENT_EXPIRES_AT,
      persistence: 'persistent',
      responseToken,
      payload: input.payload,
    }

    const finish = this.createFinisher({
      interaction,
      responseToken,
      persistence: 'persistent',
      onSettled,
    })
    const abortHandler = input.signal
      ? () => finish('aborted', 'system.abort')
      : undefined
    const record: PendingInteractionRecord = {
      interaction,
      responseToken,
      allowedActions: new Set(allowedActionsFor(input.kind)),
      persistence: 'persistent',
      signal: input.signal,
      abortHandler,
      finish,
    }
    this.pendingById.set(interactionId, record)
    this.persistentByConversation.set(input.conversationId, interactionId)
    if (input.signal && abortHandler) {
      input.signal.addEventListener('abort', abortHandler, { once: true })
    }
    this.persistSafely(record)
    this.auditSafely('requested', interaction)
    this.emitSafely({
      type: 'interaction_requested',
      conversationId: input.conversationId,
      interaction,
    })
    return interaction
  }

  restorePersistentInteractions() {
    const stored = this.persistentStore?.list() ?? []
    for (const item of stored) {
      if (this.persistentByConversation.has(item.conversationId)) continue
      if (!isPersistentInteractionKind(item.interaction.kind)) continue
      const finish = this.createFinisher({
        interaction: item.interaction,
        responseToken: item.responseToken,
        persistence: 'persistent',
      })
      const record: PendingInteractionRecord = {
        interaction: item.interaction,
        responseToken: item.responseToken,
        allowedActions: new Set(item.allowedActions),
        persistence: 'persistent',
        finish,
      }
      this.pendingById.set(item.interaction.id, record)
      this.persistentByConversation.set(item.conversationId, item.interaction.id)
      this.emitSafely({
        type: 'interaction_requested',
        conversationId: item.conversationId,
        interaction: item.interaction,
      })
    }
  }

  resolveInteraction(input: AgentInteractionResponseInput): AgentInteractionResolution {
    if (!input || typeof input !== 'object') {
      throw new Error('确认响应参数不完整。')
    }
    const conversationId = requiredString(input.conversationId)
    const interactionId = requiredString(input.interactionId)
    const actionId = requiredString(input.actionId)
    const responseToken = requiredString(input.responseToken)
    if (!conversationId || !interactionId || !actionId || !responseToken) {
      throw new Error('确认响应参数不完整。')
    }

    const record = this.pendingById.get(interactionId)
    if (!record || record.interaction.conversationId !== conversationId) {
      throw new Error('确认卡已失效或不属于当前对话。')
    }
    if (!record.allowedActions.has(actionId)) {
      throw new Error('该确认卡不支持此操作。')
    }
    if (!safeTokenEqual(responseToken, record.responseToken)) {
      throw new Error('确认卡响应令牌无效。')
    }

    const status = statusForAction(actionId)
    const resolution = record.finish(status, actionId, input.data)
    if (!resolution) throw new Error('确认卡已失效。')
    return resolution
  }

  cancelConversation(conversationId: string) {
    const interactionId = this.ephemeralByConversation.get(conversationId)
    const record = interactionId ? this.pendingById.get(interactionId) : null
    record?.finish('aborted', 'system.abort')
  }

  dispose() {
    for (const record of [...this.pendingById.values()]) {
      if (record.persistence === 'persistent') continue
      record.finish('aborted', 'system.dispose')
    }
  }

  private createFinisher(input: {
    interaction: AgentPendingInteraction
    responseToken: string
    persistence: 'ephemeral' | 'persistent'
    onSettled?: (resolution: AgentInteractionResolution) => void
  }) {
    let settled = false
    return (
      status: AgentInteractionResolutionStatus,
      actionId: string,
      data?: Record<string, unknown>,
    ) => {
      if (settled) return null
      settled = true
      const record = this.pendingById.get(input.interaction.id)
      if (record) {
        if (record.timer) clearTimeout(record.timer)
        if (record.signal && record.abortHandler) {
          record.signal.removeEventListener('abort', record.abortHandler)
        }
      }
      this.pendingById.delete(input.interaction.id)
      const slot = this.conversationSlot(input.persistence)
      if (slot.get(input.interaction.conversationId) === input.interaction.id) {
        slot.delete(input.interaction.conversationId)
      }
      if (input.persistence === 'persistent') {
        // Every terminal outcome removes the row. In particular, a live Plan
        // approval aborted with its tool call must not resurrect on restart.
        this.unpersistSafely(input.interaction.conversationId)
      }

      const resolution: AgentInteractionResolution = {
        interactionId: input.interaction.id,
        conversationId: input.interaction.conversationId,
        toolCallId: input.interaction.toolCallId,
        toolName: input.interaction.toolName,
        payloadHash: input.interaction.payloadHash,
        actionId,
        status,
        resolvedAt: new Date().toISOString(),
        kind: input.interaction.kind,
        data,
      }
      this.auditSafely('resolved', resolution)
      console.info('[agent-interaction] resolved', resolution)
      this.emitSafely({
        type: 'interaction_resolved',
        conversationId: input.interaction.conversationId,
        resolution,
      })
      input.onSettled?.(resolution)
      return resolution
    }
  }
}

function createPayloadHash(payload: PlanApprovalPayload | ComponentReviewPayload): string {
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
}
