import { memo, type ReactNode, useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, MessageSquareText, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentMessageFeedbackDraft } from '@/hooks/use-agent-message-feedback'
import type {
  AgentFeedbackIssueCode,
  AgentFeedbackOutcome,
  AgentFeedbackVote,
  AgentMessageFeedbackView,
} from '@/shared/backend-api'
import type { AgentMessageRecord } from '@/shared/local-agent'

const OUTCOME_OPTIONS: Array<{ value: AgentFeedbackOutcome; label: string }> = [
  { value: 'success', label: '已完成' },
  { value: 'partial', label: '部分完成' },
  { value: 'failure', label: '未完成' },
]

const ISSUE_OPTIONS: Array<{ value: AgentFeedbackIssueCode; label: string }> = [
  { value: 'cad_understanding', label: 'CAD 理解' },
  { value: 'tool_strategy', label: '工具策略' },
  { value: 'incorrect_answer', label: '答案错误' },
  { value: 'missed_instruction', label: '遗漏要求' },
  { value: 'incomplete', label: '结果不完整' },
  { value: 'interaction', label: '交互体验' },
  { value: 'other', label: '其他' },
]

function draftFromFeedback(feedback?: AgentMessageFeedbackView): AgentMessageFeedbackDraft {
  return {
    vote: feedback?.vote ?? null,
    outcome: feedback?.outcome ?? null,
    issueCodes: feedback?.issue_codes ?? [],
    comment: feedback?.comment ?? '',
  }
}

function hasFeedbackSignal(draft: AgentMessageFeedbackDraft) {
  return Boolean(
    draft.vote
    || draft.outcome
    || draft.issueCodes.length > 0
    || draft.comment.trim(),
  )
}

export interface AgentMessageFeedbackProps {
  message: AgentMessageRecord
  feedback?: AgentMessageFeedbackView
  loading?: boolean
  unavailable?: boolean
  leadingControls?: ReactNode
  onSave: (
    message: AgentMessageRecord,
    draft: AgentMessageFeedbackDraft,
  ) => Promise<AgentMessageFeedbackView>
  onDelete: (message: AgentMessageRecord) => Promise<void>
}

export const AgentMessageFeedback = memo(function AgentMessageFeedback({
  message,
  feedback,
  loading = false,
  unavailable = false,
  leadingControls,
  onSave,
  onDelete,
}: AgentMessageFeedbackProps) {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState(() => draftFromFeedback(feedback))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const mutationGenerationRef = useRef(0)
  const panelId = `agent-feedback-panel-${message.id}`
  const panelTitleId = `${panelId}-title`
  const panelDescriptionId = `${panelId}-description`

  useEffect(() => {
    setDraft(draftFromFeedback(feedback))
  }, [feedback])

  useEffect(() => {
    const dialog = dialogRef.current
    if (expanded && dialog && !dialog.open) {
      dialog.showModal()
    }
  }, [expanded])

  const persist = async (nextDraft: AgentMessageFeedbackDraft): Promise<boolean> => {
    const mutationGeneration = mutationGenerationRef.current + 1
    mutationGenerationRef.current = mutationGeneration
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      if (hasFeedbackSignal(nextDraft)) {
        await onSave(message, nextDraft)
      } else {
        await onDelete(message)
      }
      if (mutationGenerationRef.current !== mutationGeneration) return false
      setSaved(true)
      return true
    } catch (saveError) {
      if (mutationGenerationRef.current !== mutationGeneration) return false
      setDraft(draftFromFeedback(feedback))
      setError(saveError instanceof Error ? saveError.message : '反馈保存失败，请重试。')
      return false
    } finally {
      if (mutationGenerationRef.current === mutationGeneration) {
        setSaving(false)
      }
    }
  }

  const selectVote = async (vote: AgentFeedbackVote) => {
    const nextDraft = {
      ...draft,
      vote: draft.vote === vote ? null : vote,
    }
    setDraft(nextDraft)
    const saveSucceeded = await persist(nextDraft)
    if (saveSucceeded) setExpanded(true)
  }

  const toggleIssue = (issueCode: AgentFeedbackIssueCode) => {
    setSaved(false)
    setDraft((current) => ({
      ...current,
      issueCodes: current.issueCodes.includes(issueCode)
        ? current.issueCodes.filter((value) => value !== issueCode)
        : [...current.issueCodes, issueCode],
    }))
  }

  const clearFeedback = async () => {
    const mutationGeneration = mutationGenerationRef.current + 1
    mutationGenerationRef.current = mutationGeneration
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      await onDelete(message)
      if (mutationGenerationRef.current !== mutationGeneration) return
      setDraft(draftFromFeedback())
      closeFeedbackCard()
    } catch (deleteError) {
      if (mutationGenerationRef.current !== mutationGeneration) return
      setError(deleteError instanceof Error ? deleteError.message : '反馈清除失败，请重试。')
    } finally {
      if (mutationGenerationRef.current === mutationGeneration) {
        setSaving(false)
      }
    }
  }

  function closeFeedbackCard() {
    const dialog = dialogRef.current
    if (dialog?.open) {
      dialog.close()
      return
    }
    setExpanded(false)
  }

  const controlsDisabled = loading || unavailable

  return (
    <div className="mt-1.5 px-2 text-slate-500" aria-busy={saving}>
      {loading ? <span className="sr-only" role="status">正在加载这条回答的反馈</span> : null}
      <div className="flex min-h-8 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {leadingControls}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="有帮助"
            aria-label="这条回答有帮助"
            aria-pressed={draft.vote === 'up'}
            disabled={controlsDisabled}
            onClick={() => void selectVote('up')}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-50',
              draft.vote === 'up' && 'bg-emerald-50 text-emerald-700',
            )}
          >
            <ThumbsUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            title="需要改进"
            aria-label="这条回答需要改进"
            aria-pressed={draft.vote === 'down'}
            disabled={controlsDisabled}
            onClick={() => void selectVote('down')}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:opacity-50',
              draft.vote === 'down' && 'bg-rose-50 text-rose-700',
            )}
          >
            <ThumbsDown className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            title={feedback ? '查看或修改反馈' : '补充意见'}
            aria-label={feedback ? '查看或修改反馈' : '补充意见'}
            aria-haspopup="dialog"
            aria-expanded={expanded}
            aria-controls={panelId}
            disabled={controlsDisabled}
            onClick={() => {
              setSaved(false)
              setExpanded(true)
            }}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50',
              feedback && 'bg-slate-100 text-slate-700',
            )}
          >
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
          </button>
          {saving ? (
            <span className="inline-flex items-center gap-1 text-xs text-slate-400" role="status">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
              保存中
            </span>
          ) : saved ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600" role="status">
              <Check className="h-3.5 w-3.5" aria-hidden />
              已保存
            </span>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <dialog
          ref={dialogRef}
          id={panelId}
          aria-labelledby={panelTitleId}
          aria-describedby={panelDescriptionId}
          className="fixed inset-0 m-auto max-h-[calc(100vh-2rem)] w-[min(680px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-3xl border border-slate-200/90 bg-white p-0 text-slate-800 shadow-[0_28px_100px_rgba(15,23,42,0.28)] backdrop:bg-slate-950/40 backdrop:backdrop-blur-[2px]"
          onClose={() => setExpanded(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeFeedbackCard()
          }}
        >
          <div className="flex max-h-[calc(100vh-2rem)] min-h-0 flex-col">
            <header className="flex shrink-0 items-start gap-4 border-b border-slate-200/80 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h3 id={panelTitleId} className="text-base font-semibold text-slate-900">
                  {feedback ? '查看 / 修改反馈' : '补充意见'}
                </h3>
                <p id={panelDescriptionId} className="mt-1 text-xs leading-5 text-slate-500">
                  点选任务结果和需要改进的地方，也可以补充具体说明。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭反馈卡片"
                onClick={closeFeedbackCard}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </header>

            <form
              className="flex min-h-0 flex-1 flex-col"
              aria-busy={saving}
              onSubmit={(event) => {
                event.preventDefault()
                void persist(draft)
              }}
            >
              <div className="min-h-0 overflow-y-auto px-5 py-4">
                <fieldset className="min-w-0 border-0 p-0" disabled={saving || unavailable}>
                  <legend className="text-xs font-medium text-slate-700">这项任务完成得怎么样？</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {OUTCOME_OPTIONS.map((option, index) => (
                      <button
                        key={option.value}
                        type="button"
                        autoFocus={index === 0}
                        aria-pressed={draft.outcome === option.value}
                        onClick={() => {
                          setSaved(false)
                          setDraft((current) => ({
                            ...current,
                            outcome: current.outcome === option.value ? null : option.value,
                          }))
                        }}
                        className={cn(
                          'min-h-11 rounded-full border px-4 py-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
                          draft.outcome === option.value
                            ? 'border-violet-300 bg-violet-50 text-violet-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <p className="mt-4 text-xs font-medium text-slate-700">需要改进的地方（可多选）</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ISSUE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={draft.issueCodes.includes(option.value)}
                        onClick={() => toggleIssue(option.value)}
                        className={cn(
                          'min-h-11 rounded-full border px-4 py-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
                          draft.issueCodes.includes(option.value)
                            ? 'border-amber-300 bg-amber-50 text-amber-800'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <label className="mt-4 block text-xs font-medium text-slate-700" htmlFor={`feedback-${message.id}`}>
                    具体意见（可选）
                  </label>
                  <textarea
                    id={`feedback-${message.id}`}
                    value={draft.comment}
                    maxLength={4000}
                    rows={4}
                    placeholder="例如：哪一步判断有误、漏了什么要求，或期望怎样处理……"
                    onChange={(event) => {
                      setSaved(false)
                      setDraft((current) => ({ ...current, comment: event.target.value }))
                    }}
                    className="mt-2 min-h-28 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                  />
                  <div className="mt-1 text-right text-[11px] text-slate-400">
                    {draft.comment.length} / 4000
                  </div>
                </fieldset>

                {error ? <p className="mt-2 text-xs text-rose-600" role="alert">{error}</p> : null}
              </div>

              <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 bg-slate-50/70 px-5 py-3">
                {feedback ? (
                  <button
                    type="button"
                    disabled={saving || unavailable}
                    onClick={() => void clearFeedback()}
                    className="mr-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    清除反馈
                  </button>
                ) : null}
                {saving ? (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-400" role="status">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    保存中
                  </span>
                ) : saved ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600" role="status">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    已保存
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={closeFeedbackCard}
                  className="min-h-10 rounded-lg px-3 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  关闭
                </button>
                <button
                  type="submit"
                  disabled={saving || unavailable || !hasFeedbackSignal(draft)}
                  className="min-h-10 rounded-lg bg-slate-900 px-4 text-xs font-medium text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  保存反馈
                </button>
              </footer>
            </form>
          </div>
        </dialog>
      ) : error ? (
        <p className="px-2 pb-1 text-xs text-rose-600" role="alert">{error}</p>
      ) : null}
    </div>
  )
})
