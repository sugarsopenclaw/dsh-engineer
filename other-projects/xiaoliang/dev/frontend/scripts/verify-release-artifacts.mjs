import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { extractFile, listPackage } from '@electron/asar'
import electronFuses from '@electron/fuses'
import {
  hasConfiguredPublisherName,
  isInternalPack,
  isLegacyUnsignedRelease,
  validateSkillPackTrustAnchor,
} from './release-security-policy.mjs'

const { FuseV1Options, getCurrentFuseWire } = electronFuses
// @electron/fuses 1.x exposes FuseState in its type declarations but not from
// the CommonJS runtime entrypoint. Fuse bytes are the ASCII values documented
// by Electron's fuse wire format: "0" disables and "1" enables a fuse.
const FuseState = Object.freeze({
  DISABLE: '0'.charCodeAt(0),
  ENABLE: '1'.charCodeAt(0),
})

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const unpackedRoot = path.join(projectRoot, 'release', 'win-unpacked')
const resourcesRoot = path.join(unpackedRoot, 'resources')
const asarPath = path.join(resourcesRoot, 'app.asar')
const appExecutable = path.join(unpackedRoot, '晓量.exe')
const appUpdateConfig = path.join(resourcesRoot, 'app-update.yml')
const internalPack = isInternalPack()
const legacyUnsignedRelease = isLegacyUnsignedRelease()
const errors = []
const warnings = []
const checks = []

function pass(message) {
  checks.push(message)
}

function fail(message) {
  errors.push(message)
}

function warn(message) {
  warnings.push(message)
}

function normalizeAsarPath(value) {
  return value.replace(/^[/\\]+/, '').replace(/\\/g, '/')
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(target)
      else if (entry.isFile()) files.push(target)
    }
  }
  return files
}

function verifyAsar() {
  if (!fs.existsSync(asarPath)) {
    fail(`missing app.asar: ${path.relative(projectRoot, asarPath)}`)
    return
  }

  const entries = listPackage(asarPath, { isPack: false }).map(normalizeAsarPath)
  const sourceMaps = entries.filter((entry) => entry.toLowerCase().endsWith('.map'))
  const envFiles = entries.filter((entry) => path.posix.basename(entry).toLowerCase().startsWith('.env'))
  const legacyBundles = entries.filter((entry) => entry.startsWith('dist-electron-pkg/'))
  if (sourceMaps.length > 0) fail(`app.asar contains source maps: ${sourceMaps.join(', ')}`)
  else pass('app.asar contains zero *.map files')
  if (envFiles.length > 0) fail(`app.asar contains environment files: ${envFiles.join(', ')}`)
  else pass('app.asar contains zero .env* files')
  if (legacyBundles.length > 0) fail(`app.asar contains legacy dist-electron-pkg files`)
  else pass('app.asar excludes dist-electron-pkg')

  for (const entry of ['dist-electron/main.js', 'dist-electron/preload.js']) {
    if (!entries.includes(entry)) {
      fail(`app.asar is missing ${entry}`)
      continue
    }
    const content = extractFile(asarPath, entry).toString('utf8')
    const tail = content.slice(-4096)
    if (/sourceMappingURL\s*=/.test(tail)) fail(`${entry} still contains sourceMappingURL`)
    else pass(`${entry} has no sourceMappingURL trailer`)
  }
}

function verifyResources() {
  const files = walkFiles(resourcesRoot)
  const forbidden = files.filter((file) => {
    const relative = path.relative(resourcesRoot, file).replace(/\\/g, '/')
    const segments = relative.toLowerCase().split('/')
    return segments.includes('_diag')
      || segments.includes('tests')
      || /^diagnose_.*\.py$/i.test(path.basename(relative))
  })
  if (forbidden.length > 0) {
    fail(`resources contains diagnostics/tests: ${forbidden.map((file) => path.relative(resourcesRoot, file)).join(', ')}`)
  } else {
    pass('resources excludes _diag/, tests/, and diagnose_*.py')
  }

  const requiredCadExecutables = [
    'cad/autocad-com/python/packaged-bin/cad_worker.exe',
    'cad/autocad-http/python/packaged-bin/xiaoliang_cad_bridge.exe',
  ]
  for (const relative of requiredCadExecutables) {
    const target = path.join(resourcesRoot, ...relative.split('/'))
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) fail(`missing CAD executable: ${relative}`)
    else pass(`CAD executable present: ${relative}`)
  }
}

async function verifyFuses() {
  if (!fs.existsSync(appExecutable)) {
    fail(`missing packaged executable: ${path.relative(projectRoot, appExecutable)}`)
    return
  }
  const wire = await getCurrentFuseWire(appExecutable)
  const expected = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  ])
  for (const [fuse, state] of expected) {
    const name = FuseV1Options[fuse]
    if (wire[fuse] !== state) fail(`Electron fuse ${name} is ${wire[fuse]}, expected ${state}`)
    else pass(`Electron fuse ${name} is enforced`)
  }
}

function authenticodeStatus(file) {
  const escaped = file.replace(/'/g, "''")
  const systemPowerShell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : null
  const candidates = [systemPowerShell, 'pwsh.exe', 'powershell.exe'].filter(Boolean)
  for (const executable of candidates) {
    const result = spawnSync(
      executable,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status.ToString()`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 20_000 },
    )
    const status = String(result.stdout || '').trim()
    if (!result.error && result.status === 0 && status) return status
  }
  return null
}

function verifyCodeSigning() {
  const installers = fs.existsSync(path.join(projectRoot, 'release'))
    ? fs.readdirSync(path.join(projectRoot, 'release'))
      .filter((name) => /^晓量-Setup-.*\.exe$/i.test(name))
      .map((name) => path.join(projectRoot, 'release', name))
    : []
  const targets = [appExecutable, ...installers].filter((file) => fs.existsSync(file))
  const statuses = targets.map((file) => ({ file, status: authenticodeStatus(file) }))

  for (const { file, status } of statuses) {
    const relative = path.relative(projectRoot, file)
    if (status === 'Valid') pass(`Authenticode signature is valid: ${relative}`)
    else if (legacyUnsignedRelease) warn(`legacy unsigned release artifact (${status ?? 'unavailable'}): ${relative}`)
    else if (internalPack) warn(`unsigned internal artifact (${status ?? 'unavailable'}): ${relative}`)
    else fail(`Authenticode signature is not valid (${status ?? 'unavailable'}): ${relative}`)
  }
  if (installers.length === 0) {
    if (internalPack) warn('NSIS installer not present; installer signature check skipped for internal directory pack')
    else fail('NSIS installer not present in public release artifacts')
  }
}

function verifyUpdatePublisherName() {
  if (!fs.existsSync(appUpdateConfig)) {
    if (internalPack) warn('app-update.yml is absent from internal directory pack')
    else fail('public release is missing win-unpacked/resources/app-update.yml')
    return
  }
  const content = fs.readFileSync(appUpdateConfig, 'utf8')
  if (hasConfiguredPublisherName(content)) {
    pass('app-update.yml contains a non-empty publisherName')
  } else if (legacyUnsignedRelease) {
    warn('legacy unsigned release has no publisherName; updater intentionally uses the 0.8.18 checksum-only path')
  } else if (internalPack) {
    warn('internal app-update.yml has no publisherName; automatic updates will fail closed')
  } else {
    fail('public app-update.yml has no non-empty publisherName')
  }
}

function verifySkillPackTrustAnchor() {
  const publicKeyBase64 = process.env.XIAOLIANG_SKILL_PACK_PUBLIC_KEY_BASE64?.trim() || ''
  const keyId = process.env.XIAOLIANG_SKILL_PACK_SIGNING_KEY_ID?.trim() || 'primary-v1'
  if (!publicKeyBase64 && (internalPack || legacyUnsignedRelease)) {
    warn(`${legacyUnsignedRelease ? 'legacy unsigned release' : 'internal pack'} has no skill-pack trust anchor; managed skill installs will fail closed`)
    return
  }

  let trustAnchor
  try {
    trustAnchor = validateSkillPackTrustAnchor(publicKeyBase64, keyId)
  } catch (error) {
    fail(`skill-pack trust anchor is invalid: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (!fs.existsSync(asarPath)) return
  let mainBundle
  try {
    mainBundle = extractFile(asarPath, 'dist-electron/main.js').toString('utf8')
  } catch (error) {
    fail(`cannot inspect production main bundle for skill-pack trust anchor: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (
    !mainBundle.includes(trustAnchor.publicKeyBase64)
    || !mainBundle.includes(trustAnchor.keyId)
  ) {
    fail('production main bundle does not contain the supplied skill-pack trust anchor and key id')
  } else {
    pass('production main bundle contains a valid Ed25519 skill-pack trust anchor and key id')
  }
}

verifyAsar()
verifyResources()
await verifyFuses()
verifyCodeSigning()
verifyUpdatePublisherName()
verifySkillPackTrustAnchor()

for (const message of checks) console.log(`[release-gate] PASS ${message}`)
for (const message of warnings) console.warn(`[release-gate] WARN ${message}`)
if (errors.length > 0) {
  for (const message of errors) console.error(`[release-gate] FAIL ${message}`)
  throw new Error(`release artifact verification failed with ${errors.length} error(s)`)
}
console.log(`[release-gate] verified ${checks.length} assertions with ${warnings.length} warning(s)`)
