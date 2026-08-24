import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  COMPACT_WINDOW_WIDTH,
  WINDOW_MODE_LAYOUT_TRANSITION_MS,
  WINDOW_MODE_SETTLE_GRACE_MS,
  WIDE_LAYOUT_MIN_WIDTH,
  type WindowMode,
} from '@/shared/window-state'

const PANEL_STORAGE_KEY = 'xiaoliang:workspace-panels:v5'
const LEGACY_PANEL_STORAGE_KEYS = [
  'xiaoliang:workspace-panels:v4',
  'xiaoliang:workspace-panels:v3',
] as const
const MIN_LEFT_WIDTH = 220
const MAX_LEFT_WIDTH = 380
const MIN_RIGHT_WIDTH = 300
const DEFAULT_LEFT_WIDTH = 250
const DEFAULT_RIGHT_WIDTH = 520
const MIN_CENTER_WIDTH = COMPACT_WINDOW_WIDTH
const SEPARATOR_WIDTH = 1
const LAYOUT_SETTLE_MS = 80
const WIDE_REVEAL_FALLBACK_MS = WINDOW_MODE_LAYOUT_TRANSITION_MS + WINDOW_MODE_SETTLE_GRACE_MS

type PanelSide = 'left' | 'right'
type LayoutPhase = 'compact' | 'expanding' | 'wide' | 'collapsing'

type PanelWidths = {
  left: number
  right: number
}

type DragState = {
  panel: PanelSide
  pointerId: number
  startX: number
  startWidth: number
}

type WorkspaceGridStyle = CSSProperties & {
  '--workspace-motion-duration': string
}

interface ResizableWorkspaceProps {
  mode: WindowMode
  left: ReactNode
  right: ReactNode
  children: ReactNode
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function maxWidthForPanel(panel: PanelSide, containerWidth: number, otherWidth: number) {
  const available = containerWidth - otherWidth - MIN_CENTER_WIDTH - SEPARATOR_WIDTH * 2
  return panel === 'left' ? Math.min(MAX_LEFT_WIDTH, available) : available
}

function widthsEqual(left: PanelWidths, right: PanelWidths) {
  return left.left === right.left && left.right === right.right
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function readStoredWidths(raw: string | null): PanelWidths | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PanelWidths>
    const left = Number(parsed.left)
    const right = Number(parsed.right)
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null
    return {
      left: clamp(left, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH),
      right: Math.max(MIN_RIGHT_WIDTH, right),
    }
  } catch {
    return null
  }
}

function loadPanelWidths(): PanelWidths {
  const defaults = { left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH }
  if (typeof window === 'undefined') return defaults

  try {
    const current = readStoredWidths(window.localStorage.getItem(PANEL_STORAGE_KEY))
    if (current) return current

    for (const key of LEGACY_PANEL_STORAGE_KEYS) {
      const legacy = readStoredWidths(window.localStorage.getItem(key))
      if (!legacy) continue
      if (legacy.left > MIN_LEFT_WIDTH && legacy.right > MIN_RIGHT_WIDTH) {
        return legacy
      }
    }
    return defaults
  } catch {
    return defaults
  }
}

function savePanelWidths(widths: PanelWidths) {
  try {
    window.localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(widths))
  } catch {
    /* localStorage may be unavailable; panel resizing still works for this session. */
  }
}

function fitPanelWidths(widths: PanelWidths, containerWidth: number): PanelWidths {
  let left = clamp(widths.left, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH)
  let right = Math.max(MIN_RIGHT_WIDTH, widths.right)
  let excess = left + right - Math.max(
    MIN_LEFT_WIDTH + MIN_RIGHT_WIDTH,
    containerWidth - MIN_CENTER_WIDTH - SEPARATOR_WIDTH * 2,
  )

  if (excess > 0) {
    const rightReduction = Math.min(excess, right - MIN_RIGHT_WIDTH)
    right -= rightReduction
    excess -= rightReduction
  }
  if (excess > 0) {
    left -= Math.min(excess, left - MIN_LEFT_WIDTH)
  }
  return { left, right }
}

/**
 * 网格模板的唯一来源：React 渲染和指针拖拽都必须经过这里，
 * 否则拖拽写到的会是网格没在用的那份声明。
 */
function resolveGridTemplateColumns(phase: LayoutPhase, widths: PanelWidths) {
  if (phase !== 'wide' && phase !== 'collapsing') return 'minmax(0, 1fr)'
  const separator = widths.left === 0 && widths.right === 0 ? 0 : SEPARATOR_WIDTH
  return `${widths.left}px ${separator}px minmax(0, 1fr) ${separator}px ${widths.right}px`
}

export function ResizableWorkspace({ mode, left, right, children }: ResizableWorkspaceProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const preferredWidthsRef = useRef<PanelWidths>(loadPanelWidths())
  const phaseRef = useRef<LayoutPhase>(mode === 'wide' ? 'wide' : 'compact')
  const [phase, setPhase] = useState<LayoutPhase>(phaseRef.current)
  const [widths, setWidths] = useState<PanelWidths>(() => (
    mode === 'wide' ? preferredWidthsRef.current : { left: 0, right: 0 }
  ))
  const liveWidthsRef = useRef(widths)
  const renderedWidths = dragRef.current ? liveWidthsRef.current : widths
  const useWideGrid = phase === 'wide' || phase === 'collapsing'
  const animatePanels = !dragRef.current && !prefersReducedMotion()
    && (phase === 'wide' || phase === 'collapsing')

  const setPhaseSafe = useCallback((next: LayoutPhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const setDisplayWidths = useCallback((next: PanelWidths) => {
    if (widthsEqual(liveWidthsRef.current, next)) return
    liveWidthsRef.current = next
    setWidths(next)
  }, [])

  const fitPreferredToContainer = useCallback(() => {
    const containerWidth = rootRef.current?.getBoundingClientRect().width ?? 0
    setDisplayWidths(fitPanelWidths(preferredWidthsRef.current, containerWidth))
  }, [setDisplayWidths])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined

    let settleTimer: number | null = null
    let collapseTimer: number | null = null
    let revealFallbackTimer: number | null = null

    const clearTimers = () => {
      if (settleTimer !== null) window.clearTimeout(settleTimer)
      if (collapseTimer !== null) window.clearTimeout(collapseTimer)
      if (revealFallbackTimer !== null) window.clearTimeout(revealFallbackTimer)
      settleTimer = null
      collapseTimer = null
      revealFallbackTimer = null
    }

    if (mode === 'compact') {
      if (phaseRef.current !== 'compact') {
        setPhaseSafe('collapsing')
        setDisplayWidths({ left: 0, right: 0 })
        const delay = prefersReducedMotion() ? 0 : WINDOW_MODE_LAYOUT_TRANSITION_MS
        collapseTimer = window.setTimeout(() => {
          setPhaseSafe('compact')
        }, delay)
      }
      return clearTimers
    }

    if (phaseRef.current !== 'wide') {
      setPhaseSafe('expanding')
      setDisplayWidths({ left: 0, right: 0 })
    }

    const revealWideLayout = () => {
      fitPreferredToContainer()
      setPhaseSafe('wide')
    }

    const scheduleReveal = () => {
      if (settleTimer !== null) window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        settleTimer = null
        if (dragRef.current) return
        if (phaseRef.current === 'wide') {
          fitPreferredToContainer()
          return
        }
        // 展开途中窗口可能还是小窗尺寸，先等它长大再显示侧栏；
        // 长不到宽窗阈值时由兜底计时器照实际宽度揭示，避免永久停在 expanding。
        if (root.getBoundingClientRect().width < WIDE_LAYOUT_MIN_WIDTH) return
        revealWideLayout()
      }, phaseRef.current === 'wide' ? 0 : LAYOUT_SETTLE_MS)
    }

    scheduleReveal()
    if (phaseRef.current !== 'wide') {
      revealFallbackTimer = window.setTimeout(() => {
        revealFallbackTimer = null
        if (phaseRef.current === 'wide') return
        revealWideLayout()
      }, WIDE_REVEAL_FALLBACK_MS)
    }
    const observer = new ResizeObserver(() => {
      if (dragRef.current) return
      scheduleReveal()
    })
    observer.observe(root)
    return () => {
      clearTimers()
      observer.disconnect()
    }
  }, [fitPreferredToContainer, mode, setDisplayWidths, setPhaseSafe])

  const constrainWidth = useCallback((panel: PanelSide, requested: number) => {
    const containerWidth = rootRef.current?.getBoundingClientRect().width ?? 1280
    const otherWidth = panel === 'left'
      ? liveWidthsRef.current.right
      : liveWidthsRef.current.left
    const min = panel === 'left' ? MIN_LEFT_WIDTH : MIN_RIGHT_WIDTH
    return clamp(requested, min, maxWidthForPanel(panel, containerWidth, otherWidth))
  }, [])

  const applyLiveWidth = useCallback((panel: PanelSide, width: number) => {
    const nextWidths = { ...liveWidthsRef.current, [panel]: width }
    liveWidthsRef.current = nextWidths
    const root = rootRef.current
    if (!root) return
    root.style.gridTemplateColumns = resolveGridTemplateColumns(phaseRef.current, nextWidths)
  }, [])

  const finishDrag = useCallback((pointerId: number) => {
    if (dragRef.current?.pointerId !== pointerId) return
    dragRef.current = null
    document.body.classList.remove('workspace-panel-resizing')
    const nextWidths = { ...liveWidthsRef.current }
    preferredWidthsRef.current = nextWidths
    setWidths(nextWidths)
    savePanelWidths(nextWidths)
  }, [])

  const handlePointerDown = useCallback((panel: PanelSide, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startWidth = panel === 'left'
      ? liveWidthsRef.current.left
      : liveWidthsRef.current.right
    dragRef.current = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('workspace-panel-resizing')
  }, [])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = event.clientX - drag.startX
    const requested = drag.panel === 'left'
      ? drag.startWidth + delta
      : drag.startWidth - delta
    applyLiveWidth(drag.panel, constrainWidth(drag.panel, requested))
  }, [applyLiveWidth, constrainWidth])

  const handleSeparatorKeyDown = useCallback((panel: PanelSide, event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.shiftKey ? 24 : 12
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const signedStep = panel === 'left' ? direction * step : -direction * step
    const nextWidth = constrainWidth(panel, liveWidthsRef.current[panel] + signedStep)
    const nextWidths = { ...liveWidthsRef.current, [panel]: nextWidth }
    liveWidthsRef.current = nextWidths
    preferredWidthsRef.current = nextWidths
    setWidths(nextWidths)
    savePanelWidths(nextWidths)
  }, [constrainWidth])

  const gridStyle: WorkspaceGridStyle = {
    '--workspace-motion-duration': `${WINDOW_MODE_LAYOUT_TRANSITION_MS}ms`,
    gridTemplateColumns: resolveGridTemplateColumns(phase, renderedWidths),
  }

  const renderSeparator = (panel: PanelSide) => {
    const value = renderedWidths[panel]
    const min = panel === 'left' ? MIN_LEFT_WIDTH : MIN_RIGHT_WIDTH
    const containerWidth = rootRef.current?.getBoundingClientRect().width ?? 1280
    const otherWidth = panel === 'left' ? renderedWidths.right : renderedWidths.left
    const max = maxWidthForPanel(panel, containerWidth, otherWidth)
    return (
      <div
        role="separator"
        aria-label={panel === 'left' ? '调整项目侧边栏宽度' : '调整右侧工作区宽度'}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        className="workspace-panel-separator"
        data-panel-separator={panel}
        onKeyDown={(event) => handleSeparatorKeyDown(panel, event)}
        onPointerDown={(event) => handlePointerDown(panel, event)}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishDrag(event.pointerId)}
        onPointerCancel={(event) => finishDrag(event.pointerId)}
        onLostPointerCapture={(event) => finishDrag(event.pointerId)}
      />
    )
  }

  return (
    <div
      ref={rootRef}
      className="resizable-workspace grid min-h-0 min-w-0 flex-1 overflow-hidden"
      style={gridStyle}
      data-resizable-workspace="true"
      data-window-mode={mode}
      data-workspace-phase={phase}
      data-panel-motion={animatePanels ? 'animate' : 'none'}
    >
      <div className="min-h-0 min-w-0 overflow-hidden bg-slate-50" hidden={!useWideGrid}>
        {left}
      </div>
      {useWideGrid ? renderSeparator('left') : null}
      <div className="min-h-0 min-w-0 overflow-hidden bg-white">
        {children}
      </div>
      {useWideGrid ? renderSeparator('right') : null}
      <aside
        aria-label="文件预览与子代理工作区"
        className="min-h-0 min-w-0 overflow-hidden bg-slate-50"
        hidden={!useWideGrid}
      >
        {right}
      </aside>
    </div>
  )
}
