import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronRight, LoaderCircle, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ToolCallBlockProps {
  name: string
  args?: string
  result?: string
  output?: string
  startedAt?: number
  status: 'running' | 'done'
}

function formatElapsed(startedAt?: number) {
  if (!startedAt) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return `${minutes}m ${remain}s`
}

interface ToolCallSummary {
  title: string
  detail?: string
  tone: 'neutral' | 'success' | 'warning' | 'error'
}

function formatVolumeResult(value: unknown, unit: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ''
  }
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return `${formatted}${typeof unit === 'string' && unit.trim() ? ` ${unit.trim()}` : ''}`
}

function parseFencedJson(text: string | undefined) {
  if (!text) return null
  const match = /```json\s*([\s\S]*?)```/i.exec(text)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1]) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractAlgorithmRunError(text: string) {
  const normalized = text
    .replace(/```[\s\S]*?```/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const index = normalized.findIndex((line) => line.startsWith('算法执行失败'))
  if (index >= 0) {
    return normalized[index + 1] || '展开查看错误详情'
  }
  return '展开查看错误详情'
}

function extractResultNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const numericValues = Object.values(value).filter(
    (item): item is number => typeof item === 'number' && Number.isFinite(item),
  )
  return numericValues.length === 1 ? numericValues[0] : null
}

function buildToolSummary(name: string, result?: string): ToolCallSummary | null {
  const normalized = name.trim()
  const text = result?.trim() ?? ''
  if (!normalized || !text) return null

  if (normalized === 'cad_algorithm_run') {
    const parsed = parseFencedJson(text)
    const resultText = parsed ? formatVolumeResult(extractResultNumber(parsed.result), parsed.unit) : ''
    if (/算法执行通过/.test(text)) {
      return {
        title: '算法执行通过',
        detail: resultText ? `结果 ${resultText}` : undefined,
        tone: 'success',
      }
    }
    if (/算法执行失败/.test(text)) {
      return {
        title: '算法执行失败',
        detail: extractAlgorithmRunError(text),
        tone: 'error',
      }
    }
  }

  if (normalized === 'cad_algorithm_write' && /算法草稿已写入/.test(text)) {
    return {
      title: '算法草稿已写入',
      detail: '下一步执行验证',
      tone: 'neutral',
    }
  }

  if (normalized === 'cad_algorithm_save') {
    if (/保存被拦截|未保存|未检测到用户确认/.test(text)) {
      return {
        title: '保存被拦截',
        detail: '未保存，需用户确认',
        tone: 'warning',
      }
    }
    if (/保存失败/.test(text)) {
      return {
        title: '保存失败',
        detail: '展开查看原因',
        tone: 'error',
      }
    }
    if (/算法资产已保存/.test(text)) {
      return {
        title: '算法资产已保存',
        detail: '本地算法可复用',
        tone: 'success',
      }
    }
  }

  if (normalized === 'cad_drawing_visual_qa') {
    if (/截图无效|未对准|看不清|无法确认|下一步：|## 下一步/.test(text)) {
      return {
        title: 'CAD 识图需人工复核',
        detail: '请按提示缩放或框选目标区域',
        tone: 'warning',
      }
    }
    if (/## 视觉确认|图纸内证据/.test(text)) {
      return {
        title: 'CAD 识图链路完成',
        detail: /外部资料补充/.test(text) ? '含联网资料来源' : '已完成图内证据检查',
        tone: 'success',
      }
    }
  }

  return null
}

function buildRunningToolSummary(name: string, status: ToolCallBlockProps['status']): ToolCallSummary | null {
  if (status !== 'running') return null
  if (name === 'cad_algorithm_write') {
    return { title: '正在写入算法草稿', detail: 'calculator.py', tone: 'neutral' }
  }
  if (name === 'cad_algorithm_run') {
    return { title: '正在执行算法验证', detail: '运行 calculator.py', tone: 'neutral' }
  }
  if (name === 'cad_algorithm_save') {
    return { title: '正在保存算法资产', detail: '等待确认门槛校验', tone: 'neutral' }
  }
  if (name === 'cad_drawing_visual_qa') {
    return { title: '正在执行 CAD 识图链路', detail: '定位、截图、视觉确认', tone: 'neutral' }
  }
  return null
}

function summaryToneClass(tone: ToolCallSummary['tone']) {
  if (tone === 'success') return 'border-emerald-200/80 bg-emerald-50/80 text-emerald-800'
  if (tone === 'warning') return 'border-amber-200/80 bg-amber-50/85 text-amber-800'
  if (tone === 'error') return 'border-rose-200/80 bg-rose-50/85 text-rose-800'
  return 'border-slate-200/80 bg-slate-50/85 text-slate-700'
}

export function ToolCallBlock({
  name,
  args,
  result,
  output,
  startedAt,
  status,
}: ToolCallBlockProps) {
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (status !== 'running' || !startedAt) {
      return
    }

    const timer = window.setInterval(() => {
      setTick((current) => current + 1)
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [startedAt, status])

  const elapsed = useMemo(() => formatElapsed(startedAt), [startedAt, status, output, result, tick])
  const summary = useMemo(
    () => buildToolSummary(name, result) ?? buildRunningToolSummary(name, status),
    [name, result, status],
  )

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border bg-white/78 shadow-sm',
        status === 'running' ? 'border-sky-200/80' : 'border-slate-200/80',
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-600 transition hover:bg-slate-50/90"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
        {status === 'running' ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-sky-500" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        )}
        <Wrench className="h-3.5 w-3.5 text-slate-400" />
        <span className="font-medium text-slate-700">{name}</span>
        <span className="ml-auto text-[11px] text-slate-400">
          {status === 'running' ? '执行中' : '已完成'}
          {elapsed ? ` · ${elapsed}` : ''}
        </span>
      </button>

      {open ? (
        <div className="border-t border-slate-200/80 bg-slate-950 px-3 py-3 text-xs text-slate-200">
          {output ? (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-slate-900/90 px-3 py-2 leading-6 text-slate-100">
              {output}
            </pre>
          ) : null}

          {args ? (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                参数
              </div>
              <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-900/90 px-3 py-2 leading-6 text-slate-200">
                {args}
              </pre>
            </div>
          ) : null}

          {result ? (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                结果
              </div>
              <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-900/90 px-3 py-2 leading-6 text-slate-200">
                {result}
              </pre>
            </div>
          ) : null}
        </div>
      ) : summary ? (
        <div className="border-t border-slate-200/80 px-3 py-2">
          <div className={cn('rounded-xl border px-3 py-2 text-xs leading-5', summaryToneClass(summary.tone))}>
            <span className="font-medium">{summary.title}</span>
            {summary.detail ? <span className="ml-2">{summary.detail}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
