import { useMemo, useState } from 'react'
import { AlertTriangle, CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  AgentInteractionResponseInput,
  AgentPendingInteraction,
  ComponentReviewPayload,
} from '@/shared/local-agent'
import {
  INTERACTION_REVIEW_CONFIRM_ACTION,
  INTERACTION_REVIEW_REVISE_ACTION,
  INTERACTION_REVIEW_SKIP_ACTION,
} from '@/shared/local-agent'

interface ComponentReviewOverlayProps {
  interaction: AgentPendingInteraction
  submitting: boolean
  error: string | null
  onRespond: (response: Omit<AgentInteractionResponseInput, 'conversationId'>) => void | Promise<void>
}

function isReviewPayload(value: unknown): value is ComponentReviewPayload {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as ComponentReviewPayload).items))
}

export function ComponentReviewOverlay({
  interaction,
  submitting,
  error,
  onRespond,
}: ComponentReviewOverlayProps) {
  const payload = isReviewPayload(interaction.payload) ? interaction.payload : null
  const items = payload?.items ?? []
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.map((item) => item.componentId)),
  )
  const [feedback, setFeedback] = useState('')
  const token = interaction.responseToken || ''
  const overwriteCount = useMemo(
    () => items.filter((item) => item.wouldOverwriteConfirmed && selected.has(item.componentId)).length,
    [items, selected],
  )

  function toggle(componentId: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(componentId)) next.delete(componentId)
      else next.add(componentId)
      return next
    })
  }

  function respond(actionId: string) {
    if (!token || submitting) return
    void onRespond({
      interactionId: interaction.id,
      responseToken: token,
      actionId,
      data: {
        selectedComponentIds: [...selected],
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
      },
    })
  }

  return (
    <div
      className="absolute inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      data-component-review-overlay
    >
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-violet-200/80 bg-white/95 shadow-2xl shadow-violet-950/10">
        <header className="border-b border-violet-100 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-500">
            构件复核
          </p>
          <h2 className="mt-1 text-base font-semibold text-slate-900">{interaction.title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{interaction.description}</p>
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/60 px-4 py-10 text-center text-sm text-slate-500">
              没有可复核的草稿构件。
            </p>
          ) : items.map((item) => {
            const checked = selected.has(item.componentId)
            return (
              <button
                key={item.componentId}
                type="button"
                data-review-item={item.componentId}
                onClick={() => toggle(item.componentId)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition',
                  item.wouldOverwriteConfirmed
                    ? 'border-rose-200 bg-rose-50/80'
                    : checked
                      ? 'border-violet-200 bg-violet-50/70'
                      : 'border-slate-200 bg-white hover:border-violet-200',
                )}
              >
                {checked
                  ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                  : <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{item.name}</span>
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-slate-500">
                      {item.componentType}
                    </span>
                    {item.wouldOverwriteConfirmed ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-700">
                        <AlertTriangle className="h-3 w-3" />
                        将覆盖已确认构件
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-600">尺寸：{item.dimensions}</p>
                  <p className="text-xs text-slate-500">图纸：{item.drawing}</p>
                  {item.handles.length > 0 ? (
                    <p className="text-xs text-slate-500">Handle：{item.handles.join('、')}</p>
                  ) : null}
                  {item.evidencePack ? (
                    <p className="truncate text-xs text-slate-400">证据：{item.evidencePack}</p>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>

        <footer className="space-y-3 border-t border-violet-100 px-5 py-4">
          {overwriteCount > 0 ? (
            <p className="text-xs text-rose-700">
              已勾选 {overwriteCount} 条可能覆盖已确认记录的构件，请再核对。
            </p>
          ) : null}
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">打回反馈（可选）</span>
            <textarea
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="选择「打回修改」时，这段话会作为新一轮提示发给助手。"
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-400/40"
            />
          </label>
          {error ? <p className="text-xs text-rose-600" role="alert">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => respond(INTERACTION_REVIEW_SKIP_ACTION)}
            >
              本次不保存
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting || !feedback.trim()}
              className="border-violet-200 text-violet-700 hover:bg-violet-50"
              onClick={() => respond(INTERACTION_REVIEW_REVISE_ACTION)}
            >
              打回修改
            </Button>
            <Button
              type="button"
              disabled={submitting || selected.size === 0}
              className="bg-violet-600 text-white hover:bg-violet-700"
              onClick={() => respond(INTERACTION_REVIEW_CONFIRM_ACTION)}
            >
              确认入库
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
