import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

const SCHEMA_VERSION = 39

const DEFAULT_PROJECT_NAME = '默认项目'
const DEFAULT_PROJECT_DESCRIPTION = '系统自动创建的项目工作空间'

function ensureDefaultProject(db: Database.Database) {
  const existingProject = db
    .prepare(`SELECT id FROM projects WHERE name = ? ORDER BY updated_at DESC LIMIT 1`)
    .get(DEFAULT_PROJECT_NAME) as { id: string } | undefined

  const projectId = existingProject?.id ?? randomUUID()
  if (!existingProject) {
    db.prepare(
      `INSERT INTO projects (id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
    ).run(projectId, DEFAULT_PROJECT_NAME, DEFAULT_PROJECT_DESCRIPTION)
  }

  return { projectId }
}

/**
 * Only conversations that already exist without an owning project need a bucket.
 * A clean install must stay at zero projects so the workspace empty state stays
 * truthful and the user builds the first project from a directory themselves.
 */
function backfillUnscopedConversations(db: Database.Database) {
  const unscoped = db
    .prepare(
      `SELECT count(*) AS count
         FROM conversations
        WHERE project_id IS NULL OR project_id = ''`,
    )
    .get() as { count: number }

  if (unscoped.count === 0) {
    return
  }

  const { projectId } = ensureDefaultProject(db)

  db.prepare(
    `UPDATE conversations
     SET project_id = ?
     WHERE project_id IS NULL OR project_id = ''`,
  ).run(projectId)
}

const DEFAULT_PROJECT_REFERENCES: Array<{ table: string; column: string }> = [
  { table: 'conversations', column: 'project_id' },
  { table: 'drawings', column: 'project_id' },
  { table: 'cad_artifact_sets', column: 'project_id' },
  { table: 'project_archive_file_cache', column: 'project_id' },
  { table: 'feishu_conversation_bindings', column: 'project_id' },
  { table: 'subagent_runs', column: 'project_id' },
  { table: 'feishu_settings', column: 'default_project_id' },
]

/**
 * Older builds inserted the default project on every startup, so users who never
 * touched it are left holding an empty shell. Drop it only when every table that
 * can reference a project has nothing for it. A shell the user actually worked
 * in, renamed, or bound a directory to is an ordinary project from here on.
 */
function dropUnusedDefaultProjectShells(db: Database.Database) {
  const shells = db
    .prepare(
      `SELECT id
         FROM projects
        WHERE name = ?
          AND description = ?
          AND (root_path IS NULL OR root_path = '')`,
    )
    .all(DEFAULT_PROJECT_NAME, DEFAULT_PROJECT_DESCRIPTION) as Array<{ id: string }>

  if (shells.length === 0) {
    return
  }

  // A column that does not exist on this database cannot be pointing at the
  // shell, so skipping it is accurate. Probing keeps startup from throwing if a
  // future column lands in TABLES without a matching ALTER for existing users.
  const counters = DEFAULT_PROJECT_REFERENCES.filter(({ table, column }) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
      (existing) => existing.name === column,
    ),
  ).map(({ table, column }) =>
    db.prepare(`SELECT count(*) AS count FROM ${table} WHERE ${column} = ?`),
  )

  const deleteShell = db.prepare(`DELETE FROM projects WHERE id = ?`)

  db.transaction(() => {
    for (const shell of shells) {
      const referenced = counters.some(
        (counter) => (counter.get(shell.id) as { count: number }).count > 0,
      )
      if (referenced) continue
      deleteShell.run(shell.id)
    }
  })()
}

const TABLES = `
CREATE TABLE IF NOT EXISTS llm_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  provider    TEXT NOT NULL,
  api_mode    TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  model       TEXT NOT NULL,
  secret_ref  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS llm_profile_settings (
  profile_id       TEXT PRIMARY KEY,
  model            TEXT NOT NULL,
  reasoning_level  TEXT NOT NULL DEFAULT 'off',
  knowledge_model  TEXT NOT NULL DEFAULT '',
  secret_ref       TEXT,
  is_active        INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS blender_mcp_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  host        TEXT NOT NULL DEFAULT 'localhost',
  port        INTEGER NOT NULL DEFAULT 9876,
  command     TEXT NOT NULL DEFAULT 'uvx',
  args_json   TEXT NOT NULL DEFAULT '["blender-mcp"]',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS power_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  prevent_sleep INTEGER NOT NULL DEFAULT 0 CHECK (prevent_sleep IN (0, 1)),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS feishu_settings (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  enabled               INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  app_id                TEXT NOT NULL DEFAULT '',
  app_secret_ref        TEXT,
  domain                TEXT NOT NULL DEFAULT 'feishu',
  default_project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  allow_from_json       TEXT NOT NULL DEFAULT '[]',
  group_allow_from_json TEXT NOT NULL DEFAULT '[]',
  require_mention       INTEGER NOT NULL DEFAULT 1 CHECK (require_mention IN (0, 1)),
  group_session_scope   TEXT NOT NULL DEFAULT 'group_topic',
  streaming             INTEGER NOT NULL DEFAULT 0 CHECK (streaming IN (0, 1)),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS feishu_conversation_bindings (
  route_key       TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  chat_id         TEXT NOT NULL,
  sender_id       TEXT NOT NULL DEFAULT '',
  root_id         TEXT NOT NULL DEFAULT '',
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS feishu_message_dedup (
  namespace       TEXT NOT NULL DEFAULT 'default',
  message_id      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'processing',
  route_key       TEXT NOT NULL DEFAULT '',
  error           TEXT NOT NULL DEFAULT '',
  claimed_at_ms   INTEGER NOT NULL DEFAULT 0,
  completed_at_ms INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (namespace, message_id)
);

CREATE TABLE IF NOT EXISTS agent_workspace_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  root_path   TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS backend_auth_session (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  token_type            TEXT NOT NULL DEFAULT 'bearer',
  expires_in            INTEGER NOT NULL,
  access_secret_ref     TEXT NOT NULL,
  refresh_secret_ref    TEXT NOT NULL,
  user_id               TEXT NOT NULL,
  user_email            TEXT NOT NULL,
  user_display_name     TEXT,
  organization_id       TEXT NOT NULL,
  organization_name     TEXT NOT NULL,
  organization_slug     TEXT NOT NULL,
  role                  TEXT NOT NULL,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  root_path   TEXT NOT NULL DEFAULT '',
  root_path_updated_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS drawings (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  drawing_id  TEXT REFERENCES drawings(id) ON DELETE SET NULL,
  title       TEXT NOT NULL DEFAULT '新对话',
  creation_source TEXT NOT NULL DEFAULT 'legacy_unknown',
  agent_state TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  is_pinned   INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  preferred_model_id TEXT,
  preferred_thinking_mode TEXT NOT NULL DEFAULT 'fast',
  context_input_tokens  INTEGER NOT NULL DEFAULT 0,
  context_output_tokens INTEGER NOT NULL DEFAULT 0,
  context_used_tokens   INTEGER NOT NULL DEFAULT 0,
  context_total_tokens  INTEGER NOT NULL DEFAULT 0,
  context_percent       INTEGER NOT NULL DEFAULT 0,
  context_model_id      TEXT NOT NULL DEFAULT '',
  context_cache_tokens    INTEGER NOT NULL DEFAULT 0,
  context_trailing_tokens INTEGER NOT NULL DEFAULT 0,
  context_compact_at_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversation_usage_runs (
  client_run_id     TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'completed',
  credits           INTEGER NOT NULL DEFAULT 0,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens  INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  call_count        INTEGER NOT NULL DEFAULT 0,
  breakdown_json    TEXT NOT NULL DEFAULT '[]',
  started_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_conversation_usage_runs_conversation
  ON conversation_usage_runs(conversation_id);

CREATE TABLE IF NOT EXISTS conversation_session_bindings (
  conversation_id        TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  pi_session_id           TEXT NOT NULL,
  pi_session_file         TEXT NOT NULL,
  parent_conversation_id  TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  forked_from_entry_id    TEXT,
  runtime_version         INTEGER NOT NULL DEFAULT 2,
  migration_status        TEXT NOT NULL DEFAULT 'ready'
                          CHECK(migration_status IN ('migrating', 'ready', 'failed')),
  migration_error         TEXT NOT NULL DEFAULT '',
  archive_generation      INTEGER NOT NULL DEFAULT 0,
  archive_sha256          TEXT,
  archive_size_bytes      INTEGER NOT NULL DEFAULT 0,
  archive_source_modified_at TEXT,
  upload_status           TEXT NOT NULL DEFAULT 'pending'
                          CHECK(upload_status IN ('pending', 'uploaded', 'failed')),
  remote_storage_key      TEXT,
  uploaded_at             TEXT,
  upload_error            TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS conversation_drawing_refs (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  drawing_id      TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'reference',
  confidence      REAL NOT NULL DEFAULT 1,
  source          TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  client_run_id   TEXT,
  pi_session_id   TEXT,
  pi_entry_id     TEXT,
  path_index      INTEGER NOT NULL DEFAULT 0,
  is_visible      INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  role            TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
  host_notice     TEXT NOT NULL DEFAULT '',
  content         TEXT NOT NULL DEFAULT '',
  tool_name       TEXT NOT NULL DEFAULT '',
  tool_args       TEXT NOT NULL DEFAULT '',
  tool_result     TEXT NOT NULL DEFAULT '',
  thinking        TEXT NOT NULL DEFAULT '',
  parts_json      TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS conversation_message_id_mappings (
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  legacy_message_id   TEXT NOT NULL,
  canonical_message_id TEXT NOT NULL,
  pi_session_id       TEXT NOT NULL,
  pi_entry_id         TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (conversation_id, legacy_message_id),
  UNIQUE (conversation_id, canonical_message_id)
);

CREATE TABLE IF NOT EXISTS agent_interaction_audit (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool_call_id    TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  kind            TEXT NOT NULL,
  title           TEXT NOT NULL,
  risk            TEXT NOT NULL,
  details_json    TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL,
  action_id       TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  resolved_at     TEXT
);

CREATE TABLE IF NOT EXISTS conversation_plan_mode (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  preferred_mode TEXT NOT NULL DEFAULT 'agent',
  phase TEXT NOT NULL DEFAULT 'inactive',
  reminder_count INTEGER NOT NULL DEFAULT 0,
  awaiting_plan_approval INTEGER NOT NULL DEFAULT 0 CHECK (awaiting_plan_approval IN (0, 1)),
  pending_exit_reminder INTEGER NOT NULL DEFAULT 0 CHECK (pending_exit_reminder IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS conversation_pending_interactions (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  interaction_json TEXT NOT NULL,
  response_token TEXT NOT NULL,
  allowed_actions_json TEXT NOT NULL,
  persistence TEXT NOT NULL DEFAULT 'persistent',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS project_archive_file_cache (
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  modified_at_ms INTEGER NOT NULL,
  sha256         TEXT NOT NULL,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (project_id, relative_path)
);

CREATE TABLE IF NOT EXISTS user_skill_archive_file_cache (
  relative_path TEXT PRIMARY KEY,
  size_bytes     INTEGER NOT NULL,
  modified_at_ms INTEGER NOT NULL,
  sha256         TEXT NOT NULL,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS drawing_quantity_references (
  drawing_id                  TEXT PRIMARY KEY REFERENCES drawings(id) ON DELETE CASCADE,
  construction_attachments_json TEXT NOT NULL DEFAULT '',
  source_message             TEXT NOT NULL DEFAULT '',
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cad_drawing_artifacts (
  drawing_id      TEXT PRIMARY KEY REFERENCES drawings(id) ON DELETE CASCADE,
  drawing_name    TEXT NOT NULL,
  doc_name        TEXT NOT NULL DEFAULT '',
  doc_key         TEXT NOT NULL DEFAULT '',
  entity_count    INTEGER NOT NULL DEFAULT 0,
  source_entity_count INTEGER NOT NULL DEFAULT 0,
  indexed_entity_count INTEGER NOT NULL DEFAULT 0,
  omitted_geometry_count INTEGER NOT NULL DEFAULT 0,
  index_profile   TEXT NOT NULL DEFAULT '',
  artifact_id     TEXT,
  knowledge_file_id TEXT,
  extract_phase   TEXT NOT NULL DEFAULT 'idle',
  extract_summary TEXT,
  message         TEXT,
  raw_path        TEXT NOT NULL DEFAULT '',
  readable_path   TEXT NOT NULL DEFAULT '',
  read_at         TEXT,
  visual_phase    TEXT NOT NULL DEFAULT 'not_started',
  visual_summary  TEXT,
  visual_path     TEXT NOT NULL DEFAULT '',
  visual_region_count INTEGER NOT NULL DEFAULT 0,
  visual_image_count INTEGER NOT NULL DEFAULT 0,
  visual_model    TEXT NOT NULL DEFAULT '',
  visual_read_at  TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS subagent_runs (
  child_run_id            TEXT PRIMARY KEY,
  parent_session_id       TEXT NOT NULL,
  parent_prompt_id        TEXT NOT NULL,
  client_run_id           TEXT NOT NULL,
  project_id              TEXT NOT NULL,
  agent_type              TEXT NOT NULL,
  status                  TEXT NOT NULL,
  model                   TEXT NOT NULL,
  description             TEXT NOT NULL DEFAULT '',
  task_preview            TEXT NOT NULL DEFAULT '',
  thinking_mode           TEXT NOT NULL DEFAULT 'fast',
  started_at              TEXT NOT NULL,
  finished_at             TEXT,
  usage_json              TEXT NOT NULL DEFAULT '{}',
  tool_call_count         INTEGER NOT NULL DEFAULT 0,
  safe_artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  trace_ref               TEXT NOT NULL DEFAULT '',
  trace_schema_version    INTEGER NOT NULL DEFAULT 1,
  trace_event_count       INTEGER NOT NULL DEFAULT 0,
  trace_last_sequence     INTEGER NOT NULL DEFAULT 0,
  trace_sha256            TEXT,
  trace_size_bytes        INTEGER NOT NULL DEFAULT 0,
  trace_compressed        INTEGER NOT NULL DEFAULT 0 CHECK (trace_compressed IN (0, 1)),
  upload_status           TEXT NOT NULL DEFAULT 'pending',
  remote_storage_key      TEXT,
  uploaded_at             TEXT,
  upload_error            TEXT,
  error_code              TEXT,
  error_message           TEXT,
  orphan_notice_consumed  INTEGER NOT NULL DEFAULT 0 CHECK (orphan_notice_consumed IN (0, 1)),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cad_artifact_sets (
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  drawing_relpath      TEXT NOT NULL,
  kind                 TEXT NOT NULL,
  storage_scope        TEXT NOT NULL DEFAULT 'project',
  artifact_key         TEXT NOT NULL DEFAULT '',
  legacy_drawing_id    TEXT,
  manifest_relpath     TEXT NOT NULL DEFAULT '',
  source_sha256        TEXT NOT NULL DEFAULT '',
  producer_fingerprint TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL,
  reason               TEXT NOT NULL DEFAULT '',
  summary_json         TEXT NOT NULL DEFAULT '{}',
  generated_at         TEXT,
  verified_at          TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (project_id, drawing_relpath, kind)
);
`

export function runMigrations(db: Database.Database) {
  db.exec(TABLES)

  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined

  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION)
  } else if (row.version < SCHEMA_VERSION) {
    db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION)
  }

  const messageColumns = db
    .prepare(`PRAGMA table_info(messages)`)
    .all() as Array<{ name: string }>

  if (!messageColumns.some((column) => column.name === 'attachments_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN attachments_json TEXT NOT NULL DEFAULT ''`)
  }

  if (!messageColumns.some((column) => column.name === 'parts_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN parts_json TEXT NOT NULL DEFAULT ''`)
  }

  if (!messageColumns.some((column) => column.name === 'client_run_id')) {
    db.exec(`ALTER TABLE messages ADD COLUMN client_run_id TEXT`)
  }

  if (!messageColumns.some((column) => column.name === 'pi_session_id')) {
    db.exec(`ALTER TABLE messages ADD COLUMN pi_session_id TEXT`)
  }

  if (!messageColumns.some((column) => column.name === 'pi_entry_id')) {
    db.exec(`ALTER TABLE messages ADD COLUMN pi_entry_id TEXT`)
  }

  if (!messageColumns.some((column) => column.name === 'path_index')) {
    db.exec(`ALTER TABLE messages ADD COLUMN path_index INTEGER NOT NULL DEFAULT 0`)
  }

  if (!messageColumns.some((column) => column.name === 'is_visible')) {
    db.exec(`ALTER TABLE messages ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1`)
  }

  if (!messageColumns.some((column) => column.name === 'host_notice')) {
    db.exec(`ALTER TABLE messages ADD COLUMN host_notice TEXT NOT NULL DEFAULT ''`)
  }

  const sessionBindingColumns = db
    .prepare(`PRAGMA table_info(conversation_session_bindings)`)
    .all() as Array<{ name: string }>
  const ensureSessionBindingColumn = (name: string, definition: string) => {
    if (!sessionBindingColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE conversation_session_bindings ADD COLUMN ${name} ${definition}`)
    }
  }
  ensureSessionBindingColumn('archive_generation', `INTEGER NOT NULL DEFAULT 0`)
  ensureSessionBindingColumn('archive_sha256', `TEXT`)
  ensureSessionBindingColumn('archive_size_bytes', `INTEGER NOT NULL DEFAULT 0`)
  ensureSessionBindingColumn('archive_source_modified_at', `TEXT`)
  ensureSessionBindingColumn('upload_status', `TEXT NOT NULL DEFAULT 'pending'`)
  ensureSessionBindingColumn('remote_storage_key', `TEXT`)
  ensureSessionBindingColumn('uploaded_at', `TEXT`)
  ensureSessionBindingColumn('upload_error', `TEXT`)

  const subagentRunColumns = db
    .prepare(`PRAGMA table_info(subagent_runs)`)
    .all() as Array<{ name: string }>
  const ensureSubagentRunColumn = (name: string, definition: string) => {
    if (!subagentRunColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE subagent_runs ADD COLUMN ${name} ${definition}`)
    }
  }
  ensureSubagentRunColumn('description', `TEXT NOT NULL DEFAULT ''`)
  ensureSubagentRunColumn('task_preview', `TEXT NOT NULL DEFAULT ''`)
  ensureSubagentRunColumn('thinking_mode', `TEXT NOT NULL DEFAULT 'fast'`)
  ensureSubagentRunColumn('trace_schema_version', `INTEGER NOT NULL DEFAULT 1`)
  ensureSubagentRunColumn('trace_event_count', `INTEGER NOT NULL DEFAULT 0`)
  ensureSubagentRunColumn('trace_last_sequence', `INTEGER NOT NULL DEFAULT 0`)
  ensureSubagentRunColumn('trace_sha256', `TEXT`)
  ensureSubagentRunColumn('trace_size_bytes', `INTEGER NOT NULL DEFAULT 0`)
  ensureSubagentRunColumn('trace_compressed', `INTEGER NOT NULL DEFAULT 0`)
  ensureSubagentRunColumn('upload_status', `TEXT NOT NULL DEFAULT 'pending'`)
  ensureSubagentRunColumn('remote_storage_key', `TEXT`)
  ensureSubagentRunColumn('uploaded_at', `TEXT`)
  ensureSubagentRunColumn('upload_error', `TEXT`)
  ensureSubagentRunColumn('error_message', `TEXT`)
  ensureSubagentRunColumn('orphan_notice_consumed', `INTEGER NOT NULL DEFAULT 0`)

  const conversationColumns = db
    .prepare(`PRAGMA table_info(conversations)`)
    .all() as Array<{ name: string }>

  const usageRunColumns = db
    .prepare(`PRAGMA table_info(conversation_usage_runs)`)
    .all() as Array<{ name: string }>
  if (!usageRunColumns.some((column) => column.name === 'started_at')) {
    db.exec(`ALTER TABLE conversation_usage_runs ADD COLUMN started_at TEXT NOT NULL DEFAULT ''`)
    db.exec(
      `UPDATE conversation_usage_runs
          SET started_at = updated_at
        WHERE started_at = ''`,
    )
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversation_usage_runs_started
       ON conversation_usage_runs(conversation_id, started_at)`,
  )

  const projectColumns = db
    .prepare(`PRAGMA table_info(projects)`)
    .all() as Array<{ name: string }>

  if (!projectColumns.some((column) => column.name === 'root_path')) {
    db.exec(`ALTER TABLE projects ADD COLUMN root_path TEXT NOT NULL DEFAULT ''`)
  }

  if (!projectColumns.some((column) => column.name === 'root_path_updated_at')) {
    db.exec(`ALTER TABLE projects ADD COLUMN root_path_updated_at TEXT`)
  }

  const profileColumns = db
    .prepare(`PRAGMA table_info(llm_profile_settings)`)
    .all() as Array<{ name: string }>

  if (!profileColumns.some((column) => column.name === 'reasoning_level')) {
    db.exec(`ALTER TABLE llm_profile_settings ADD COLUMN reasoning_level TEXT`)
  }

  if (!profileColumns.some((column) => column.name === 'knowledge_model')) {
    db.exec(
      `ALTER TABLE llm_profile_settings ADD COLUMN knowledge_model TEXT NOT NULL DEFAULT ''`,
    )
  }

  if (!conversationColumns.some((column) => column.name === 'preferred_model_id')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN preferred_model_id TEXT`)
  }

  if (!conversationColumns.some((column) => column.name === 'preferred_thinking_mode')) {
    db.exec(
      `ALTER TABLE conversations ADD COLUMN preferred_thinking_mode TEXT NOT NULL DEFAULT 'fast'`,
    )
  }

  if (!conversationColumns.some((column) => column.name === 'is_pinned')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0`)
  }

  if (!conversationColumns.some((column) => column.name === 'project_id')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`)
  }

  if (!conversationColumns.some((column) => column.name === 'drawing_id')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN drawing_id TEXT REFERENCES drawings(id) ON DELETE SET NULL`)
  }

  if (!conversationColumns.some((column) => column.name === 'creation_source')) {
    db.exec(
      `ALTER TABLE conversations ADD COLUMN creation_source TEXT NOT NULL DEFAULT 'legacy_unknown'`,
    )
  }

  if (!conversationColumns.some((column) => column.name === 'context_input_tokens')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN context_input_tokens INTEGER NOT NULL DEFAULT 0`)
  }

  if (!conversationColumns.some((column) => column.name === 'context_output_tokens')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN context_output_tokens INTEGER NOT NULL DEFAULT 0`)
  }

  if (!conversationColumns.some((column) => column.name === 'context_used_tokens')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN context_used_tokens INTEGER NOT NULL DEFAULT 0`)
  }

  const cadDrawingArtifactColumns = db
    .prepare(`PRAGMA table_info(cad_drawing_artifacts)`)
    .all() as Array<{ name: string }>

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'knowledge_file_id')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN knowledge_file_id TEXT`)
  }

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'source_entity_count')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN source_entity_count INTEGER NOT NULL DEFAULT 0`)
  }

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'indexed_entity_count')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN indexed_entity_count INTEGER NOT NULL DEFAULT 0`)
  }

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'omitted_geometry_count')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN omitted_geometry_count INTEGER NOT NULL DEFAULT 0`)
  }

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'index_profile')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN index_profile TEXT NOT NULL DEFAULT ''`)
  }

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'visual_phase')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN visual_phase TEXT NOT NULL DEFAULT 'not_started'`)
  }

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'visual_summary')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN visual_summary TEXT`)
  }

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'visual_path')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN visual_path TEXT NOT NULL DEFAULT ''`)
  }

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'visual_region_count')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN visual_region_count INTEGER NOT NULL DEFAULT 0`)
  }

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'visual_image_count')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN visual_image_count INTEGER NOT NULL DEFAULT 0`)
  }

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'visual_model')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN visual_model TEXT NOT NULL DEFAULT ''`)
  }

  if (!cadDrawingArtifactColumns.some((column) => column.name === 'visual_read_at')) {
    db.exec(`ALTER TABLE cad_drawing_artifacts ADD COLUMN visual_read_at TEXT`)
  }

  if (!conversationColumns.some((column) => column.name === 'context_total_tokens')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN context_total_tokens INTEGER NOT NULL DEFAULT 0`)
  }

  if (!conversationColumns.some((column) => column.name === 'context_percent')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN context_percent INTEGER NOT NULL DEFAULT 0`)
  }

  if (!conversationColumns.some((column) => column.name === 'context_model_id')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN context_model_id TEXT NOT NULL DEFAULT ''`)
  }

  if (!conversationColumns.some((column) => column.name === 'context_cache_tokens')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN context_cache_tokens INTEGER NOT NULL DEFAULT 0`)
  }

  if (!conversationColumns.some((column) => column.name === 'context_trailing_tokens')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN context_trailing_tokens INTEGER NOT NULL DEFAULT 0`)
  }

  if (!conversationColumns.some((column) => column.name === 'context_compact_at_tokens')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN context_compact_at_tokens INTEGER NOT NULL DEFAULT 0`)
  }

  db.exec(
    `UPDATE conversations
     SET project_id = (
       SELECT d.project_id
       FROM drawings d
       WHERE d.id = conversations.drawing_id
     )
     WHERE drawing_id IS NOT NULL
       AND (project_id IS NULL OR project_id = '')`,
  )

  backfillUnscopedConversations(db)

  db.prepare(
    `INSERT OR IGNORE INTO conversation_drawing_refs (
       id, conversation_id, drawing_id, role, confidence, source, created_at, updated_at
     )
     SELECT lower(hex(randomblob(16))), id, drawing_id, 'legacy_primary', 1, 'migration:conversation.drawing_id',
            datetime('now','localtime'), datetime('now','localtime')
       FROM conversations
      WHERE drawing_id IS NOT NULL AND drawing_id <> ''`,
  ).run()

  db.exec(
    `INSERT INTO cad_artifact_sets (
       project_id, drawing_relpath, kind, storage_scope, artifact_key,
       legacy_drawing_id, manifest_relpath, source_sha256, producer_fingerprint,
       status, reason, summary_json, generated_at, verified_at, updated_at
     )
     SELECT d.project_id,
            '.legacy-userdata/' || a.drawing_id,
            'legacy',
            'userdata_legacy',
            a.drawing_id,
            a.drawing_id,
            '', '', '',
            'untracked_legacy',
            'Legacy userData CAD artifact has no project manifest or trusted source/producer hash.',
            '{}',
            COALESCE(a.read_at, a.visual_read_at, a.updated_at),
            NULL,
            datetime('now','localtime')
       FROM cad_drawing_artifacts a
       JOIN drawings d ON d.id = a.drawing_id
      WHERE 1 = 1
     ON CONFLICT(project_id, drawing_relpath, kind) DO UPDATE SET
       storage_scope = excluded.storage_scope,
       artifact_key = excluded.artifact_key,
       legacy_drawing_id = excluded.legacy_drawing_id,
       status = 'untracked_legacy',
       reason = excluded.reason,
       generated_at = excluded.generated_at,
       updated_at = excluded.updated_at`,
  )

  // Runs last so every project-referencing table above has settled before the
  // emptiness check decides whether a legacy default project shell can go.
  dropUnusedDefaultProjectShells(db)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)`)
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_pi_entry
       ON messages(pi_session_id, pi_entry_id)
       WHERE pi_session_id IS NOT NULL AND pi_entry_id IS NOT NULL`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_messages_active_path
       ON messages(conversation_id, path_index)
       WHERE is_visible = 1`,
  )
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_session_bindings_pi_session
       ON conversation_session_bindings(pi_session_id)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversation_session_bindings_parent
       ON conversation_session_bindings(parent_conversation_id, updated_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversation_session_bindings_upload_status
       ON conversation_session_bindings(upload_status, migration_status, updated_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversation_message_id_mappings_canonical
       ON conversation_message_id_mappings(conversation_id, canonical_message_id)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_interaction_audit_conversation
       ON agent_interaction_audit(conversation_id, created_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_interaction_audit_status
       ON agent_interaction_audit(status, created_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversation_plan_mode_awaiting
       ON conversation_plan_mode(awaiting_plan_approval, updated_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversation_pending_interactions_updated
       ON conversation_pending_interactions(updated_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversations_pin_updated ON conversations(is_pinned, updated_at, created_at)`,
  )
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_drawings_project_normalized_name ON drawings(project_id, normalized_name)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversations_project_drawing_updated ON conversations(project_id, drawing_id, updated_at, created_at)`,
  )
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_drawing_refs_unique
       ON conversation_drawing_refs(conversation_id, drawing_id, role)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversation_drawing_refs_conversation
       ON conversation_drawing_refs(conversation_id, updated_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversation_drawing_refs_drawing
       ON conversation_drawing_refs(drawing_id, updated_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_feishu_bindings_conversation
       ON feishu_conversation_bindings(conversation_id, updated_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_feishu_bindings_chat
       ON feishu_conversation_bindings(chat_id, updated_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_feishu_message_dedup_status
       ON feishu_message_dedup(namespace, status, claimed_at_ms, completed_at_ms)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_subagent_runs_parent
       ON subagent_runs(parent_session_id, started_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_subagent_runs_client
       ON subagent_runs(client_run_id, started_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_subagent_runs_project_status
       ON subagent_runs(project_id, status, started_at)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_cad_artifact_sets_project_status
       ON cad_artifact_sets(project_id, status, drawing_relpath)`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_cad_artifact_sets_legacy
       ON cad_artifact_sets(legacy_drawing_id, storage_scope)`,
  )
}
