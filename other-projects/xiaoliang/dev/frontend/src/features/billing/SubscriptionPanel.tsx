import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Crown, Loader2, RefreshCw, Rocket, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'
import {
  creditsRemaining,
  formatAmountYuan,
  formatCredits,
  formatUnitPrice,
  formatValidityDays,
  isLowBalance,
  planTierLabel,
} from '@/shared/billing-domain'
import type {
  BillingOrderStatusView,
  BillingProductView,
  QuotaSummaryData,
  WeChatNativeOrderView,
} from '@/shared/backend-api'
import { useAuthStore } from '@/stores/auth-store'
import { useBillingStore } from '@/stores/billing-store'
import { cn } from '@/lib/utils'
import { WeChatPayDialog } from '@/features/billing/WeChatPayDialog'
import {
  type CheckoutOrderToken,
  isTerminalWeChatOrderStatus,
  isWeChatOrderExpired,
  mergeWeChatOrderStatus,
  statusForWeChatOrder,
  WeChatCheckoutRequestGuard,
} from '@/features/billing/wechat-checkout-state'

const FALLBACK_PRODUCTS: BillingProductView[] = [
  {
    id: 'credits_starter',
    plan_tier: 'starter',
    name: '入门版',
    description: '晓量算力包 12,375 Credits（12 个月）',
    amount_fen: 9900,
    credits: 12_375,
    duration_days: 365,
    unit_price_rmb: 0.008,
    discount_percent: 0,
  },
  {
    id: 'credits_standard',
    plan_tier: 'standard',
    name: '标准版',
    description: '晓量算力包 63,750 Credits（12 个月）',
    amount_fen: 49900,
    credits: 63_750,
    duration_days: 365,
    unit_price_rmb: 0.007827,
    discount_percent: 2,
  },
  {
    id: 'credits_professional',
    plan_tier: 'professional',
    name: '专业版',
    description: '晓量算力包 132,000 Credits（12 个月）',
    amount_fen: 99900,
    credits: 132_000,
    duration_days: 365,
    unit_price_rmb: 0.007568,
    discount_percent: 5,
  },
]

const TIER_ICONS: Record<string, LucideIcon> = {
  starter: Zap,
  standard: Rocket,
  professional: Crown,
}

export function SubscriptionPanel({
  onQuotaChange,
}: {
  onQuotaChange?: (quota: QuotaSummaryData | null) => void
}) {
  const quota = useBillingStore((s) => s.quota)
  const setQuota = useBillingStore((s) => s.setQuota)
  const quotaExceededMessage = useBillingStore((s) => s.quotaExceededMessage)
  const sessionQuota = useAuthStore((s) => s.session?.quota ?? null)
  const displayedQuota = quota ?? sessionQuota

  const [products, setProducts] = useState<BillingProductView[]>(FALLBACK_PRODUCTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creatingId, setCreatingId] = useState<string | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [payingProduct, setPayingProduct] = useState<BillingProductView | null>(null)
  const [activeOrder, setActiveOrder] = useState<WeChatNativeOrderView | null>(null)
  const [orderStatus, setOrderStatus] = useState<BillingOrderStatusView | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [paymentError, setPaymentError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [expiredOrderId, setExpiredOrderId] = useState<string | null>(null)
  const checkoutGuardRef = useRef<WeChatCheckoutRequestGuard | null>(null)
  const manualSyncingRef = useRef(false)
  const manualSyncRequestRef = useRef(0)
  if (!checkoutGuardRef.current) {
    checkoutGuardRef.current = new WeChatCheckoutRequestGuard()
  }
  const checkoutGuard = checkoutGuardRef.current

  const loadProducts = useCallback(async () => {
    if (!isElectronApp()) {
      setProducts(FALLBACK_PRODUCTS)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const next = await electronBridge.getBillingProducts()
      setProducts(next.length > 0 ? next : FALLBACK_PRODUCTS)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProducts(FALLBACK_PRODUCTS)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshQuota = useCallback(async () => {
    if (!isElectronApp()) return null
    try {
      const next = await electronBridge.getBillingQuota()
      if (next) {
        setQuota(next)
        onQuotaChange?.(next)
      }
      return next
    } catch {
      return null
    }
  }, [onQuotaChange, setQuota])

  useEffect(() => {
    void loadProducts()
    void refreshQuota()
  }, [loadProducts, refreshQuota])

  useEffect(() => {
    return () => {
      checkoutGuard.invalidate()
      manualSyncRequestRef.current += 1
      manualSyncingRef.current = false
    }
  }, [checkoutGuard])

  useEffect(() => {
    if (!activeOrder?.code_url) {
      setQrDataUrl('')
      return
    }
    let cancelled = false
    void QRCode.toDataURL(activeOrder.code_url, { width: 220, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch((err) => {
        if (!cancelled) {
          setQrDataUrl('')
          setPaymentError(err instanceof Error ? err.message : '二维码生成失败，请稍后重试。')
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeOrder?.code_url, activeOrder?.order_id])

  const activeOrderStatus = activeOrder ? statusForWeChatOrder(activeOrder, orderStatus) : null
  const isLocallyExpired = Boolean(
    activeOrder &&
      expiredOrderId === activeOrder.order_id &&
      !isTerminalWeChatOrderStatus(activeOrderStatus),
  )
  const displayedOrderStatus = isLocallyExpired ? 'expired' : activeOrderStatus

  const synchronizeOrder = useCallback(
    async (token: CheckoutOrderToken, reportErrors: boolean) => {
      try {
        const status = await electronBridge.syncBillingOrder(token.orderId)
        if (!checkoutGuard.isCurrent(token, status.order_id)) return null

        setOrderStatus((current) => mergeWeChatOrderStatus(current, status, token.orderId))
        if (status.quota && (status.status === 'paid' || reportErrors)) {
          setQuota(status.quota)
          onQuotaChange?.(status.quota)
        }
        if (status.status === 'paid') {
          setPaymentError('')
        } else if (reportErrors) {
          setPaymentError('')
        }
        return status
      } catch (err) {
        if (reportErrors && checkoutGuard.isCurrent(token)) {
          setPaymentError(err instanceof Error ? err.message : String(err))
        }
        return null
      }
    },
    [checkoutGuard, onQuotaChange, setQuota],
  )

  useEffect(() => {
    if (
      !activeOrder ||
      isLocallyExpired ||
      isTerminalWeChatOrderStatus(activeOrderStatus)
    ) {
      return
    }

    const orderId = activeOrder.order_id
    const token = checkoutGuard.tokenFor(orderId)
    if (!token) return

    const pollMs = Math.max(2, activeOrder.poll_after_seconds || 2) * 1000
    const expiresAtMs = Date.parse(activeOrder.expires_at)
    let stopped = false
    let markedExpired = false
    let pollTimer: number | undefined
    let expiryTimer: number | undefined

    const markExpired = (needsFinalSync: boolean) => {
      if (stopped || markedExpired || !checkoutGuard.isCurrent(token)) return
      markedExpired = true
      void (async () => {
        if (needsFinalSync) await synchronizeOrder(token, false)
        if (!stopped && checkoutGuard.isCurrent(token)) setExpiredOrderId(orderId)
      })()
    }

    const pollOnce = async () => {
      if (stopped || !checkoutGuard.isCurrent(token)) return
      if (isWeChatOrderExpired(activeOrder)) {
        markExpired(true)
        return
      }

      await synchronizeOrder(token, false)
      if (stopped || !checkoutGuard.isCurrent(token)) return
      if (isWeChatOrderExpired(activeOrder)) {
        // This request already queried the final payable state.
        markExpired(false)
        return
      }
      pollTimer = window.setTimeout(() => void pollOnce(), pollMs)
    }

    const remainingMs = Number.isFinite(expiresAtMs) ? expiresAtMs - Date.now() : null
    if (remainingMs !== null && remainingMs <= 0) {
      expiryTimer = window.setTimeout(() => markExpired(true), 0)
    } else {
      pollTimer = window.setTimeout(
        () => void pollOnce(),
        remainingMs === null ? pollMs : Math.min(pollMs, remainingMs),
      )
      if (remainingMs !== null) {
        expiryTimer = window.setTimeout(() => markExpired(true), remainingMs)
      }
    }

    return () => {
      stopped = true
      if (pollTimer !== undefined) window.clearTimeout(pollTimer)
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer)
    }
  }, [
    activeOrder,
    activeOrderStatus,
    checkoutGuard,
    isLocallyExpired,
    synchronizeOrder,
  ])

  const lowBalance = isLowBalance(displayedQuota)
  const expiresAt = displayedQuota?.credits_expiring_at ?? displayedQuota?.quota_period_ends_at
  const expiryLabel = expiresAt ? new Date(expiresAt).toLocaleDateString('zh-CN') : ''

  const pendingCheckout = Boolean(
    activeOrder &&
      !isLocallyExpired &&
      !isTerminalWeChatOrderStatus(activeOrderStatus),
  )
  const activeOrderProduct = activeOrder
    ? products.find((product) => product.id === activeOrder.product_id) ||
      (payingProduct?.id === activeOrder.product_id ? payingProduct : null)
    : null

  const handlePaymentClose = useCallback(() => {
    setPaymentOpen(false)
  }, [])

  async function handleBuy(product: BillingProductView) {
    if (
      activeOrder &&
      !isLocallyExpired &&
      !isTerminalWeChatOrderStatus(activeOrderStatus)
    ) {
      if (activeOrderProduct) setPayingProduct(activeOrderProduct)
      setPaymentOpen(true)
      return
    }

    if (!isElectronApp()) {
      setPayingProduct(product)
      setPaymentOpen(true)
      setPaymentError('请在桌面客户端中购买。')
      return
    }

    const createGeneration = checkoutGuard.beginCreate(activeOrder !== null)
    if (createGeneration === null) {
      setPaymentOpen(true)
      return
    }

    manualSyncRequestRef.current += 1
    manualSyncingRef.current = false
    setSyncing(false)
    setPayingProduct(product)
    setPaymentOpen(true)
    setCreatingId(product.id)
    setPaymentError('')
    setExpiredOrderId(null)
    setActiveOrder(null)
    setOrderStatus(null)

    try {
      const order = await electronBridge.createBillingWeChatOrder(product.id)
      if (!checkoutGuard.acceptCreated(createGeneration, order.order_id)) return
      setActiveOrder(order)
      setOrderStatus(null)
      if (!order.code_url) {
        setPaymentError('订单已创建，但未返回支付二维码，请稍后重试。')
      }
    } catch (err) {
      if (checkoutGuard.isCreateCurrent(createGeneration)) {
        setPaymentError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (checkoutGuard.finishCreate(createGeneration)) setCreatingId(null)
    }
  }

  async function handleSync() {
    if (!activeOrder || manualSyncingRef.current) return
    const token = checkoutGuard.tokenFor(activeOrder.order_id)
    if (!token) return

    manualSyncingRef.current = true
    const requestId = manualSyncRequestRef.current + 1
    manualSyncRequestRef.current = requestId
    setSyncing(true)
    setPaymentError('')
    try {
      await synchronizeOrder(token, true)
    } finally {
      if (manualSyncRequestRef.current === requestId) {
        manualSyncingRef.current = false
        if (checkoutGuard.isCurrent(token)) setSyncing(false)
      }
    }
  }

  return (
    <section className="min-w-0 overflow-x-hidden rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">算力与额度</h2>
          {displayedQuota ? (
            <>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span
                  className={cn(
                    'text-2xl font-semibold tabular-nums',
                    isLowBalance(displayedQuota) ? 'text-amber-600' : 'text-slate-900',
                  )}
                >
                  {formatCredits(creditsRemaining(displayedQuota))}
                </span>
                <span className="text-xs text-slate-500">Credits 可用</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {planTierLabel(displayedQuota.plan_tier)}
                {expiryLabel ? ` · ${expiryLabel}到期` : ''}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-500">— Credits</p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void loadProducts()
            void refreshQuota()
          }}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {quotaExceededMessage ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {quotaExceededMessage}
        </p>
      ) : null}

      {lowBalance && !quotaExceededMessage ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          算力余额偏低，长任务可能中途中断，建议先补充算力包。
        </p>
      ) : null}

      {error ? <p className="mt-3 break-all text-xs text-rose-600">{error}</p> : null}

      <div className="settings-plan-grid mt-4">
        {products.map((product) => {
          const Icon = TIER_ICONS[product.plan_tier] ?? Zap
          return (
            <div
              key={product.id}
              className="relative flex min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-50/80 p-3"
            >
              {product.discount_percent > 0 ? (
                <span className="absolute -top-2 right-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white">
                  省 {product.discount_percent}%
                </span>
              ) : null}
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-slate-700" />
                <p className="text-sm font-semibold text-slate-900">{product.name}</p>
              </div>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {formatAmountYuan(product.amount_fen)}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-700">
                {formatCredits(product.credits)} Credits
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatUnitPrice(product.amount_fen, product.credits)}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {formatValidityDays(product.duration_days)}
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full min-w-0 whitespace-normal"
                disabled={
                  creatingId !== null ||
                  (pendingCheckout && activeOrder?.product_id !== product.id)
                }
                onClick={() => void handleBuy(product)}
              >
                {creatingId === product.id ? (
                  <>
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    创建订单…
                  </>
                ) : pendingCheckout && activeOrder?.product_id === product.id ? (
                  '继续支付当前订单'
                ) : (
                  '微信扫码购买'
                )}
              </Button>
            </div>
          )
        })}
      </div>

      {pendingCheckout ? (
        <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800" role="status">
          当前{activeOrderProduct?.name ? `「${activeOrderProduct.name}」` : ''}订单仍待支付；
          收起二维码后仍会自动确认，订单结束前不会重复建单。
        </p>
      ) : null}

      <p className="mt-3 text-xs text-slate-400">
        按实际消耗的模型 Token 计费，购买越多单价越低。Credits 自购买日起 12 个月内有效。
      </p>

      <WeChatPayDialog
        open={paymentOpen}
        onClose={handlePaymentClose}
        productName={(activeOrderProduct || payingProduct)?.name || ''}
        amountFen={activeOrder?.amount_fen ?? payingProduct?.amount_fen ?? 0}
        outTradeNo={activeOrder?.out_trade_no || ''}
        status={displayedOrderStatus}
        paid={displayedOrderStatus === 'paid'}
        qrDataUrl={qrDataUrl}
        creating={creatingId !== null}
        syncing={syncing}
        paymentError={paymentError}
        onSync={() => void handleSync()}
      />
    </section>
  )
}
