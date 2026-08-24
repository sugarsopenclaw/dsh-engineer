import dns from 'node:dns/promises'
import net from 'node:net'

export class SsrfBlockedError extends Error {
  readonly reason: 'blocked_target' | 'dns_failure' | 'private_dns' | 'fake_ip_dns'

  constructor(
    message: string,
    reason: 'blocked_target' | 'dns_failure' | 'private_dns' | 'fake_ip_dns' = 'blocked_target',
  ) {
    super(message)
    this.name = 'SsrfBlockedError'
    this.reason = reason
  }
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }
  const [a, b] = parts
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  // Carrier-grade NAT.
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  // Multicast, reserved and broadcast.
  if (a >= 224) return true
  return false
}

function isFakeIpBenchmarkAddress(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  return parts.length === 4 && parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)
}

function normalizeIpv6(address: string): string {
  const withoutZone = address.split('%')[0]
  return withoutZone.trim().toLowerCase()
}

/**
 * Expands a valid IPv6 address to its eight 16-bit groups: '::' compression is filled with
 * zero groups and a dotted-quad tail ('::ffff:127.0.0.1') becomes the last two groups.
 * Compressed, hex-only and dotted spellings of one address must classify identically, so
 * nothing downstream pattern-matches the textual form.
 */
function expandIpv6Groups(address: string): number[] | null {
  let value = normalizeIpv6(address)
  const lastColon = value.lastIndexOf(':')
  const lastPart = value.slice(lastColon + 1)
  if (lastPart.includes('.')) {
    // A dotted-quad tail ('::ffff:127.0.0.1') stands in for the last two groups;
    // rewrite it as hex groups so the rest only deals with 16-bit fields.
    const parts = lastPart.split('.').map((part) => Number.parseInt(part, 10))
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null
    }
    const high = ((parts[0] << 8) | parts[1]).toString(16)
    const low = ((parts[2] << 8) | parts[3]).toString(16)
    value = `${value.slice(0, lastColon)}:${high}:${low}`
  }
  const halves = value.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail]
    .map((part) => Number.parseInt(part, 16))
  if (groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null
  return groups
}

/** IPv4-mapped, IPv4-compatible and NAT64 (64:ff9b::/96) forms embed a v4 address in the last two groups. */
function embeddedIpv4(groups: number[]): string | null {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups
  const dotted = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`
  // '::' and '::1' are compatible-form spellings of 0.0.0.0 and 0.0.0.1 and land here too.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) return dotted
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return dotted
  return null
}

function isPrivateIpv6(address: string): boolean {
  const groups = expandIpv6Groups(address)
  if (!groups) return true
  // Every spelling that embeds an IPv4 address delegates to the v4 rules.
  const embedded = embeddedIpv4(groups)
  if (embedded !== null) return isPrivateIpv4(embedded)
  const first = groups[0]
  // Unique local, link local and multicast.
  if ((first & 0xfe00) === 0xfc00) return true
  if ((first & 0xffc0) === 0xfe80) return true
  // Deprecated site-local fec0::/10 remains non-public and must stay unreachable.
  if ((first & 0xffc0) === 0xfec0) return true
  if ((first & 0xff00) === 0xff00) return true
  return false
}

export function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address)
  if (version === 4) return isPrivateIpv4(address)
  if (version === 6) return isPrivateIpv6(address)
  return true
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
])

/**
 * Applies the checks that remain valid when a trusted user/system proxy resolves the
 * destination hostname. DNS is deliberately not touched here: an HTTP CONNECT or SOCKS5
 * proxy must receive the hostname unchanged so Fake-IP DNS cannot replace it locally.
 */
export function assertSafeTargetHost(hostname: string): string {
  let host = hostname.trim().toLowerCase().replace(/\.$/u, '')
  // WHATWG URL.hostname retains brackets for IPv6 literals. Normalise them before
  // net.isIP; reject zone identifiers because their interface scope is explicitly local.
  if (host.startsWith('[') && host.endsWith(']')) {
    const literal = host.slice(1, -1)
    if (literal.includes('%') || net.isIP(literal) !== 6) {
      throw new SsrfBlockedError(`拒绝抓取无效或带接口范围的 IPv6 地址：${hostname}`)
    }
    host = literal
  } else if (host.includes('[') || host.includes(']')) {
    throw new SsrfBlockedError(`拒绝抓取格式异常的主机名：${hostname}`)
  }
  if (!host) throw new SsrfBlockedError('抓取目标缺少主机名。')
  if (
    BLOCKED_HOSTNAMES.has(host)
    || host.endsWith('.localhost')
    || host.endsWith('.internal')
    || host.endsWith('.local')
    || host.endsWith('.localdomain')
    || host.endsWith('.lan')
    || host.endsWith('.home.arpa')
  ) {
    throw new SsrfBlockedError(`拒绝抓取内网主机：${hostname}`)
  }
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new SsrfBlockedError(`拒绝抓取内网或保留地址：${hostname}`)
  }
  return host
}

/**
 * Resolves a hostname and rejects it when any answer points inside the machine or its
 * network. Every redirect hop re-runs this, so a public name that later resolves to a
 * loopback address cannot be used to rebind into the desktop's own services.
 */
export async function assertPublicHost(
  hostname: string,
  resolver: {
    lookup: (host: string, options: { all: true }) => Promise<Array<{ address: string }>>
  } = { lookup: (host, options) => dns.lookup(host, options) },
): Promise<string[]> {
  const host = assertSafeTargetHost(hostname)

  if (net.isIP(host)) {
    return [host]
  }

  let records: Array<{ address: string }>
  try {
    records = await resolver.lookup(host, { all: true })
  } catch (error) {
    throw new SsrfBlockedError(
      `域名解析失败：${host}（${error instanceof Error ? error.message : String(error)}）`,
      'dns_failure',
    )
  }
  if (records.length === 0) {
    throw new SsrfBlockedError(`域名没有解析结果：${host}`, 'dns_failure')
  }
  const addresses = records.map((record) => record.address)
  const blocked = addresses.filter((address) => isBlockedAddress(address))
  if (blocked.length > 0) {
    // A mixed Fake-IP + real private answer is private_dns, never a safe fallback signal.
    const onlyFakeIpBlocked = blocked.every((address) => isFakeIpBenchmarkAddress(address))
    const fakeIpHint = onlyFakeIpBlocked
      ? ' 检测到 RFC 2544 的 198.18.0.0/15，这通常是 Clash、Surge 或 sing-box 的 Fake-IP。本机直连必须拦截该地址并改用后端抓取；若运维明确接受代理端 DNS 不可 pin 的边界，可设置 XIAOLIANG_WEB_SYSTEM_PROXY=on。不要更换域名重复抓取。'
      : ''
    throw new SsrfBlockedError(
      `拒绝抓取解析到内网或保留地址的域名：${host} -> ${blocked.join(', ')}。${fakeIpHint}`.trim(),
      onlyFakeIpBlocked ? 'fake_ip_dns' : 'private_dns',
    )
  }
  return addresses
}
