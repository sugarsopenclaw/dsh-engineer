import type { ReactNode } from 'react'
import type {
  ConversationUsageChangedPayload,
  ConversationUsageTotalsView,
  RunUsagePurposeBreakdown,
} from '@/shared/billing-domain'
import { formatCredits, runUsageCacheHitPercent } from '@/shared/billing-domain'
import { formatTokens } from '@/lib/format-tokens'
import { cn } from '@/lib/utils'

const PURPOSE_LABELS: Record<string, string> = {
  main: '主对话',
  subagent: '子代理',
  cad_query: 'CAD 查询',
  visual_index: '视觉索引',
  compaction: '压缩',
  schema_repair: '结构修复',
}

function purposeLabel(purpose: string): string {
  return PURPOSE_LABELS[purpose] ?? purpose
}

function BreakdownLines({ breakdown }: { breakdown: RunUsagePurposeBreakdown[] }) {
  if (breakdown.length === 0) return null
  return (
    <>
      {breakdown.map((item) => (
        <p key={`${item.callPurpose}:${item.childRunId ?? ''}`} className="whitespace-nowrap">
          {purposeLabel(item.callPurpose)}
          {item.childRunId ? `（${item.childRunId.slice(0, 8)}）` : ''}
          {'：输入 '}
          {formatTokens(item.inputTokens)}
          {' · 输出 '}
          {formatTokens(item.outputTokens)}
          {item.cacheReadTokens > 0 ? ` · 缓存 ${formatTokens(item.cacheReadTokens)}` : ''}
        </p>
      ))}
    </>
  )
}

function SessionLines({ session }: { session: ConversationUsageTotalsView }) {
  return (
    <>
      <p className="whitespace-nowrap font-medium text-slate-700">
        会话累计（{session.runCount} 轮）：输入 {formatTokens(session.inputTokens)}
        {' · 输出 '}
        {formatTokens(session.outputTokens)}
        {session.cacheReadTokens > 0 ? ` · 缓存 ${formatTokens(session.cacheReadTokens)}` : ''}
        {' · Credits 消耗 '}
        {formatCredits(session.creditsCharged)}
      </p>
      <BreakdownLines breakdown={session.breakdown} />
    </>
  )
}

const USAGE_FONT =
  "text-[11px] font-normal leading-[14px] [font-family:'Microsoft_YaHei_UI','Microsoft_YaHei','PingFang_SC','Hiragino_Sans_GB','Noto_Sans_SC',sans-serif]"

// 数字与文字保持同一字号，避免混排时显得忽大忽小；数字加深一档形成层次。
const USAGE_METRIC = `${USAGE_FONT} text-slate-500`

const USAGE_LINE_CLASS = `truncate text-center text-slate-400 antialiased ${USAGE_FONT}`

function Metric({ children }: { children: ReactNode }) {
  return <span className={USAGE_METRIC}>{children}</span>
}

function RemainingCredits({
  remainingCredits,
  remainingLow,
  onOpenSettings,
}: {
  remainingCredits: number
  remainingLow: boolean
  onOpenSettings?: () => void
}) {
  const label = `Credits 剩余 ${formatCredits(remainingCredits)}`
  const className = cn(
    USAGE_METRIC,
    'inline bg-transparent p-0 antialiased',
    remainingLow ? 'text-amber-600 hover:text-amber-700' : 'hover:text-slate-600',
    onOpenSettings && 'cursor-pointer',
  )

  if (!onOpenSettings) {
    return <span className={className}>{label}</span>
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onOpenSettings}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenSettings()
        }
      }}
      title={remainingLow ? '算力余额偏低，点击补充' : '剩余算力，点击管理'}
      className={className}
    >
      {label}
    </span>
  )
}

/**
 * 输入框外底部的用量小字：本轮后端权威数字（输入/输出/缓存命中/Credits），
 * 后面接实时剩余算力。悬停展开会话累计与按用途拆分。
 */
export function ComposerUsageStats({
  usage,
  remainingCredits = null,
  remainingLow = false,
  onOpenSettings,
}: {
  usage: ConversationUsageChangedPayload | null
  remainingCredits?: number | null
  remainingLow?: boolean
  onOpenSettings?: () => void
}) {
  const run = usage?.run ?? null
  const session = usage?.session ?? null
  const hasSession = Boolean(session && session.runCount > 0)
  const hasRemaining = remainingCredits != null
  if (!run && !hasSession && !hasRemaining) return null

  const cacheHit = run ? runUsageCacheHitPercent(run) : 0
  const remaining = hasRemaining ? (
    <RemainingCredits
      remainingCredits={remainingCredits}
      remainingLow={remainingLow}
      onOpenSettings={onOpenSettings}
    />
  ) : null

  return (
    <div className="group relative w-full min-w-0 max-w-full">
      {run ? (
        // 宽窗口：每项左右顶边、中间等分；窄窗口（<md）隐藏会话累计与剩余算力。
        <div
          className={cn(
            USAGE_LINE_CLASS,
            'flex items-center justify-between gap-x-6 whitespace-nowrap',
          )}
        >
          {hasSession && session ? (
            <span className="hidden shrink-0 md:inline">会话累计 {session.runCount} 轮</span>
          ) : null}
          <span className="min-w-0 truncate">
            输入 <Metric>{formatTokens(run.inputTokens)}</Metric>
          </span>
          <span className="shrink-0">
            输出 <Metric>{formatTokens(run.outputTokens)}</Metric>
          </span>
          {run.inputTokens > 0 ? (
            <span className="shrink-0">
              缓存命中 <Metric>{cacheHit}%</Metric>
            </span>
          ) : null}
          <span className="shrink-0">
            <Metric>Credits 消耗 {formatCredits(run.creditsCharged)}</Metric>
          </span>
          {remaining ? <span className="hidden shrink-0 md:inline">{remaining}</span> : null}
        </div>
      ) : (
        <div className={USAGE_LINE_CLASS}>
          {hasSession ? (
            <>
              会话累计 {session?.runCount ?? 0} 轮
              {' · '}
              <Metric>Credits 消耗 {session ? formatCredits(session.creditsCharged) : 0}</Metric>
              {remaining ? ' · ' : null}
              {remaining}
            </>
          ) : (
            remaining
          )}
        </div>
      )}
      {run || hasSession ? (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-[80] mb-1 hidden -translate-x-1/2 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-[11px] leading-5 text-slate-500 shadow-lg group-hover:block">
          {run ? (
            <p className="whitespace-nowrap font-medium text-slate-700">
              本轮：输入 {formatTokens(run.inputTokens)}
              {' · 输出 '}
              {formatTokens(run.outputTokens)}
              {run.cacheReadTokens > 0 ? ` · 缓存 ${formatTokens(run.cacheReadTokens)}` : ''}
              {run.reasoningTokens > 0 ? ` · 推理 ${formatTokens(run.reasoningTokens)}` : ''}
              {' · Credits 消耗 '}
              {formatCredits(run.creditsCharged)}
            </p>
          ) : null}
          {run ? <BreakdownLines breakdown={run.breakdown} /> : null}
          {session && session.runCount > 0 ? <SessionLines session={session} /> : null}
        </div>
      ) : null}
    </div>
  )
}
