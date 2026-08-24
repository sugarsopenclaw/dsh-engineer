const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const projectRoot = path.resolve(__dirname, '..')

const bundleOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  write: false,
  banner: {
    js: "const __bundledImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  },
  define: {
    'import.meta.url': '__bundledImportMetaUrl',
  },
}

function compileBundledModule(filename, output) {
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function loadBundledModule(relativePath) {
  const filename = path.resolve(projectRoot, relativePath)
  const output = esbuild.buildSync({ ...bundleOptions, entryPoints: [filename] })
  return compileBundledModule(filename, output)
}

async function loadBundledModuleAsync(relativePath, plugins = []) {
  const filename = path.resolve(projectRoot, relativePath)
  const output = await esbuild.build({
    ...bundleOptions,
    entryPoints: [filename],
    plugins,
  })
  return compileBundledModule(filename, output)
}

function electronStub() {
  return {
    name: 'electron-stub',
    setup(build) {
      build.onResolve({ filter: /^electron$/ }, () => ({
        path: 'electron',
        namespace: 'electron-stub',
      }))
      build.onLoad({ filter: /.*/, namespace: 'electron-stub' }, () => ({
        contents: 'export class BrowserWindow {}\nexport const app = { getPath() { return "" }, isPackaged: false }',
        loader: 'js',
      }))
    },
  }
}

const PI_TOOL_BASE = ['read', 'grep', 'find', 'ls', 'edit', 'write']

test('buildPiCodingTools registers six tools and adds bash only when available', () => {
  const piCoding = loadBundledModule('electron/runtime/agent/tools/domain/pi-coding/index.ts')

  const withoutBash = piCoding.buildPiCodingTools({ cwd: projectRoot, includeBash: false })
  assert.deepEqual(withoutBash.map((tool) => tool.name), PI_TOOL_BASE)

  const withBash = piCoding.buildPiCodingTools({ cwd: projectRoot, includeBash: true })
  assert.deepEqual(withBash.map((tool) => tool.name), [...PI_TOOL_BASE, 'bash'])

  for (const tool of withBash) {
    assert.equal(typeof tool.execute, 'function', `${tool.name} 必须可执行`)
    assert.ok(tool.description && tool.description.length > 0, `${tool.name} 必须有描述`)
    assert.ok(tool.parameters, `${tool.name} 必须有参数 schema`)
  }
})

test('parent file tools expose the validated pack but hide and protect raw research pages', async (t) => {
  const piCoding = loadBundledModule('electron/runtime/agent/tools/domain/pi-coding/index.ts')
  const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-parent-research-')))
  const researchRoot = path.join(fixtureRoot, '.xiaoliang', 'research')
  const pagesRoot = path.join(researchRoot, 'pages')
  const evidenceRoot = path.join(researchRoot, 'evidence', 'run-1')
  fs.mkdirSync(pagesRoot, { recursive: true })
  fs.mkdirSync(evidenceRoot, { recursive: true })
  fs.writeFileSync(path.join(pagesRoot, 'raw.md'), 'child-only-secret-clause')
  fs.writeFileSync(path.join(evidenceRoot, 'evidence.md'), 'host-validated-pack')

  try {
    const byName = new Map(
      piCoding.buildPiCodingTools({ cwd: fixtureRoot, includeBash: false })
        .map((tool) => [tool.name, tool]),
    )
    const read = byName.get('read')
    const grep = byName.get('grep')
    const find = byName.get('find')
    const ls = byName.get('ls')
    const write = byName.get('write')

    await assert.rejects(
      () => read.execute('read-page', { path: '.xiaoliang/research/pages/raw.md' }),
      /历史调研网页原文保持封存/,
    )
    const pack = await read.execute('read-pack', {
      path: '.xiaoliang/research/evidence/run-1/evidence.md',
    })
    assert.match(pack.content[0].text, /host-validated-pack/)

    await assert.rejects(
      () => write.execute('write-research', {
        path: '.xiaoliang/research/evidence/run-1/forged.md',
        content: 'forged',
      }),
      /主 Agent 不能修改/,
    )
    await assert.rejects(
      () => ls.execute('ls-pages', { path: '.xiaoliang/research/pages' }),
      /历史调研网页原文保持封存/,
    )

    const listed = await ls.execute('ls-research', { path: '.xiaoliang/research' })
    assert.doesNotMatch(listed.content[0].text, /pages/u)
    assert.match(listed.content[0].text, /evidence/u)

    const grepped = await grep.execute('grep-all', {
      pattern: 'child-only-secret-clause',
      path: '.',
    })
    assert.doesNotMatch(grepped.content[0].text, /child-only-secret-clause|research[\\/]pages/u)

    const found = await find.execute('find-all', { pattern: '**/*.md', path: '.' })
    assert.doesNotMatch(found.content[0].text, /research[\\/]pages/u)
    assert.match(found.content[0].text, /evidence\.md/u)

    const alias = path.join(fixtureRoot, 'research-alias')
    try {
      fs.symlinkSync(researchRoot, alias, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      t.diagnostic(`symlink/junction unavailable: ${error.message}`)
      return
    }
    await assert.rejects(
      () => read.execute('read-alias-page', { path: 'research-alias/pages/raw.md' }),
      /历史调研网页原文保持封存/,
    )
    await assert.rejects(
      () => write.execute('write-alias', {
        path: 'research-alias/new.md',
        content: 'forged through alias',
      }),
      /主 Agent 不能修改/,
    )
    assert.ok(!fs.existsSync(path.join(researchRoot, 'new.md')))
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('isPiBashAvailable is a cached boolean probe', () => {
  const piCoding = loadBundledModule('electron/runtime/agent/tools/domain/pi-coding/index.ts')
  piCoding.resetPiBashAvailabilityCache()
  const first = piCoding.isPiBashAvailable()
  assert.equal(typeof first, 'boolean')
  assert.equal(piCoding.isPiBashAvailable(), first)
})

test('createAgentTools mounts Pi coding tools only when the project cwd is provided', async () => {
  const tools = await loadBundledModuleAsync('electron/runtime/agent/tools/index.ts', [electronStub()])
  const baseDeps = {
    conversationId: 'conversation-1',
    consumeAlgorithmSaveApproval: () => false,
    webSearch: async () => ({}),
    parseProjectDocument: async () => ({}),
    saveProjectComponents: async () => [],
    queryProjectComponents: async () => [],
    getProjectComponent: async () => ({}),
    updateProjectComponent: async () => ({}),
    deleteProjectComponent: async () => undefined,
    writeProjectTextArtifact: async () => ({}),
    writeProjectExcelArtifact: async () => ({}),
    writeProjectDocxArtifact: async () => ({}),
    writeProjectPptxArtifact: async () => ({}),
    exportProjectAlgorithm: async () => [],
    loadApprovedPlanMessage: async () => '计划已批准，开始执行。',
  }

  const withPi = await tools.createAgentTools({
    ...baseDeps,
    piCodingTools: { cwd: projectRoot, includeBash: true },
  })
  const withPiNames = withPi.map((tool) => tool.name)
  for (const name of [...PI_TOOL_BASE, 'bash']) {
    assert.ok(withPiNames.includes(name), `启用时应包含 ${name}`)
  }
  assert.ok(withPiNames.includes('doc_parse'), '富文档解析工具必须保留')
  assert.ok(withPiNames.includes('project_artifact_create'), '产物工具必须保留')
  assert.ok(!withPiNames.includes('project_list'), 'project_list 已删除')
  assert.ok(!withPiNames.includes('project_search'), 'project_search 已删除')
  assert.ok(!withPiNames.includes('project_read'), 'project_read 已由 doc_parse 接替')
  assert.equal(new Set(withPiNames).size, withPiNames.length, '工具名必须唯一')

  const withoutPi = await tools.createAgentTools({
    ...baseDeps,
    piCodingTools: null,
  })
  const withoutPiNames = withoutPi.map((tool) => tool.name)
  for (const name of [...PI_TOOL_BASE, 'bash']) {
    assert.ok(!withoutPiNames.includes(name), `未启用时不应包含 ${name}`)
  }

  const artifactOnly = await tools.createAgentTools({
    ...baseDeps,
    projectRoot,
    piCodingTools: null,
  })
  const artifactOnlyNames = artifactOnly.map((tool) => tool.name)
  assert.equal(artifactOnlyNames.filter((name) => name === 'read').length, 1)
  assert.ok(artifactOnlyNames.includes('web_fetch'))
  assert.ok(!artifactOnlyNames.includes('grep'))
  assert.equal(new Set(artifactOnlyNames).size, artifactOnlyNames.length)
})

test('tooling prompt section describes the file tool split and drops retired names', () => {
  const { buildToolingSection } = loadBundledModule(
    'electron/runtime/agent/prompts/system/sections/tooling.ts',
  )

  const fullNames = [
    ...PI_TOOL_BASE,
    'bash',
    'doc_parse',
    'project_artifact_create',
    'project_document_skill_read',
    'web_search',
    'web_fetch',
    'delegate_cad',
    'delegate_blender',
    'cad_evidence_image',
  ]
  const full = buildToolingSection(fullNames)
  assert.match(full, /【文件工具】/)
  assert.match(full, /【文件写入】/)
  assert.match(full, /【bash】/)
  assert.match(full, /【富文档】/)
  assert.match(full, /生成 DOCX、XLSX、PPTX、报告或创建自制 skill/)
  assert.doesNotMatch(full, /复杂富文档.*(?:skill|project_document_skill_read)/)
  assert.match(full, /必须按此顺序[\s\S]*用 read 读取[\s\S]*evidence\.md[\s\S]*cad_evidence_image/)
  assert.match(full, /不得只抄路径、只信摘录里的「字面观察」/)

  const { buildDelegationSection } = loadBundledModule(
    'electron/runtime/agent/prompts/system/sections/delegation.ts',
  )
  const { buildCoreRoleSection } = loadBundledModule(
    'electron/runtime/agent/prompts/system/sections/core-role.ts',
  )
  assert.match(
    buildDelegationSection(fullNames),
    /必须先 read canonical evidence\.md，再用 cad_evidence_image/,
  )
  assert.match(buildCoreRoleSection(fullNames), /引用的局部图必须实际查看后再作答/)
  assert.match(full, /【联网边界】/)
  assert.match(full, /【网页正文】.*\.xiaoliang\/web\/pages\//)
  assert.match(full, /结构化 title\/url\/snippet\/provider\/fallback\/status/u)
  assert.match(full, /工程标准、政策或造价依据.*web_fetch 正文.*编号\/条号.*发布与实施日期.*实际发布机关 URL/u)
  assert.match(full, /snippet、转载或征求意见稿.*待核.*人工复核/u)
  assert.match(full, /【检索年份】.*\d{4}年\d{1,2}月/u)
  assert.match(full, /图签\/标题栏\/设计总说明/)
  assert.doesNotMatch(full, /web_research|delegate_research|调研子代理|Tier1|Tier2|GB 55001~55037/u)
  assert.doesNotMatch(full, /project_list|project_search|project_read/)

  const noBash = buildToolingSection(fullNames.filter((name) => name !== 'bash'))
  assert.doesNotMatch(noBash, /【bash】/)
  assert.doesNotMatch(noBash, /\bbash\b/)

  const noCodingTools = buildToolingSection(['doc_parse', 'project_artifact_create'])
  assert.doesNotMatch(noCodingTools, /【文件工具】/)
  assert.match(noCodingTools, /【富文档】/)

  const artifactOnly = buildToolingSection(['read', 'web_search', 'web_fetch'])
  assert.match(artifactOnly, /当前 read 只允许读取 web_fetch 返回的 \.xiaoliang\/web\/pages\/\*\.md/u)
  assert.doesNotMatch(artifactOnly, /ls 列目录/u)
})

test('project document skill reader exposes only artifact-authoring skills', async () => {
  const { buildProjectDocumentSkillTools } = loadBundledModule(
    'electron/runtime/agent/tools/domain/project-document-skills/index.ts',
  )
  const [reader] = buildProjectDocumentSkillTools()
  const schema = JSON.stringify(reader.parameters)
  const retained = [
    'spreadsheet-writing',
    'document-writing',
    'presentation-writing',
    'report-writing',
    'create-skills',
  ]
  const retired = [
    'project-file-reading-playbook',
    'pdf-reading',
    'docx-reading',
    'spreadsheet-reading',
  ]

  for (const slug of retained) {
    assert.match(schema, new RegExp(slug))
    const result = await reader.execute(`read-${slug}`, { slug })
    assert.equal(result.details.found, true, `${slug} 必须继续可读`)
  }
  for (const slug of retired) {
    assert.doesNotMatch(schema, new RegExp(slug))
    const result = await reader.execute(`read-${slug}`, { slug })
    assert.equal(result.details.found, false, `${slug} 必须保持下架`)
  }
})

test('runtime reminder lives in a per-turn layer so the system prompt stays byte-stable', () => {
  const read = (relativePath) =>
    fs.readFileSync(path.resolve(projectRoot, relativePath), 'utf8')

  // buildSystemPrompt must not embed volatile fields (time, session name, image count).
  const builder = read('electron/runtime/agent/prompts/system/builder.ts')
  assert.doesNotMatch(builder, /buildRuntimeReminder\(/)

  // The manager injects the same reminder content as a [runtime_reminder] context layer.
  const manager = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  assert.match(manager, /key: 'runtime_reminder'/)
  assert.match(manager, /content: buildRuntimeReminder\(\{/)
})

test('per-turn context layers are injected at the tail so history stays a stable cache prefix', () => {
  const manager = fs
    .readFileSync(
      path.resolve(projectRoot, 'electron/runtime/agent/sessions/agent-session-manager.ts'),
      'utf8',
    )
    .replace(/\s+/g, ' ')

  // Head injection puts a volatile layer (current time) in front of the whole transcript,
  // which caps the gateway prefix cache at system+tools. Tail injection must not regress.
  assert.doesNotMatch(manager, /\.\.\.injectedMessages, \.\.\.messages/)
  assert.match(
    manager,
    /return \[ \.\.\.messages, \{ role: 'user', content: \[CONTEXT_SNAPSHOT_PREFACE, renderContextLayers\(assembled\.layers\)\]/,
  )
})

test('context layers render once and carry a stable provenance preface', () => {
  const { CONTEXT_SNAPSHOT_PREFACE, renderContextLayers } = loadBundledModule(
    'electron/runtime/agent/context/context-assembler.ts',
  )

  // A tail-injected pseudo user message must say it is not the user speaking.
  assert.match(CONTEXT_SNAPSHOT_PREFACE, /不是用户发言/)

  // Layers whose content already opens with their own tag must not get a duplicate tag line.
  const rendered = renderContextLayers([
    { key: 'cad_session', content: 'active_document_name: 地下室.dwg' },
    { key: 'cad_evidence_preflight', content: '[cad_evidence_preflight]\nstatus: delegate_required' },
  ])
  assert.match(rendered, /^\[cad_session\]\nactive_document_name/)
  assert.equal(rendered.match(/\[cad_evidence_preflight\]/g).length, 1)
})
