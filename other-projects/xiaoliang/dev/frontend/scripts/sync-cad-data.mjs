import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const outputDir = path.join(projectRoot, 'build', '.cad-data')
const fontsDir = path.join(outputDir, 'fonts')
const templatesDir = path.join(outputDir, 'templates')
const manifestPath = path.join(outputDir, 'manifest.json')

const UPSTREAM_REF = process.env.XIAOLIANG_CAD_DATA_REF || 'main'
const MIRRORS = [
  `https://cdn.jsdelivr.net/gh/mlightcad/cad-data@${UPSTREAM_REF}`,
  `https://raw.githubusercontent.com/mlightcad/cad-data/${UPSTREAM_REF}`,
]
const TEMPLATES = ['acadiso.dxf', 'acad.dxf']
const DOWNLOAD_ATTEMPTS = 3
const DOWNLOAD_TIMEOUT_MS = 120_000

/**
 * Superseded by the equivalent .woff, or targeting a script the product does not serve.
 * Excluding these keeps roughly 22 MB out of the installer without losing coverage
 * for mainland-China engineering drawings.
 */
const SUPERSEDED_FILES = new Set(['simsun.ttf'])
const NON_TARGET_LOCALE_FILES = new Set([
  'msyh.woff',
  'whgdtxt.shx',
  'whgtxt.shx',
  'whtgtxt.shx',
  'whtmtxt.shx',
])
/** Japanese (shift-jis) and traditional-Chinese (big5) big fonts, plus vendor fonts. */
const MINIMAL_EXTRA_EXCLUDES = new Set([
  '@extfont2.shx',
  'bigfont.shx',
  'chineset.shx',
  'extfont.shx',
  'extfont2.shx',
  'gbhzfs.shx',
  'intecad.shx',
  'simfang.woff',
  'yjkchn.shx',
  'zjdz.shx',
])

const PROFILES = {
  full: new Set(),
  standard: new Set([...SUPERSEDED_FILES, ...NON_TARGET_LOCALE_FILES]),
  minimal: new Set([...SUPERSEDED_FILES, ...NON_TARGET_LOCALE_FILES, ...MINIMAL_EXTRA_EXCLUDES]),
}

function log(message) {
  process.stdout.write(`[cad-data] ${message}\n`)
}

function fail(message) {
  process.stderr.write(`[cad-data] ${message}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { profile: 'standard', force: false }
  for (const arg of argv) {
    if (arg === '--force') {
      args.force = true
      continue
    }
    const profileMatch = /^--profile=(.+)$/.exec(arg)
    if (profileMatch) {
      args.profile = profileMatch[1]
      continue
    }
    fail(`unknown argument: ${arg}`)
  }
  if (!Object.hasOwn(PROFILES, args.profile)) {
    fail(`unknown profile "${args.profile}". Expected one of: ${Object.keys(PROFILES).join(', ')}`)
  }
  return args
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

async function download(relativePath) {
  const errors = []
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    for (const mirror of MIRRORS) {
      const url = `${mirror}/${relativePath}`
      try {
        const response = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        })
        if (!response.ok) {
          errors.push(`${url} -> HTTP ${response.status}`)
          continue
        }
        return Buffer.from(await response.arrayBuffer())
      } catch (error) {
        errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (attempt < DOWNLOAD_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750))
    }
  }
  throw new Error(`could not download ${relativePath}:\n  ${errors.join('\n  ')}`)
}

/**
 * jsDelivr serves an HTML error page with a 200 status for unknown paths, so binary
 * assets are checked for an accidental text payload before being written to disk.
 */
function assertNotErrorPage(relativePath, buffer) {
  const head = buffer.subarray(0, 64).toString('utf8').trimStart().toLowerCase()
  if (head.startsWith('<!doctype html') || head.startsWith("couldn't find")) {
    throw new Error(`upstream returned an error page for ${relativePath}`)
  }
}

function readExistingManifest() {
  if (!fs.existsSync(manifestPath)) return null
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

function reuseCached(targetPath, expected) {
  if (!expected || !fs.existsSync(targetPath)) return false
  const buffer = fs.readFileSync(targetPath)
  return buffer.length === expected.size && sha256(buffer) === expected.sha256
}

async function syncFile(relativePath, targetPath, cached, force) {
  if (!force && reuseCached(targetPath, cached)) {
    return { size: cached.size, sha256: cached.sha256, reused: true }
  }
  const buffer = await download(relativePath)
  assertNotErrorPage(relativePath, buffer)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, buffer)
  return { size: buffer.length, sha256: sha256(buffer), reused: false }
}

async function main() {
  const { profile, force } = parseArgs(process.argv.slice(2))
  const excluded = PROFILES[profile]
  const previous = readExistingManifest()
  const cachedFiles = previous?.profile === profile ? previous.files ?? {} : {}

  log(`syncing mlightcad/cad-data@${UPSTREAM_REF} (profile: ${profile})`)

  const catalogRaw = await download('fonts/fonts.json')
  assertNotErrorPage('fonts/fonts.json', catalogRaw)
  let catalog
  try {
    catalog = JSON.parse(catalogRaw.toString('utf8'))
  } catch (error) {
    fail(`upstream fonts.json is not valid JSON: ${error.message}`)
  }
  if (!Array.isArray(catalog) || catalog.length === 0) {
    fail('upstream fonts.json is empty or malformed')
  }

  const selected = catalog.filter((entry) => (
    entry
    && typeof entry.file === 'string'
    && Array.isArray(entry.name)
    && !excluded.has(entry.file)
  ))
  if (selected.length === 0) fail(`profile "${profile}" selected no fonts`)

  fs.mkdirSync(fontsDir, { recursive: true })
  fs.mkdirSync(templatesDir, { recursive: true })

  const files = {}
  let downloadedCount = 0
  let totalBytes = 0

  for (const entry of selected) {
    const relativePath = `fonts/${entry.file}`
    const result = await syncFile(
      relativePath,
      path.join(fontsDir, entry.file),
      cachedFiles[relativePath],
      force,
    )
    files[relativePath] = { size: result.size, sha256: result.sha256 }
    totalBytes += result.size
    if (!result.reused) {
      downloadedCount += 1
      log(`fetched ${relativePath} (${formatBytes(result.size)})`)
    }
  }

  for (const template of TEMPLATES) {
    const relativePath = `templates/${template}`
    const result = await syncFile(
      relativePath,
      path.join(templatesDir, template),
      cachedFiles[relativePath],
      force,
    )
    files[relativePath] = { size: result.size, sha256: result.sha256 }
    totalBytes += result.size
    if (!result.reused) {
      downloadedCount += 1
      log(`fetched ${relativePath} (${formatBytes(result.size)})`)
    }
  }

  // The served catalog must list only fonts present on disk, otherwise the viewer
  // font loader issues requests that fail at runtime.
  const catalogPath = path.join(fontsDir, 'fonts.json')
  const catalogJson = `${JSON.stringify(selected, null, 2)}\n`
  fs.writeFileSync(catalogPath, catalogJson, 'utf8')
  const catalogBuffer = Buffer.from(catalogJson, 'utf8')
  files['fonts/fonts.json'] = { size: catalogBuffer.length, sha256: sha256(catalogBuffer) }
  totalBytes += catalogBuffer.length

  const staleFiles = fs.readdirSync(fontsDir)
    .filter((name) => name !== 'fonts.json' && !Object.hasOwn(files, `fonts/${name}`))
  for (const name of staleFiles) {
    fs.rmSync(path.join(fontsDir, name), { force: true })
    log(`removed stale font ${name}`)
  }

  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({
      schema_version: 1,
      source: `mlightcad/cad-data@${UPSTREAM_REF}`,
      profile,
      generated_at: new Date().toISOString(),
      font_count: selected.length,
      total_bytes: totalBytes,
      files,
    }, null, 2)}\n`,
    'utf8',
  )

  const reusedCount = Object.keys(files).length - downloadedCount
  log(
    `ready: ${selected.length} fonts + ${TEMPLATES.length} templates, `
    + `${formatBytes(totalBytes)} total (${downloadedCount} fetched, ${reusedCount} cached)`,
  )
  log(`output: ${path.relative(projectRoot, outputDir)}`)
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
