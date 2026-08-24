import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  CAD_PREVIEW_RUNTIME_CHANNEL,
  isCadPreviewRuntimeMessage,
  type CadPreviewDocumentSummary,
  type CadPreviewOpenRequest,
} from '@/shared/cad-preview-runtime'
import type { ProjectCadPreviewResult } from '@/shared/local-agent'

const RUNTIME_PATH = './cad-preview-runtime.html'
const READY_TIMEOUT_MS = 20_000
/**
 * A watchdog on silence rather than a deadline on the open: a 26k-entity drawing
 * legitimately converts for tens of seconds, but it reports progress the whole way.
 */
const PROGRESS_STALL_TIMEOUT_MS = 60_000

type Phase =
  | { status: 'starting' }
  | { status: 'opening' }
  | { status: 'ready'; document: CadPreviewDocumentSummary }
  | { status: 'error'; message: string }

/**
 * The runtime document is served from the renderer's own origin, so a concrete target
 * origin is only available under the dev server. Packaged builds run on `file://`,
 * where a same-directory frame reports an opaque origin that `postMessage` cannot be
 * addressed by; there we fall back to `'*'` and rely on the frame identity check plus
 * the runtime's CSP, which forbids navigating away from the document we loaded.
 */
function runtimeTargetOrigin(runtimeUrl: URL): string {
  return runtimeUrl.protocol === 'http:' || runtimeUrl.protocol === 'https:'
    ? runtimeUrl.origin
    : '*'
}

export function ProjectCadPreview({
  preview,
  onRetry,
}: {
  preview: ProjectCadPreviewResult
  onRetry: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const requestIdRef = useRef(0)
  const [phase, setPhase] = useState<Phase>({ status: 'starting' })
  const runtimeUrl = new URL(RUNTIME_PATH, window.location.href)

  const request = useMemo<Omit<CadPreviewOpenRequest, 'requestId'>>(() => ({
    channel: CAD_PREVIEW_RUNTIME_CHANNEL,
    type: 'open',
    fileName: preview.name,
    sourceUrl: preview.sourceUrl,
    cadDataBaseUrl: preview.cadDataBaseUrl,
    locale: 'zh',
    // The panel chrome is light; the drawing's own COLORTHEME still drives the canvas.
    theme: 'light',
  }), [preview.cadDataBaseUrl, preview.name, preview.sourceUrl])

  useEffect(() => {
    setPhase({ status: 'starting' })
    const requestId = ++requestIdRef.current
    let timer: ReturnType<typeof setTimeout>

    const waitFor = (ms: number, message: string) => {
      clearTimeout(timer)
      timer = setTimeout(() => setPhase({ status: 'error', message }), ms)
    }
    waitFor(READY_TIMEOUT_MS, 'CAD 预览运行时启动超时。')

    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return
      if (!isCadPreviewRuntimeMessage(event.data)) return
      const message = event.data
      if (message.type === 'ready') {
        setPhase({ status: 'opening' })
        frameRef.current.contentWindow?.postMessage(
          { ...request, requestId },
          runtimeTargetOrigin(runtimeUrl),
        )
        waitFor(PROGRESS_STALL_TIMEOUT_MS, '图纸打开无响应，请重试。')
        return
      }
      if (message.requestId !== requestId) return
      if (message.type === 'progress') {
        waitFor(PROGRESS_STALL_TIMEOUT_MS, '图纸打开无响应，请重试。')
        return
      }
      clearTimeout(timer)
      setPhase(message.ok
        ? { status: 'ready', document: message.document }
        : { status: 'error', message: message.error })
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
  }, [request, runtimeUrl.href])

  return (
    <div className="relative h-full min-h-0 w-full bg-slate-100">
      {/* Unlike the docx runtime this frame is not sandboxed: an opaque origin stops
          the CAD parser's Web Workers from loading under `file://`. The runtime
          document's own CSP is the boundary instead.
          The capability is single-use, so a new grant needs a fresh frame. */}
      <iframe
        key={preview.sourceUrl}
        ref={frameRef}
        src={runtimeUrl.toString()}
        title={`${preview.name} CAD 预览`}
        referrerPolicy="no-referrer"
        className="h-full w-full border-0"
      />
      {/* Only covers the blank frame before the runtime boots; from the open request
          on, the viewer draws its own staged progress overlay. */}
      {phase.status === 'starting' ? (
        <div
          role="status"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-100 text-xs text-slate-500"
        >
          <LoaderCircle className="h-5 w-5 animate-spin text-violet-500" />
          <p>启动 CAD 预览…</p>
        </div>
      ) : null}
      {phase.status === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-100 px-5 text-center">
          <p className="text-xs font-medium text-slate-600">无法打开图纸</p>
          <p className="text-[11px] leading-5 text-slate-400">{phase.message}</p>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onRetry}>
            重新加载
          </Button>
        </div>
      ) : null}
      {phase.status === 'ready' && phase.document.fontsNotFound.length > 0 ? (
        <p className="absolute inset-x-0 bottom-0 bg-amber-50/95 px-2.5 py-1.5 text-[10px] leading-4 text-amber-700">
          缺少字体 {phase.document.fontsNotFound.slice(0, 4).join('、')}
          {phase.document.fontsNotFound.length > 4 ? ' 等' : ''}，相关文字已使用替代字体显示。
        </p>
      ) : null}
    </div>
  )
}
