import * as electron from 'electron'
import { randomUUID } from 'node:crypto'

import {
  isWebSystemProxyEnabled,
  MAX_RESPONSE_BYTES,
  normalizeRequestUrl,
  parseProxyRoute,
  WebReadError,
} from './http-client'
import { assertPublicHost, assertSafeTargetHost, SsrfBlockedError } from './ssrf'

const DEFAULT_RENDER_TIMEOUT_MS = 45_000
const DEFAULT_SETTLE_MS = 800
const RENDER_USER_AGENT = 'Mozilla/5.0 (compatible; xiaoliang-web-render/1.0; +https://xl.x3yun.com)'

export interface RenderedWebPage {
  finalUrl: string
  title: string
  html: string
  redirects: string[]
}

export interface RenderWebPageOptions {
  signal?: AbortSignal
  timeoutMs?: number
  settleMs?: number
  resolveHost?: (hostname: string) => Promise<string[]>
  resolveProxy?: (url: string) => Promise<string>
}

export type RenderWebPageExecutor = (
  url: string,
  options?: RenderWebPageOptions,
) => Promise<RenderedWebPage>

let renderQueue: Promise<void> = Promise.resolve()

function cancelled(): WebReadError {
  return new WebReadError('CANCELLED', '网页渲染已取消。')
}

function timeout(milliseconds: number): WebReadError {
  return new WebReadError(
    'RENDER_TIMEOUT',
    `网页脚本渲染超时（${Math.round(milliseconds / 1_000)} 秒）。`,
  )
}

function ssrfWebReadError(error: SsrfBlockedError): WebReadError {
  if (error.reason === 'fake_ip_dns') return new WebReadError('FAKE_IP_DNS', error.message)
  if (error.reason === 'dns_failure') return new WebReadError('DNS_ERROR', error.message)
  return new WebReadError('BLOCKED_HOST', error.message)
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds)
    const onAbort = () => done(cancelled())
    function done(error?: Error) {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function withDeadline<T>(
  operation: Promise<T>,
  milliseconds: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw cancelled()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => finish(timeout(milliseconds)), milliseconds)
    const onAbort = () => finish(cancelled())
    let settled = false
    function finish(error?: Error, value?: T) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(value as T)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    operation.then((value) => finish(undefined, value), (error) => {
      finish(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

export function safeNavigation(
  rawUrl: string,
  expectedHost: string,
  expectedProtocol: 'http:' | 'https:' = 'https:',
): URL | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (expectedProtocol === 'https:' && parsed.protocol !== 'https:') return null
    if (parsed.host.toLowerCase() !== expectedHost) return null
    if (parsed.username || parsed.password) return null
    return parsed
  } catch {
    return null
  }
}

export function shouldCancelRenderRequest(
  rawUrl: string,
  resourceType: string,
  expectedHost: string,
  mainFrameProtocol: 'http:' | 'https:',
): boolean {
  try {
    const target = new URL(rawUrl)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return true
    // Chromium resolves subresources itself, so synchronously reject every literal/local
    // target before allowing public cross-origin CDNs. Hostname DNS rebinding remains outside
    // this helper and is called out in the renderer boundary documentation below.
    assertSafeTargetHost(target.hostname)
    const protocolAllowed = target.protocol === 'https:'
      || (mainFrameProtocol === 'http:' && target.protocol === 'http:')
    if (!protocolAllowed || resourceType === 'image') return true
    return resourceType === 'mainFrame'
      && !safeNavigation(target.toString(), expectedHost, mainFrameProtocol)
  } catch {
    return true
  }
}

async function renderOnce(
  rawUrl: string,
  options: RenderWebPageOptions,
): Promise<RenderedWebPage> {
  const requested = normalizeRequestUrl(rawUrl)
  try {
    assertSafeTargetHost(requested.hostname)
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      throw ssrfWebReadError(error)
    }
    throw error
  }
  if (options.signal?.aborted) throw cancelled()
  if (typeof electron.BrowserWindow !== 'function') {
    throw new WebReadError('RENDER_UNAVAILABLE', '当前进程没有可用的 Electron 隐藏渲染窗。')
  }

  const expectedHost = requested.host.toLowerCase()
  let mainFrameProtocol = requested.protocol as 'http:' | 'https:'
  const redirects: string[] = []
  const renderWindow = new electron.BrowserWindow({
    width: 16,
    height: 16,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      images: false,
      devTools: false,
      partition: `xiaoliang-web-render-${randomUUID()}`,
    },
  })

  const { webContents } = renderWindow
  const session = webContents.session
  session.setPermissionCheckHandler(() => false)
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  webContents.on('will-attach-webview', (event) => event.preventDefault())
  webContents.on('will-navigate', (event) => {
    if (event.isMainFrame === false) return
    const next = safeNavigation(event.url, expectedHost, mainFrameProtocol)
    if (!next) event.preventDefault()
    else mainFrameProtocol = next.protocol as 'http:' | 'https:'
  })
  webContents.on('will-redirect', (event) => {
    // Treat a missing isMainFrame field as main-frame navigation so an Electron API
    // change cannot turn the host/protocol check into a fail-open redirect.
    if (event.isMainFrame === false) return
    const next = safeNavigation(event.url, expectedHost, mainFrameProtocol)
    if (!next) {
      event.preventDefault()
      return
    }
    mainFrameProtocol = next.protocol as 'http:' | 'https:'
    redirects.push(next.toString())
  })
  session.on('will-download', (event) => event.preventDefault())
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({
      cancel: shouldCancelRenderRequest(
        details.url,
        details.resourceType,
        expectedHost,
        mainFrameProtocol,
      ),
    })
  })
  webContents.setUserAgent(RENDER_USER_AGENT)

  const abortListener = () => {
    if (!renderWindow.isDestroyed()) renderWindow.destroy()
  }
  options.signal?.addEventListener('abort', abortListener, { once: true })

  try {
    let route
    try {
      // Match http-client.ts: PAC/system proxies resolve destinations outside our
      // DNS-pin boundary, so the renderer also goes DIRECT unless the operator opted
      // in via XIAOLIANG_WEB_SYSTEM_PROXY. setProxy pins the window's own connections,
      // which would otherwise follow Chromium's system resolution either way.
      if (!options.resolveProxy && !isWebSystemProxyEnabled()) {
        await session.setProxy({ mode: 'direct' })
      }
      route = parseProxyRoute(await (options.resolveProxy
        ? options.resolveProxy(requested.toString())
        : isWebSystemProxyEnabled()
          ? session.resolveProxy(requested.toString())
          : 'DIRECT'))
    } catch (error) {
      if (error instanceof WebReadError) throw error
      throw new WebReadError(
        'PROXY_RESOLUTION_FAILED',
        `无法读取系统代理配置：${error instanceof Error ? error.message : String(error)}。请检查代理设置后重试，不要更换站点反复抓取。`,
      )
    }
    if (route.kind === 'direct') {
      try {
        await (options.resolveHost ?? assertPublicHost)(requested.hostname)
      } catch (error) {
        if (error instanceof SsrfBlockedError) {
          throw ssrfWebReadError(error)
        }
        throw error
      }
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS
    try {
      await withDeadline(renderWindow.loadURL(requested.toString()), timeoutMs, options.signal)
    } catch (error) {
      if (error instanceof WebReadError) throw error
      throw new WebReadError(
        'RENDER_FAILED',
        `网页脚本渲染失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    await wait(options.settleMs ?? DEFAULT_SETTLE_MS, options.signal)
    if (renderWindow.isDestroyed()) throw cancelled()

    const payload = await withDeadline(webContents.executeJavaScript(
      `(() => ({
        html: document.documentElement ? document.documentElement.outerHTML : '',
        title: document.title || '',
        finalUrl: window.location.href || ''
      }))()`,
      true,
    ), timeoutMs, options.signal) as { html?: unknown; title?: unknown; finalUrl?: unknown }
    const finalUrl = typeof payload.finalUrl === 'string' && payload.finalUrl
      ? payload.finalUrl
      : webContents.getURL()
    if (!safeNavigation(finalUrl, expectedHost, mainFrameProtocol)) {
      throw new WebReadError('CROSS_HOST_REDIRECT', '渲染页面离开了原站点，已拒绝读取正文。')
    }
    const html = typeof payload.html === 'string' ? payload.html : ''
    if (Buffer.byteLength(html, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new WebReadError(
        'TOO_LARGE',
        `渲染后的页面超过 ${MAX_RESPONSE_BYTES} 字节上限。`,
      )
    }
    return {
      finalUrl,
      title: typeof payload.title === 'string' ? payload.title.trim() : '',
      html,
      redirects,
    }
  } finally {
    options.signal?.removeEventListener('abort', abortListener)
    if (!renderWindow.isDestroyed()) renderWindow.destroy()
  }
}

/**
 * Serialises hidden Chromium renderers so a page cannot multiply Electron renderer memory.
 *
 * Subresources use Chromium's normal resolver and are not DNS-pinned per request. Main-frame
 * navigation is pre-checked and restricted to the original host, but this is still not a
 * browser-use sandbox; login, interaction and adversarial pages may fail or be rejected.
 */
export function renderWebPage(
  rawUrl: string,
  options: RenderWebPageOptions = {},
): Promise<RenderedWebPage> {
  const operation = renderQueue.then(() => renderOnce(rawUrl, options))
  renderQueue = operation.then(() => undefined, () => undefined)
  return operation
}
