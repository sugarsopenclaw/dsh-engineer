import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'
import {
  getDefaultAgentEnvironmentStatus,
  type AgentBashPrepareProgress,
  type AgentBlenderMcpPrepareProgress,
  type AgentEnvironmentStatus,
} from '@/shared/local-agent'

const PHASE_LABELS: Record<AgentBashPrepareProgress['phase'], string> = {
  resolving: '获取下载源…',
  downloading: '下载运行时…',
  verifying: '校验完整性…',
  extracting: '解压…',
  validating: '验证 bash…',
  completed: '已完成',
  failed: '失败',
}

const BLENDER_PHASE_LABELS: Record<AgentBlenderMcpPrepareProgress['phase'], string> = {
  resolving: '定位 uv 运行时…',
  installing: '安装 Python 依赖(国内镜像)…',
  validating: '验证依赖环境…',
  completed: '已完成',
  failed: '失败',
}

const BLENDER_PHASE_PERCENT: Record<AgentBlenderMcpPrepareProgress['phase'], number> = {
  resolving: 10,
  installing: 60,
  validating: 90,
  completed: 100,
  failed: 100,
}

function formatMegabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function bashStatusText(status: AgentEnvironmentStatus['bash']) {
  if (status.source === 'managed') {
    return status.version ? `已就绪 · 晓量托管 ${status.version}` : '已就绪 · 晓量托管'
  }
  if (status.source === 'system') return '已就绪 · 系统 Git Bash'
  return '未就绪'
}

function blenderStatusText(status: AgentEnvironmentStatus['blenderMcp']) {
  if (status.customCommand) return '自定义命令'
  if (!status.uvAvailable) return 'uv 缺失'
  if (status.prepared) return '已就绪 · 依赖已预热'
  return '未预热'
}

function blenderStatusTone(status: AgentEnvironmentStatus['blenderMcp']) {
  if (status.customCommand) return 'bg-slate-100 text-slate-600'
  if (!status.uvAvailable) return 'bg-amber-50 text-amber-700'
  if (status.prepared) return 'bg-emerald-50 text-emerald-700'
  return 'bg-amber-50 text-amber-700'
}

function EnvCheckRow({
  title,
  detail,
  detailBreak = 'words',
  actions,
}: {
  title: string
  detail: string
  detailBreak?: 'words' | 'all'
  actions: ReactNode
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-xs font-semibold text-slate-800">{title}</div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      </div>
      <p
        className={`mt-0.5 text-[11px] leading-relaxed text-slate-500 ${
          detailBreak === 'all' ? 'break-all' : 'break-words'
        }`}
      >
        {detail}
      </p>
    </div>
  )
}

function blenderDetailText(status: AgentEnvironmentStatus['blenderMcp']) {
  if (status.customCommand) {
    return '当前使用自定义启动命令,预热仅适用于默认的 uvx 启动方式。'
  }
  if (!status.uvAvailable) {
    return '未找到 uv 运行时;重装晓量可恢复预置组件,或手动安装 uv 后重新检测。'
  }
  if (status.prepared) {
    return `依赖环境已缓存,启动 Blender 建模连接约 1-2 秒。(${status.packageSpec})`
  }
  return '首次使用前建议预热 Python 依赖(走国内镜像,约 20-60 秒);未预热时首次连接可能超时。'
}

/**
 * 设置页「环境检测与准备」:展示 bash 命令行运行时、rg/fd 检索组件与
 * Blender 建模依赖环境状态,缺失时一键准备(国内镜像/后端 OSS,热生效免重启)。
 */
export function EnvPreparePanel({ visible = true }: { visible?: boolean }) {
  const [status, setStatus] = useState<AgentEnvironmentStatus>(() =>
    getDefaultAgentEnvironmentStatus(),
  )
  const [loading, setLoading] = useState(false)
  const [preparingBash, setPreparingBash] = useState(false)
  const [preparingBlender, setPreparingBlender] = useState(false)
  const [bashProgress, setBashProgress] = useState<AgentBashPrepareProgress | null>(null)
  const [blenderProgress, setBlenderProgress] = useState<AgentBlenderMcpPrepareProgress | null>(null)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    if (!isElectronApp()) return
    setLoading(true)
    try {
      const next = await electronBridge.getAgentEnvironmentStatus()
      setStatus(next)
      if (next.bash.preparing) setPreparingBash(true)
      if (next.blenderMcp.preparing) setPreparingBlender(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    void refresh()
  }, [visible, refresh])

  useEffect(() => {
    const unsubscribeBash = electronBridge.onAgentBashPrepareProgress((next) => {
      setBashProgress(next)
      if (next.phase === 'failed') {
        setMessage(next.message ?? '准备失败。')
      }
    })
    const unsubscribeBlender = electronBridge.onAgentBlenderMcpPrepareProgress((next) => {
      setBlenderProgress(next)
      if (next.phase === 'failed') {
        setMessage(next.message ?? '预热失败。')
      }
    })
    return () => {
      unsubscribeBash?.()
      unsubscribeBlender?.()
    }
  }, [])

  const handlePrepareBash = async () => {
    setMessage('')
    setBashProgress(null)
    setPreparingBash(true)
    try {
      const next = await electronBridge.prepareAgentBashRuntime()
      setStatus(next)
      setMessage('bash 运行时已就绪,下一次对话自动生效。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setPreparingBash(false)
    }
  }

  const handlePrepareBlender = async () => {
    setMessage('')
    setBlenderProgress(null)
    setPreparingBlender(true)
    try {
      const next = await electronBridge.prepareAgentBlenderMcpRuntime()
      setStatus(next)
      setMessage('Blender 建模依赖已就绪,连接测试或对话时自动使用。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setPreparingBlender(false)
    }
  }

  const bashReady = status.bash.source !== 'none'
  const bashPercent = bashProgress?.totalBytes && bashProgress.receivedBytes !== undefined
    ? Math.min(100, Math.round((bashProgress.receivedBytes / bashProgress.totalBytes) * 100))
    : null
  const showBlenderPrepare = !status.blenderMcp.customCommand
    && status.blenderMcp.uvAvailable
    && !status.blenderMcp.prepared

  return (
    <section className="order-2 min-w-0 overflow-x-hidden rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">环境检测与准备</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            AI 文件工具与 Blender 建模的本机组件状态。缺失组件仅影响对应能力,其余功能不受影响。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 text-xs"
          disabled={loading || preparingBash || preparingBlender || !isElectronApp()}
          onClick={() => void refresh()}
        >
          重新检测
        </Button>
      </div>

      <div className="mt-4 grid min-w-0 gap-2">
        <EnvCheckRow
          title="bash 命令行运行时"
          detail={status.bash.bashPath ?? '未检测到 Git Bash;可一键准备晓量托管运行时(约 37MB)。'}
          detailBreak="all"
          actions={(
            <>
              <span
                className={`max-w-full rounded-full px-2.5 py-1 text-[11px] font-medium leading-snug ${
                  bashReady
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                {bashStatusText(status.bash)}
              </span>
              {!bashReady ? (
                <Button
                  type="button"
                  size="sm"
                  className="text-xs"
                  disabled={preparingBash || loading || !isElectronApp()}
                  onClick={() => void handlePrepareBash()}
                >
                  {preparingBash ? '准备中…' : '一键准备'}
                </Button>
              ) : null}
            </>
          )}
        />

        {preparingBash && bashProgress ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between text-[11px] text-slate-600">
              <span>{PHASE_LABELS[bashProgress.phase]}</span>
              {bashProgress.phase === 'downloading' && bashProgress.receivedBytes !== undefined ? (
                <span>
                  {formatMegabytes(bashProgress.receivedBytes)}
                  {bashProgress.totalBytes ? ` / ${formatMegabytes(bashProgress.totalBytes)}` : ''}
                </span>
              ) : null}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-slate-600 transition-all"
                style={{ width: `${bashPercent ?? (bashProgress.phase === 'downloading' ? 5 : 90)}%` }}
              />
            </div>
          </div>
        ) : null}

        <EnvCheckRow
          title="文本检索组件(rg / fd)"
          detail="随安装包预置;缺失时重装应用可修复。"
          actions={(
            <span
              className={`max-w-full rounded-full px-2.5 py-1 text-[11px] font-medium leading-snug ${
                status.searchTools.rg && status.searchTools.fd
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {status.searchTools.rg && status.searchTools.fd
                ? '已就绪'
                : `缺失:${[
                  !status.searchTools.rg ? 'rg' : null,
                  !status.searchTools.fd ? 'fd' : null,
                ].filter(Boolean).join('、')}`}
            </span>
          )}
        />

        <EnvCheckRow
          title="Blender 建模依赖(uv 环境)"
          detail={blenderDetailText(status.blenderMcp)}
          actions={(
            <>
              <span
                className={`max-w-full rounded-full px-2.5 py-1 text-[11px] font-medium leading-snug ${blenderStatusTone(status.blenderMcp)}`}
              >
                {blenderStatusText(status.blenderMcp)}
              </span>
              {showBlenderPrepare ? (
                <Button
                  type="button"
                  size="sm"
                  className="text-xs"
                  disabled={preparingBlender || loading || !isElectronApp()}
                  onClick={() => void handlePrepareBlender()}
                >
                  {preparingBlender ? '预热中…' : '一键预热'}
                </Button>
              ) : null}
            </>
          )}
        />

        {preparingBlender && blenderProgress ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-[11px] text-slate-600">
              <span className="shrink-0">{BLENDER_PHASE_LABELS[blenderProgress.phase]}</span>
              {blenderProgress.message ? (
                <span className="truncate text-slate-400">{blenderProgress.message}</span>
              ) : null}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-slate-600 transition-all"
                style={{ width: `${BLENDER_PHASE_PERCENT[blenderProgress.phase]}%` }}
              />
            </div>
          </div>
        ) : null}

        {message ? (
          <p className="text-[11px] leading-relaxed text-slate-500">{message}</p>
        ) : null}
      </div>
    </section>
  )
}
