const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const JSZip = require('jszip')
const XLSX = require('xlsx')

function loadBundledModule(relativePath, plugins = []) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    plugins,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

async function loadBundledModuleAsync(relativePath, plugins = []) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = await esbuild.build({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    plugins,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

function projectRepositoryStub() {
  return {
    name: 'project-repository-stub',
    setup(build) {
      build.onResolve({ filter: /conversations\/conversation-repository$/ }, (args) => ({
        path: args.path,
        namespace: 'project-repository-stub',
      }))
      build.onLoad({ filter: /.*/, namespace: 'project-repository-stub' }, () => ({
        contents: [
          'export function getProjectSummary() { return globalThis.__xiaoliangProjectToolTestProject || null }',
          'export function getConversationSummary() { return null }',
        ].join('\n'),
        loader: 'js',
      }))
    },
  }
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
        contents: 'export const app = { getPath() { return "" } }',
        loader: 'js',
      }))
    },
  }
}

function artifactResult(kind, payload) {
  return {
    projectId: 'project-1',
    rootPath: 'C:/project',
    outputRootPath: 'C:/project/xiaoliang-outputs',
    path: `xiaoliang-outputs/${payload.path}`,
    absolutePath: `C:/project/xiaoliang-outputs/${payload.path}`,
    kind,
    created: true,
    overwritten: false,
    sizeBytes: 10,
  }
}

test('main project file surface is doc_parse plus artifact tools', () => {
  const files = loadBundledModule('electron/runtime/agent/tools/domain/project-files/index.ts')
  const artifacts = loadBundledModule('electron/runtime/agent/tools/domain/project-artifacts/index.ts')
  const fileTools = files.buildProjectFileTools({
    parseProjectDocument: async () => ({}),
  })
  const artifactTools = artifacts.buildProjectArtifactTools({
    writeProjectTextArtifact: async (input) => artifactResult(input.kind, input),
    writeProjectExcelArtifact: async (input) => artifactResult('excel', input),
    writeProjectDocxArtifact: async (input) => artifactResult('docx', input),
    writeProjectPptxArtifact: async (input) => artifactResult('pptx', input),
    exportProjectAlgorithm: async () => [],
  })

  assert.deepEqual(fileTools.map((tool) => tool.name), ['doc_parse'])
  assert.deepEqual(artifactTools.map((tool) => tool.name), ['project_artifact_create', 'project_algorithm_export'])
})

test('doc_parse forwards parser options and rejects non-rich-document paths', async () => {
  const files = loadBundledModule('electron/runtime/agent/tools/domain/project-files/index.ts')
  let received = null
  const tool = files.buildProjectFileTools({
    parseProjectDocument: async (input) => {
      received = input
      return {
        projectId: 'project-1',
        rootPath: 'C:/project',
        path: input.path,
        kind: 'xlsx',
        sizeBytes: 10,
        modifiedAt: '2026-08-13T00:00:00.000Z',
        content: 'sheet preview',
        truncated: false,
      }
    },
  }).find((item) => item.name === 'doc_parse')

  await tool.execute('parse', {
    path: 'docs/quantity.xlsx',
    sheet_names: ['工程量'],
    include_formulas: true,
    mode: 'cloud',
  })
  assert.equal(received.path, 'docs/quantity.xlsx')
  assert.deepEqual(received.sheet_names, ['工程量'])
  assert.equal(received.mode, 'cloud')

  for (const richPath of ['报告.pdf', '说明/说明书.DOCX', '演示.pptx', '清单.xls']) {
    received = null
    await tool.execute('parse-rich', { path: richPath })
    assert.equal(received.path, richPath)
  }

  for (const plainPath of ['notes/readme.md', 'data/table.csv', 'photos/site.png', 'scripts/calc.py']) {
    await assert.rejects(
      () => tool.execute('reject-plain', { path: plainPath }),
      /read/,
    )
  }
  await assert.rejects(
    () => tool.execute('reject-dwg', { path: 'drawings/plan.dwg' }),
    /CAD/,
  )
})

test('legacy project tool references are migrated only in memory', () => {
  const { migrateLegacyProjectToolReferences } = loadBundledModule(
    'electron/runtime/agent/skills/legacy-project-tool-compat.ts',
  )
  const original = [
    '---',
    'name: legacy-project-skill',
    '---',
    'Use project_file_read({ path: "a.md" }).',
    'Then project_quantity_excel_write({ path: "out.xlsx", sheets: [] }).',
    'List project_artifacts_list().',
    'Also project_read({ path: "b.pdf" }), project_list(), project_search.',
  ].join('\n')
  const migrated = migrateLegacyProjectToolReferences(original)

  assert.match(migrated, /doc_parse\(\{ path: "a\.md" \}\)/)
  assert.match(migrated, /doc_parse\(\{ path: "b\.pdf" \}\)/)
  assert.match(migrated, /project_artifact_create\(\{ format: "xlsx"/)
  assert.match(migrated, /ls\(\{ path: "xiaoliang-outputs" \}\)/)
  assert.doesNotMatch(migrated, /project_file_read|project_quantity_excel_write|project_artifacts_list/)
  assert.doesNotMatch(migrated, /project_read|project_list|project_search/)
  assert.match(original, /project_file_read/)
})

test('project_artifact_create dispatches formats without weakening payload policies', async () => {
  const artifacts = loadBundledModule('electron/runtime/agent/tools/domain/project-artifacts/index.ts')
  const calls = []
  const tool = artifacts.buildProjectArtifactTools({
    writeProjectTextArtifact: async (input) => {
      calls.push(['text', input])
      return artifactResult(input.kind, input)
    },
    writeProjectExcelArtifact: async (input) => {
      calls.push(['xlsx', input])
      return artifactResult('excel', input)
    },
    writeProjectDocxArtifact: async (input) => artifactResult('docx', input),
    writeProjectPptxArtifact: async (input) => artifactResult('pptx', input),
    exportProjectAlgorithm: async () => [],
  }).find((item) => item.name === 'project_artifact_create')

  await tool.execute('markdown', {
    format: 'markdown',
    path: 'reports/result.md',
    content: '# Result',
    overwrite_confirmed: false,
  })
  await tool.execute('xlsx', {
    format: 'xlsx',
    path: 'quantity/result.xlsx',
    sheets: [{ name: '工程量', rows: [{ 项目: '基础', 数量: 1 }] }],
    open_after_write: false,
  })

  assert.equal(calls[0][0], 'text')
  assert.equal(calls[0][1].kind, 'markdown')
  assert.equal('format' in calls[0][1], false)
  assert.equal(calls[1][0], 'xlsx')
  assert.equal('format' in calls[1][1], false)
  await assert.rejects(
    () => tool.execute('bad-docx', { format: 'docx', path: 'reports/bad.docx' }),
    /title/,
  )
  await assert.rejects(
    () => tool.execute('bad-json', { format: 'json', path: 'data/bad.json', content: '{bad' }),
    /有效 JSON/,
  )
})

test('project file service paginates safely, ranks globally, and reads XLSX locally', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-project-tools-'))
  globalThis.__xiaoliangProjectToolTestProject = {
    id: 'project-1',
    name: 'Project Tools Test',
    rootPath: temporaryRoot,
  }
  try {
    fs.mkdirSync(path.join(temporaryRoot, 'docs'), { recursive: true })
    fs.mkdirSync(path.join(temporaryRoot, 'xiaoliang-outputs', 'reports'), { recursive: true })
    fs.writeFileSync(path.join(temporaryRoot, 'root.txt'), 'root file')
    fs.writeFileSync(path.join(temporaryRoot, 'overview.md'), '# root overview')
    fs.writeFileSync(path.join(temporaryRoot, 'xiaoliang-outputs', 'reports', 'result.md'), '# result')
    for (let index = 0; index < 12; index += 1) {
      fs.writeFileSync(path.join(temporaryRoot, 'docs', `a-${String(index).padStart(2, '0')}.txt`), 'needle only')
    }
    fs.writeFileSync(path.join(temporaryRoot, 'docs', 'z-best.txt'), 'needle target\nneedle target')

    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([['项目', '数量'], ['基础', 3]])
    sheet.B2 = { t: 'n', v: 3, f: '1+2' }
    XLSX.utils.book_append_sheet(workbook, sheet, '工程量')
    XLSX.writeFile(workbook, path.join(temporaryRoot, 'docs', 'quantity.xlsx'))

    let cloudReads = 0
    const { ProjectFileService } = await loadBundledModuleAsync(
      'electron/runtime/project-files/project-file-service.ts',
      [projectRepositoryStub()],
    )
    const service = new ProjectFileService(async () => {
      cloudReads += 1
      return {
        content: 'cloud semantic workbook',
        parser: 'qwen-doc-test',
        warning: null,
        metadata: { sheets: ['工程量'] },
        truncated: false,
      }
    })

    const first = await service.listFiles('project-1', undefined, {
      depth: 1,
      limit: 2,
      source: 'all',
    })
    assert.equal(first.returnedCount, 2)
    assert.ok(first.nextCursor)
    const second = await service.listFiles('project-1', undefined, {
      depth: 1,
      limit: 2,
      source: 'all',
      cursor: first.nextCursor,
    })
    assert.equal(second.scopePath, '')
    await assert.rejects(
      () => service.listFiles('project-1', undefined, { path: '../outside', depth: 1 }),
      /目录之外|不存在/,
    )

    const artifacts = await service.listFiles('project-1', undefined, {
      depth: 3,
      source: 'artifact',
    })
    assert.deepEqual(artifacts.files.map((file) => file.path), ['xiaoliang-outputs/reports/result.md'])

    const search = await service.searchFiles({
      projectId: 'project-1',
      query: 'needle target',
      path: 'docs',
      limit: 2,
    })
    assert.equal(search.matches[0].path, 'docs/z-best.txt')
    assert.equal(search.matchCount, 13)
    assert.equal(search.matches.length, 2)

    const globSearch = await service.searchFiles({
      projectId: 'project-1',
      query: 'root overview',
      glob: '**/*.md',
      limit: 5,
    })
    assert.equal(globSearch.matches[0].path, 'overview.md')

    const excel = await service.readFile({
      projectId: 'project-1',
      path: 'docs/quantity.xlsx',
      sheetNames: ['工程量'],
      includeFormulas: true,
    })
    assert.equal(excel.parser, 'node-xlsx')
    assert.deepEqual(excel.sheets, ['工程量'])
    assert.match(excel.content, /=1\+2/)
    assert.equal(cloudReads, 0)

    const cloudExcel = await service.readFile({
      projectId: 'project-1',
      path: 'docs/quantity.xlsx',
      mode: 'cloud',
    })
    assert.equal(cloudExcel.parser, 'qwen-doc-test')
    assert.match(cloudExcel.content, /cloud semantic workbook/)
    assert.equal(cloudReads, 1)

    const { ProjectArtifactService } = await loadBundledModuleAsync(
      'electron/runtime/project-files/project-artifact-service.ts',
      [projectRepositoryStub(), electronStub()],
    )
    const artifactService = new ProjectArtifactService()
    const yaml = await artifactService.writeText('project-1', {
      path: 'config/settings.yaml',
      content: 'enabled: true',
      kind: 'text',
    })
    assert.equal(yaml.path, 'xiaoliang-outputs/config/settings.yaml')
    await assert.rejects(
      () => artifactService.writeText('project-1', {
        path: 'config/unsafe.exe',
        content: 'not executable',
        kind: 'text',
      }),
      /扩展名/,
    )
  } finally {
    delete globalThis.__xiaoliangProjectToolTestProject
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('project file preview lists dot-prefixed children and renders bounded local formats safely', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-project-preview-'))
  globalThis.__xiaoliangProjectToolTestProject = {
    id: 'project-preview',
    name: 'Project Preview Test',
    rootPath: temporaryRoot,
  }
  try {
    fs.mkdirSync(path.join(temporaryRoot, 'docs'), { recursive: true })
    fs.mkdirSync(path.join(temporaryRoot, '.hidden'), { recursive: true })
    fs.mkdirSync(path.join(temporaryRoot, '.xiaoliang'), { recursive: true })
    fs.mkdirSync(path.join(temporaryRoot, '.git'), { recursive: true })
    fs.writeFileSync(path.join(temporaryRoot, 'docs', 'note.md'), '# nested note')
    fs.writeFileSync(path.join(temporaryRoot, '.hidden', 'secret.txt'), 'hidden')
    fs.writeFileSync(path.join(temporaryRoot, '.xiaoliang', 'result.md'), '# xiaoliang output')
    fs.writeFileSync(path.join(temporaryRoot, '.git', 'config'), 'ignored repository metadata')
    fs.writeFileSync(path.join(temporaryRoot, '.env'), 'VISIBLE_IN_LOCAL_PREVIEW=true')
    fs.writeFileSync(path.join(temporaryRoot, '~$draft.docx'), 'temporary office file')
    fs.writeFileSync(path.join(temporaryRoot, 'scratch.tmp'), 'temporary file')
    const longText = '中'.repeat(100_000)
    fs.writeFileSync(path.join(temporaryRoot, 'long.txt'), longText)
    fs.writeFileSync(path.join(temporaryRoot, 'oversized-text.txt'), 'a'.repeat(5 * 1024 * 1024))
    fs.writeFileSync(
      path.join(temporaryRoot, 'oversized-unicode.txt'),
      '中'.repeat(Math.ceil((4 * 1024 * 1024 + 3) / 3)),
    )
    fs.writeFileSync(
      path.join(temporaryRoot, 'pixel.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    )
    fs.writeFileSync(path.join(temporaryRoot, 'sample.pdf'), '%PDF-1.7\n%%EOF\n')
    fs.writeFileSync(path.join(temporaryRoot, 'growing.pdf'), '%PDF-1.7\n%%EOF\n')
    fs.writeFileSync(path.join(temporaryRoot, 'fake.png'), 'not a png')
    fs.writeFileSync(path.join(temporaryRoot, 'fake.pdf'), 'not a pdf')
    fs.writeFileSync(path.join(temporaryRoot, 'fake.docx'), 'not a docx')
    fs.writeFileSync(path.join(temporaryRoot, 'oversized.pdf'), '%PDF-')
    fs.truncateSync(path.join(temporaryRoot, 'oversized.pdf'), 32 * 1024 * 1024 + 1)
    fs.writeFileSync(path.join(temporaryRoot, 'drawing.dwg'), 'not previewed')

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['项目', '数量'], ['基础', 3]]),
      '工程量',
    )
    XLSX.writeFile(workbook, path.join(temporaryRoot, 'quantity.xlsx'))

    const docxArchive = new JSZip()
    docxArchive.file('[Content_Types].xml', '<Types/>')
    docxArchive.file('word/document.xml', '<w:document/>')
    fs.writeFileSync(
      path.join(temporaryRoot, 'sample.docx'),
      await docxArchive.generateAsync({ type: 'nodebuffer' }),
    )
    const compressedArchive = new JSZip()
    compressedArchive.file('[Content_Types].xml', '<Types/>')
    compressedArchive.file('word/document.xml', '0'.repeat(400_000))
    fs.writeFileSync(
      path.join(temporaryRoot, 'compressed.docx'),
      await compressedArchive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    )

    const { ProjectFileService } = await loadBundledModuleAsync(
      'electron/runtime/project-files/project-file-service.ts',
      [projectRepositoryStub()],
    )
    const service = new ProjectFileService()
    const root = await service.listPreviewDirectory('project-preview')
    assert.equal(root.rootExists, true)
    assert.ok(root.entries.some((entry) => entry.type === 'directory' && entry.path === '.hidden'))
    assert.ok(root.entries.some((entry) => entry.type === 'directory' && entry.path === '.xiaoliang'))
    assert.ok(root.entries.some((entry) => entry.type === 'file' && entry.path === '.env'))
    assert.ok(!root.entries.some((entry) => entry.path === '.git'))
    assert.ok(!root.entries.some((entry) => entry.path === '~$draft.docx'))
    assert.ok(!root.entries.some((entry) => entry.path === 'scratch.tmp'))
    assert.ok(!root.entries.some((entry) => entry.path === 'docs/note.md'))

    const docs = await service.listPreviewDirectory('project-preview', 'docs')
    assert.deepEqual(docs.entries.map((entry) => entry.path), ['docs/note.md'])
    const hidden = await service.listPreviewDirectory('project-preview', '.hidden')
    assert.deepEqual(hidden.entries.map((entry) => entry.path), ['.hidden/secret.txt'])
    const xiaoliang = await service.listPreviewDirectory('project-preview', '.xiaoliang')
    assert.deepEqual(xiaoliang.entries.map((entry) => entry.path), ['.xiaoliang/result.md'])
    await assert.rejects(
      () => service.listPreviewDirectory('project-preview', 'docs/../'),
      /规范的相对路径/,
    )

    const firstText = await service.readFilePreview({
      projectId: 'project-preview',
      path: 'long.txt',
    })
    assert.equal(firstText.mode, 'text')
    assert.ok(firstText.nextOffset)
    assert.ok(!firstText.content.includes('\uFFFD'))
    const secondText = await service.readFilePreview({
      projectId: 'project-preview',
      path: 'long.txt',
      offset: firstText.nextOffset,
    })
    assert.equal(secondText.mode, 'text')
    assert.equal(firstText.content + secondText.content, longText)
    assert.equal(secondText.limitReached, false)

    let oversizedText = await service.readFilePreview({
      projectId: 'project-preview',
      path: 'oversized-text.txt',
    })
    let accumulatedText = oversizedText.content
    let textPageCount = 1
    while (oversizedText.nextOffset !== null) {
      const previousOffset = oversizedText.nextOffset
      oversizedText = await service.readFilePreview({
        projectId: 'project-preview',
        path: 'oversized-text.txt',
        offset: previousOffset,
      })
      assert.equal(oversizedText.offset, previousOffset)
      accumulatedText += oversizedText.content
      textPageCount += 1
      assert.ok(textPageCount <= 16)
    }
    assert.equal(accumulatedText.length, 4 * 1024 * 1024)
    assert.equal(oversizedText.truncated, true)
    assert.equal(oversizedText.limitReached, true)
    await assert.rejects(
      () => service.readFilePreview({
        projectId: 'project-preview',
        path: 'oversized-text.txt',
        offset: 4 * 1024 * 1024 + 1,
      }),
      /offset 无效/,
    )

    let unicodePage = await service.readFilePreview({
      projectId: 'project-preview',
      path: 'oversized-unicode.txt',
    })
    let unicodeContent = unicodePage.content
    while (unicodePage.nextOffset !== null) {
      unicodePage = await service.readFilePreview({
        projectId: 'project-preview',
        path: 'oversized-unicode.txt',
        offset: unicodePage.nextOffset,
      })
      unicodeContent += unicodePage.content
    }
    assert.equal(unicodePage.limitReached, true)
    assert.ok(!unicodeContent.includes('\uFFFD'))

    const image = await service.readFilePreview({ projectId: 'project-preview', path: 'pixel.png' })
    assert.equal(image.mode, 'image')
    assert.equal(image.mimeType, 'image/png')
    assert.ok(image.dataBase64.length > 0)

    const pdf = await service.readFilePreview({ projectId: 'project-preview', path: 'sample.pdf' })
    assert.equal(pdf.mode, 'pdf')
    assert.equal(pdf.mimeType, 'application/pdf')

    for (const invalidPath of ['fake.png', 'fake.pdf', 'fake.docx']) {
      const invalid = await service.readFilePreview({ projectId: 'project-preview', path: invalidPath })
      assert.equal(invalid.mode, 'unsupported')
      assert.match(invalid.reason, /解析失败/)
    }
    const oversizedPdf = await service.readFilePreview({ projectId: 'project-preview', path: 'oversized.pdf' })
    assert.equal(oversizedPdf.mode, 'unsupported')
    assert.match(oversizedPdf.reason, /超过 32MB/)

    const originalOpen = fs.promises.open
    const growingPath = path.join(temporaryRoot, 'growing.pdf')
    fs.promises.open = async (...args) => {
      const handle = await originalOpen.apply(fs.promises, args)
      if (path.resolve(String(args[0])) !== path.resolve(growingPath)) return handle
      let grew = false
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'read') {
            return async (...readArgs) => {
              if (!grew) {
                grew = true
                fs.appendFileSync(growingPath, Buffer.alloc(1024, 0x20))
              }
              return target.read(...readArgs)
            }
          }
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }
    try {
      await assert.rejects(
        () => service.readFilePreview({ projectId: 'project-preview', path: 'growing.pdf' }),
        /读取期间发生变化/,
      )
    } finally {
      fs.promises.open = originalOpen
    }

    const spreadsheet = await service.readFilePreview({ projectId: 'project-preview', path: 'quantity.xlsx' })
    assert.equal(spreadsheet.mode, 'spreadsheet')
    assert.equal(spreadsheet.sheets[0].name, '工程量')
    assert.deepEqual(spreadsheet.sheets[0].rows[1], ['基础', '3'])

    const docx = await service.readFilePreview({ projectId: 'project-preview', path: 'sample.docx' })
    assert.equal(docx.mode, 'docx')
    assert.ok(docx.dataBase64.length > 0)
    const compressedDocx = await service.readFilePreview({ projectId: 'project-preview', path: 'compressed.docx' })
    assert.equal(compressedDocx.mode, 'unsupported')
    assert.match(compressedDocx.reason, /压缩比超过安全限制/)

    const unsupported = await service.readFilePreview({ projectId: 'project-preview', path: 'drawing.dwg' })
    assert.equal(unsupported.mode, 'unsupported')
    assert.match(unsupported.reason, /CAD 预览运行时不可用/)

    const grantCalls = []
    const cadService = new ProjectFileService(undefined, async (request) => {
      grantCalls.push(request)
      return {
        sourceUrl: 'http://127.0.0.1:51234/source/capability/drawing.dwg',
        cadDataBaseUrl: 'http://127.0.0.1:51234/cad-data/token/',
      }
    })
    const cad = await cadService.readFilePreview({ projectId: 'project-preview', path: 'drawing.dwg' })
    assert.equal(cad.mode, 'cad')
    assert.equal(cad.kind, 'cad')
    assert.equal(cad.sourceUrl, 'http://127.0.0.1:51234/source/capability/drawing.dwg')
    assert.equal(cad.cadDataBaseUrl, 'http://127.0.0.1:51234/cad-data/token/')
    assert.equal(grantCalls.length, 1)
    assert.equal(grantCalls[0].relativePath, 'drawing.dwg')

    const failingCadService = new ProjectFileService(undefined, async () => {
      throw new Error('图纸签名与扩展名不符。')
    })
    const cadFailure = await failingCadService.readFilePreview({
      projectId: 'project-preview',
      path: 'drawing.dwg',
    })
    assert.equal(cadFailure.mode, 'unsupported')
    assert.match(cadFailure.reason, /图纸签名与扩展名不符/)
    await assert.rejects(
      () => service.readFilePreview({ projectId: 'project-preview', path: 'docs/../long.txt' }),
      /规范的相对路径/,
    )
    for (const unsafePath of [
      path.resolve(temporaryRoot, 'long.txt'),
      'C:\\Windows\\system.ini',
      '\\\\server\\share\\file.txt',
    ]) {
      await assert.rejects(
        () => service.readFilePreview({ projectId: 'project-preview', path: unsafePath }),
        /只允许访问项目目录内的相对路径/,
      )
    }

    try {
      fs.symlinkSync(path.join(temporaryRoot, 'docs'), path.join(temporaryRoot, 'docs-link'), 'junction')
      await assert.rejects(
        () => service.listPreviewDirectory('project-preview', 'docs-link'),
        /符号链接/,
      )
    } catch (error) {
      if (!error || !['EPERM', 'EACCES'].includes(error.code)) throw error
    }
  } finally {
    delete globalThis.__xiaoliangProjectToolTestProject
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('project scan keeps deep files, survives 500 directories, and searches every large candidate fairly', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-project-boundaries-'))
  globalThis.__xiaoliangProjectToolTestProject = {
    id: 'project-boundaries',
    name: 'Project Boundary Test',
    rootPath: temporaryRoot,
  }
  try {
    const deepDirectory = path.join(temporaryRoot, 'd1', 'd2', 'd3', 'd4', 'd5', 'd6')
    fs.mkdirSync(deepDirectory, { recursive: true })
    fs.writeFileSync(path.join(deepDirectory, 'deep.txt'), 'six levels retained')

    for (let index = 0; index < 505; index += 1) {
      fs.mkdirSync(path.join(temporaryRoot, `empty-${String(index).padStart(3, '0')}`))
    }
    fs.writeFileSync(path.join(temporaryRoot, 'zz-after-directories.txt'), 'still visible')

    const largeRoot = path.join(temporaryRoot, 'large')
    fs.mkdirSync(largeRoot)
    for (let index = 0; index < 20; index += 1) {
      const content = Buffer.alloc(2 * 1024 * 1024, 97)
      if (index === 19) content.write('fairness-last-needle', 0, 'utf8')
      fs.writeFileSync(path.join(largeRoot, `large-${String(index).padStart(2, '0')}.txt`), content)
    }

    const outputRoot = path.join(temporaryRoot, 'xiaoliang-outputs', 'history')
    fs.mkdirSync(outputRoot, { recursive: true })
    const oldArtifact = path.join(outputRoot, 'old.md')
    const newArtifact = path.join(outputRoot, 'new.md')
    fs.writeFileSync(oldArtifact, 'old')
    fs.writeFileSync(newArtifact, 'new')
    fs.utimesSync(oldArtifact, new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00Z'))
    fs.utimesSync(newArtifact, new Date('2025-01-01T00:00:00Z'), new Date('2025-01-01T00:00:00Z'))

    const { ProjectFileService } = await loadBundledModuleAsync(
      'electron/runtime/project-files/project-file-service.ts',
      [projectRepositoryStub()],
    )
    const service = new ProjectFileService()

    const deep = await service.listFiles('project-boundaries', undefined, {
      depth: 6,
      source: 'user',
    })
    assert.ok(deep.files.some((file) => file.path === 'd1/d2/d3/d4/d5/d6/deep.txt'))
    assert.ok(deep.files.some((file) => file.path === 'zz-after-directories.txt'))
    assert.match(deep.warning || '', /文件扫描仍继续/)

    const fairSearch = await service.searchFiles({
      projectId: 'project-boundaries',
      path: 'large',
      query: 'fairness-last-needle',
      limit: 5,
    })
    assert.equal(fairSearch.searchedFileCount, 20)
    assert.equal(fairSearch.matches[0].path, 'large/large-19.txt')

    const history = await service.listFiles('project-boundaries', undefined, {
      source: 'artifact',
      depth: 8,
      sort: 'modified_desc',
    })
    assert.deepEqual(
      history.files.slice(0, 2).map((file) => file.path),
      ['xiaoliang-outputs/history/new.md', 'xiaoliang-outputs/history/old.md'],
    )
  } finally {
    delete globalThis.__xiaoliangProjectToolTestProject
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('project component service persists idempotent JSON records and protects confirmed data', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-project-components-'))
  globalThis.__xiaoliangProjectToolTestProject = {
    id: 'project-components',
    name: 'Component Test',
    rootPath: temporaryRoot,
    rootPathExists: true,
  }
  const componentInput = (overrides = {}) => ({
    identity: {
      component_type: '独立基础',
      semantic_name: 'J-1 独立基础',
      discipline: '结构',
    },
    anchors: {
      drawing_relpath: 'drawings/foundation.dwg',
      layout_name: '模型',
      source_handles: [
        { handle: 'A20', role: 'outline' },
        { handle: 'A10', role: 'label' },
      ],
      bbox: [0, 0, 3000, 3000],
    },
    quantities: {
      unit: 'm³',
      dimensions: { 长: 3, 宽: 3, 高: 0.8 },
      items: [{ name: '混凝土', value: 7.2, unit: 'm³', formula: '3×3×0.8' }],
    },
    semantics: { description: '轴线交点处独立基础。' },
    evidence: {
      evidence_pack: '.xiaoliang/cad/evidence/run-1/evidence.md',
      images: [{ path: '.xiaoliang/cad/evidence/run-1/foundation.png', note: '基础详图' }],
    },
    provenance: { created_by: 'agent', run_id: 'run-1' },
    ...overrides,
  })

  try {
    const { ProjectComponentService } = await loadBundledModuleAsync(
      'electron/runtime/project-files/project-component-service.ts',
      [projectRepositoryStub()],
    )
    const service = new ProjectComponentService()

    const created = await service.saveComponents('project-components', [componentInput()], 'draft')
    assert.equal(created[0].action, 'created')
    assert.equal(created[0].component.status, 'draft')
    const componentId = created[0].component.component_id

    const recordPath = path.join(
      temporaryRoot,
      '.xiaoliang',
      'components',
      'records',
      `${componentId}.json`,
    )
    assert.equal(fs.existsSync(recordPath), true)
    const stored = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    assert.equal(stored.schema_version, 'xiaoliang-component-v1')
    assert.equal(stored.component_id, componentId)
    assert.equal(stored.source_key.length, 64)

    const reorderedHandles = componentInput({
      anchors: {
        ...componentInput().anchors,
        source_handles: [
          { handle: 'A10', role: 'label' },
          { handle: 'A20', role: 'outline' },
        ],
      },
      semantics: { description: '顺序变化仍应命中同一个 source_key。' },
    })
    const upserted = await service.saveComponents('project-components', [reorderedHandles], 'draft')
    assert.equal(upserted[0].action, 'updated')
    assert.equal(upserted[0].component.component_id, componentId)

    const confirmed = await service.saveComponents('project-components', [reorderedHandles], 'confirmed')
    assert.equal(confirmed[0].action, 'updated')
    assert.equal(confirmed[0].component.status, 'confirmed')

    const conflictInput = componentInput({ semantics: { description: '不应静默覆盖。' } })
    const conflict = await service.saveComponents('project-components', [conflictInput], 'confirmed')
    assert.equal(conflict[0].action, 'conflict')
    assert.match(conflict[0].warning, /默认未覆盖/)
    assert.equal((await service.getComponent('project-components', componentId)).semantics.description, '顺序变化仍应命中同一个 source_key。')

    const overwritten = await service.saveComponents(
      'project-components',
      [conflictInput],
      'draft',
      true,
    )
    assert.equal(overwritten[0].action, 'updated')
    assert.equal(overwritten[0].component.status, 'confirmed')
    assert.equal((await service.getComponent('project-components', componentId)).semantics.description, '不应静默覆盖。')

    const updated = await service.updateComponent('project-components', componentId, {
      identity: { semantic_name: 'J-1A 独立基础' },
      semantics: { description: '用户复核后的描述。' },
    })
    assert.equal(updated.identity.semantic_name, 'J-1A 独立基础')
    assert.equal(updated.semantics.description, '用户复核后的描述。')

    const matches = await service.listComponents('project-components', {
      keyword: '复核后的描述',
      component_type: '独立基础',
      status: 'confirmed',
    })
    assert.deepEqual(matches.map((item) => item.component_id), [componentId])

    const second = await service.saveComponents('project-components', [componentInput({
      identity: { component_type: '独立基础', semantic_name: 'J-2 独立基础' },
      anchors: {
        ...componentInput().anchors,
        source_handles: [{ handle: 'B10', role: 'outline' }],
      },
    })], 'draft')
    const secondId = second[0].component.component_id
    const confirmedBatch = await service.confirmComponents('project-components', [secondId])
    assert.equal(confirmedBatch[0].status, 'confirmed')
    assert.ok(confirmedBatch[0].confirmed_at)

    const imagePath = path.join(temporaryRoot, '.xiaoliang', 'cad', 'evidence', 'run-1', 'foundation.png')
    fs.mkdirSync(path.dirname(imagePath), { recursive: true })
    fs.writeFileSync(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]))
    const image = await service.readProjectImage(
      'project-components',
      '.xiaoliang/cad/evidence/run-1/foundation.png',
    )
    assert.equal(image.mime_type, 'image/png')
    assert.match(image.data_url, /^data:image\/png;base64,/)
    await assert.rejects(
      () => service.readProjectImage('project-components', '../outside.png'),
      /不安全的路径片段/,
    )

    await service.deleteComponent('project-components', secondId)
    await assert.rejects(
      () => service.getComponent('project-components', secondId),
      /未找到构件/,
    )
  } finally {
    delete globalThis.__xiaoliangProjectToolTestProject
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('project component tools expose the focused CRUD surface and cap query context', async () => {
  const components = loadBundledModule('electron/runtime/agent/tools/domain/project-components/index.ts')
  let queryFilter = null
  const tools = components.buildProjectComponentTools({
    saveProjectComponents: async () => [],
    queryProjectComponents: async (filter) => {
      queryFilter = filter
      return Array.from({ length: 4 }, (_, index) => ({
        component_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        source_key: 'a'.repeat(64),
        status: 'confirmed',
        component_type: '梁',
        semantic_name: `L-${index + 1}`,
        drawing_relpath: 'drawings/structure.dwg',
        source_handle_count: 1,
        quantity_item_count: 0,
        updated_at: '2026-08-09T00:00:00.000Z',
      }))
    },
    getProjectComponent: async () => ({}),
    updateProjectComponent: async () => ({}),
    deleteProjectComponent: async () => undefined,
  })

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['component_save', 'component_query', 'component_get', 'component_update', 'component_delete'],
  )
  const queryTool = tools.find((tool) => tool.name === 'component_query')
  const result = await queryTool.execute('call-1', { status: 'confirmed', limit: 2 })
  assert.deepEqual(queryFilter, { status: 'confirmed' })
  assert.equal(result.details.total, 4)
  assert.equal(result.details.components.length, 2)
  assert.match(result.content[0].text, /结果已截断/)
})

test('component_update ships a shallow wire schema but validates the full patch contract at runtime', async () => {
  const components = loadBundledModule('electron/runtime/agent/tools/domain/project-components/index.ts')
  let updateCalls = 0
  const record = {
    component_id: 'component-1',
    source_key: 'k'.repeat(64),
    status: 'confirmed',
    identity: { component_type: '独立基础', semantic_name: 'J-1 独立基础' },
    anchors: { drawing_relpath: 'drawings/structure.dwg', source_handles: [{ handle: 'A1' }] },
    quantities: { items: [] },
    semantics: { description: '描述' },
    provenance: { updated_at: '2026-08-17T00:00:00.000Z', confirmed_at: null },
  }
  const tools = components.buildProjectComponentTools({
    saveProjectComponents: async () => [],
    queryProjectComponents: async () => [],
    getProjectComponent: async () => ({}),
    updateProjectComponent: async () => {
      updateCalls += 1
      return record
    },
    deleteProjectComponent: async () => undefined,
  })
  const updateTool = tools.find((tool) => tool.name === 'component_update')
  assert.ok(updateTool)

  // The wire schema stays shallow so the component tree is not shipped twice
  // in the tools context (component_save keeps the full structure).
  const wirePatch = updateTool.parameters.properties.patch
  assert.equal(wirePatch.additionalProperties, true)
  assert.deepEqual(wirePatch.properties ?? {}, {})
  assert.doesNotMatch(JSON.stringify(updateTool.parameters), /source_handles/)

  // Runtime still enforces the full contract before touching the repository.
  const rejected = await updateTool.execute('update-invalid', {
    component_id: 'component-1',
    patch: { identity: { component_type: 42 }, bogus: true },
  })
  assert.equal(rejected.details.error, 'COMPONENT_PATCH_INVALID')
  assert.ok(rejected.details.issues.length > 0)
  assert.match(rejected.content[0].text, /校验失败/)
  assert.equal(updateCalls, 0)

  const accepted = await updateTool.execute('update-valid', {
    component_id: 'component-1',
    patch: { identity: { semantic_name: 'J-1A 独立基础' } },
  })
  assert.equal(updateCalls, 1)
  assert.match(accepted.content[0].text, /已更新构件/)
})
