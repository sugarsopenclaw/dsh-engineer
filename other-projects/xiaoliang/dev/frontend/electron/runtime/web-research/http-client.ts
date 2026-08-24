import * as electron from 'electron'
import net, { type LookupFunction } from 'node:net'
import { Agent, ProxyAgent } from 'undici'
import { assertPublicHost, assertSafeTargetHost, SsrfBlockedError } from './ssrf'

export const WEB_READ_TIMEOUT_MS = 60_000
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
export const MAX_URL_LENGTH = 2_000
const MAX_SAME_HOST_REDIRECTS = 10

const USER_AGENT = 'Mozilla/5.0 (compatible; xiaoliang-web/1.0; +https://xl.x3yun.com)'
const ACCEPT = 'text/markdown,text/html,application/xhtml+xml,application/pdf,application/xml;q=0.9,*/*;q=0.8'

export class WebReadError extends Error {
  readonly code: string
  readonly httpStatus?: number

  constructor(code: string, message: string, options: { httpStatus?: number } = {}) {
    super(message)
    this.name = 'WebReadError'
    this.code = code
    this.httpStatus = options.httpStatus
  }
}

function isSsrfBlockedError(error: unknown): error is SsrfBlockedError {
  return error instanceof SsrfBlockedError
    || (error instanceof Error && error.name === 'SsrfBlockedError')
}

function ssrfWebReadError(error: SsrfBlockedError): WebReadError {
  const reason = (error as SsrfBlockedError & { reason?: string }).reason
  if (reason === 'fake_ip_dns') return new WebReadError('FAKE_IP_DNS', error.message)
  if (reason === 'dns_failure') return new WebReadError('DNS_ERROR', error.message)
  return new WebReadError('BLOCKED_HOST', error.message)
}

export interface FetchedResource {
  finalUrl: string
  status: number
  contentType: string
  body: Buffer
  redirects: string[]
}

export function normalizeRequestUrl(rawUrl: string): URL {
  const value = rawUrl.trim()
  if (!value || value.length > MAX_URL_LENGTH) {
    throw new WebReadError('INVALID_URL', `URL 为空或超过 ${MAX_URL_LENGTH} 字符。`)
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new WebReadError('INVALID_URL', 'URL 无法解析，请传入完整的 http/https 地址。')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebReadError('INVALID_URL', '只支持 http/https 地址。')
  }
  if (parsed.username || parsed.password) {
    throw new WebReadError('INVALID_URL', 'URL 不得包含用户名或密码。')
  }
  parsed.hash = ''
  return parsed
}

async function readBoundedBody(response: Response): Promise<Buffer> {
  const declared = Number.parseInt(response.headers.get('content-length') || '', 10)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new WebReadError('TOO_LARGE', `响应体 ${declared} 字节超过 ${MAX_RESPONSE_BYTES} 字节上限。`)
  }
  if (!response.body) return Buffer.alloc(0)

  const chunks: Buffer[] = []
  let total = 0
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        throw new WebReadError('TOO_LARGE', `响应体超过 ${MAX_RESPONSE_BYTES} 字节上限。`)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // The stream is already closed or errored; nothing left to release.
    }
  }
  return Buffer.concat(chunks, total)
}

export interface FetchResourceOptions {
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  resolveHost?: (hostname: string) => Promise<string[]>
  /** Chromium/system proxy decision for a URL. Production uses Electron's default session. */
  resolveProxy?: (url: string) => Promise<string>
}

export type WebProxyRoute =
  | { kind: 'direct' }
  | { kind: 'proxy'; proxyUrl: string }

/**
 * Converts Chromium's proxy-resolution result into one enforced route. Only the first
 * directive is used, so a `PROXY ...; DIRECT` fallback cannot silently bypass SSRF checks.
 */
export function parseProxyRoute(resolution: string): WebProxyRoute {
  const directive = resolution
    .split(';')
    .map((part) => part.trim())
    .find(Boolean)
  if (!directive || directive.toUpperCase() === 'DIRECT') return { kind: 'direct' }

  const match = /^(PROXY|HTTP|HTTPS|SOCKS5)\s+(.+)$/iu.exec(directive)
  if (!match) {
    const method = directive.split(/\s+/u, 1)[0] || 'unknown'
    throw new WebReadError(
      'UNSUPPORTED_PROXY',
      `系统为该地址选择了当前抓取通道不支持的 ${method} 代理。请改用 HTTP、HTTPS 或 SOCKS5 代理；不要更换站点重复抓取。`,
    )
  }

  const method = match[1].toUpperCase()
  const scheme = method === 'HTTPS'
    ? 'https'
    : method === 'SOCKS5'
      ? 'socks5'
      : 'http'
  let proxy: URL
  try {
    proxy = new URL(`${scheme}://${match[2].trim()}`)
  } catch {
    throw new WebReadError('UNSUPPORTED_PROXY', `系统返回了无法解析的 ${method} 代理地址。`)
  }
  if (!proxy.hostname || (proxy.pathname !== '' && proxy.pathname !== '/') || proxy.search || proxy.hash) {
    throw new WebReadError('UNSUPPORTED_PROXY', `系统返回了无法解析的 ${method} 代理地址。`)
  }
  return { kind: 'proxy', proxyUrl: proxy.toString() }
}

/** System/PAC proxies resolve destinations outside our DNS-pin boundary, so require opt-in. */
export function isWebSystemProxyEnabled(
  environment: { XIAOLIANG_WEB_SYSTEM_PROXY?: string } = process.env,
): boolean {
  const value = environment.XIAOLIANG_WEB_SYSTEM_PROXY?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'on'
}

async function resolveSystemProxy(url: string): Promise<string> {
  if (!isWebSystemProxyEnabled()) return 'DIRECT'
  const defaultSession = electron.session?.defaultSession
  if (!defaultSession || typeof defaultSession.resolveProxy !== 'function') return 'DIRECT'
  return defaultSession.resolveProxy(url)
}

/**
 * Connect lookup that answers with exactly the addresses assertPublicHost just validated.
 * The hostname argument is ignored on purpose: looking it up again would reopen the DNS
 * rebinding window between validation and connect.
 */
export function pinnedAddressLookup(addresses: string[]): LookupFunction {
  const records = addresses.map((address) => ({ address, family: net.isIP(address) === 6 ? 6 : 4 }))
  return (_hostname, _options, callback) => callback(null, records[0].address, records[0].family)
}

/**
 * Fetches one page from this machine.
 *
 * Same-host redirects are followed manually so every hop can be re-validated against the
 * SSRF rules; a cross-host redirect stops and reports the new URL instead, because that is
 * a different source and the caller should decide whether it is still on task.
 *
 * A non-2xx response is an error rather than content. Turning a 403 interstitial into
 * Markdown is how a paywall or WAF page ends up quoted as if it were the document.
 */
export async function fetchResource(
  rawUrl: string,
  options: FetchResourceOptions = {},
): Promise<FetchedResource> {
  const fetchImpl = options.fetchImpl ?? fetch
  const resolveHost = options.resolveHost ?? ((hostname: string) => assertPublicHost(hostname))
  const resolveProxy = options.resolveProxy ?? resolveSystemProxy
  const timeoutMs = options.timeoutMs ?? WEB_READ_TIMEOUT_MS

  let current = normalizeRequestUrl(rawUrl)
  const redirects: string[] = []

  for (let hop = 0; hop <= MAX_SAME_HOST_REDIRECTS; hop += 1) {
    // A proxy must never make literal private/metadata targets reachable. For a hostname,
    // the proxy receives the original name and performs DNS itself; DIRECT retains the
    // full local-DNS validation and address pinning below.
    try {
      assertSafeTargetHost(current.hostname)
    } catch (error) {
      if (isSsrfBlockedError(error)) throw ssrfWebReadError(error)
      throw error
    }

    let route: WebProxyRoute
    try {
      route = parseProxyRoute(await resolveProxy(current.toString()))
    } catch (error) {
      if (error instanceof WebReadError) throw error
      throw new WebReadError(
        'PROXY_RESOLUTION_FAILED',
        `无法读取系统代理配置：${error instanceof Error ? error.message : String(error)}。请检查代理设置后重试，不要更换站点反复抓取。`,
      )
    }

    let dispatcher: Agent | ProxyAgent
    if (route.kind === 'proxy') {
      // CONNECT/SOCKS receives the hostname, so Fake-IP DNS on this machine is bypassed.
      // Using exactly the selected proxy also avoids a PAC `; DIRECT` fail-open fallback.
      dispatcher = new ProxyAgent(route.proxyUrl)
    } else {
      let addresses: string[]
      try {
        addresses = await resolveHost(current.hostname)
      } catch (error) {
        if (isSsrfBlockedError(error)) throw ssrfWebReadError(error)
        throw error
      }
      // fetch resolves the hostname again on connect, and a TTL=0 name can rebind to an
      // internal address in between; the hop connects only to the validated addresses.
      // The URL keeps the hostname, so TLS SNI and the Host header are unchanged.
      dispatcher = new Agent({ connect: { lookup: pinnedAddressLookup(addresses) } })
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal

    try {
      let response: Response
      try {
        response = await fetchImpl(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          headers: {
            'User-Agent': USER_AGENT,
            Accept: ACCEPT,
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
          signal,
          // undici's own types drift from the undici-types copy @types/node uses for fetch.
          dispatcher: dispatcher as unknown as RequestInit['dispatcher'],
        })
      } catch (error) {
        if (options.signal?.aborted) throw new WebReadError('CANCELLED', '抓取已取消。')
        if (timeoutSignal.aborted) {
          throw new WebReadError('TIMEOUT', `抓取超时（${Math.round(timeoutMs / 1000)} 秒）：${current.toString()}`)
        }
        throw new WebReadError(
          'NETWORK_ERROR',
          `抓取失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          throw new WebReadError('BAD_REDIRECT', `${response.status} 跳转没有 Location 头。`)
        }
        let next: URL
        try {
          next = new URL(location, current)
        } catch {
          throw new WebReadError('BAD_REDIRECT', `跳转目标无法解析：${location}`)
        }
        if (next.username || next.password) {
          throw new WebReadError('BAD_REDIRECT', '跳转目标包含用户名或密码，已拒绝继续。')
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          throw new WebReadError('BAD_REDIRECT', `跳转目标不是 http/https 地址：${next.protocol}`)
        }
        if (current.protocol === 'https:' && next.protocol === 'http:') {
          throw new WebReadError('INSECURE_REDIRECT', 'HTTPS 页面试图降级跳转到 HTTP，已拒绝继续。')
        }
        if (next.host !== current.host) {
          throw new WebReadError(
            'CROSS_HOST_REDIRECT',
            `该地址跳转到了另一个站点：${next.toString()}。如果仍然需要，请对新地址单独调用一次。`,
          )
        }
        redirects.push(next.toString())
        current = next
        continue
      }

      if (!response.ok) {
        throw new WebReadError(
          'HTTP_ERROR',
          `目标返回 HTTP ${response.status}，没有拿到正文；不要把错误页当作页面内容。`,
          { httpStatus: response.status },
        )
      }

      const body = await readBoundedBody(response)
      return {
        finalUrl: current.toString(),
        status: response.status,
        contentType: (response.headers.get('content-type') || '').toLowerCase(),
        body,
        redirects,
      }
    } finally {
      void dispatcher.close()
    }
  }

  throw new WebReadError('TOO_MANY_REDIRECTS', `同站跳转超过 ${MAX_SAME_HOST_REDIRECTS} 次。`)
}
