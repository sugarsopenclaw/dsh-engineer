const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const Database = require('better-sqlite3')
const esbuild = require('esbuild')

function loadBundledModule(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const output = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
  })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(output.outputFiles[0].text, filename)
  return mod.exports
}

test('image attachment fallback ids are content-stable and preserve explicit ids', () => {
  const { stableImageAttachmentId } = loadBundledModule(
    'electron/runtime/agent/image-attachment-id.ts',
  )
  const input = { data: 'cG5nLWJ5dGVz', mimeType: 'image/png' }

  assert.equal(stableImageAttachmentId(input), stableImageAttachmentId(input))
  assert.notEqual(
    stableImageAttachmentId(input),
    stableImageAttachmentId({ ...input, data: 'b3RoZXItYnl0ZXM=' }),
  )
  assert.equal(stableImageAttachmentId({ ...input, id: 'provider-image-1' }), 'provider-image-1')
})

test('archive message source keys follow stable local message ids', () => {
  const { stableMessageKey } = loadBundledModule(
    'electron/runtime/project-sync/project-sync-identity.ts',
  )
  const base = {
    id: 'local-message-1',
    conversationId: 'conversation-1',
    role: 'assistant',
    content: 'first version',
    toolName: '',
    toolArgs: '',
    toolResult: '',
    thinking: '',
    createdAt: '2026-08-09T00:00:00.000Z',
  }

  assert.equal(stableMessageKey(base), stableMessageKey({ ...base, content: 'edited version' }))
  assert.notEqual(stableMessageKey(base), stableMessageKey({ ...base, id: 'local-message-2' }))
})

test('conversation archive sync includes relationship ids and archives empty Pi sessions', () => {
  const syncSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'electron/runtime/project-sync/project-archive-sync-service.ts'),
    'utf8',
  )

  assert.doesNotMatch(syncSource, /messages\.some\(\(message\) => message\.role === 'user'\)/)
  assert.match(syncSource, /creation_source: conversation\.creationSource/)
  assert.match(syncSource, /client_run_id: message\.clientRunId/)
  assert.match(syncSource, /pi_session_id: message\.piSessionId/)
  assert.match(syncSource, /syncPiSessionArchive\(accessToken, project, conversation\)/)
})

test('Pi JSONL archive parser preserves tree records and rejects partial writes', () => {
  const { parsePiSessionArchiveJsonl } = loadBundledModule(
    'electron/runtime/project-sync/pi-session-archive.ts',
  )
  const jsonl = Buffer.from([
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'session-1',
      parentSession: 'C:/sessions/parent.jsonl',
    }),
    JSON.stringify({ type: 'message', id: 'entry-1', parentId: null }),
    JSON.stringify({ type: 'message', id: 'entry-2', parentId: 'entry-1' }),
    '',
  ].join('\n'))

  assert.deepEqual(parsePiSessionArchiveJsonl(jsonl, 'session-1'), {
    jsonlSchemaVersion: 3,
    parentSessionFile: 'C:/sessions/parent.jsonl',
    currentLeafEntryId: 'entry-2',
    entryCount: 2,
  })
  assert.throws(
    () => parsePiSessionArchiveJsonl(Buffer.from('{"type":"session"}'), 'session-1'),
    /尚未完成一行写入/,
  )
})

test('startup schema migration backfills unscoped conversations into the default project', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-project-backfill-'))
  const databasePath = path.join(tempDir, 'archive-backfill.db')
  const db = new Database(databasePath)
  try {
    const { runMigrations } = loadBundledModule('electron/runtime/db/schema.ts')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
    db.prepare(
      `INSERT INTO conversations (id, project_id) VALUES (?, NULL)`,
    ).run('legacy-unscoped-conversation')

    runMigrations(db)

    const scope = db.prepare(
      `SELECT conversation.project_id, project.name AS project_name
         FROM conversations conversation
         JOIN projects project ON project.id = conversation.project_id
        WHERE conversation.id = ?`,
    ).get('legacy-unscoped-conversation')
    assert.ok(scope.project_id)
    assert.equal(scope.project_name, '默认项目')
  } finally {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('startup schema migration leaves a clean database with zero projects', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-project-clean-'))
  const db = new Database(path.join(tempDir, 'clean-install.db'))
  try {
    const { runMigrations } = loadBundledModule('electron/runtime/db/schema.ts')
    db.pragma('foreign_keys = ON')

    runMigrations(db)
    runMigrations(db)

    assert.equal(db.prepare('SELECT count(*) AS count FROM projects').get().count, 0)
    assert.equal(db.prepare('SELECT count(*) AS count FROM conversations').get().count, 0)
  } finally {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('startup schema migration evaporates an unused default project shell but keeps any that holds work', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoliang-project-shell-'))
  const db = new Database(path.join(tempDir, 'legacy-shell.db'))
  try {
    const { runMigrations } = loadBundledModule('electron/runtime/db/schema.ts')
    db.pragma('foreign_keys = ON')
    runMigrations(db)

    const insertLegacyShell = db.prepare(
      `INSERT INTO projects (id, name, description)
       VALUES (?, '默认项目', '系统自动创建的项目工作空间')`,
    )
    const countProject = db.prepare('SELECT count(*) AS count FROM projects WHERE id = ?')

    insertLegacyShell.run('untouched-shell')
    runMigrations(db)
    assert.equal(countProject.get('untouched-shell').count, 0)

    insertLegacyShell.run('shell-with-conversation')
    db.prepare('INSERT INTO conversations (id, project_id) VALUES (?, ?)').run(
      'kept-conversation',
      'shell-with-conversation',
    )
    runMigrations(db)
    assert.equal(countProject.get('shell-with-conversation').count, 1)

    insertLegacyShell.run('shell-with-directory')
    db.prepare('UPDATE projects SET root_path = ? WHERE id = ?').run(
      path.join(tempDir, 'bound-directory'),
      'shell-with-directory',
    )
    runMigrations(db)
    assert.equal(countProject.get('shell-with-directory').count, 1)
  } finally {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('Pi archive state is retryable and invalidated when its JSONL projection changes', () => {
  const schemaSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'electron/runtime/db/schema.ts'),
    'utf8',
  )
  const stateSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'electron/runtime/project-sync/pi-session-archive-state.ts'),
    'utf8',
  )
  const syncSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'electron/runtime/project-sync/project-archive-sync-service.ts'),
    'utf8',
  )

  assert.match(schemaSource, /archive_generation\s+INTEGER NOT NULL DEFAULT 0/)
  assert.match(schemaSource, /upload_status\s+TEXT NOT NULL DEFAULT 'pending'/)
  assert.match(stateSource, /archive_generation = archive_generation \+ 1/)
  assert.match(stateSource, /upload_status = 'pending'/)
  assert.match(syncSource, /markPiSessionArchiveUploaded/)
  assert.match(syncSource, /markPiSessionArchiveFailed/)
  assert.match(stateSource, /binding\.upload_status IN \('pending', 'failed'\)/)
})

test('user skill archive uses a dedicated hash cache and account-scoped endpoints', () => {
  const schemaSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'electron/runtime/db/schema.ts'),
    'utf8',
  )
  const syncSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'electron/runtime/project-sync/user-skill-archive-sync-service.ts'),
    'utf8',
  )

  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS user_skill_archive_file_cache/)
  assert.match(syncSource, /FROM user_skill_archive_file_cache/)
  assert.match(syncSource, /skill_slug: file\.skillSlug/)
  assert.match(syncSource, /if \(!scan\.rootAvailable\) return/)
  assert.match(syncSource, /this\.pending = true/)
  assert.doesNotMatch(syncSource, /complete: true, rootName \}/)
  assert.doesNotMatch(syncSource, /local_project_id/)
})

test('user skill archive skips a missing skills root and scopes the hash cache', () => {
  const {
    canCommitUserSkillArchiveScan,
    userSkillArchiveCacheKey,
  } = loadBundledModule(
    'electron/runtime/project-sync/user-skill-archive-policy.ts',
  )

  assert.equal(canCommitUserSkillArchiveScan({ rootExists: false, rootIsDirectory: false }), false)
  assert.equal(canCommitUserSkillArchiveScan({ rootExists: true, rootIsDirectory: false }), false)
  assert.equal(canCommitUserSkillArchiveScan({ rootExists: true, rootIsDirectory: true }), true)
  assert.notEqual(
    userSkillArchiveCacheKey('C:/ws-a/skills', 'demo/SKILL.md'),
    userSkillArchiveCacheKey('C:/ws-b/skills', 'demo/SKILL.md'),
  )
})

test('project archive scanning prunes generated and dependency directories by name', () => {
  const { isDefaultProjectArchiveIgnoredDirectory } = loadBundledModule(
    'electron/runtime/project-sync/project-scan-policy.ts',
  )
  for (const name of [
    'node_modules',
    '.git',
    'dist',
    'build',
    'out',
    '.venv',
    '__pycache__',
    '.next',
    'target',
    'NODE_MODULES',
  ]) {
    assert.equal(isDefaultProjectArchiveIgnoredDirectory(name), true, name)
  }
  assert.equal(isDefaultProjectArchiveIgnoredDirectory('src'), false)
})

test('PostgreSQL migration declares the complete Pi session archive table and indexes', () => {
  const migration = fs.readFileSync(
    path.resolve(
      __dirname,
      '..',
      '..',
      'backend/scripts/migrations/2026-08-12-pi-session-archive.sql',
    ),
    'utf8',
  )
  assert.match(migration, /CREATE TABLE IF NOT EXISTS pi_session_archives/)
  assert.match(
    migration,
    /UNIQUE \(conversation_archive_id, pi_session_id, sha256\)/,
  )
  for (const column of [
    'organization_id',
    'project_archive_id',
    'conversation_archive_id',
    'local_conversation_id',
    'pi_session_id',
    'parent_pi_session_id',
    'runtime_version',
    'jsonl_schema_version',
    'current_leaf_entry_id',
    'entry_count',
    'sha256',
    'size_bytes',
    'source_modified_at',
    'storage_key',
    'upload_status',
    'upload_error',
    'training_consent',
    'uploaded_at',
  ]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`))
  }
  assert.match(migration, /ix_pi_session_archives_conversation_archive_id/)
  assert.match(migration, /ix_pi_session_archives_storage_key/)
})
