import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  CircleOff,
  Loader2,
  RefreshCw,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { electronBridge } from '@/services/electron-bridge'
import type {
  CadAutomationDiagnostics,
  CadAutomationStatus,
  SubagentRunUpdate,
} from '@/shared/local-agent'

type InvalidationTarget = {
  drawingPath: string
  artifactKind: 'entities' | 'visual'
}

type PopoverPosition = {
  bottom?: number
  left: number
  maxHeight: number
  top?: number
  width: number
}

type BlenderMcpProbe = {
  phase: 'idle' | 'checking' | 'ready' | 'disabled' | 'unavailable'
  detail: string
}

function blenderMcpProbeLabel(phase: BlenderMcpProbe['phase']) {
  if (phase === 'checking') return '检测中'
  if (phase === 'ready') return '已就绪'
  if (phase === 'disabled') return '未开启'
  if (phase === 'unavailable') return '不可达'
  return '待检测'
}

type StatusTone = 'neutral' | 'ready' | 'pending' | 'error'

function blenderMcpProbeTone(phase: BlenderMcpProbe['phase']): StatusTone {
  if (phase === 'ready') return 'ready'
  if (phase === 'checking' || phase === 'idle') return 'neutral'
  return 'error'
}

function cadStatusPresentation(automationStatus: CadAutomationStatus | null, enabled: boolean, foundationReady: boolean) {
  if (!automationStatus) return { tone: 'neutral' as const, label: '连接中' }
  if (!enabled) return { tone: 'error' as const, label: '未开启' }
  if (foundationReady) return { tone: 'ready' as const, label: '已就绪' }
  return { tone: 'pending' as const, label: '待就绪' }
}

function SubagentStatusBadge({
  children,
  interactive = false,
  tone,
  ...props
}: {
  children: ReactNode
  interactive?: boolean
  tone: StatusTone
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const className = cn(
    'inline-flex h-5 shrink-0 items-center justify-center rounded-full px-2 text-[10px] font-medium leading-none',
    tone === 'ready' && 'bg-emerald-50 text-emerald-700',
    tone === 'pending' && 'bg-amber-50 text-amber-700',
    tone === 'error' && 'bg-rose-50 text-rose-700',
    tone === 'neutral' && 'bg-slate-100 text-slate-500',
    interactive && 'transition',
    interactive && tone === 'ready' && 'enabled:hover:bg-emerald-100',
    interactive && tone === 'error' && 'enabled:hover:bg-rose-100',
    interactive && tone === 'neutral' && 'enabled:hover:bg-slate-200',
    interactive && 'disabled:cursor-default',
    props.className,
  )

  if (interactive) {
    return (
      <button type="button" {...props} className={className}>
        {children}
      </button>
    )
  }

  return <span className={className}>{children}</span>
}

interface CadConnectionIndicatorProps {
  automationStatus: CadAutomationStatus | null
  subagentRun?: SubagentRunUpdate | null
}

interface SubagentToolsButtonProps {
  active?: boolean
  disabled?: boolean
  label: string
  onClick?: () => void
  title: string
}

function SubagentToolsButton({
  active = false,
  disabled = false,
  label,
  onClick,
  title,
}: SubagentToolsButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition',
        'enabled:hover:bg-slate-100 enabled:hover:text-slate-600 disabled:cursor-default disabled:opacity-60',
        active && !disabled && 'bg-slate-100 text-slate-600',
      )}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Wrench className="h-3 w-3" aria-hidden="true" />
    </button>
  )
}

function artifactKindLabel(kind: 'entities' | 'visual' | 'unknown' | 'legacy') {
  if (kind === 'entities') return '实体'
  if (kind === 'visual') return '视觉'
  if (kind === 'legacy') return '旧缓存'
  return '未跟踪'
}

function artifactStatusClass(status: string) {
  if (status === 'valid') return 'text-emerald-700'
  if (status === 'missing' || status === 'untracked' || status === 'untracked_legacy') {
    return 'text-slate-500'
  }
  return 'text-amber-700'
}

function artifactStatusLabel(status: string, kind: 'entities' | 'visual' | 'unknown' | 'legacy') {
  if (status === 'valid') return '有效'
  if (status === 'missing') return kind === 'visual' ? '视觉索引未生成' : '索引未生成'
  if (status === 'untracked') return '未登记'
  if (status === 'untracked_legacy') return '旧缓存未登记'
  if (status === 'corrupt') return '索引损坏'
  if (status === 'stale_source') return '源图已变更'
  if (status === 'stale_pipeline') return '版本已过期'
  return status
}

function canResetArtifact(status: string) {
  return status !== 'missing' && status !== 'untracked' && status !== 'untracked_legacy'
}

function runLabel(run: SubagentRunUpdate | null) {
  if (!run) return '已就绪'
  const labels = {
    queued: '等待中',
    initializing: '处理中',
    running: '处理中',
    completed: '已完成',
    failed: '处理失败',
    cancelled: '已取消',
  } as const
  return labels[run.status]
}

export function CadConnectionIndicator({
  automationStatus,
  subagentRun = null,
}: CadConnectionIndicatorProps) {
  const [open, setOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [diagnostics, setDiagnostics] = useState<CadAutomationDiagnostics | null>(null)
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false)
  const [diagnosticsError, setDiagnosticsError] = useState('')
  const [diagnosticsMessage, setDiagnosticsMessage] = useState('')
  const [invalidationTarget, setInvalidationTarget] = useState<InvalidationTarget | null>(null)
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null)
  const [blenderMcpProbe, setBlenderMcpProbe] = useState<BlenderMcpProbe>({
    phase: 'idle',
    detail: '打开后检测宿主 Blender MCP。',
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const diagnosticsRevisionRef = useRef(0)
  const blenderProbeRevisionRef = useRef(0)
  const popoverId = useId()

  const enabled = automationStatus?.mode === 'subagent'
  const readiness = automationStatus?.readiness ?? null
  const projectId = automationStatus?.projectId?.trim() || ''
  const run = subagentRun ?? automationStatus?.activeRun ?? null
  const busy = Boolean(
    enabled
      && run
      && (run.status === 'queued' || run.status === 'initializing' || run.status === 'running'),
  )
  const developerToolsAvailable = Boolean(
    enabled && automationStatus?.developerToolsAvailable && projectId,
  )
  const foundationReady = Boolean(readiness?.ready)
  const cadStatus = cadStatusPresentation(automationStatus, enabled, foundationReady)
  const foundationBusy = Boolean(
    readiness?.state === 'busy'
      || readiness?.bridge.state === 'starting'
      || readiness?.bridge.state === 'restarting',
  )

  const tooltip = useMemo(() => {
    if (!automationStatus) return 'CAD 助手连接中'
    if (!enabled) return 'CAD 助手未开启'
    if (!automationStatus.projectRootReady) return '请先打开项目'
    if (busy) return '正在处理图纸'
    if (!readiness) return '正在检查 CAD 地基'
    if (readiness.ready) return 'CAD、项目图纸与 plot 已就绪'
    if (readiness.state === 'autocad_not_installed') return '未检测到完整版 AutoCAD'
    if (readiness.state === 'autocad_com_unregistered') return 'AutoCAD COM 未注册'
    if (readiness.state === 'autocad_not_running') return 'CAD 地基健康，AutoCAD 尚未运行'
    if (readiness.state === 'no_document') return 'CAD 已连接，尚未打开图纸'
    if (readiness.state === 'busy') return 'AutoCAD 当前繁忙'
    return 'CAD 地基需要处理'
  }, [automationStatus, busy, enabled, readiness])

  const checkBlenderMcp = useCallback(async () => {
    const revision = ++blenderProbeRevisionRef.current
    setBlenderMcpProbe({ phase: 'checking', detail: '正在检测宿主 Blender MCP。' })
    try {
      const result = await electronBridge.testBlenderMcpConnection()
      if (blenderProbeRevisionRef.current !== revision) return
      if (result.success) {
        setBlenderMcpProbe({
          phase: 'ready',
          detail: `宿主 Blender MCP 已就绪 · ${result.host}:${result.port} · ${result.toolCount} 个工具 · ${result.latencyMs}ms`,
        })
        return
      }
      setBlenderMcpProbe({
        phase: result.enabled ? 'unavailable' : 'disabled',
        detail: result.error || '宿主 Blender MCP 不可达。',
      })
    } catch (error) {
      if (blenderProbeRevisionRef.current !== revision) return
      setBlenderMcpProbe({
        phase: 'unavailable',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    // Defer one tick so React Strict Mode's development-only effect replay does not double-probe Blender.
    const timer = window.setTimeout(() => void checkBlenderMcp(), 0)
    return () => {
      window.clearTimeout(timer)
      blenderProbeRevisionRef.current += 1
    }
  }, [checkBlenderMcp, open])

  useLayoutEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return

      const viewportPadding = 12
      const gap = 8
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const width = Math.max(0, Math.min(288, viewportWidth - viewportPadding * 2))
      const triggerRect = trigger.getBoundingClientRect()
      const left = Math.min(
        Math.max(triggerRect.right - width, viewportPadding),
        Math.max(viewportPadding, viewportWidth - width - viewportPadding),
      )
      const spaceAbove = Math.max(0, triggerRect.top - gap - viewportPadding)
      const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - gap - viewportPadding)
      const placeAbove = spaceAbove >= 160 || spaceAbove >= spaceBelow

      setPopoverPosition({
        left,
        maxHeight: placeAbove ? spaceAbove : spaceBelow,
        width,
        ...(placeAbove
          ? { bottom: viewportHeight - triggerRect.top + gap }
          : { top: triggerRect.bottom + gap }),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeWhenOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', closeWhenOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeWhenOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    diagnosticsRevisionRef.current += 1
    setDiagnostics(null)
    setDiagnosticsOpen(false)
    setDiagnosticsError('')
    setDiagnosticsMessage('')
    setInvalidationTarget(null)
  }, [projectId])

  const loadDiagnostics = async () => {
    if (!projectId || diagnosticsBusy) return
    const revision = ++diagnosticsRevisionRef.current
    setDiagnosticsBusy(true)
    setDiagnosticsError('')
    try {
      const next = await electronBridge.getCadAutomationDiagnostics({ projectId })
      if (diagnosticsRevisionRef.current === revision) setDiagnostics(next)
    } catch (error) {
      if (diagnosticsRevisionRef.current === revision) {
        setDiagnosticsError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (diagnosticsRevisionRef.current === revision) setDiagnosticsBusy(false)
    }
  }

  const toggleDiagnostics = () => {
    const nextOpen = !diagnosticsOpen
    setDiagnosticsOpen(nextOpen)
    setDiagnosticsMessage('')
    if (nextOpen && !diagnostics) void loadDiagnostics()
  }

  const invalidateArtifact = async () => {
    const target = invalidationTarget
    if (!target || !projectId || diagnosticsBusy || busy) return
    const revision = ++diagnosticsRevisionRef.current
    setDiagnosticsBusy(true)
    setDiagnosticsError('')
    setDiagnosticsMessage('')
    try {
      const result = await electronBridge.invalidateCadAutomationArtifact({
        projectId,
        drawingPath: target.drawingPath,
        kind: target.artifactKind,
      })
      if (diagnosticsRevisionRef.current !== revision) return
      setDiagnosticsMessage(result.message)
      setInvalidationTarget(null)
      const next = await electronBridge.getCadAutomationDiagnostics({ projectId })
      if (diagnosticsRevisionRef.current === revision) setDiagnostics(next)
    } catch (error) {
      if (diagnosticsRevisionRef.current === revision) {
        setDiagnosticsError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (diagnosticsRevisionRef.current === revision) setDiagnosticsBusy(false)
    }
  }

  const restartBridge = async () => {
    if (!projectId || diagnosticsBusy || busy) return
    const revision = ++diagnosticsRevisionRef.current
    setDiagnosticsBusy(true)
    setDiagnosticsError('')
    setDiagnosticsMessage('')
    try {
      const result = await electronBridge.restartCadAutomationBridge({ projectId })
      if (diagnosticsRevisionRef.current !== revision) return
      setDiagnosticsMessage(result.message)
      const next = await electronBridge.getCadAutomationDiagnostics({ projectId })
      if (diagnosticsRevisionRef.current === revision) setDiagnostics(next)
    } catch (error) {
      if (diagnosticsRevisionRef.current === revision) {
        setDiagnosticsError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (diagnosticsRevisionRef.current === revision) setDiagnosticsBusy(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition',
          'hover:bg-slate-100 hover:text-slate-700',
          open && 'bg-slate-100 text-slate-700',
        )}
        aria-label="CAD 与 Blender 子智能体状态"
        aria-controls={popoverId}
        aria-expanded={open}
        title={tooltip}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="relative inline-flex items-center justify-center">
          {busy || foundationBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : enabled ? (
            <Bot className="h-4 w-4" />
          ) : (
            <CircleOff className="h-4 w-4" />
          )}
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full',
              enabled && automationStatus?.projectRootReady && foundationReady
                ? 'bg-emerald-500'
                : enabled && automationStatus?.projectRootReady
                  ? 'bg-amber-500'
                  : 'bg-rose-500',
            )}
          />
        </span>
      </button>

      {open ? createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          role="region"
          aria-label="CAD 与 Blender 子智能体状态"
          className="fixed z-[100] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          style={{
            left: popoverPosition?.left ?? 0,
            width: popoverPosition?.width ?? 288,
            maxHeight: popoverPosition?.maxHeight ?? 0,
            ...(popoverPosition?.top !== undefined
              ? { top: popoverPosition.top }
              : { bottom: popoverPosition?.bottom ?? 0 }),
            visibility: popoverPosition ? 'visible' : 'hidden',
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <ul className="list-none space-y-1.5" aria-label="子智能体状态">
              <li className="flex min-h-6 items-center gap-2">
                <Bot
                  className={cn(
                    'h-4 w-4',
                    !automationStatus
                      ? 'text-slate-400'
                      : enabled && foundationReady
                        ? 'text-emerald-600'
                        : enabled
                          ? 'text-amber-600'
                          : 'text-rose-600',
                  )}
                  aria-hidden="true"
                />
                <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">CAD 子智能体</p>
                <SubagentStatusBadge tone={cadStatus.tone}>{cadStatus.label}</SubagentStatusBadge>
                <SubagentToolsButton
                  active={diagnosticsOpen}
                  disabled={!developerToolsAvailable}
                  label={
                    developerToolsAvailable
                      ? diagnosticsOpen ? '关闭 CAD 诊断' : '打开 CAD 诊断'
                      : 'CAD 诊断暂不可用'
                  }
                  title={developerToolsAvailable ? 'CAD 诊断' : 'CAD 诊断暂不可用'}
                  onClick={developerToolsAvailable ? toggleDiagnostics : undefined}
                />
              </li>

              <li className="flex min-h-6 items-center gap-2">
                <Bot
                  className={cn(
                    'h-4 w-4',
                    blenderMcpProbe.phase === 'ready'
                      ? 'text-emerald-600'
                      : blenderMcpProbe.phase === 'checking' || blenderMcpProbe.phase === 'idle'
                        ? 'text-slate-400'
                        : 'text-rose-600',
                  )}
                  aria-hidden="true"
                />
                <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">Blender 子智能体</p>
                <SubagentStatusBadge
                  interactive
                  tone={blenderMcpProbeTone(blenderMcpProbe.phase)}
                  aria-label={blenderMcpProbe.phase === 'checking'
                    ? 'Blender 子智能体检测中'
                    : `Blender 子智能体${blenderMcpProbeLabel(blenderMcpProbe.phase)}，点击重新检测`}
                  title={blenderMcpProbe.detail}
                  disabled={blenderMcpProbe.phase === 'checking'}
                  onClick={() => void checkBlenderMcp()}
                >
                  {blenderMcpProbeLabel(blenderMcpProbe.phase)}
                </SubagentStatusBadge>
                <SubagentToolsButton
                  disabled
                  label="Blender 诊断暂不可用"
                  title="Blender 诊断功能待接入"
                />
              </li>
            </ul>

            {!automationStatus ? (
              <p className="mt-3 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">正在连接</p>
            ) : enabled ? (
              busy || (run && run.status !== 'completed') ? (
                <div role="status" aria-live="polite" className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-slate-700">
                  {busy ? <Loader2 className="h-3 w-3 animate-spin text-sky-500" /> : <Bot className="h-3 w-3 text-sky-600" />}
                  <span>CAD 任务 · {run ? runLabel(run) : '处理中'}</span>
                </div>
              ) : !automationStatus.projectRootReady ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">请先打开项目</p>
              ) : !foundationReady ? (
                <p className={cn(
                  'mt-3 rounded-lg px-2.5 py-2 text-[11px]',
                  readiness?.state === 'bridge_unavailable'
                    || readiness?.state === 'autocad_not_installed'
                    || readiness?.state === 'autocad_com_unregistered'
                    || readiness?.state === 'autocad_unsupported'
                    || readiness?.state === 'environment_unavailable'
                    ? 'bg-rose-50 text-rose-700'
                    : 'bg-amber-50 text-amber-700',
                )}>{automationStatus.message}</p>
              ) : null
            ) : (
              <p className="mt-3 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] text-rose-700">暂不可用</p>
            )}

            {developerToolsAvailable && diagnosticsOpen ? (
              <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white p-2">
                <div className="flex items-center gap-1.5">
                  <Wrench className="h-3 w-3 text-slate-500" />
                  <span className="text-[10px] font-medium text-slate-600">诊断</span>
                  <button
                    type="button"
                    className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                    onClick={toggleDiagnostics}
                    disabled={diagnosticsBusy}
                  >
                    关闭
                  </button>
                </div>

                {diagnosticsOpen ? (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[9px] text-slate-500">
                      <span>{diagnostics ? `${diagnostics.readiness.bridge.state} · plot ${diagnostics.readiness.plot.ready ? 'ready' : diagnostics.readiness.plot.state}` : '读取地基与可信索引'}</span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                        onClick={() => void loadDiagnostics()}
                        disabled={diagnosticsBusy}
                      >
                        <RefreshCw className={cn('h-2.5 w-2.5', diagnosticsBusy && 'animate-spin')} />刷新
                      </button>
                    </div>
                    {diagnosticsError ? <p className="rounded bg-rose-50 px-1.5 py-1 text-[9px] text-rose-700">{diagnosticsError}</p> : null}
                    {diagnosticsMessage ? <p className="rounded bg-emerald-50 px-1.5 py-1 text-[9px] text-emerald-700">{diagnosticsMessage}</p> : null}

                    {diagnostics ? (
                      <div className="rounded bg-slate-50 px-1.5 py-1 text-[8px] leading-relaxed text-slate-500">
                        <p>bridge · {diagnostics.readiness.bridge.reachable ? 'reachable' : 'unavailable'} · restart {diagnostics.readiness.bridge.restartCount}</p>
                        <p>AutoCAD · {diagnostics.readiness.autocad.state} · full {String(diagnostics.readiness.autocad.fullInstalled)} · {diagnostics.readiness.autocad.documentCount} docs</p>
                        <p>plot · {diagnostics.readiness.plot.state} · PDF {String(diagnostics.readiness.plot.configurations.pdf)} · PNG {String(diagnostics.readiness.plot.configurations.png)}</p>
                        {diagnostics.readiness.bridge.lastError ? <p className="text-rose-600">{diagnostics.readiness.bridge.lastError.code} · {diagnostics.readiness.bridge.lastError.message}</p> : null}
                        <button
                          type="button"
                          className="mt-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[8px] text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                          onClick={() => void restartBridge()}
                          disabled={diagnosticsBusy || busy || diagnostics.readiness.bridge.activeLeases > 1}
                          title="仅重启 HTTP bridge，不关闭 AutoCAD 或图纸"
                        >
                          安全重启 bridge
                        </button>
                      </div>
                    ) : null}

                    {invalidationTarget ? (
                      <div className="rounded border border-amber-200 bg-amber-50 p-1.5">
                        <p className="text-[9px] leading-snug text-amber-800">
                          重置“{invalidationTarget.drawingPath}”的{invalidationTarget.artifactKind === 'entities' ? '实体' : '视觉'}索引登记？文件会保留，下次相关任务自动重建。
                        </p>
                        <div className="mt-1 flex gap-1">
                          <button type="button" className="flex-1 rounded border border-amber-200 bg-white px-1 py-0.5 text-[9px] text-slate-600" onClick={() => setInvalidationTarget(null)} disabled={diagnosticsBusy}>取消</button>
                          <button type="button" className="flex-1 rounded bg-amber-600 px-1 py-0.5 text-[9px] text-white disabled:opacity-50" onClick={() => void invalidateArtifact()} disabled={diagnosticsBusy || busy}>确认重置</button>
                        </div>
                      </div>
                    ) : null}

                    {diagnostics ? (
                      <div className="max-h-72 space-y-1 overflow-y-auto pr-0.5 [content-visibility:auto]">
                        {diagnostics.artifacts.slice(0, 40).map((artifact) => {
                          const canInvalidate = artifact.storageScope === 'project'
                            && (artifact.kind === 'entities' || artifact.kind === 'visual')
                            && Boolean(artifact.manifestPath)
                            && canResetArtifact(artifact.status)
                          return (
                            <div key={`${artifact.storageScope}:${artifact.drawingPath}:${artifact.kind}`} className="rounded bg-slate-50 px-1.5 py-1">
                              <div className="flex items-center gap-1">
                                <span className="min-w-0 flex-1 truncate text-[9px] text-slate-600" title={artifact.drawingPath}>{artifact.drawingPath}</span>
                                <span className="shrink-0 text-[8px] text-slate-400">{artifactKindLabel(artifact.kind)}</span>
                                {canInvalidate ? (
                                  <button type="button" className="shrink-0 rounded px-1 text-[8px] text-amber-700 hover:bg-amber-50 disabled:opacity-50" disabled={diagnosticsBusy || busy} title="重置索引登记" onClick={() => setInvalidationTarget({ drawingPath: artifact.drawingPath, artifactKind: artifact.kind as 'entities' | 'visual' })}>重置</button>
                                ) : null}
                              </div>
                              <p
                                className={cn('truncate text-[8px]', artifactStatusClass(artifact.status))}
                                title={artifact.reason || artifact.status}
                              >
                                {artifactStatusLabel(artifact.status, artifact.kind)}{artifact.sourceSha256 ? ` · sha ${artifact.sourceSha256.slice(0, 10)}` : ''}
                              </p>
                            </div>
                          )
                        })}
                        {diagnostics.artifacts.length === 0 ? <p className="rounded bg-slate-50 px-1.5 py-1 text-[9px] text-slate-500">暂无项目 CAD artifact。</p> : null}
                        {diagnostics.artifacts.length > 40 ? <p className="text-center text-[8px] text-slate-400">仅显示前 40 项</p> : null}
                        {diagnostics.runs.slice(0, 5).map((item) => <p key={item.childRunId} className="truncate px-1 text-[8px] text-slate-400">run {item.childRunId.slice(0, 10)} · {item.status}</p>)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
