import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

export type CadExtension = '.dwg' | '.dxf'

const MAX_DRAWING_BYTES = 256 * 1024 * 1024
const CAD_HEADER_BYTES = 4_096
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u
/** Upstream font names contain spaces and a leading `@`, but never a path separator. */
const CAD_DATA_NAME_PATTERN = /^[A-Za-z0-9@][A-Za-z0-9@_. -]{0,127}$/u
const CAD_DATA_DIRECTORIES = new Set(['fonts', 'templates'])

const CAD_DATA_MIME_TYPES: Record<string, string> = {
  '.dxf': 'application/dxf',
  '.json': 'application/json; charset=utf-8',
  '.shx': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

interface SourceGrant {
  extension: CadExtension
  fileName: string
  size: number
  sourcePath: string
  /** Epoch milliseconds after which the grant stops resolving; omitted means no expiry. */
  expiresAt?: number
}

export interface SourceGrantHandle {
  capability: string
  url: string
}

function cadMimeType(extension: CadExtension): string {
  return extension === '.dwg' ? 'application/vnd.dwg' : 'application/dxf'
}

function matchesCadSignature(bytes: Buffer, extension: CadExtension): boolean {
  if (extension === '.dwg') return /^AC10\d{2}/u.test(bytes.subarray(0, 6).toString('ascii'))
  const binarySignature = Buffer.from('AutoCAD Binary DXF\r\n\x1a\0', 'binary')
  if (bytes.subarray(0, binarySignature.length).equals(binarySignature)) return true
  return /^\uFEFF?\s*0\s+SECTION(?:\s|$)/iu.test(bytes.toString('utf8'))
}

export async function validateDrawingFile(
  sourcePath: string,
  extension: CadExtension,
): Promise<number> {
  let handle: fs.promises.FileHandle | undefined
  try {
    handle = await fs.promises.open(sourcePath, 'r')
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0) throw new Error('Drawing is empty or unavailable.')
    if (stat.size > MAX_DRAWING_BYTES) throw new Error('Drawing exceeds the 256 MiB MLightCAD limit.')
    const header = Buffer.alloc(Math.min(CAD_HEADER_BYTES, stat.size))
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (!matchesCadSignature(header.subarray(0, bytesRead), extension)) {
      throw new Error('CAD signature does not match its extension.')
    }
    return stat.size
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * Loopback origin that hands the sandboxed runtime window exactly two things: the
 * drawing it was told to open (single-use capability) and the bundled font/template
 * corpus (long-lived capability, read-only, flat allow-list).
 */
export class MLightCadAssetServer {
  private readonly sourceGrants = new Map<string, SourceGrant>()
  private readonly cadDataToken = randomBytes(32).toString('base64url')
  private server: http.Server | undefined
  private origin: string | undefined
  private starting: Promise<void> | undefined
  private closed = false

  constructor(private readonly cadDataRoot: string) {}

  async start(): Promise<string> {
    if (this.closed) throw new Error('MLightCAD asset server is closed.')
    if (this.origin) return this.origin
    this.starting ??= this.listen()
    try {
      await this.starting
    } finally {
      this.starting = undefined
    }
    if (!this.origin) throw new Error('MLightCAD asset server did not bind a loopback port.')
    return this.origin
  }

  get cadDataBaseUrl(): string {
    if (!this.origin) throw new Error('MLightCAD asset server is not started.')
    return `${this.origin}/cad-data/${this.cadDataToken}/`
  }

  grantSource(grant: SourceGrant): SourceGrantHandle {
    if (!this.origin) throw new Error('MLightCAD asset server is not started.')
    const capability = randomBytes(32).toString('base64url')
    this.sourceGrants.set(capability, grant)
    return {
      capability,
      url: `${this.origin}/source/${capability}/${encodeURIComponent(grant.fileName)}`,
    }
  }

  revokeSource(capability: string): void {
    this.sourceGrants.delete(capability)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.sourceGrants.clear()
    const server = this.server
    this.server = undefined
    this.origin = undefined
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async listen(): Promise<void> {
    const server = http.createServer((request, response) => {
      void this.serve(request, response).catch(() => {
        if (response.destroyed) return
        if (response.headersSent) {
          response.destroy()
          return
        }
        const body = Buffer.from(JSON.stringify({ ok: false, error: 'Asset is unavailable.' }))
        response.writeHead(404, {
          'Cache-Control': 'no-store',
          'Content-Length': body.length,
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        })
        response.end(body)
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('MLightCAD asset server did not bind a loopback port.')
    }
    this.server = server
    this.origin = `http://127.0.0.1:${address.port}`
  }

  private async serve(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.method !== 'GET') throw new Error('Not found.')
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (requestUrl.search || requestUrl.hash) throw new Error('Not found.')
    const parts = requestUrl.pathname.split('/')
    if (parts[1] === 'source') {
      await this.serveSource(parts, response)
      return
    }
    if (parts[1] === 'cad-data') {
      await this.serveCadData(parts, response)
      return
    }
    throw new Error('Not found.')
  }

  private async serveSource(parts: string[], response: http.ServerResponse): Promise<void> {
    if (parts.length !== 4 || !CAPABILITY_PATTERN.test(parts[2] ?? '')) throw new Error('Not found.')
    const capability = parts[2] ?? ''
    const grant = this.sourceGrants.get(capability)
    if (!grant) throw new Error('Not found.')
    if (grant.expiresAt !== undefined && Date.now() > grant.expiresAt) {
      this.sourceGrants.delete(capability)
      throw new Error('Not found.')
    }
    let requestedFileName: string
    try {
      requestedFileName = decodeURIComponent(parts[3] ?? '')
    } catch {
      throw new Error('Not found.')
    }
    if (requestedFileName !== grant.fileName) throw new Error('Not found.')
    // Single use: the runtime buffers the drawing on open, so a replayed URL is always an abuse.
    this.sourceGrants.delete(capability)
    const size = await validateDrawingFile(grant.sourcePath, grant.extension)
    if (size !== grant.size) throw new Error('Drawing changed before extraction.')
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Length': size,
      'Content-Type': cadMimeType(grant.extension),
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    })
    await pipeline(fs.createReadStream(grant.sourcePath), response)
  }

  private async serveCadData(parts: string[], response: http.ServerResponse): Promise<void> {
    if (parts.length !== 5 || parts[2] !== this.cadDataToken) throw new Error('Not found.')
    const directory = parts[3] ?? ''
    if (!CAD_DATA_DIRECTORIES.has(directory)) throw new Error('Not found.')
    let fileName: string
    try {
      fileName = decodeURIComponent(parts[4] ?? '')
    } catch {
      throw new Error('Not found.')
    }
    if (!CAD_DATA_NAME_PATTERN.test(fileName)) throw new Error('Not found.')
    const filePath = path.join(this.cadDataRoot, directory, fileName)
    if (path.dirname(filePath) !== path.join(this.cadDataRoot, directory)) throw new Error('Not found.')
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) throw new Error('Not found.')
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': stat.size,
      'Content-Type': CAD_DATA_MIME_TYPES[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    })
    await pipeline(fs.createReadStream(filePath), response)
  }
}
