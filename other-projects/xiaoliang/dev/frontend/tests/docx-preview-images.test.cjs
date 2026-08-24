const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const frontendRoot = path.resolve(__dirname, '..')

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

async function loadRepairModule() {
  const esbuild = require('esbuild')
  const result = await esbuild.build({
    absWorkingDir: frontendRoot,
    entryPoints: ['src/docx-preview-runtime/repair-preview-images.ts'],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
  })
  const module = { exports: {} }
  const compiled = new Function('module', 'exports', 'require', result.outputFiles[0].text)
  compiled(module, module.exports, require)
  return module.exports
}

async function loadDocxProtocolModule() {
  const esbuild = require('esbuild')
  const result = await esbuild.build({
    absWorkingDir: frontendRoot,
    entryPoints: ['src/shared/docx-preview-runtime.ts'],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
  })
  const module = { exports: {} }
  const compiled = new Function('module', 'exports', 'require', result.outputFiles[0].text)
  compiled(module, module.exports, require)
  return module.exports
}

function dataUrl(mime, bytes) {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

test('docx preview sniffs raster bytes and rewrites WPS/broken image data URLs', async () => {
  const {
    sniffRasterImageMime,
    repairImageDataUrl,
    isSafeRasterImageDataUrl,
    repairCssImageDataUrls,
  } = await loadRepairModule()

  assert.equal(sniffRasterImageMime(PNG_1X1), 'image/png')
  assert.equal(sniffRasterImageMime(JPEG_MAGIC), 'image/jpeg')
  assert.equal(sniffRasterImageMime(SVG_BYTES), null)

  assert.equal(
    repairImageDataUrl(dataUrl('application/octet-stream', PNG_1X1)),
    dataUrl('image/png', PNG_1X1),
  )
  assert.equal(
    repairImageDataUrl(dataUrl('image/.jpg', JPEG_MAGIC)),
    dataUrl('image/jpeg', JPEG_MAGIC),
  )
  assert.equal(
    repairImageDataUrl(dataUrl('image/png', PNG_1X1)),
    dataUrl('image/png', PNG_1X1),
  )
  assert.equal(repairImageDataUrl(dataUrl('image/svg+xml', SVG_BYTES)), null)
  assert.equal(repairImageDataUrl('https://example.com/x.png'), null)

  assert.equal(isSafeRasterImageDataUrl(dataUrl('image/png', PNG_1X1)), true)
  assert.equal(isSafeRasterImageDataUrl(dataUrl('image/.jpg', JPEG_MAGIC)), false)
  assert.equal(isSafeRasterImageDataUrl(dataUrl('image/svg+xml', SVG_BYTES)), false)
  assert.equal(isSafeRasterImageDataUrl(dataUrl('application/octet-stream', PNG_1X1)), false)

  const css = `li { background: url("${dataUrl('image/.jpg', JPEG_MAGIC)}") }`
  assert.equal(
    repairCssImageDataUrls(css),
    `li { background: url("${dataUrl('image/jpeg', JPEG_MAGIC)}") }`,
  )
})

test('docx preview runtime bundles raster sniffing for broken Word image types', async () => {
  const { buildDocxPreviewRuntimeHtml } = await import('../scripts/build-docx-preview-runtime.mjs')
  const html = await buildDocxPreviewRuntimeHtml()
  assert.match(html, /image\/webp/)
  assert.match(html, /image\/jpeg/)
  assert.match(html, /image\/png/)
  assert.doesNotMatch(html, /image\/svg\+xml/)
  assert.match(html, /<style>/)
  assert.match(html, /docx-image-missing/)
})

test('docx preview bounds render errors before validating the parent message', async () => {
  const {
    DOCX_PREVIEW_RUNTIME_CHANNEL,
    MAX_DOCX_PREVIEW_ERROR_CHARACTERS,
    isDocxPreviewRuntimeMessage,
    toDocxPreviewErrorText,
  } = await loadDocxProtocolModule()
  const error = toDocxPreviewErrorText(new Error('x'.repeat(2_000)))

  assert.equal(error.length, MAX_DOCX_PREVIEW_ERROR_CHARACTERS)
  assert.equal(isDocxPreviewRuntimeMessage({
    channel: DOCX_PREVIEW_RUNTIME_CHANNEL,
    type: 'result',
    requestId: 1,
    success: false,
    error,
  }), true)
  assert.equal(isDocxPreviewRuntimeMessage({
    channel: DOCX_PREVIEW_RUNTIME_CHANNEL,
    type: 'result',
    requestId: 1,
    success: false,
    error: `${error}x`,
  }), false)
})
