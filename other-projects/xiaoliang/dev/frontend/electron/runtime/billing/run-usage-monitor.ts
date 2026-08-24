import type { AgentUsageRunDetailView } from '../../../src/shared/backend-api'
import type { ConversationUsageChangedPayload } from '../../../src/shared/billing-domain'

export interface RunUsageMonitorOptions {
  /** 拉取后端权威 run 用量；失败或不可用返回 null（保留已有数字）。 */
  readUsage: (clientRunId: string) => Promise<AgentUsageRunDetailView | null>
  /** 落库并返回「该 run + 会话累计」载荷；无法落库返回 null。 */
  persist: (
    conversationId: string,
    detail: AgentUsageRunDetailView,
  ) => ConversationUsageChangedPayload | null
  publish: (payload: ConversationUsageChangedPayload) => void
  /** 同一 run 两次拉取的最小间隔（默认 2s），run 结束的 final 拉取不受限。 */
  minIntervalMs?: number
  now?: () => number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

interface RunState {
  conversationId: string
  inFlight: boolean
  queued: boolean
  queuedFinal: boolean
  timer: ReturnType<typeof setTimeout> | null
  lastReadAt: number
  lastPublishedKey: string | null
  disposed: boolean
}

function payloadFingerprint(payload: ConversationUsageChangedPayload): string {
  return JSON.stringify(payload, (key, value) => (key === 'updatedAt' ? undefined : value))
}

/**
 * 把「每次托管调用结算」转成对 getRunUsage 的去抖拉取。
 * 与 CreditBalanceMonitor 同模式：单飞 + 最小间隔 + 尾部补刷，
 * 但按 clientRunId 分键，多个会话并发运行时互不阻塞。
 */
export class RunUsageMonitor {
  private readonly readUsage: RunUsageMonitorOptions['readUsage']
  private readonly persist: RunUsageMonitorOptions['persist']
  private readonly publish: RunUsageMonitorOptions['publish']
  private readonly minIntervalMs: number
  private readonly now: () => number
  private readonly setTimeoutFn: typeof setTimeout
  private readonly clearTimeoutFn: typeof clearTimeout
  private readonly runs = new Map<string, RunState>()

  constructor(options: RunUsageMonitorOptions) {
    this.readUsage = options.readUsage
    this.persist = options.persist
    this.publish = options.publish
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 2_000)
    this.now = options.now ?? (() => Date.now())
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  }

  /** 托管调用结算后调用：去抖拉取该 run 的权威用量。 */
  notifySettled(conversationId: string, clientRunId: string): void {
    this.request(conversationId, clientRunId, false)
  }

  /** run 结束（finishRun 之后）调用：立即拉一次最终值，不受最小间隔限制。 */
  flushFinal(conversationId: string, clientRunId: string): void {
    this.request(conversationId, clientRunId, true)
  }

  dispose(): void {
    for (const state of this.runs.values()) {
      state.disposed = true
      if (state.timer) this.clearTimeoutFn(state.timer)
      state.timer = null
    }
    this.runs.clear()
  }

  private request(conversationId: string, clientRunId: string, final: boolean): void {
    const normalizedRunId = clientRunId.trim()
    const normalizedConversationId = conversationId.trim()
    if (!normalizedRunId || !normalizedConversationId) return

    let state = this.runs.get(normalizedRunId)
    if (!state) {
      state = {
        conversationId: normalizedConversationId,
        inFlight: false,
        queued: false,
        queuedFinal: false,
        timer: null,
        // -∞ 保证首次结算立即拉取，最小间隔只约束后续节奏。
        lastReadAt: Number.NEGATIVE_INFINITY,
        lastPublishedKey: null,
        disposed: false,
      }
      this.runs.set(normalizedRunId, state)
    }
    state.conversationId = normalizedConversationId
    if (state.disposed) return

    if (state.inFlight) {
      // 单飞期间到达的请求合并为一次尾部补刷。
      state.queued = true
      state.queuedFinal = state.queuedFinal || final
      return
    }

    const elapsed = this.now() - state.lastReadAt
    const waitMs = final ? 0 : Math.max(0, this.minIntervalMs - elapsed)
    if (waitMs > 0) {
      state.queuedFinal = state.queuedFinal || final
      if (!state.timer) {
        state.timer = this.setTimeoutFn(() => {
          if (!state) return
          state.timer = null
          const scheduledFinal = state.queuedFinal
          state.queuedFinal = false
          void this.execute(normalizedRunId, state, scheduledFinal)
        }, waitMs)
      }
      return
    }

    void this.execute(normalizedRunId, state, final)
  }

  private async execute(runId: string, state: RunState, final: boolean): Promise<void> {
    if (state.inFlight || state.disposed) return
    state.inFlight = true
    state.queued = false
    state.queuedFinal = false
    state.lastReadAt = this.now()
    try {
      const detail = await this.readUsage(runId)
      if (detail && !state.disposed) {
        const payload = this.persist(state.conversationId, detail)
        if (payload) {
          const key = payloadFingerprint(payload)
          if (key !== state.lastPublishedKey) {
            state.lastPublishedKey = key
            this.publish(payload)
          }
        }
      }
    } catch {
      // 拉取失败保留已有数字，下一轮结算会再试。
    } finally {
      state.inFlight = false
      if (state.queued && !state.disposed) {
        const queuedFinal = state.queuedFinal
        state.queued = false
        state.queuedFinal = false
        this.request(state.conversationId, runId, queuedFinal)
        return
      }
      if (final) {
        // run 已结束：最终值已落库，释放该 run 的监控状态。
        if (state.timer) this.clearTimeoutFn(state.timer)
        state.timer = null
        this.runs.delete(runId)
      }
    }
  }
}
