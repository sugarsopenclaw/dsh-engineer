import { getDB } from '../db'
import {
  getDefaultFeishuSettingsView,
  type FeishuDomain,
  type FeishuGroupSessionScope,
  type FeishuSettingsInput,
  type FeishuSettingsView,
} from '../../../src/shared/local-agent'

const FEISHU_SETTINGS_ID = 1
const FEISHU_APP_SECRET_REF = 'feishu:app-secret'

interface FeishuSettingsRow {
  enabled: number
  app_id: string
  app_secret_ref: string | null
  domain: string
  allow_from_json: string
  group_allow_from_json: string
  require_mention: number
  group_session_scope: string
  streaming: number
  updated_at: string
}

function parseStringList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean),
  ))
}

function normalizeDomain(value: unknown): FeishuDomain {
  return value === 'lark' ? 'lark' : 'feishu'
}

function normalizeGroupSessionScope(value: unknown): FeishuGroupSessionScope {
  if (
    value === 'group' ||
    value === 'group_sender' ||
    value === 'group_topic' ||
    value === 'group_topic_sender'
  ) {
    return value
  }
  return 'group_topic'
}

function mapRow(row: FeishuSettingsRow | undefined): FeishuSettingsView {
  const fallback = getDefaultFeishuSettingsView()
  if (!row) return fallback

  const appId = row.app_id.trim()
  const hasAppSecret = Boolean(row.app_secret_ref)

  return {
    enabled: row.enabled === 1,
    configured: Boolean(appId && hasAppSecret),
    appId,
    hasAppSecret,
    domain: normalizeDomain(row.domain),
    allowFrom: parseStringList(row.allow_from_json),
    groupAllowFrom: parseStringList(row.group_allow_from_json),
    requireMention: row.require_mention === 1,
    groupSessionScope: normalizeGroupSessionScope(row.group_session_scope),
    streaming: row.streaming === 1,
    updatedAt: row.updated_at ?? '',
  }
}

function getRow() {
  return getDB()
    .prepare(
      `SELECT s.enabled,
              s.app_id,
              s.app_secret_ref,
              s.domain,
              s.allow_from_json,
              s.group_allow_from_json,
              s.require_mention,
              s.group_session_scope,
              s.streaming,
              s.updated_at
         FROM feishu_settings s
        WHERE s.id = ?`,
    )
    .get(FEISHU_SETTINGS_ID) as FeishuSettingsRow | undefined
}

export function getFeishuAppSecretRef() {
  return FEISHU_APP_SECRET_REF
}

export function getFeishuSettingsView(): FeishuSettingsView {
  return mapRow(getRow())
}

export function upsertFeishuSettings(
  input: Omit<FeishuSettingsInput, 'appSecret'> & { secretRef: string | null },
): FeishuSettingsView {
  const current = getFeishuSettingsView()
  const appId = typeof input.appId === 'string' ? input.appId.trim() : current.appId
  const domain = normalizeDomain(input.domain ?? current.domain)
  const allowFrom =
    input.allowFrom === undefined ? current.allowFrom : normalizeStringList(input.allowFrom)
  const groupAllowFrom =
    input.groupAllowFrom === undefined
      ? current.groupAllowFrom
      : normalizeStringList(input.groupAllowFrom)
  const requireMention =
    typeof input.requireMention === 'boolean' ? input.requireMention : current.requireMention
  const groupSessionScope = normalizeGroupSessionScope(
    input.groupSessionScope ?? current.groupSessionScope,
  )
  const streaming = typeof input.streaming === 'boolean' ? input.streaming : current.streaming
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : current.enabled

  getDB()
    .prepare(
      `INSERT INTO feishu_settings (
        id,
        enabled,
        app_id,
        app_secret_ref,
        domain,
        default_project_id,
        allow_from_json,
        group_allow_from_json,
        require_mention,
        group_session_scope,
        streaming,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        app_id = excluded.app_id,
        app_secret_ref = excluded.app_secret_ref,
        domain = excluded.domain,
        default_project_id = NULL,
        allow_from_json = excluded.allow_from_json,
        group_allow_from_json = excluded.group_allow_from_json,
        require_mention = excluded.require_mention,
        group_session_scope = excluded.group_session_scope,
        streaming = excluded.streaming,
        updated_at = datetime('now','localtime')`,
    )
    .run(
      FEISHU_SETTINGS_ID,
      enabled ? 1 : 0,
      appId,
      input.secretRef,
      domain,
      null,
      JSON.stringify(allowFrom),
      JSON.stringify(groupAllowFrom),
      requireMention ? 1 : 0,
      groupSessionScope,
      streaming ? 1 : 0,
    )

  return getFeishuSettingsView()
}
