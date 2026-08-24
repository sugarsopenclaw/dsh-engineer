import type {
  BillingOrderStatusView,
  WeChatNativeOrderView,
} from '@/shared/backend-api'

const TERMINAL_ORDER_STATUSES = new Set(['paid', 'closed', 'failed', 'expired'])

function normalizedStatus(status: string | null | undefined): string {
  return String(status || '')
    .trim()
    .toLowerCase()
}

export function isTerminalWeChatOrderStatus(status: string | null | undefined): boolean {
  return TERMINAL_ORDER_STATUSES.has(normalizedStatus(status))
}

export function statusForWeChatOrder(
  order: WeChatNativeOrderView,
  status: BillingOrderStatusView | null,
): string {
  return status?.order_id === order.order_id ? status.status : order.status
}

export function isWeChatOrderExpired(
  order: Pick<WeChatNativeOrderView, 'expires_at'>,
  nowMs = Date.now(),
): boolean {
  const expiresAtMs = Date.parse(order.expires_at)
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs
}

export function isWeChatOrderPayable(
  order: WeChatNativeOrderView,
  status: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  return !isTerminalWeChatOrderStatus(status) && !isWeChatOrderExpired(order, nowMs)
}

/**
 * Preserve a terminal result when overlapping sync calls finish out of order,
 * and never attach a response for one order to another order's dialog.
 */
export function mergeWeChatOrderStatus(
  current: BillingOrderStatusView | null,
  incoming: BillingOrderStatusView,
  expectedOrderId: string,
): BillingOrderStatusView | null {
  if (incoming.order_id !== expectedOrderId) return current
  if (!current || current.order_id !== expectedOrderId) return incoming

  const currentStatus = normalizedStatus(current.status)
  const incomingStatus = normalizedStatus(incoming.status)
  if (incomingStatus === 'paid') return incoming
  if (currentStatus === 'paid') return current
  if (isTerminalWeChatOrderStatus(currentStatus)) return current
  return incoming
}

export interface CheckoutOrderToken {
  generation: number
  orderId: string
}

/**
 * Synchronous guard for side effects that React state alone cannot protect
 * against (for example, two clicks before the disabled state is rendered).
 */
export class WeChatCheckoutRequestGuard {
  private generation = 0
  private creating = false
  private activeOrderId: string | null = null

  beginCreate(replaceActiveOrder = false): number | null {
    if (this.creating || (this.activeOrderId && !replaceActiveOrder)) return null
    this.creating = true
    this.activeOrderId = null
    this.generation += 1
    return this.generation
  }

  acceptCreated(generation: number, orderId: string): boolean {
    if (!orderId || !this.creating || generation !== this.generation) return false
    this.activeOrderId = orderId
    return true
  }

  isCreateCurrent(generation: number): boolean {
    return this.creating && generation === this.generation
  }

  finishCreate(generation: number): boolean {
    if (generation !== this.generation) return false
    this.creating = false
    return true
  }

  tokenFor(orderId: string): CheckoutOrderToken | null {
    if (!orderId || orderId !== this.activeOrderId) return null
    return { generation: this.generation, orderId }
  }

  isCurrent(token: CheckoutOrderToken, responseOrderId = token.orderId): boolean {
    return (
      token.generation === this.generation &&
      token.orderId === this.activeOrderId &&
      responseOrderId === token.orderId
    )
  }

  invalidate(): void {
    this.generation += 1
    this.creating = false
    this.activeOrderId = null
  }
}
