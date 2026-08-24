import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import electron from 'electron'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const cadDataRoot = path.join(projectRoot, 'build', '.cad-data')

function fail(message) {
  process.stderr.write(`[mlight-dual] ${message}\n`)
  process.exit(1)
}

function readArg(name) {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

function requiredArg(name) {
  const value = readArg(name)
  if (!value) fail(`missing --${name}=<value>`)
  return value
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function sameWindowsPath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function xrefsFromAutoCadProvenance(drawing, sourceSha256, provenancePath) {
  if (!provenancePath) return []
  const resolvedProvenance = path.resolve(provenancePath)
  if (!fs.existsSync(resolvedProvenance)) fail(`AutoCAD provenance not found: ${resolvedProvenance}`)
  const provenance = JSON.parse(fs.readFileSync(resolvedProvenance, 'utf8'))
  if (!sameWindowsPath(provenance?.source?.path ?? '', drawing)) {
    fail('AutoCAD provenance source path does not match --drawing')
  }
  if (provenance?.source?.sha256 !== sourceSha256) {
    fail('AutoCAD provenance source SHA-256 does not match --drawing')
  }
  const byAlias = new Map()
  for (const block of provenance?.block_inventory ?? []) {
    if (!block?.owner_is_xref || !block?.owner_block_name) continue
    const recordedPath = String(block.owner_xref_path ?? '').trim()
    const candidate = recordedPath
      ? path.resolve(path.dirname(drawing), recordedPath)
      : path.resolve(path.dirname(drawing), `${block.owner_block_name}.dwg`)
    byAlias.set(String(block.owner_block_name), {
      alias: String(block.owner_block_name),
      sourcePath: candidate,
      hostBlockHandle: String(block.owner_block_handle ?? ''),
      autocadDeclaredEntityCount: Number(block.declared_entity_count ?? 0),
      provenancePath: resolvedProvenance,
    })
  }
  return [...byAlias.values()]
}

function requirePrerequisites() {
  const required = [
    path.join(projectRoot, 'dist', 'mlight-runtime.html'),
    path.join(projectRoot, 'dist-electron', 'runtime', 'cad', 'mlight', 'preload.js'),
    path.join(cadDataRoot, 'fonts', 'fonts.json'),
  ]
  const missing = required.filter((candidate) => !fs.existsSync(candidate))
  if (missing.length > 0) {
    fail(
      'missing build outputs; run `npm run build` and `npm run sync:cad-data` first:\n  '
      + missing.map((candidate) => path.relative(projectRoot, candidate)).join('\n  '),
    )
  }
}

function ensureOutputAvailable(outputDir, overwrite) {
  const protectedNames = [
    'entities.raw.jsonl',
    'entities.readable.md',
    'summary.json',
    'provenance.json',
  ]
  const existing = protectedNames.filter((name) => fs.existsSync(path.join(outputDir, name)))
  if (existing.length > 0 && !overwrite) {
    fail(
      `output already contains capture artifacts (${existing.join(', ')}); `
      + 'pass --overwrite to replace this channel explicitly',
    )
  }
}

function safeCleanup(temporaryRoot) {
  const tempBase = fs.realpathSync(os.tmpdir())
  const resolved = fs.realpathSync(temporaryRoot)
  if (
    path.dirname(resolved) !== tempBase
    || !path.basename(resolved).startsWith('xiaoliang-mlight-dual-')
  ) {
    throw new Error(`refusing to remove unexpected temporary directory: ${resolved}`)
  }
  fs.rmSync(resolved, { recursive: true, force: true })
}

async function main() {
  requirePrerequisites()
  const drawing = path.resolve(requiredArg('drawing'))
  const outputDir = path.resolve(requiredArg('output'))
  const provenancePath = readArg('autocad-provenance')
  const overwrite = process.argv.includes('--overwrite')
  if (!fs.existsSync(drawing) || !fs.statSync(drawing).isFile()) fail(`drawing not found: ${drawing}`)
  if (!['.dwg', '.dxf'].includes(path.extname(drawing).toLowerCase())) {
    fail(`drawing must be DWG or DXF: ${drawing}`)
  }
  ensureOutputAvailable(outputDir, overwrite)
  fs.mkdirSync(outputDir, { recursive: true })
  const sourceSha256 = sha256File(drawing)
  const xrefs = xrefsFromAutoCadProvenance(drawing, sourceSha256, provenancePath)

  const temporaryRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'xiaoliang-mlight-dual-'))
  try {
    const workspaceRoot = path.join(temporaryRoot, 'workspace')
    fs.mkdirSync(workspaceRoot)
    const drawingName = path.basename(drawing)
    const copiedDrawing = path.join(workspaceRoot, drawingName)
    fs.copyFileSync(drawing, copiedDrawing)
    const copiedSha256 = sha256File(copiedDrawing)
    if (sourceSha256 !== copiedSha256) throw new Error('temporary drawing copy failed SHA-256 verification')

    const xrefMap = xrefs.map((xref, index) => {
      const available = fs.existsSync(xref.sourcePath) && fs.statSync(xref.sourcePath).isFile()
      if (!available) return { ...xref, available, workspaceRelativePath: null, sha256: null, sizeBytes: null }
      const relativeDirectory = path.join('xrefs', String(index + 1))
      const relativePath = path.join(relativeDirectory, path.basename(xref.sourcePath))
      const destination = path.join(workspaceRoot, relativePath)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(xref.sourcePath, destination)
      const sha256 = sha256File(xref.sourcePath)
      if (sha256 !== sha256File(destination)) {
        throw new Error(`temporary xref copy failed SHA-256 verification: ${xref.sourcePath}`)
      }
      return {
        ...xref,
        available,
        workspaceRelativePath: relativePath.split(path.sep).join('/'),
        sha256,
        sizeBytes: fs.statSync(xref.sourcePath).size,
      }
    })
    const xrefMapPath = path.join(temporaryRoot, 'xref-map.json')
    fs.writeFileSync(xrefMapPath, `${JSON.stringify(xrefMap, null, 2)}\n`, 'utf8')

    const bundlePath = path.join(temporaryRoot, 'mlight-dual-main.cjs')
    await build({
      entryPoints: [path.join(scriptDir, 'probe', 'mlight-dual-channel-main.ts')],
      outfile: bundlePath,
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node22',
      sourcemap: 'inline',
      external: ['electron'],
      logLevel: 'warning',
    })

    const result = spawnSync(
      electron,
      [
        bundlePath,
        `--project-root=${workspaceRoot}`,
        `--drawing=${drawingName}`,
        `--source-path=${drawing}`,
        `--source-sha256=${sourceSha256}`,
        `--output-dir=${outputDir}`,
        `--cad-data-root=${cadDataRoot}`,
        `--frontend-root=${projectRoot}`,
        `--xref-map=${xrefMapPath}`,
      ],
      { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } },
    )
    if (result.status !== 0) throw new Error(`extractor exited with code ${result.status}`)
  } finally {
    safeCleanup(temporaryRoot)
  }
}

main().catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)))
