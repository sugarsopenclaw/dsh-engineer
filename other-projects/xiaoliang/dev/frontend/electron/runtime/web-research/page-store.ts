import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const WEB_ARTIFACT_ROOT = '.xiaoliang/web'
export const WEB_PAGES_DIRNAME = 'pages'

const MAX_SLUG_LENGTH = 48
export const MAX_WEB_ARTIFACT_BYTES = 8 * 1024 * 1024

export interface StoredPageInput {
  projectRoot: string
  url: string
  title: string
  markdown: string
  httpStatus?: number
  contentType?: string
  provider?: string
  status?: string
  fetchedAt?: string
  pageCount?: number
  redirects?: readonly string[]
  extractionNote?: string
}

export interface StoredPage {
  relativePath: string
  absolutePath: string
  lineCount: number
  byteLength: number
  sha256: string
}

/** Maps storage failures to a stable tool-visible message without exposing machine paths. */
export function formatWebArtifactStorageWarning(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/8388608|8\s*MB|落盘上限/iu.test(message)) {
    return '全文 artifact 写入失败：正文超过 8 MB 落盘上限。'
  }
  if (/符号链接|junction|symlink/iu.test(message)) {
    return '全文 artifact 写入失败：artifact 目录包含符号链接或 junction，已拒绝写入。'
  }
  if (/越过项目根|不是目录|不可信普通|不是普通|absolute project root/iu.test(message)) {
    return '全文 artifact 写入失败：artifact 目录不可信，已拒绝写入。'
  }
  return '全文 artifact 写入失败：文件系统写入失败。'
}

function slugFromUrl(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return 'page'
  }
  const host = parsed.hostname.replace(/^www\./u, '')
  let decodedPath = parsed.pathname
  try {
    decodedPath = decodeURIComponent(parsed.pathname)
  } catch {
    // A malformed percent escape may still be fetchable; keep its URL-encoded spelling.
  }
  const tail = decodedPath
    .split('/')
    .filter(Boolean)
    .slice(-1)[0] || ''
  const slug = `${host}-${tail}`
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,6}$/u, '')
    // Keep CJK so a Chinese article slug stays recognisable in a directory listing.
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_SLUG_LENGTH)
  return slug || 'page'
}

function escapeFrontMatter(value: string): string {
  return value.replace(/\r?\n/gu, ' ').replace(/"/gu, '\\"').trim()
}

function buildFrontMatter(input: StoredPageInput, sha256: string): string {
  const lines = [
    '---',
    `url: "${escapeFrontMatter(input.url)}"`,
    `title: "${escapeFrontMatter(input.title).slice(0, 300)}"`,
    `fetched_at: "${input.fetchedAt ?? new Date().toISOString()}"`,
    `sha256: "${sha256}"`,
  ]
  if (typeof input.httpStatus === 'number') lines.push(`http_status: ${input.httpStatus}`)
  if (input.contentType) {
    lines.push(`content_type: "${escapeFrontMatter(input.contentType).slice(0, 200)}"`)
  }
  if (input.provider) lines.push(`provider: "${escapeFrontMatter(input.provider).slice(0, 100)}"`)
  if (input.status) lines.push(`status: "${escapeFrontMatter(input.status).slice(0, 50)}"`)
  if (typeof input.pageCount === 'number' && input.pageCount > 0) {
    lines.push(`page_count: ${input.pageCount}`)
  }
  if (input.redirects && input.redirects.length > 0) {
    lines.push(`redirects: "${escapeFrontMatter(input.redirects.join(' -> ')).slice(0, 1000)}"`)
  }
  if (input.extractionNote) {
    lines.push(`extraction: "${escapeFrontMatter(input.extractionNote).slice(0, 200)}"`)
  }
  lines.push('---')
  return lines.join('\n')
}

export function webPagesRelativeDir(): string {
  return `${WEB_ARTIFACT_ROOT}/${WEB_PAGES_DIRNAME}`
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Creates each directory one level at a time and refuses links before any deeper write. */
async function ensureTrustedPagesDirectory(
  projectRoot: string,
): Promise<string> {
  const relativeDir = webPagesRelativeDir()
  let current = projectRoot
  for (const segment of relativeDir.split('/')) {
    const requested = path.join(current, segment)
    try {
      await fs.promises.lstat(requested)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try {
        await fs.promises.mkdir(requested, { recursive: false, mode: 0o700 })
      } catch (mkdirError) {
        // Parallel fetches may initialise the page directory at once.
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError
      }
    }
    const stat = await fs.promises.lstat(requested)
    if (stat.isSymbolicLink()) {
      throw new Error(`通用网页目录不能经过符号链接或 junction：${relativeDir}`)
    }
    if (!stat.isDirectory()) throw new Error(`通用网页路径不是目录：${requested}`)
    const resolved = await fs.promises.realpath(requested)
    if (!isInside(projectRoot, resolved) || resolved === projectRoot) {
      throw new Error(`通用网页目录越过项目根目录：${relativeDir}`)
    }
    current = resolved
  }
  return current
}

/**
 * Persists a fetched page under the project so the wording can be re-read and audited.
 *
 * Both URL and extracted-body hashes are part of the filename. Re-fetching unchanged text
 * reuses its immutable record; changed text gets a new path, so an older evidence pack can
 * never silently start pointing at different wording or line numbers.
 */
export async function storeWebPage(
  input: StoredPageInput,
): Promise<StoredPage> {
  if (!path.isAbsolute(input.projectRoot)) {
    throw new Error('Web page store requires an absolute project root.')
  }
  const projectRoot = await fs.promises.realpath(input.projectRoot)
  const pagesDir = await ensureTrustedPagesDirectory(projectRoot)

  const body = input.markdown.replace(/\r\n?/gu, '\n').trim()
  const contentSha = createHash('sha256').update(body, 'utf8').digest('hex')
  const urlSha = createHash('sha256').update(input.url, 'utf8').digest('hex')
  const filename = `${slugFromUrl(input.url)}-${urlSha.slice(0, 16)}-${contentSha.slice(0, 16)}.md`
  const relativePath = `${webPagesRelativeDir()}/${filename}`
  const absolutePath = path.join(pagesDir, filename)
  const content = `${buildFrontMatter(input, contentSha)}\n\n${body}\n`
  if (Buffer.byteLength(content, 'utf8') > MAX_WEB_ARTIFACT_BYTES) {
    throw new Error(`抓取内容超过 ${MAX_WEB_ARTIFACT_BYTES} 字节落盘上限。`)
  }

  // Preserve the first fetch timestamp and inode when this exact page body is already on
  // disk. A damaged or manually replaced record is repaired from the fresh fetch instead.
  try {
    const existingStat = await fs.promises.lstat(absolutePath)
    if (existingStat.isSymbolicLink() || !existingStat.isFile()) {
      throw new Error(`通用网页 artifact 目标不是可信普通文件：${relativePath}`)
    }
    const existing = await fs.promises.readFile(absolutePath, 'utf8')
    const normalized = existing.replace(/\r\n?/gu, '\n')
    const closing = normalized.indexOf('\n---\n', 4)
    const existingBody = closing >= 0
      ? normalized.slice(closing + '\n---\n'.length).replace(/^\n/u, '').replace(/\n$/u, '')
      : ''
    if (
      existingBody === body
      && normalized.includes(`\nurl: "${escapeFrontMatter(input.url)}"\n`)
      && normalized.includes(`\nsha256: "${contentSha}"\n`)
    ) {
      return {
        relativePath,
        absolutePath,
        lineCount: normalized.split('\n').length,
        byteLength: Buffer.byteLength(existing, 'utf8'),
        sha256: contentSha,
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const temporaryPath = path.join(pagesDir, `.page-${randomUUID()}.tmp`)
  let handle: fs.promises.FileHandle | null = null
  try {
    handle = await fs.promises.open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.promises.rename(temporaryPath, absolutePath)
    const storedStat = await fs.promises.lstat(absolutePath)
    if (storedStat.isSymbolicLink() || !storedStat.isFile()) {
      throw new Error(`通用网页 artifact 写入后不是普通文件：${relativePath}`)
    }
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await fs.promises.unlink(temporaryPath).catch(() => undefined)
    throw error
  }

  return {
    relativePath,
    absolutePath,
    lineCount: content.split('\n').length,
    byteLength: Buffer.byteLength(content, 'utf8'),
    sha256: contentSha,
  }
}
