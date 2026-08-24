import { renderAsync } from 'docx-preview'

import {
  DOCX_PREVIEW_RUNTIME_CHANNEL,
  MAX_DOCX_PREVIEW_BYTES,
  isDocxPreviewRenderRequest,
  toDocxPreviewErrorText,
} from '../shared/docx-preview-runtime'
import {
  repairPreviewImages,
  replaceMissingImages,
  sanitizeRenderedDocument,
} from './repair-preview-images'

const root = document.getElementById('docx-preview-root')
if (!root) throw new Error('DOCX preview root is missing.')

let renderGeneration = 0

function decodeBase64(value: string) {
  const binary = window.atob(value)
  if (binary.length > MAX_DOCX_PREVIEW_BYTES) throw new Error('DOCX preview exceeds its byte limit.')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function postToParent(message: { type: 'ready' } | {
  type: 'result'
  requestId: number
  success: boolean
  error?: string
}) {
  window.parent.postMessage({
    channel: DOCX_PREVIEW_RUNTIME_CHANNEL,
    ...message,
  }, '*')
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || !isDocxPreviewRenderRequest(event.data)) return
  const request = event.data
  const generation = renderGeneration + 1
  renderGeneration = generation
  root.classList.add('is-rendering')

  const bodyContainer = document.createElement('div')
  const styleContainer = document.createElement('div')
  void Promise.resolve().then(() => renderAsync(
    decodeBase64(request.dataBase64),
    bodyContainer,
    styleContainer,
    {
      className: 'xiaoliang-docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderAltChunks: false,
      renderComments: false,
      useBase64URL: true,
    },
  )).then(() => {
    if (renderGeneration !== generation) return
    repairPreviewImages(styleContainer)
    repairPreviewImages(bodyContainer)
    sanitizeRenderedDocument(styleContainer)
    sanitizeRenderedDocument(bodyContainer)
    replaceMissingImages(styleContainer)
    replaceMissingImages(bodyContainer)
    root.replaceChildren(...styleContainer.childNodes, ...bodyContainer.childNodes)
    root.classList.remove('is-rendering')
    postToParent({ type: 'result', requestId: request.requestId, success: true })
  }).catch((error: unknown) => {
    if (renderGeneration !== generation) return
    root.replaceChildren()
    root.classList.remove('is-rendering')
    postToParent({
      type: 'result',
      requestId: request.requestId,
      success: false,
      error: toDocxPreviewErrorText(error),
    })
  })
})

postToParent({ type: 'ready' })
