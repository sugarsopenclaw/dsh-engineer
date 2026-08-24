// Structural minimal shape: anything with these fields qualifies, so both the
// backend QuotaSummaryData and plain test fixtures assign without a cast.
export interface CreditBalanceQuota {
  credits_remaining?: number | null
  credits_total?: number | null
  plan_tier?: string | null
}

export interface CreditBalanceMonitorOptions<TQuota extends CreditBalanceQuota = CreditBalanceQuota> {
  /** Reads the authoritative quota from the backend. */
  readQuota: () => Promise<TQuota | null>
  /** Pushes a fresh quota to the renderer. */
  publish: (quota: TQuota) => void
  /** Minimum spacing between backend reads. Defaults to 2s. */
  minIntervalMs?: number
  /** Injectable clock for tests. */
  now?: () => number
  /** Injectable scheduler for tests. */
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

/**
 * Turns "a managed model call just settled (and was charged)" signals into a
 * coalesced stream of authoritative balance pushes. Per-call billing means the
 * balance moves during a run; this monitor confirms the real number after each
 * charge without firing one backend request per model call.
 */
export class CreditBalanceMonitor<TQuota extends CreditBalanceQuota = CreditBalanceQuota> {
  private readonly readQuota: () => Promise<TQuota | null>
  private readonly publish: (quota: TQuota) => void
  private readonly minIntervalMs: number
  private readonly now: () => number
  private readonly setTimeoutFn: typeof setTimeout
  private readonly clearTimeoutFn: typeof clearTimeout

  private inFlight = false
  private pending = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastReadAt = 0
  private lastPublishedKey: string | null = null
  private disposed = false

  constructor(options: CreditBalanceMonitorOptions<TQuota>) {
    this.readQuota = options.readQuota
    this.publish = options.publish
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 2_000)
    this.now = options.now ?? Date.now
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  }

  notifySpend(): void {
    if (this.disposed) return
    if (this.inFlight) {
      this.pending = true
      return
    }
    // lastReadAt starts at 0: the very first charge must read immediately.
    const waitMs = this.lastReadAt === 0
      ? 0
      : this.minIntervalMs - (this.now() - this.lastReadAt)
    if (waitMs <= 0) {
      void this.refresh()
      return
    }
    if (!this.timer) {
      this.timer = this.setTimeoutFn(() => {
        this.timer = null
        void this.refresh()
      }, waitMs)
    }
  }

  dispose(): void {
    this.disposed = true
    this.pending = false
    if (this.timer) {
      this.clearTimeoutFn(this.timer)
      this.timer = null
    }
  }

  private async refresh(): Promise<void> {
    if (this.disposed || this.inFlight) return
    this.inFlight = true
    this.lastReadAt = this.now()
    try {
      const quota = await this.readQuota()
      if (quota && !this.disposed) {
        const key = quotaKey(quota)
        if (key !== this.lastPublishedKey) {
          this.lastPublishedKey = key
          this.publish(quota)
        }
      }
    } catch {
      // A stale badge is better than surfacing a balance-refresh failure.
    } finally {
      this.inFlight = false
    }
    if (this.pending && !this.disposed) {
      this.pending = false
      this.notifySpend()
    }
  }
}

function quotaKey(quota: CreditBalanceQuota): string {
  return [
    quota.credits_remaining ?? '',
    quota.credits_total ?? '',
    quota.plan_tier ?? '',
  ].join('|')
}
