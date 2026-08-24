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

// markstream 把 mermaid / d2 / monaco 等重型渲染器声明为可选 peer 并按需 import()，
// 打包时保持 external，交给运行时；纯文本回答不会触达它们。
const MARKSTREAM_OPTIONAL_PEERS = [
  '@antv/infographic',
  '@terrastruct/d2',
  'mermaid',
  'stream-markdown',
  'stream-monaco',
]

function loadBundledModule(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    tsconfig: path.resolve(__dirname, '..', 'tsconfig.app.json'),
    external: [
      'react',
      'react/*',
      'react-dom',
      'react-dom/*',
      ...MARKSTREAM_OPTIONAL_PEERS,
    ],
    write: false,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function marker(index) {
  return `节点标记-${String(index).padStart(3, '0')}`
}

/**
 * 复刻线上两条被截断回答的顶层结构：标题 / 正文 / 列表 / 表格 / 无语言代码块交替，
 * 且第 40 个节点（索引 39）之后仍有大量内容。
 */
function buildLongAnswer(nodeCount) {
  const blocks = []
  for (let index = 0; index < nodeCount; index += 1) {
    const tag = marker(index)
    switch (index % 5) {
      case 0:
        blocks.push(`## ${tag} 装配式构件要点`)
        break
      case 1:
        blocks.push(`${tag}：叠合板吊装前应完成支撑体系验收，确保标高与轴线偏差在允许范围内。`)
        break
      case 2:
        blocks.push(`- ${tag} 控制要点一\n- ${tag} 控制要点二`)
        break
      case 3:
        blocks.push(
          `| 工序 | 标准 |\n| --- | --- |\n| ${tag} | 偏差 ≤ 5mm |`,
        )
        break
      default:
        blocks.push('```\n' + `${tag} 进场验收 -> 吊装就位 -> 灌浆封仓 -> 质量验收` + '\n```')
        break
    }
  }
  return blocks.join('\n\n')
}

function renderLongAnswer(nodeCount) {
  const { MarkdownRender } = loadBundledModule('src/components/chat/markdown-render.tsx')
  return renderToStaticMarkup(
    React.createElement(MarkdownRender, {
      content: buildLongAnswer(nodeCount),
      final: true,
    }),
  )
}

function assertFullyRendered(markup, nodeCount, sampleIndexes) {
  const placeholders = markup.match(/node-placeholder/g)?.length ?? 0
  assert.equal(placeholders, 0, `不应留下未绘制的占位节点，实际 ${placeholders} 个`)

  for (const index of sampleIndexes) {
    assert.ok(
      markup.includes(marker(index)),
      `索引 ${index} 的顶层节点应当被渲染（共 ${nodeCount} 个节点）`,
    )
  }
}

test('74 个顶层节点的回答不会停在第 40 个节点', () => {
  assertFullyRendered(renderLongAnswer(74), 74, [0, 39, 40, 41, 73])
})

test('116 个顶层节点的回答完整收尾', () => {
  const markup = renderLongAnswer(116)
  assertFullyRendered(markup, 116, [40, 80, 115])
  assert.ok(markup.includes('data-node-index="115"'), '最后一个节点槽位应当存在')
})

test('聊天渲染关闭 markstream 的延迟节点与分批渲染', () => {
  const source = read('src/components/chat/markdown-render.tsx')
  assert.match(source, /deferNodesUntilVisible=\{false\}/)
  assert.match(source, /batchRendering=\{false\}/)
})

test('应用入口在自定义样式之前载入 markstream 基础样式', () => {
  const source = read('src/main.tsx')
  const baseIndex = source.indexOf("import 'markstream-react/index.css'")
  const appIndex = source.indexOf("import './styles/index.css'")

  assert.ok(baseIndex >= 0, 'main.tsx 必须导入 markstream-react/index.css')
  assert.ok(appIndex > baseIndex, '项目样式必须排在 markstream 基础样式之后以保留覆盖')
})

test('聊天容器关闭 markstream 根节点的 content-visibility 跳过绘制', () => {
  const styles = read('src/styles/index.css')
  assert.match(
    styles,
    /\.chat-markdown \.markstream-react\.markdown-renderer \{[^}]*content-visibility:\s*visible/,
  )
})
