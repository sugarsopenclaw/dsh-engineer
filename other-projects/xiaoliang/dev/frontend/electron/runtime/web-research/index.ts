import { extractHtmlDocument } from './extract-html'
import { extractPdfDocument } from './extract-pdf'
import {
  fetchResource,
  normalizeRequestUrl,
  WebReadError,
  type FetchResourceOptions,
} from './http-client'
import {
  formatWebArtifactStorageWarning,
  storeWebPage,
  type StoredPage,
} from './page-store'
import { renderWebPage, type RenderWebPageExecutor } from './render-window'
import { isWebRenderEnabled } from '../agent/subagents/feature-flags'

export { WebReadError } from './http-client'
export {
  WEB_ARTIFACT_ROOT,
  webPagesRelativeDir,
} from './page-store'
export { renderWebPage } from './render-window'
export type { RenderedWebPage, RenderWebPageExecutor, RenderWebPageOptions } from './render-window'

/** How much of the page the caller sees inline before it has to read the stored file. */
export const DEFAULT_INLINE_CHARS = 20_000
export const MAX_INLINE_CHARS = 60_000
export const WEB_READ_CACHE_TTL_MS = 15 * 60 * 1_000
export const WEB_READ_CACHE_MAX_ENTRIES = 64
export const WEB_READ_GLOBAL_CONCURRENCY = 4
export const WEB_READ_HOST_CONCURRENCY = 2
const WEB_READ_RETRY_BASE_MS = 800

export interface ReadWebPageInput {
  projectRoot?: string
  url: string
  maxChars?: number
  maxPdfPages?: number
  /** Forces Chromium extraction for HTML; PDFs and plain text keep their native readers. */
  render?: boolean
}

export interface ReadWebPageOptions extends FetchResourceOptions {
  renderEnabled?: boolean
  /** Test seam and future browser-provider seam; production defaults to the hidden window. */
  renderPage?: RenderWebPageExecutor
}

export interface ReadWebPageResult {
  url: string
  finalUrl: string
  title: string
  httpStatus: number
  contentType: string
  kind: 'html' | 'pdf' | 'text'
  stored?: StoredPage
  preview: string
  truncated: boolean
  totalChars: number
  pageCount?: number
  redirects: string[]
  /** Present only when the network/extraction stage came from the 15-minute process cache. */
  cacheAgeMs?: number
  /** Artifact persistence is best-effort; extraction remains usable when it fails. */
  storageWarning?: string
}

interface ExtractedWebDocument {
  finalUrl: string
  title: string
  httpStatus: number
  contentType: string
  kind: ReadWebPageResult['kind']
  markdown: string
  pageCount?: number
  redirects: string[]
  extractionNote: string
}

interface CachedWebDocument {
  cachedAt: number
  document: ExtractedWebDocument
}

interface GateWaiter {
  host: string
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
}

class WebReadConcurrencyGate {
  private active = 0
  private readonly activeByHost = new Map<string, number>()
  private readonly waiters: GateWaiter[] = []

  acquire(host: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new WebReadError('CANCELLED', '抓取已取消。'))
    }
    return new Promise((resolve, reject) => {
      const waiter: GateWaiter = { host, resolve, reject, ...(signal ? { signal } : {}) }
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          reject(new WebReadError('CANCELLED', '抓取已取消。'))
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.waiters.push(waiter)
      this.dispatch()
    })
  }

  snapshot() {
    return {
      active: this.active,
      queued: this.waiters.length,
      activeByHost: Object.fromEntries(this.activeByHost),
    }
  }

  private dispatch(): void {
    while (this.active < WEB_READ_GLOBAL_CONCURRENCY) {
      const index = this.waiters.findIndex((waiter) => (
        !waiter.signal?.aborted
        && (this.activeByHost.get(waiter.host) ?? 0) < WEB_READ_HOST_CONCURRENCY
      ))
      if (index < 0) return
      const [waiter] = this.waiters.splice(index, 1)
      if (waiter.onAbort && waiter.signal) {
        waiter.signal.removeEventListener('abort', waiter.onAbort)
      }
      this.active += 1
      this.activeByHost.set(waiter.host, (this.activeByHost.get(waiter.host) ?? 0) + 1)
      let released = false
      waiter.resolve(() => {
        if (released) return
        released = true
        this.active = Math.max(0, this.active - 1)
        const remaining = Math.max(0, (this.activeByHost.get(waiter.host) ?? 1) - 1)
        if (remaining > 0) this.activeByHost.set(waiter.host, remaining)
        else this.activeByHost.delete(waiter.host)
        this.dispatch()
      })
    }
  }
}

const webReadCache = new Map<string, CachedWebDocument>()
const webReadGate = new WebReadConcurrencyGate()

function looksLikePdf(contentType: string, body: Buffer, url: string): boolean {
  if (contentType.includes('application/pdf')) return true
  if (body.subarray(0, 5).toString('latin1') === '%PDF-') return true
  return /\.pdf($|[?#])/iu.test(url)
}

function looksLikeHtml(contentType: string, body: Buffer): boolean {
  if (contentType.includes('text/html') || contentType.includes('application/xhtml')) return true
  if (contentType.includes('text/markdown') || contentType.includes('text/plain')) return false
  const head = body.subarray(0, 2048).toString('latin1').toLowerCase()
  return head.includes('<html') || head.includes('<!doctype html')
}

function normalizeCharsetLabel(rawLabel: string): string {
  const label = rawLabel.trim().toLowerCase().replace(/["']/gu, '')
  if (label === 'utf8') return 'utf-8'
  if (label === 'gb2312' || label === 'gb_2312-80' || label === 'gbk' || label === 'x-gbk') {
    return 'gb18030'
  }
  return label
}

function declaredCharset(contentType: string, body: Buffer): string | null {
  const header = /charset\s*=\s*["']?\s*([^;\s"']+)/iu.exec(contentType)?.[1]
  if (header) return normalizeCharsetLabel(header)
  const head = body.subarray(0, 8_192).toString('latin1')
  const meta = /<meta\b[^>]*charset\s*=\s*["']?\s*([a-z0-9._-]+)/iu.exec(head)?.[1]
    ?? /<meta\b[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9._-]+)/iu.exec(head)?.[1]
  return meta ? normalizeCharsetLabel(meta) : null
}

export function decodeWebText(body: Buffer, contentType: string): { text: string; charset: string } {
  const declared = declaredCharset(contentType, body)
  if (declared) {
    try {
      return { text: new TextDecoder(declared).decode(body), charset: declared }
    } catch {
      throw new WebReadError('UNSUPPORTED_CHARSET', `网页声明了本机不支持的字符编码：${declared}`)
    }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), charset: 'utf-8' }
  } catch {
    // A sizeable share of older Chinese public pages omit the header but are GBK-compatible.
    try {
      return { text: new TextDecoder('gb18030', { fatal: true }).decode(body), charset: 'gb18030-sniffed' }
    } catch {
      throw new WebReadError(
        'UNSUPPORTED_CHARSET',
        '网页正文既不是有效 UTF-8，也不能按 GB18030 解码；为避免把乱码当原文，本次拒绝落盘。',
      )
    }
  }
}

/**
 * Conservative SPA-shell detector. A short legitimate page remains static unless the raw
 * HTML also carries a known application root/loading marker or several external bundles.
 */
export function looksLikeHtmlSkeleton(markdown: string, html: string): boolean {
  const visible = markdown
    .replace(/[`*_#>\[\]()|!-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (visible.length >= 240) return false

  // Script/style bodies routinely contain words like "loading"; only markup and
  // visible copy may count as shell markers. Script tags themselves stay, so
  // `<script id="__NEXT_DATA__">` and external-bundle counting are unaffected.
  const markup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
  const hasShellMarker = /(?:\bid=["'](?:root|app|__next)["']|\bdata-reactroot\b|\bng-version\b|__NEXT_DATA__|请(?:开启|启用)\s*JavaScript|enable\s+JavaScript|正在加载|加载中|loading(?!\s*=)\.{0,3})/iu.test(markup)
  const externalScripts = html.match(/<script\b[^>]*\bsrc\s*=/giu)?.length ?? 0
  return hasShellMarker && (visible.length < 120 || externalScripts >= 2)
}

function webReadCacheKey(input: ReadWebPageInput): string {
  const url = normalizeRequestUrl(input.url).toString()
  const maxPdfPages = Math.max(1, Math.min(input.maxPdfPages ?? 400, 400))
  return JSON.stringify([url, maxPdfPages, Boolean(input.render)])
}

function getCachedWebDocument(key: string): { document: ExtractedWebDocument; ageMs: number } | null {
  const cached = webReadCache.get(key)
  if (!cached) return null
  const ageMs = Math.max(0, Date.now() - cached.cachedAt)
  if (ageMs >= WEB_READ_CACHE_TTL_MS) {
    webReadCache.delete(key)
    return null
  }
  webReadCache.delete(key)
  webReadCache.set(key, cached)
  return { document: cached.document, ageMs }
}

function cacheWebDocument(key: string, document: ExtractedWebDocument): void {
  webReadCache.delete(key)
  webReadCache.set(key, { cachedAt: Date.now(), document })
  while (webReadCache.size > WEB_READ_CACHE_MAX_ENTRIES) {
    const oldestKey = webReadCache.keys().next().value as string | undefined
    if (!oldestKey) break
    webReadCache.delete(oldestKey)
  }
}

function isRetryableWebReadError(error: unknown): boolean {
  return error instanceof WebReadError && (
    error.code === 'TIMEOUT'
    || error.code === 'RENDER_TIMEOUT'
    || (typeof error.httpStatus === 'number' && error.httpStatus >= 500)
  )
}

async function retryDelay(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new WebReadError('CANCELLED', '抓取已取消。')
  const milliseconds = WEB_READ_RETRY_BASE_MS + Math.floor(Math.random() * 201)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new WebReadError('CANCELLED', '抓取已取消。'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function fetchAndExtractWebDocument(
  input: ReadWebPageInput,
  options: ReadWebPageOptions,
): Promise<ExtractedWebDocument> {
  const resource = await fetchResource(input.url, options)
  let finalUrl = resource.finalUrl
  let redirects = [...resource.redirects]
  let title = ''
  let markdown = ''
  let kind: ReadWebPageResult['kind'] = 'text'
  let pageCount: number | undefined
  let extractionNote = 'plain-text'

  if (looksLikePdf(resource.contentType, resource.body, resource.finalUrl)) {
    const extraction = await extractPdfDocument(resource.body, {
      ...(input.maxPdfPages ? { maxPages: input.maxPdfPages } : {}),
    })
    title = extraction.title
    markdown = extraction.markdown
    kind = 'pdf'
    pageCount = extraction.pageCount
    extractionNote = `pdfjs:${extraction.extractedPages}/${extraction.pageCount}`
    if (!markdown.trim()) {
      throw new WebReadError(
        'PDF_NO_TEXT_LAYER',
        '该 PDF 没有可提取的文字层（多为扫描件或图片版），本机取不到原文；请另找可读版本或在限制中说明。',
      )
    }
  } else if (looksLikeHtml(resource.contentType, resource.body)) {
    kind = 'html'
    let decodedHtml = ''
    if (!input.render) {
      const decoded = decodeWebText(resource.body, resource.contentType)
      decodedHtml = decoded.text
      const extraction = extractHtmlDocument(decoded.text, resource.finalUrl)
      title = extraction.title
      markdown = extraction.markdown
      extractionNote = `html:${extraction.usedSelector};charset=${decoded.charset}`
    }

    const skeletonDetected = Boolean(
      !input.render
      && markdown.trim()
      && looksLikeHtmlSkeleton(markdown, decodedHtml),
    )
    const shouldRender = Boolean(input.render || !markdown.trim() || skeletonDetected)
    const renderEnabled = options.renderEnabled ?? isWebRenderEnabled()
    if (shouldRender) {
      if (!renderEnabled) {
        if (input.render) {
          throw new WebReadError('RENDER_DISABLED', '网页脚本渲染已由 XIAOLIANG_WEB_RENDER 关闭。')
        }
        if (skeletonDetected) {
          throw new WebReadError(
            'EMPTY_DOCUMENT',
            '静态页面只有应用骨架；本机脚本渲染默认关闭，将改用安全的后端网页抓取。',
          )
        }
      } else {
        let rendered: Awaited<ReturnType<RenderWebPageExecutor>>
        try {
          rendered = await (options.renderPage ?? renderWebPage)(resource.finalUrl, {
            ...(options.signal ? { signal: options.signal } : {}),
            ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}),
            ...(options.resolveProxy ? { resolveProxy: options.resolveProxy } : {}),
          })
        } catch (error) {
          const failureContext = input.render
            ? '强制脚本渲染失败'
            : skeletonDetected
              ? '静态页面只有应用骨架，自动脚本渲染也失败'
              : '静态页面没有可提取正文，自动脚本渲染也失败'
          if (error instanceof WebReadError) {
            throw new WebReadError(
              error.code,
              `${failureContext}：${error.message}`,
              { ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}) },
            )
          }
          throw new WebReadError(
            'RENDER_FAILED',
            `${failureContext}：${error instanceof Error ? error.message : String(error)}`,
          )
        }
        const extraction = extractHtmlDocument(rendered.html, rendered.finalUrl)
        title = rendered.title || extraction.title
        markdown = extraction.markdown
        finalUrl = rendered.finalUrl
        redirects = [...new Set([...redirects, ...rendered.redirects])]
        extractionNote = `rendered:${extraction.usedSelector}`
      }
    }
    if (!markdown.trim()) {
      throw new WebReadError(
        'EMPTY_DOCUMENT',
        shouldRender && renderEnabled
          ? input.render
            ? '该页面强制脚本渲染后没有可提取正文，可能需要登录或交互。'
            : '该页面静态抓取和脚本渲染后都没有可提取正文，可能需要登录或交互。'
          : '该页面没有可提取正文；脚本渲染当前已关闭，或页面需要登录/交互。',
      )
    }
  } else {
    const decoded = decodeWebText(resource.body, resource.contentType)
    markdown = decoded.text.trim()
    extractionNote = `plain-text;charset=${decoded.charset}`
    if (!markdown) {
      throw new WebReadError('EMPTY_DOCUMENT', '该地址返回的内容为空或不是可读文本。')
    }
  }

  return {
    finalUrl,
    title,
    httpStatus: resource.status,
    contentType: resource.contentType,
    kind,
    markdown,
    ...(pageCount !== undefined ? { pageCount } : {}),
    redirects,
    extractionNote,
  }
}

async function materializeWebDocument(
  input: ReadWebPageInput,
  document: ExtractedWebDocument,
  cacheAgeMs?: number,
): Promise<ReadWebPageResult> {
  const projectRoot = input.projectRoot?.trim() || ''
  const limit = Math.max(1_000, Math.min(input.maxChars ?? DEFAULT_INLINE_CHARS, MAX_INLINE_CHARS))
  const truncated = document.markdown.length > limit
  let stored: StoredPage | undefined
  let storageWarning: string | undefined
  if (projectRoot && truncated) {
    try {
      stored = await storeWebPage({
        projectRoot,
        url: document.finalUrl,
        title: document.title || document.finalUrl,
        markdown: document.markdown,
        httpStatus: document.httpStatus,
        contentType: document.contentType,
        ...(document.pageCount !== undefined ? { pageCount: document.pageCount } : {}),
        ...(document.redirects.length > 0 ? { redirects: document.redirects } : {}),
        extractionNote: document.extractionNote,
      })
    } catch (error) {
      storageWarning = formatWebArtifactStorageWarning(error)
      console.warn('[web-artifact] local page store failed', storageWarning)
    }
  }

  return {
    url: input.url,
    finalUrl: document.finalUrl,
    title: document.title,
    httpStatus: document.httpStatus,
    contentType: document.contentType,
    kind: document.kind,
    stored,
    preview: truncated ? document.markdown.slice(0, limit) : document.markdown,
    truncated,
    totalChars: document.markdown.length,
    ...(document.pageCount !== undefined ? { pageCount: document.pageCount } : {}),
    redirects: [...document.redirects],
    ...(cacheAgeMs !== undefined ? { cacheAgeMs } : {}),
    ...(storageWarning ? { storageWarning } : {}),
  }
}

/**
 * Fetches a page on this machine and converts it to Markdown. Short text stays inline;
 * truncated text is written into the current project when possible, while storage failure
 * still returns a bounded preview. Successful extraction is cached for 15 minutes; network
 * work is capped at four global calls and two calls per host.
 */
export async function readWebPage(
  input: ReadWebPageInput,
  options: ReadWebPageOptions = {},
): Promise<ReadWebPageResult> {
  const key = webReadCacheKey(input)
  const cached = getCachedWebDocument(key)
  if (cached) return materializeWebDocument(input, cached.document, cached.ageMs)

  const host = normalizeRequestUrl(input.url).hostname.toLowerCase()
  const release = await webReadGate.acquire(host, options.signal)
  try {
    // A preceding call may have filled the cache while this call was waiting at the gate.
    const afterWait = getCachedWebDocument(key)
    if (afterWait) return materializeWebDocument(input, afterWait.document, afterWait.ageMs)

    let document: ExtractedWebDocument
    try {
      document = await fetchAndExtractWebDocument(input, options)
    } catch (error) {
      if (!isRetryableWebReadError(error)) throw error
      await retryDelay(options.signal)
      document = await fetchAndExtractWebDocument(input, options)
    }
    cacheWebDocument(key, document)
    return materializeWebDocument(input, document)
  } finally {
    release()
  }
}

export function clearWebReadCache(): void {
  webReadCache.clear()
}

export function getWebReadConcurrencySnapshot() {
  return webReadGate.snapshot()
}
