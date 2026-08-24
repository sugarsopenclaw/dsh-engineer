const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
}

function loadBundledModule(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    tsconfig: path.resolve(__dirname, '..', 'tsconfig.app.json'),
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    write: false,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

test('streaming assistant output never mounts evidence images', () => {
  const panelSource = read('src/components/runtime/agent-chat-panel.tsx')
  const bubbleSource = read('src/components/chat/message-bubble.tsx')

  assert.doesNotMatch(panelSource, /<MessageImages\s+attachments=\{streaming\.attachments\}/)
  assert.doesNotMatch(panelSource, /streaming\.attachments\.length\s*>\s*0/)
  assert.match(bubbleSource, /<MessageImages\s+attachments=\{attachments\}\s+className="mt-3"/)
})

test('completed assistant evidence renders as a compact three-column thumbnail grid', () => {
  const { MessageImages } = loadBundledModule('src/components/chat/message-images.tsx')
  const markup = renderToStaticMarkup(React.createElement(MessageImages, {
    attachments: [{
      id: 'evidence-1',
      mimeType: 'image/png',
      data: Buffer.from('thumbnail').toString('base64'),
      name: 'detail.png',
    }],
  }))

  assert.match(markup, /max-w-\[22rem\] grid-cols-3/)
  assert.match(markup, /aspect-\[4\/3\] w-full/)
  assert.match(markup, /aria-label="查看大图：detail\.png"/)
  assert.match(markup, /loading="lazy"/)
  assert.match(markup, /<dialog/)
  assert.match(markup, /aria-label="关闭图片预览"/)
})
