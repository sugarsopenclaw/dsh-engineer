import path from 'node:path'
import { app } from 'electron'

import { MLightCadAssetServer } from './mlight-asset-server'
import { resolveCadDrawing, resolveCadDataRoot } from './mlight-session-service'

/** A grant the panel never redeems must not stay reachable for the whole session. */
const PREVIEW_GRANT_TTL_MS = 5 * 60 * 1_000
/** Browsing a folder of drawings mints one grant per click; only the recent ones can still be in flight. */
const MAX_OUTSTANDING_GRANTS = 8

export interface CadPreviewGrant {
  sourceUrl: string
  cadDataBaseUrl: string
  fileName: string
}

export interface CadPreviewGrantRequest {
  projectRoot: string
  relativePath: string
}

/**
 * Hands the preview iframe a short-lived loopback URL for one drawing.
 *
 * Drawings routinely run to tens of megabytes, so the panel streams them from this
 * capability origin rather than carrying base64 through IPC the way the document
 * previews do. It owns an asset server separate from the agent session pool: a
 * capability minted for the user's panel should not be replayable against the
 * origin that serves the agent's drawings.
 */
export class CadPreviewService {
  private readonly assets: MLightCadAssetServer
  /** Insertion-ordered so the oldest capability is the first to give up its slot. */
  private readonly outstanding = new Map<string, number>()
  private closed = false

  constructor(cadDataRoot?: string) {
    this.assets = new MLightCadAssetServer(path.resolve(cadDataRoot ?? defaultCadDataRoot()))
  }

  async grant(request: CadPreviewGrantRequest): Promise<CadPreviewGrant> {
    if (this.closed) throw new Error('CAD preview service is closed.')
    const drawing = await resolveCadDrawing({
      projectRoot: request.projectRoot,
      sourceRelativePath: request.relativePath,
    })
    await this.assets.start()
    this.pruneOutstanding()
    const granted = this.assets.grantSource({
      extension: drawing.extension,
      fileName: drawing.fileName,
      size: drawing.size,
      sourcePath: drawing.sourcePath,
      expiresAt: Date.now() + PREVIEW_GRANT_TTL_MS,
    })
    this.outstanding.set(granted.capability, Date.now() + PREVIEW_GRANT_TTL_MS)
    return {
      sourceUrl: granted.url,
      cadDataBaseUrl: this.assets.cadDataBaseUrl,
      fileName: drawing.fileName,
    }
  }

  /**
   * The asset server only drops an expired grant when someone asks for it, so a user
   * clicking through drawings would otherwise leave every skipped capability behind.
   */
  private pruneOutstanding(): void {
    const now = Date.now()
    for (const [capability, expiresAt] of this.outstanding) {
      if (expiresAt > now) break
      this.assets.revokeSource(capability)
      this.outstanding.delete(capability)
    }
    while (this.outstanding.size >= MAX_OUTSTANDING_GRANTS) {
      const oldest = this.outstanding.keys().next()
      if (oldest.done) break
      this.assets.revokeSource(oldest.value)
      this.outstanding.delete(oldest.value)
    }
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.outstanding.clear()
    await this.assets.close()
  }
}

function defaultCadDataRoot(): string {
  const appPath = path.resolve(app.getAppPath())
  return resolveCadDataRoot({
    appPath,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  })
}
