import { Expand, Maximize2, Minimize2, Minus, Pin, PinOff, Shrink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PRODUCT_DISPLAY_NAME } from '@/constants/app'
import type { WindowState } from '@/shared/window-state'
import logo from '@/assets/logo.png'

interface WindowTitlebarProps {
  windowState: WindowState
  onToggleAlwaysOnTop: () => Promise<void>
  onToggleWindowSize: () => Promise<void>
  onToggleMaximize: () => Promise<void>
  onMinimize: () => void
  onClose: () => void
}

export function WindowTitlebar({
  windowState,
  onToggleAlwaysOnTop,
  onToggleWindowSize,
  onToggleMaximize,
  onMinimize,
  onClose,
}: WindowTitlebarProps) {
  const compactMode = windowState.mode === 'compact'
  const sizeToggleLabel = compactMode ? '切换到宽窗口' : '切换到小窗口'
  const maximizeLabel = windowState.maximized ? '还原窗口' : '最大化窗口'

  return (
    <header className="window-titlebar shrink-0 text-slate-50" data-window-titlebar="true">
      <div className="window-titlebar__drag flex items-center gap-2 px-3">
        <div className="window-titlebar__brand">
          <div className="window-titlebar__logo-shell">
            <img src={logo} alt="" draggable={false} className="window-titlebar__logo" />
          </div>
          <span className="truncate text-sm font-semibold tracking-tight">{PRODUCT_DISPLAY_NAME}</span>
        </div>
      </div>
      <div className="window-titlebar__controls flex items-center gap-1 px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`window-titlebar__button h-8 w-8 text-slate-100/90 hover:bg-white/10 hover:text-white ${
            windowState.alwaysOnTop ? 'bg-violet-400/15 text-violet-100 ring-1 ring-violet-300/20' : ''
          }`}
          aria-label={windowState.alwaysOnTop ? '取消置顶' : '置顶窗口'}
          aria-pressed={windowState.alwaysOnTop}
          title={windowState.alwaysOnTop ? '取消置顶' : '置顶窗口'}
          onClick={() => void onToggleAlwaysOnTop()}
        >
          {windowState.alwaysOnTop ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="window-titlebar__button h-8 w-8 text-slate-100/90 hover:bg-white/10 hover:text-white"
          aria-label={sizeToggleLabel}
          title={sizeToggleLabel}
          onClick={() => void onToggleWindowSize()}
        >
          {compactMode ? <Expand className="h-4 w-4" /> : <Shrink className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="window-titlebar__button h-8 w-8 text-slate-100/90 hover:bg-white/10 hover:text-white"
          aria-label="最小化窗口"
          title="最小化窗口"
          onClick={onMinimize}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="window-titlebar__button h-8 w-8 text-slate-100/90 hover:bg-white/10 hover:text-white"
          aria-label={maximizeLabel}
          title={compactMode ? '宽窗口下可最大化' : maximizeLabel}
          disabled={compactMode}
          onClick={() => void onToggleMaximize()}
        >
          {windowState.maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="window-titlebar__button h-8 w-8 text-slate-100/90 hover:bg-rose-500/85 hover:text-white"
          aria-label="关闭窗口"
          title="关闭窗口"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
