import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContextUsageInfo } from '@/shared/local-agent'
import { formatTokens } from '@/lib/format-tokens'

const RING_SIZE = 22
const STROKE_WIDTH = 3
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const POPOVER_WIDTH = 288
const VIEWPORT_PADDING = 12
const POPOVER_GAP = 8
const MIN_SPACE_ABOVE = 160

type PopoverPosition = {
  bottom?: number
  left: number
  maxHeight: number
  top?: number
  width: number
}

function getColor(percent: number, pending: boolean, compacting: boolean): string {
  if (compacting) return '#8b5cf6'
  if (pending) return '#64748b'
  if (percent >= 80) return '#ef4444'
  if (percent >= 60) return '#f59e0b'
  return '#22c55e'
}

export interface ContextUsageRingProps {
  usage: ContextUsageInfo
  pending?: boolean
  compacting?: boolean
  disabled?: boolean
  onCompact?: (instructions?: string) => void
}

export function ContextUsageRing({
  usage,
  pending = false,
  compacting = false,
  disabled = false,
  onCompact,
}: ContextUsageRingProps) {
  const popoverId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputOpen, setInputOpen] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null)
  const percent = Math.max(0, Math.min(100, usage.percent))
  const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE
  const color = getColor(percent, pending, compacting)
  const trailingTokens = Math.max(0, usage.trailingTokens ?? 0)
  const compactAtTokens = Math.max(0, usage.compactAtTokens ?? 0)
  const displayLimitTokens = compactAtTokens || Math.max(0, usage.totalTokens)
  const confirmedTokens = Math.max(0, usage.usedTokens - trailingTokens)
  const cacheTokens = usage.cacheTokens ?? Math.max(
    0,
    usage.usedTokens - usage.inputTokens - usage.outputTokens - trailingTokens,
  )
  const actionLabel = compacting
    ? '正在压缩上下文'
    : disabled
      ? `上下文预计占用 ${Math.round(percent)}%，当前任务结束后可手动压缩`
      : `上下文预计占用 ${Math.round(percent)}%，点击手动压缩`

  useLayoutEffect(() => {
    if (!inputOpen) {
      setPopoverPosition(null)
      return
    }

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return

      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const width = Math.max(0, Math.min(POPOVER_WIDTH, viewportWidth - VIEWPORT_PADDING * 2))
      const triggerRect = trigger.getBoundingClientRect()
      const preferredLeft = triggerRect.left
      const fallbackLeft = triggerRect.right - width
      const rawLeft = preferredLeft + width <= viewportWidth - VIEWPORT_PADDING
        ? preferredLeft
        : fallbackLeft
      const left = Math.min(
        Math.max(rawLeft, VIEWPORT_PADDING),
        Math.max(VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING),
      )
      const spaceAbove = Math.max(0, triggerRect.top - POPOVER_GAP - VIEWPORT_PADDING)
      const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - POPOVER_GAP - VIEWPORT_PADDING)
      const placeAbove = spaceAbove >= MIN_SPACE_ABOVE || spaceAbove >= spaceBelow

      setPopoverPosition({
        left,
        maxHeight: placeAbove ? spaceAbove : spaceBelow,
        width,
        ...(placeAbove
          ? { bottom: viewportHeight - triggerRect.top + POPOVER_GAP }
          : { top: triggerRect.bottom + POPOVER_GAP }),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [inputOpen])

  useEffect(() => {
    if (!inputOpen) return
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setInputOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [inputOpen])

  useEffect(() => {
    if (compacting || disabled) setInputOpen(false)
  }, [compacting, disabled])

  function submitCompaction() {
    if (disabled || compacting) return
    const normalized = instructions.trim()
    setInputOpen(false)
    setInstructions('')
    onCompact?.(normalized || undefined)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div ref={rootRef} className="group relative inline-flex h-7 w-7 shrink-0 items-center justify-center">
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full outline-none transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        aria-label={actionLabel}
        aria-busy={compacting}
        aria-disabled={disabled || compacting}
        aria-expanded={inputOpen}
        aria-controls={inputOpen ? popoverId : undefined}
        title={actionLabel}
        onClick={() => {
          if (!disabled && !compacting) setInputOpen((current) => !current)
        }}
      >
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          className="-rotate-90"
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          aria-hidden
        >
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth={STROKE_WIDTH}
          />
          {percent > 0 ? (
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={color}
              strokeWidth={STROKE_WIDTH}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className={compacting
                ? 'animate-pulse transition-all duration-500 ease-out'
                : 'transition-all duration-500 ease-out'}
            />
          ) : null}
        </svg>
      </button>

      {inputOpen ? createPortal(
        <form
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label="压缩上下文"
          onSubmit={(event) => {
            event.preventDefault()
            submitCompaction()
          }}
          className="fixed z-[100] overflow-y-auto rounded-xl border border-slate-200/90 bg-white p-3 text-left shadow-[0_18px_48px_rgba(15,23,42,0.18)]"
          style={{
            left: popoverPosition?.left ?? 0,
            width: popoverPosition?.width ?? POPOVER_WIDTH,
            maxHeight: popoverPosition?.maxHeight ?? undefined,
            ...(popoverPosition?.top !== undefined
              ? { top: popoverPosition.top }
              : { bottom: popoverPosition?.bottom ?? 0 }),
            visibility: popoverPosition ? 'visible' : 'hidden',
          }}
        >
          <label htmlFor={`${popoverId}-instructions`} className="text-xs font-semibold text-slate-800">
            希望保留的重点
          </label>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">可选；留空将按当前方式压缩。</p>
          <input
            ref={inputRef}
            id={`${popoverId}-instructions`}
            type="text"
            maxLength={1000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setInputOpen(false)
                window.requestAnimationFrame(() => triggerRef.current?.focus())
              }
            }}
            placeholder="例如：保留尺寸、材料和待确认项"
            className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setInputOpen(false)
                window.requestAnimationFrame(() => triggerRef.current?.focus())
              }}
              className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              取消
            </button>
            <button
              type="submit"
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
            >
              开始压缩
            </button>
          </div>
        </form>,
        document.body,
      ) : null}

      {!inputOpen ? (
      <div className="pointer-events-none absolute bottom-full left-1/2 z-[80] mb-2 hidden -translate-x-1/2 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs shadow-lg group-hover:block group-focus-within:block">
        <p className="whitespace-nowrap font-medium text-slate-800">
          预计占用 {formatTokens(usage.usedTokens)} / {formatTokens(displayLimitTokens)}
          （{Math.round(percent)}%）
        </p>
        {compactAtTokens > 0 && usage.totalTokens > compactAtTokens ? (
          <p className="mt-1 whitespace-nowrap text-slate-400">
            模型窗口 {formatTokens(usage.totalTokens)}
          </p>
        ) : null}
        {confirmedTokens > 0 ? (
          <p className="mt-1 whitespace-nowrap text-slate-500">
            最近 usage：输入 {formatTokens(usage.inputTokens)}
            {cacheTokens > 0 ? ` · 缓存 ${formatTokens(cacheTokens)}` : ''}
            {' · '}
            输出 {formatTokens(usage.outputTokens)}
          </p>
        ) : null}
        {trailingTokens > 0 ? (
          <p className="mt-1 whitespace-nowrap text-slate-500">
            估算部分 {formatTokens(trailingTokens)}
          </p>
        ) : null}
        {compactAtTokens > 0 ? (
          <p className="mt-1 whitespace-nowrap text-slate-400">
            建议压缩线 {formatTokens(compactAtTokens)} · 自动触发以模型 usage 为准
          </p>
        ) : null}
        {pending ? (
          <p className="mt-1 whitespace-nowrap text-slate-400">等待本轮模型 usage 校准估算</p>
        ) : null}
        <p className="mt-1 whitespace-nowrap text-violet-600">
          {compacting ? '正在压缩上下文…' : disabled ? '任务结束后可压缩' : '点击压缩上下文'}
        </p>
      </div>
      ) : null}
    </div>
  )
}
