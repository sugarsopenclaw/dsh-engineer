import { getDB } from '../../db'

export interface AgentWorkspaceSettingsRow {
  root_path: string
  updated_at: string
}

export interface AgentWorkspaceSettings {
  rootPath: string | null
  updatedAt: string | null
}

function mapSettings(row: AgentWorkspaceSettingsRow | undefined): AgentWorkspaceSettings {
  return {
    rootPath: row?.root_path?.trim() || null,
    updatedAt: row?.updated_at ?? null,
  }
}

export function getAgentWorkspaceSettings(): AgentWorkspaceSettings {
  const row = getDB()
    .prepare('SELECT root_path, updated_at FROM agent_workspace_settings WHERE id = 1')
    .get() as AgentWorkspaceSettingsRow | undefined
  return mapSettings(row)
}

export function saveAgentWorkspaceRoot(rootPath: string | null): AgentWorkspaceSettings {
  const normalizedRoot = rootPath?.trim() || ''
  getDB()
    .prepare(
      `INSERT INTO agent_workspace_settings (id, root_path, updated_at)
       VALUES (1, ?, datetime('now','localtime'))
       ON CONFLICT(id) DO UPDATE SET
         root_path = excluded.root_path,
         updated_at = excluded.updated_at`,
    )
    .run(normalizedRoot)
  return getAgentWorkspaceSettings()
}
