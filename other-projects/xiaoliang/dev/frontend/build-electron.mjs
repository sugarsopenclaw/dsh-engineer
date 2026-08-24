import fs from 'node:fs'
import path from 'node:path'
import { build, context } from 'esbuild'
import {
  isInternalPack,
  isLegacyUnsignedRelease,
  validateSkillPackTrustAnchor,
} from './scripts/release-security-policy.mjs'

const watch = process.argv.includes('--watch')
const isProduction = process.env.NODE_ENV === 'production'
const internalPack = isInternalPack()
const legacyUnsignedRelease = isLegacyUnsignedRelease()
const skillPackPublicKeyBase64 = (
  process.env.XIAOLIANG_SKILL_PACK_PUBLIC_KEY_BASE64 || ''
).trim()
const skillPackSigningKeyId = (
  process.env.XIAOLIANG_SKILL_PACK_SIGNING_KEY_ID || 'primary-v1'
).trim()

if (isProduction && !skillPackPublicKeyBase64 && (internalPack || legacyUnsignedRelease)) {
  console.warn(
    `[build-electron] ${legacyUnsignedRelease ? 'legacy unsigned release' : 'internal pack'} has no skill-pack trust anchor; managed skill installs will fail closed.`,
  )
} else if (isProduction) {
  try {
    validateSkillPackTrustAnchor(skillPackPublicKeyBase64, skillPackSigningKeyId)
  } catch (error) {
    throw new Error(
      `[build-electron] production trust anchor is invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}
const rootDir = process.cwd()
const outDir = path.join(rootDir, process.env.XIAOLIANG_ELECTRON_OUTDIR || 'dist-electron')
const devBuildReadyFile = path.join(outDir, '.dev-build-ready')
let bundledAssetsReady = false
const bundledSkillsSourceDir = path.join(rootDir, 'electron', 'runtime', 'agent', 'skills', 'library')
const bundledSkillsTargetDir = path.join(outDir, 'runtime', 'agent', 'skills', 'library')
const bundledDocumentSkillsSourceDir = path.join(rootDir, 'electron', 'runtime', 'agent', 'document-skills', 'library')
const bundledDocumentSkillsTargetDir = path.join(outDir, 'runtime', 'agent', 'document-skills', 'library')
const bundledAgentDefinitionsSourceDir = path.join(rootDir, 'electron', 'runtime', 'agent', 'subagents', 'definitions')
const bundledAgentDefinitionsTargetDir = path.join(outDir, 'runtime', 'agent', 'subagents', 'definitions')
const piPackageDistDir = path.join(
  rootDir,
  'node_modules',
  '@earendil-works',
  'pi-coding-agent',
  'dist',
)
const piPackageAssetsTargetDir = path.join(
  outDir,
  'runtime',
  'agent',
  'pi',
  'pi-package-assets',
  'dist',
)

function copyBundledSkillAssets() {
  fs.rmSync(bundledSkillsTargetDir, { recursive: true, force: true })
  if (!fs.existsSync(bundledSkillsSourceDir)) {
    return
  }
  fs.mkdirSync(path.dirname(bundledSkillsTargetDir), { recursive: true })
  fs.cpSync(bundledSkillsSourceDir, bundledSkillsTargetDir, { recursive: true })
}

function copyBundledDocumentSkillAssets() {
  fs.rmSync(bundledDocumentSkillsTargetDir, { recursive: true, force: true })
  if (!fs.existsSync(bundledDocumentSkillsSourceDir)) {
    return
  }
  fs.mkdirSync(path.dirname(bundledDocumentSkillsTargetDir), { recursive: true })
  fs.cpSync(bundledDocumentSkillsSourceDir, bundledDocumentSkillsTargetDir, { recursive: true })
}

function copyBundledAgentDefinitionAssets() {
  fs.rmSync(bundledAgentDefinitionsTargetDir, { recursive: true, force: true })
  if (!fs.existsSync(bundledAgentDefinitionsSourceDir)) {
    return
  }
  fs.mkdirSync(path.dirname(bundledAgentDefinitionsTargetDir), { recursive: true })
  fs.cpSync(bundledAgentDefinitionsSourceDir, bundledAgentDefinitionsTargetDir, { recursive: true })
}

function copyPiHtmlExportAssets() {
  fs.rmSync(piPackageAssetsTargetDir, { recursive: true, force: true })
  const exportSourceDir = path.join(piPackageDistDir, 'core', 'export-html')
  const themeSourceDir = path.join(piPackageDistDir, 'modes', 'interactive', 'theme')
  if (!fs.existsSync(exportSourceDir)) {
    throw new Error(`Pi HTML export assets are missing: ${exportSourceDir}`)
  }

  fs.mkdirSync(path.join(piPackageAssetsTargetDir, 'core'), { recursive: true })
  fs.cpSync(
    exportSourceDir,
    path.join(piPackageAssetsTargetDir, 'core', 'export-html'),
    {
      recursive: true,
      filter: (source) => !isProduction || path.extname(source).toLowerCase() !== '.map',
    },
  )
  fs.mkdirSync(
    path.join(piPackageAssetsTargetDir, 'modes', 'interactive', 'theme'),
    { recursive: true },
  )
  for (const themeFile of ['dark.json', 'light.json']) {
    fs.copyFileSync(
      path.join(themeSourceDir, themeFile),
      path.join(piPackageAssetsTargetDir, 'modes', 'interactive', 'theme', themeFile),
    )
  }
}

const bundledAssetCopySteps = [
  ['bundled skills', copyBundledSkillAssets],
  ['bundled document skills', copyBundledDocumentSkillAssets],
  ['bundled agent definitions', copyBundledAgentDefinitionAssets],
  ['Pi HTML export assets', copyPiHtmlExportAssets],
]

/**
 * These copies do not depend on the TypeScript build, so an unrelated compile failure must
 * not skip them: a dist asset that lags its source fails the app at runtime with an error
 * that points nowhere near the stale file. A failed copy becomes a build error of its own.
 */
function copyBundledAssets() {
  const errors = []
  for (const [label, copy] of bundledAssetCopySteps) {
    try {
      copy()
    } catch (error) {
      errors.push({
        text: `Failed to copy ${label}: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  return errors
}

function clearDevBuildReady() {
  fs.rmSync(devBuildReadyFile, { force: true })
}

function markDevBuildReady() {
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    devBuildReadyFile,
    JSON.stringify({ pid: process.pid, readyAt: new Date().toISOString() }),
  )
}

const sharedConfig = {
  entryPoints: [
    'electron/main.ts',
    'electron/preload.ts',
    'electron/runtime/cad/mlight/preload.ts',
  ],
  outdir: outDir,
  outbase: 'electron',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  banner: {
    js: "const __xiaoliangImportMetaUrl = typeof __filename === 'string' ? require('node:url').pathToFileURL(__filename).href : 'file:///';",
  },
  define: {
    'import.meta.url': '__xiaoliangImportMetaUrl',
    'process.env.XIAOLIANG_SKILL_PACK_PUBLIC_KEY_BASE64': JSON.stringify(
      skillPackPublicKeyBase64,
    ),
    'process.env.XIAOLIANG_SKILL_PACK_SIGNING_KEY_ID': JSON.stringify(
      skillPackSigningKeyId,
    ),
    'process.env.XIAOLIANG_LEGACY_UNSIGNED_RELEASE': JSON.stringify(
      legacyUnsignedRelease ? '1' : '',
    ),
  },
  sourcemap: watch || process.env.NODE_ENV === 'development',
  ...(isProduction
    ? {
        minify: true,
        keepNames: true,
        legalComments: 'none',
      }
    : {}),
  external: ['electron', 'better-sqlite3', 'keytar'],
  logLevel: 'info',
  plugins: [
    {
      name: 'copy-bundled-assets',
      setup(buildApi) {
        buildApi.onEnd((result) => {
          let errors = []
          if (!watch || !bundledAssetsReady) {
            errors = copyBundledAssets()
            bundledAssetsReady = errors.length === 0
          }

          if (watch) {
            try {
              if (result.errors.length === 0 && errors.length === 0 && bundledAssetsReady) {
                markDevBuildReady()
              } else {
                clearDevBuildReady()
              }
            } catch (error) {
              errors.push({
                text: `Failed to update Electron dev readiness: ${error instanceof Error ? error.message : String(error)}`,
              })
            }
          }

          return { errors }
        })
      },
    },
  ],
}

if (!watch) {
  try {
    fs.rmSync(outDir, { recursive: true, force: true })
  } catch (error) {
    console.warn(
      '[build-electron] could not remove dist-electron, overwriting in place:',
      error instanceof Error ? error.message : String(error),
    )
  }
  await build(sharedConfig)
  process.exit(0)
}

clearDevBuildReady()
const buildContext = await context(sharedConfig)
await buildContext.watch()
console.log('[build-electron] watching electron/**/*.ts')
