const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('production Electron build is minified without source maps and runs the release gate', () => {
  const build = read('build-electron.mjs')
  const manifest = JSON.parse(read('package.json'))
  assert.match(build, /sourcemap: watch \|\| process\.env\.NODE_ENV === 'development'/)
  assert.match(build, /minify: true/)
  assert.match(build, /keepNames: true/)
  assert.match(build, /legalComments: 'none'/)
  assert.match(build, /!isProduction \|\| path\.extname\(source\)\.toLowerCase\(\) !== '\.map'/)
  assert.match(manifest.scripts['electron:build'], /verify:release-artifacts/)
  assert.doesNotMatch(manifest.scripts['electron:build'], /XIAOLIANG_INTERNAL_PACK/)
  assert.match(
    manifest.scripts['electron:build:legacy-unsigned'],
    /XIAOLIANG_LEGACY_UNSIGNED_RELEASE=1.*verify:release-artifacts/,
  )
  assert.match(manifest.scripts['electron:pack'], /XIAOLIANG_INTERNAL_PACK=1/)
  assert.equal(manifest.build.files.includes('dist-electron-pkg/**/*'), false)
})

test('public release policy requires a canonical Ed25519 SPKI trust anchor', async () => {
  const policy = await import(pathToFileURL(
    path.join(root, 'scripts/release-security-policy.mjs'),
  ).href)
  const { publicKey } = crypto.generateKeyPairSync('ed25519')
  const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')

  assert.equal(policy.isInternalPack({ XIAOLIANG_INTERNAL_PACK: '1' }), true)
  assert.equal(policy.isInternalPack({ XIAOLIANG_INTERNAL_PACK: 'true' }), false)
  assert.equal(
    policy.isLegacyUnsignedRelease({ XIAOLIANG_LEGACY_UNSIGNED_RELEASE: '1' }),
    true,
  )
  assert.equal(
    policy.isLegacyUnsignedRelease({ XIAOLIANG_LEGACY_UNSIGNED_RELEASE: 'true' }),
    false,
  )
  assert.equal(
    policy.validateSkillPackTrustAnchor(publicKeyBase64, 'primary-v1').publicKeyBase64,
    publicKeyBase64,
  )
  assert.throws(() => policy.validateSkillPackTrustAnchor('', 'primary-v1'), /is required/)
  assert.throws(() => policy.validateSkillPackTrustAnchor('not-base64', 'primary-v1'), /Base64/)

  const { publicKey: rsaPublicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const rsaBase64 = rsaPublicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  assert.throws(
    () => policy.validateSkillPackTrustAnchor(rsaBase64, 'primary-v1'),
    /Ed25519/,
  )

  const missingAnchorBuild = spawnSync(process.execPath, ['build-electron.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      XIAOLIANG_INTERNAL_PACK: '',
      XIAOLIANG_SKILL_PACK_PUBLIC_KEY_BASE64: '',
    },
  })
  assert.notEqual(missingAnchorBuild.status, 0)
  assert.match(
    `${missingAnchorBuild.stdout}\n${missingAnchorBuild.stderr}`,
    /production trust anchor is invalid.*is required/s,
  )
})

test('packaging enables the hardened Electron fuse set and update signature verification', () => {
  const manifest = JSON.parse(read('package.json'))
  const updater = read('electron/shell/auto-update-manager.ts')
  const verifier = read('scripts/verify-release-artifacts.mjs')
  assert.deepEqual(manifest.build.electronFuses, {
    runAsNode: false,
    enableNodeCliInspectArguments: false,
    enableNodeOptionsEnvironmentVariable: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
  })
  assert.equal(manifest.build.win.verifyUpdateCodeSignature, true)
  assert.match(updater, /trustedPublishers\.length === 0/)
  assert.match(updater, /更新配置缺少受信任的 publisherName/u)
  assert.match(updater, /process\.env\.XIAOLIANG_LEGACY_UNSIGNED_RELEASE === '1'/)
  assert.match(updater, /process\.platform === 'win32' && !legacyUnsignedRelease/)
  assert.match(verifier, /else fail\(`Authenticode signature is not valid/)
  assert.match(verifier, /legacy unsigned release artifact/)
  assert.match(verifier, /hasConfiguredPublisherName\(content\)/)
})

test('publisher-name policy rejects empty updater configuration', async () => {
  const policy = await import(pathToFileURL(
    path.join(root, 'scripts/release-security-policy.mjs'),
  ).href)
  assert.equal(policy.hasConfiguredPublisherName('provider: generic\n'), false)
  assert.equal(policy.hasConfiguredPublisherName('publisherName: []\n'), false)
  assert.equal(policy.hasConfiguredPublisherName('publisherName: # missing\n'), false)
  assert.equal(policy.hasConfiguredPublisherName('publisherName:\n  - \"\"\n'), false)
  assert.equal(policy.hasConfiguredPublisherName('publisherName:\n  - Xiaoliang Co., Ltd.\n'), true)
  assert.equal(policy.hasConfiguredPublisherName('publisherName: Xiaoliang Co., Ltd.\n'), true)
})

test('main window, external URLs, and LLM settings keep the narrowed security boundary', () => {
  const appConfig = read('electron/shell/app-config.ts')
  const handlers = read('electron/runtime/ipc/ipc-handlers.ts')
  const contract = read('src/shared/ipc-contract.ts')
  const localAgent = read('src/shared/local-agent.ts')
  assert.match(appConfig, /sandbox: true/)
  assert.match(handlers, /new Set\(\['https:', 'http:', 'mailto:'\]\)/)
  assert.doesNotMatch(handlers, /input\.apiKey|SETTINGS_TEST_LLM_CONNECTION/)
  assert.doesNotMatch(contract, /settings:testLlmConnection/)
  assert.doesNotMatch(localAgent, /interface LlmConnectionTestInput|apiKey\?: string/)
  assert.equal(fs.existsSync(path.join(root, 'electron/runtime/llm/connection-tester.ts')), false)
})

test('market skill requests require Bearer auth and verify a signature before install', () => {
  const source = read('electron/runtime/agent/skills/sync/skill-pack-sync-service.ts')
  const registry = read('electron/runtime/agent/skills/registry.ts')
  assert.match(source, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.match(source, /请先登录后再检查或安装 skill 更新/)
  assert.match(source, /verifySkillPackSignature\(pack, publicKeyBase64, trustedKeyId\)/)
  assert.match(source, /verifyDeclaredSkillMetadata\(/)
  assert.match(source, /name: trustedMetadata\.name/)
  assert.match(source, /description: trustedMetadata\.description/)
  assert.match(
    registry,
    /name: extractMarkdownTitle\(content\) \|\| frontmatter\.name \|\| manifestSkill\?\.name/,
  )
  const installUpdate = source.slice(
    source.indexOf('async installUpdate'),
    source.indexOf('export function validatePack'),
  )
  assert.match(installUpdate, /validatePack\(pack, expectedChecksum \|\| null\)/)
  assert.match(installUpdate, /writeManagedPack\(pack\)/)
  assert.ok(
    installUpdate.indexOf('validatePack(pack, expectedChecksum || null)')
      < installUpdate.indexOf('writeManagedPack(pack)'),
  )
})

test('PowerShell key-export instructions keep binary DER out of the pipeline', () => {
  const documentation = read('docs/security-hardening.md')
  assert.match(documentation, /-outform DER -out .*public\.der/u)
  assert.match(documentation, /openssl base64 -A -in .*public\.der/u)
  assert.doesNotMatch(documentation, /-outform DER\s*\|/u)
  assert.match(documentation, /SPKI DER/u)
})
