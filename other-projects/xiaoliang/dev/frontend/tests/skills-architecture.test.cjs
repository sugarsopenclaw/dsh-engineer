const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function frontmatterName(content) {
  return content.match(/^---\r?\n[\s\S]*?^name:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)?.[1]?.trim() || ''
}

test('settings exposes built-in, market, and custom skill categories', () => {
  const source = read('src/components/runtime/skill-pack-release-panel.tsx')
  assert.match(source, /type SkillCategory = 'built-in' \| 'market' \| 'custom'/)
  assert.match(source, /`内置 \$\{builtInSkills\.length\}`/)
  assert.match(source, /`市场 \$\{marketSkills\.length\}`/)
  assert.match(source, /`自制 \$\{userSkills\.length\}`/)
  assert.doesNotMatch(source, /内置能力随客户端发布/)
  assert.doesNotMatch(source, /市场只接收后端发布的只读版本包/)
  assert.doesNotMatch(source, /只读、随客户端升级/)
  assert.doesNotMatch(source, /可在这里创建、编辑、启停和删除/)
  assert.doesNotMatch(source, /本地存储位置/)
  assert.doesNotMatch(source, /settings-metric-grid/)
  assert.doesNotMatch(source, /sm:grid-cols-3/)
  assert.equal((source.match(/\{skill\.description\}/g) || []).length, 0)
})

test('bundled skills use directory-matching standard names and OpenAI metadata', () => {
  const libraryRoot = path.join(root, 'electron/runtime/agent/document-skills/library')
  const expected = [
    'create-skills',
    'document-writing',
    'presentation-writing',
    'report-writing',
    'spreadsheet-writing',
  ].sort()
  const actual = fs.readdirSync(libraryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  assert.deepEqual(actual, expected)
  for (const slug of expected) {
    const skill = fs.readFileSync(path.join(libraryRoot, slug, 'SKILL.md'), 'utf8')
    const openAi = fs.readFileSync(path.join(libraryRoot, slug, 'agents/openai.yaml'), 'utf8')
    assert.equal(frontmatterName(skill), slug)
    assert.match(openAi, new RegExp(`\\$${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`))
    assert.ok(skill.split(/\r?\n/).length <= 500)
  }
})

test('submission and teaching skill draft capabilities stay retired', () => {
  const targets = [
    'electron/runtime/agent/sessions/agent-session-manager.ts',
    'electron/runtime/agent/tools/domain/skills/index.ts',
    'electron/runtime/agent/tools/index.ts',
    'src/shared/backend-api.ts',
    'src/shared/local-agent.ts',
  ]
  for (const target of targets) {
    const source = read(target)
    assert.doesNotMatch(source, /cad_skill_draft_create|\/submissions|AutoIngestSubmission|draftSkills/)
  }
  assert.equal(fs.existsSync(path.join(root, 'src/api/submissions.ts')), false)
  assert.equal(fs.existsSync(path.join(root, 'electron/runtime/agent/skills/drafts/store.ts')), false)
})

test('Office skills share one controlled project artifact entry point', () => {
  const tools = read('electron/runtime/agent/tools/domain/project-artifacts/index.ts')
  const worker = read('electron/runtime/project-files/python/artifact_worker.py')
  assert.match(tools, /name: 'project_artifact_create'/)
  assert.doesNotMatch(tools, /name: 'project_(?:artifacts_list|artifact_write_text|quantity_excel_write|docx_write|pptx_write)'/)
  assert.match(worker, /action == "write_docx"/)
  assert.match(worker, /action == "write_pptx"/)
})

test('custom skills are archived in the background and are not a marketplace submission', () => {
  const syncSource = read('electron/runtime/project-sync/user-skill-archive-sync-service.ts')
  const sessionSource = read('electron/runtime/agent/sessions/agent-session-manager.ts')
  const createSkill = read('electron/runtime/agent/document-skills/library/create-skills/SKILL.md')
  const backendRouter = fs.readFileSync(
    path.resolve(root, '../backend/app/api/router.py'),
    'utf8',
  )
  assert.match(syncSource, /\/user-skills\/archive\/snapshots\/start/)
  assert.match(syncSource, /\/user-skills\/archive\/files\/prepare/)
  assert.match(syncSource, /userSkillService\.getSkillsRootPath\(\)/)
  assert.match(sessionSource, /userSkillArchiveSyncService\.scheduleInitialSync/)
  assert.match(sessionSource, /userSkillService\.onChange/)
  assert.match(backendRouter, /user_skill_archive_router/)
  assert.match(createSkill, /不得把用户 skill 投稿到市场/)
  assert.doesNotMatch(createSkill, /不得把用户 skill 投稿或上传到后端/)
})

test('market installer rejects executable files and validates domain and SKILL metadata', () => {
  const source = read('electron/runtime/agent/skills/sync/skill-pack-sync-service.ts')
  assert.match(source, /ALLOWED_REMOTE_FILE_PATTERN = \/\^\(SKILL/)
  assert.match(source, /SKILL_DOMAIN_PATTERN/)
  assert.match(source, /verifyDeclaredSkillMetadata\(\{/)
  assert.match(source, /content: skillMarkdown/)
  assert.doesNotMatch(source, /scripts\\\//)
})

test('retired agent persistence surfaces stay out of the runtime', () => {
  const retiredToolNames = [
    ['workspace', 'file', 'read'].join('_'),
    ['workspace', 'memory', 'search'].join('_'),
    ['workspace', 'memory', 'append'].join('_'),
  ]
  const runtimeSource = [
    'electron/runtime/agent/tools/index.ts',
    'electron/runtime/agent/sessions/agent-session-manager.ts',
    'electron/runtime/agent/prompts/system/sections/tooling.ts',
    'electron/runtime/agent/context/providers/agent-workspace-provider.ts',
  ].map(read).join('\n')
  for (const toolName of retiredToolNames) {
    assert.equal(runtimeSource.includes(toolName), false)
  }

  const removedPaths = [
    path.join('electron', 'runtime', 'agent', 'tools', 'domain', ['workspace', 'memory'].join('-'), 'index.ts'),
    path.join('electron', 'runtime', 'agent', 'memory', ['workspace', 'memory', 'flush'].join('-') + '.ts'),
    path.join('electron', 'runtime', 'agent', 'heartbeat', ['agent', 'heartbeat', 'service'].join('-') + '.ts'),
    path.join('electron', 'runtime', 'agent', 'document-skills', 'library', ['self', 'improvement'].join('-'), 'SKILL.md'),
  ]
  for (const relativePath of removedPaths) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false)
  }
})
