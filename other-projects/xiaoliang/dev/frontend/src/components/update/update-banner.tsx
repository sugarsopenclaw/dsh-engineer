import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, LoaderCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { RELEASE_SITE_URL } from '@/constants/client-release'
import { useUiStore } from '@/stores/ui-store'
import { shouldShowUpdateBanner } from '@/components/update/update-state.mts'
import { electronBridge } from '@/services/electron-bridge'

function getBannerMeta(phase: ReturnType<typeof useUiStore.getState>['updateStatus']['phase']) {
  switch (phase) {
    case 'checking':
      return {
        icon: LoaderCircle,
        iconClassName: 'animate-spin text-sky-600',
        title: '正在检查更新',
        toneClassName: 'update-banner--checking',
      }
    case 'available':
    case 'downloading':
      return {
        icon: Download,
        iconClassName: 'text-cyan-600',
        title: '正在下载更新',
        toneClassName: 'update-banner--downloading',
      }
    case 'downloaded':
      return {
        icon: CheckCircle2,
        iconClassName: 'text-emerald-600',
        title: '更新已就绪',
        toneClassName: 'update-banner--downloaded',
      }
    case 'error':
      return {
        icon: AlertCircle,
        iconClassName: 'text-rose-600',
        title: '更新失败',
        toneClassName: 'update-banner--error',
      }
    case 'idle':
      return null
  }
}

function getUpdateNoticeKey(status: ReturnType<typeof useUiStore.getState>['updateStatus']) {
  const family =
    status.phase === 'available' || status.phase === 'downloading'
      ? 'download-flow'
      : status.phase

  return `${family}:${status.version ?? ''}`
}

export function UpdateBanner() {
  const status = useUiStore((s) => s.updateStatus)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  useEffect(() => {
    if (status.phase === 'idle') {
      setDismissedKey(null)
    }
  }, [status.phase])

  if (!shouldShowUpdateBanner(status)) return null

  const meta = getBannerMeta(status.phase)
  if (!meta) return null

  const noticeKey = getUpdateNoticeKey(status)
  if (dismissedKey === noticeKey && !status.forceUpdate) return null

  const Icon = meta.icon
  const openReleaseSite = () => {
    void electronBridge.openExternalUrl(RELEASE_SITE_URL)
  }
  const installUpdate = () => {
    void electronBridge.installAppUpdate()
  }

  return (
    <section className="pointer-events-none fixed right-3 bottom-3 z-[80] w-[min(26rem,calc(100vw-1.5rem))] sm:right-4 sm:bottom-4 sm:w-[24rem]">
      <div className={cn('update-banner pointer-events-auto', meta.toneClassName)}>
        {!status.forceUpdate ? (
          <button
            type="button"
            className="absolute top-3 right-3 z-[2] rounded-full border border-white/60 bg-white/75 p-1 text-slate-400 shadow-sm transition hover:bg-white hover:text-slate-700"
            onClick={() => setDismissedKey(noticeKey)}
            aria-label="关闭更新提示"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <div className="relative z-[1] flex items-start gap-3 pr-8">
          <div className="mt-0.5 rounded-xl bg-white/70 p-2 shadow-sm ring-1 ring-white/60">
            <Icon className={cn('h-4 w-4', meta.iconClassName)} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{meta.title}</h2>
              {status.version ? (
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-black/5">
                  v{status.version}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {status.forceUpdateMessage || status.message}
            </p>

            {status.phase === 'downloaded' ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={installUpdate}>
                  立即重启安装
                </Button>
                <p className="text-xs leading-5 text-slate-500">
                  也可以稍后退出应用时自动完成安装。
                </p>
              </div>
            ) : null}

            {status.phase === 'downloading' && status.percent !== null ? (
              <div className="mt-3">
                <div className="update-banner__progress">
                  <div className="update-banner__progress-bar" style={{ width: `${status.percent}%` }} />
                </div>
              </div>
            ) : null}

            {status.phase === 'error' ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={openReleaseSite}>
                  前往官网下载最新版
                </Button>
                <p className="text-xs leading-5 text-slate-500">
                  自动更新失败时可从官网下载页手动安装最新版本。
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
