import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatAmountYuan } from '@/shared/billing-domain'
import { isTerminalWeChatOrderStatus } from '@/features/billing/wechat-checkout-state'

export function formatPayStatus(status: string | null | undefined, paid: boolean): string {
  if (paid || status === 'paid') return '已到账'
  if (status === 'closed') return '已关闭'
  if (status === 'failed') return '失败'
  if (status === 'expired') return '已过期'
  if (!status || status === 'pending' || status === 'notpay') return '待支付'
  return status
}

export interface WeChatPayDialogProps {
  open: boolean
  onClose: () => void
  productName: string
  amountFen: number
  outTradeNo: string
  status: string | null
  paid: boolean
  qrDataUrl: string
  creating: boolean
  syncing: boolean
  paymentError: string
  onSync: () => void
}

export function WeChatPayDialog({
  open,
  onClose,
  productName,
  amountFen,
  outTradeNo,
  status,
  paid,
  qrDataUrl,
  creating,
  syncing,
  paymentError,
  onSync,
}: WeChatPayDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const statusLabel = formatPayStatus(status, paid)
  const amountLabel = amountFen > 0 ? formatAmountYuan(amountFen) : '—'
  const description = [productName, amountLabel].filter(Boolean).join(' · ')
  const terminal = paid || isTerminalWeChatOrderStatus(status)

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    dialogRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  const qrHint = creating
    ? '创建订单…'
    : qrDataUrl
      ? ''
      : paymentError
        ? '未能生成二维码'
        : '生成二维码中…'
  const statusHint = paid
    ? '支付成功，额度已到账'
    : status === 'expired'
      ? '二维码已过期，请关闭后重新下单。'
      : status === 'closed'
        ? '订单已关闭，请关闭后重新下单。'
        : status === 'failed'
          ? '支付失败，请关闭后重试。'
          : creating
            ? '订单创建中；暂时收起后仍会继续处理。'
            : outTradeNo
              ? '支付后将自动刷新额度；暂时收起后仍会继续确认。'
              : paymentError
                ? '订单未创建成功，请关闭后重试。'
                : '正在准备订单…'

  const dialog = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/32 px-3 py-3 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === overlayRef.current) onClose()
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="flex max-h-[calc(100vh-1.5rem)] w-[min(calc(100vw-1.5rem),22rem)] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_28px_100px_rgba(15,23,42,0.28)] outline-none"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200/80 px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-slate-900">
              微信扫码支付
            </h2>
            <p id={descriptionId} className="mt-0.5 truncate text-xs text-slate-500">
              {description || '正在准备订单'}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            aria-label="关闭支付弹窗"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="grid justify-items-center gap-3">
            <div
              className={cn(
                'grid size-[min(12rem,42vmin)] place-items-center rounded-lg border border-slate-100 bg-white',
                terminal && 'opacity-45',
              )}
            >
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="微信支付二维码"
                  draggable={false}
                  className="size-[calc(100%-0.75rem)] rounded-md"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 px-3 text-center text-xs text-slate-400">
                  {creating || !paymentError ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <CircleAlert className="h-5 w-5 text-rose-500" aria-hidden="true" />
                  )}
                  <span>{qrHint}</span>
                </div>
              )}
            </div>

            <div className="w-full min-w-0 space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-xs">
              <PayRow label="金额" value={amountLabel} />
              <PayRow label="状态" value={statusLabel} />
              <PayRow label="订单号" value={outTradeNo || '—'} />
            </div>

            {paid ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-700" role="status">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {statusHint}
              </p>
            ) : (
              <p className="text-center text-xs text-slate-500" role="status">
                {statusHint}
              </p>
            )}

            {paymentError ? (
              <p className="flex w-full min-w-0 items-start gap-1.5 text-xs text-rose-600" role="alert">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-all">{paymentError}</span>
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200/80 px-4 py-3">
          <Button
            type="button"
            className="w-full min-w-0 whitespace-normal"
            disabled={!outTradeNo || terminal || syncing || creating}
            onClick={onSync}
          >
            {syncing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            我已支付，刷新状态
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={onClose}>
            {paid
              ? '完成'
              : terminal || (!creating && !outTradeNo && paymentError)
                ? '关闭'
                : '暂时收起'}
          </Button>
        </footer>
      </section>
    </div>
  )

  if (typeof document === 'undefined') return dialog
  return createPortal(dialog, document.body)
}

function PayRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 break-all text-right font-medium text-slate-800">{value}</span>
    </div>
  )
}
