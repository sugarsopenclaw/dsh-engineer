import { useLayoutEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DOCX_PREVIEW_RUNTIME_CHANNEL,
  isDocxPreviewRuntimeMessage,
} from '@/shared/docx-preview-runtime'

const RUNTIME_PATH = './docx-preview-runtime.html'
const READY_TIMEOUT_MS = 20_000
const RENDER_TIMEOUT_MS = 30_000

type Phase =
  | { status: 'starting' }
  | { status: 'rendering' }
  | { status: 'ready' }
  | { status: 'error'; message: string }

export function ProjectDocxPreview({ dataBase64 }: { dataBase64: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const requestIdRef = useRef(0)
  const dataEpochRef = useRef({ value: dataBase64, epoch: 0 })
  const [reloadToken, setReloadToken] = useState(0)
  const [phase, setPhase] = useState<Phase>({ status: 'starting' })

  if (dataEpochRef.current.value !== dataBase64) {
    dataEpochRef.current = { value: dataBase64, epoch: dataEpochRef.current.epoch + 1 }
  }
  const frameKey = `${reloadToken}:${dataEpochRef.current.epoch}`

  // The runtime is a fast inline script, so subscribe before it can emit its one-shot ready message.
  useLayoutEffect(() => {
    setPhase({ status: 'starting' })
    const requestId = ++requestIdRef.current
    let timer = window.setTimeout(() => {
      setPhase({ status: 'error', message: 'Word 预览运行时启动超时。' })
    }, READY_TIMEOUT_MS)

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (!isDocxPreviewRuntimeMessage(event.data)) return
      const message = event.data
      if (message.type === 'ready') {
        setPhase({ status: 'rendering' })
        frameRef.current.contentWindow?.postMessage({
          channel: DOCX_PREVIEW_RUNTIME_CHANNEL,
          type: 'render',
          requestId,
          dataBase64,
        }, '*')
        window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          setPhase({ status: 'error', message: 'Word 文档渲染超时。' })
        }, RENDER_TIMEOUT_MS)
        return
      }
      if (message.requestId !== requestId) return
      window.clearTimeout(timer)
      setPhase(message.success
        ? { status: 'ready' }
        : { status: 'error', message: message.error?.trim() || 'Word 文档渲染失败。' })
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
    }
  }, [dataBase64, frameKey])

  return (
    <div className="relative h-full min-h-72 bg-slate-100/70">
      <iframe
        key={frameKey}
        ref={frameRef}
        src={new URL(RUNTIME_PATH, window.location.href).toString()}
        title="Word 文档安全预览"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        aria-hidden={phase.status !== 'ready'}
        className="h-full min-h-72 w-full border-0 bg-slate-100/70"
      />
      {phase.status === 'starting' || phase.status === 'rendering' ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-slate-50/90 text-xs text-slate-500"
          role="status"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {phase.status === 'starting' ? '启动 Word 预览…' : '正在渲染 Word 文档…'}
        </div>
      ) : null}
      {phase.status === 'error' ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-50 px-5 text-center">
          <p className="text-xs font-medium text-slate-600">无法打开 Word 文档</p>
          <p className="text-[11px] leading-5 text-slate-400">{phase.message}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setReloadToken((value) => value + 1)}
          >
            重新加载
          </Button>
        </div>
      ) : null}
    </div>
  )
}
