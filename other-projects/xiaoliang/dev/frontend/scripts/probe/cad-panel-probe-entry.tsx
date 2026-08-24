import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { ProjectCadPreview } from '@/components/runtime/project-cad-preview'
import type { ProjectCadPreviewResult } from '@/shared/local-agent'

/**
 * Mounts the real preview component the way the workspace panel does, so the probe
 * exercises the production iframe path (relative `dist/` sibling, ready handshake,
 * postMessage target origin) instead of a hand-rolled stand-in.
 */
const spec = JSON.parse(
  decodeURIComponent(new URLSearchParams(location.search).get('spec') ?? '%7B%7D'),
) as ProjectCadPreviewResult

const emit = (event: Record<string, unknown>) => {
  console.log(`@@probe@@${JSON.stringify(event)}`)
}

const host = document.getElementById('root')
if (!host) throw new Error('probe host element is missing')

// The runtime posts to `window.parent`, which is this harness, so the probe sees the
// same message stream the component reacts to and can settle on the real outcome.
window.addEventListener('message', (event) => {
  const data = event.data as { channel?: string; type?: string; ok?: boolean }
  if (data?.channel !== 'xiaoliang:cad-preview-runtime') return
  emit({ type: 'runtime', message: data })
  if (data.type !== 'result') return
  // Let the component finish reacting before the probe grabs its screenshot.
  setTimeout(() => emit({
    type: 'result',
    ok: data.ok === true,
    panelText: host.textContent?.slice(0, 300) ?? '',
  }), 500)
})

createRoot(host).render(
  <StrictMode>
    <ProjectCadPreview preview={spec} onRetry={() => emit({ type: 'retry' })} />
  </StrictMode>,
)

emit({ type: 'mounted' })
