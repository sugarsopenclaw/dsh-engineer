import { AlertCircle, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentMessageHostNotice } from '@/shared/local-agent'
import { describeSubagentCompletionNotice } from '@/shared/subagent-completion'

/**
 * Transcript row for turns the host opened on the agent's behalf. A background
 * subagent's report is context, not conversation, so it gets a marker instead of a bubble.
 */
export function HostNoticeRow({ notice }: { notice: AgentMessageHostNotice }) {
  const failed = notice.status === 'failed' || notice.status === 'cancelled'
  const Icon = failed ? AlertCircle : Bot
  return (
    <div className="flex justify-center">
      <div
        title={`task_id: ${notice.taskId}`}
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[11px]',
          failed
            ? 'border-amber-200 bg-amber-50/80 text-amber-700'
            : 'border-slate-200/70 bg-white/70 text-slate-500',
        )}
      >
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{describeSubagentCompletionNotice(notice)}</span>
      </div>
    </div>
  )
}
