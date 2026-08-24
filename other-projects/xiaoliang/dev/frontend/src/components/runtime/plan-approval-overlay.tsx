import { useState } from 'react'
import { FileText, X } from 'lucide-react'
import { MarkdownRender } from '@/components/chat/markdown-render'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AgentInteractionResponseInput, AgentPendingInteraction } from '@/shared/local-agent'
import {
  INTERACTION_PLAN_ABANDON_ACTION,
  INTERACTION_PLAN_APPROVE_ACTION,
  INTERACTION_PLAN_REVISE_ACTION,
} from '@/shared/local-agent'
import type { PlanApprovalPayload } from '@/shared/local-agent'

interface PlanApprovalOverlayProps {
  interaction: AgentPendingInteraction
  submitting: boolean
  error: string | null
  onRespond: (response: Omit<AgentInteractionResponseInput, 'conversationId'>) => void | Promise<void>
}

function isPlanPayload(value: unknown): value is PlanApprovalPayload {
  return Boolean(value && typeof value === 'object' && 'planContent' in value)
}

export function PlanApprovalOverlay({
  interaction,
  submitting,
  error,
  onRespond,
}: PlanApprovalOverlayProps) {
  const [feedback, setFeedback] = useState('')
  const payload = isPlanPayload(interaction.payload) ? interaction.payload : null
  const planContent = payload?.planContent?.trim() || ''
  const empty = !planContent
  const token = interaction.responseToken || ''

  function respond(actionId: string) {
    if (!token || submitting) return
    void onRespond({
      interactionId: interaction.id,
      responseToken: token,
      actionId,
      data: feedback.trim() ? { feedback: feedback.trim() } : undefined,
    })
  }

  return (
    <div
      className="absolute inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      data-plan-approval-overlay
    >
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-violet-200/80 bg-white/95 shadow-2xl shadow-violet-950/10">
        <header className="flex items-start justify-between gap-3 border-b border-violet-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-500">
              Plan 审批
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-900">{interaction.title}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{interaction.description}</p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-violet-50 hover:text-violet-700"
            aria-label="放弃计划"
            disabled={submitting}
            onClick={() => respond(INTERACTION_PLAN_ABANDON_ACTION)}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {empty ? (
            <div
              className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-violet-200 bg-violet-50/60 px-6 py-16 text-center"
              data-plan-empty
            >
              <FileText className="h-8 w-8 text-violet-400" />
              <p className="mt-3 text-sm font-medium text-slate-700">计划文件还是空的</p>
              <p className="mt-1 text-xs text-slate-500">
                打回后助手会继续调研并写入 plan.md，批准开工已被禁用。
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3">
              <MarkdownRender content={planContent} final />
            </div>
          )}
        </div>

        <footer className="space-y-3 border-t border-violet-100 px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">整体反馈（可选）</span>
            <textarea
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="批准时可补充约束；打回时请写明要改什么。"
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-violet-400/0 transition focus:border-violet-300 focus:ring-2 focus:ring-violet-400/40"
            />
          </label>
          {error ? (
            <p className="text-xs text-rose-600" role="alert">{error}</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => respond(INTERACTION_PLAN_ABANDON_ACTION)}
            >
              放弃
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              className="border-violet-200 text-violet-700 hover:bg-violet-50"
              onClick={() => respond(INTERACTION_PLAN_REVISE_ACTION)}
            >
              打回修改
            </Button>
            <Button
              type="button"
              disabled={submitting || empty}
              className={cn('bg-violet-600 text-white hover:bg-violet-700')}
              onClick={() => respond(INTERACTION_PLAN_APPROVE_ACTION)}
            >
              批准开工
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
