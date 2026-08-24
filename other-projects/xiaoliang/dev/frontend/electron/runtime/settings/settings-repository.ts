import { getDB } from '../db'
import {
  DEFAULT_LLM_PROFILE_ID,
  getDefaultLlmSettingsView,
  getLlmModelOption,
  getLlmProfileCatalogEntry,
  isLlmReasoningLevel,
  LLM_PROVIDER_PROFILES,
  type LlmApiMode,
  type LlmProfileId,
  type LlmProfileSettingsInput,
  type LlmProvider,
  type LlmReasoningLevel,
  type LlmSettingsView,
} from '../../../src/shared/local-agent'

interface LegacyLlmSettingsRow {
  provider: LlmProvider
  api_mode: LlmApiMode
  base_url: string
  model: string
  secret_ref: string | null
  updated_at: string
}

interface LlmProfileSettingsRow {
  profile_id: LlmProfileId
  model: string
  reasoning_level: string | null
  knowledge_model: string | null
  secret_ref: string | null
  is_active: number
  updated_at: string
}

export interface ResolvedLlmConfig {
  profileId: LlmProfileId
  provider: LlmProvider
  apiMode: LlmApiMode
  baseUrl: string
  runtimeProvider: string
  model: string
  reasoningLevel: LlmReasoningLevel
  secretRef: string | null
  updatedAt: string
}

const PROFILE_ROW_COLUMNS =
  'profile_id, model, reasoning_level, knowledge_model, secret_ref, is_active, updated_at'

function getProfileRows(): LlmProfileSettingsRow[] {
  return getDB()
    .prepare(
      `SELECT ${PROFILE_ROW_COLUMNS} FROM llm_profile_settings ORDER BY profile_id`,
    )
    .all() as LlmProfileSettingsRow[]
}

function getProfileRow(profileId: LlmProfileId) {
  return getDB()
    .prepare(
      `SELECT ${PROFILE_ROW_COLUMNS} FROM llm_profile_settings WHERE profile_id = ?`,
    )
    .get(profileId) as LlmProfileSettingsRow | undefined
}

function getLegacySettingsRow() {
  return getDB()
    .prepare(
      'SELECT provider, api_mode, base_url, model, secret_ref, updated_at FROM llm_settings WHERE id = 1',
    )
    .get() as LegacyLlmSettingsRow | undefined
}

function normalizeStoredModel(profileId: LlmProfileId, modelId: string | undefined) {
  if (typeof modelId === 'string' && getLlmModelOption(profileId, modelId)) {
    return modelId.trim()
  }
  return getLlmProfileCatalogEntry(profileId).defaultModel
}

function isLegacyReasoningModel(modelId: string) {
  const normalized = modelId.trim().toLowerCase()
  return (
    normalized === 'minimax-m2.5' ||
    normalized.includes('-thinking') ||
    normalized.includes('qwq') ||
    normalized.includes('qvq') ||
    normalized.includes('-deepseek')
  )
}

function normalizeStoredReasoning(
  profileId: LlmProfileId,
  modelId: string,
  reasoningLevel: string | null | undefined,
): LlmReasoningLevel {
  if (isLlmReasoningLevel(reasoningLevel)) {
    return reasoningLevel
  }

  const normalizedModel = normalizeStoredModel(profileId, modelId)
  return isLegacyReasoningModel(normalizedModel) ? 'medium' : 'off'
}

function resolveLegacyProfileId(baseUrl: string | undefined): LlmProfileId {
  if (typeof baseUrl === 'string' && baseUrl.includes('coding.dashscope.aliyuncs.com')) {
    return 'aliyun-coding-plan'
  }
  if (typeof baseUrl === 'string' && baseUrl.includes('api.kimi.com/coding')) {
    return 'kimi-coding'
  }
  return DEFAULT_LLM_PROFILE_ID
}

function ensureProfileRows() {
  const existing = getProfileRows()
  if (existing.length > 0) {
    return existing
  }

  const legacy = getLegacySettingsRow()
  if (!legacy) {
    return existing
  }

  const profileId = resolveLegacyProfileId(legacy.base_url)
  const model = normalizeStoredModel(profileId, legacy.model)

  getDB()
    .prepare(
      `INSERT INTO llm_profile_settings (
        profile_id, model, reasoning_level, knowledge_model, secret_ref, is_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      profileId,
      model,
      normalizeStoredReasoning(profileId, model, null),
      '',
      legacy.secret_ref,
      legacy.updated_at || '',
    )

  return getProfileRows()
}

function resolveActiveProfileId(rows: LlmProfileSettingsRow[]) {
  const activeRow = rows.find((row) => row.is_active === 1)
  return activeRow?.profile_id ?? DEFAULT_LLM_PROFILE_ID
}

export function assertKnownModel(profileId: LlmProfileId, modelId: string) {
  const normalized = modelId.trim()
  if (!normalized || !getLlmModelOption(profileId, normalized)) {
    throw new Error(`模型 ${modelId} 不在当前分组的可选列表中。`)
  }
  return normalized
}

export function getLlmSettingsView(): LlmSettingsView {
  const rows = ensureProfileRows()
  const rowsById = new Map(rows.map((row) => [row.profile_id, row]))
  const fallback = getDefaultLlmSettingsView()
  const activeProfileId = resolveActiveProfileId(rows)

  return {
    activeProfileId,
    profiles: fallback.profiles.map((profile) => {
      const row = rowsById.get(profile.profileId)
      return {
        ...profile,
        model: normalizeStoredModel(profile.profileId, row?.model ?? profile.model),
        reasoningLevel: normalizeStoredReasoning(
          profile.profileId,
          row?.model ?? profile.model,
          row?.reasoning_level,
        ),
        hasApiKey: Boolean(row?.secret_ref),
        updatedAt: row?.updated_at ?? '',
        isActive: profile.profileId === activeProfileId,
      }
    }),
  }
}

export function getResolvedLlmConfig(profileId?: LlmProfileId): ResolvedLlmConfig {
  const view = getLlmSettingsView()
  const selectedProfileId = profileId ?? view.activeProfileId
  const profileView = view.profiles.find((profile) => profile.profileId === selectedProfileId)
  const catalog = getLlmProfileCatalogEntry(selectedProfileId)
  const row = getProfileRow(selectedProfileId)

  return {
    profileId: selectedProfileId,
    provider: catalog.provider,
    apiMode: catalog.apiMode,
    baseUrl: catalog.baseUrl,
    runtimeProvider: catalog.runtimeProvider,
    model: profileView?.model ?? catalog.defaultModel,
    reasoningLevel: profileView?.reasoningLevel ?? 'off',
    secretRef: row?.secret_ref ?? null,
    updatedAt: row?.updated_at ?? '',
  }
}

export function resolveLlmConfigInput(
  input?: Partial<Pick<LlmProfileSettingsInput, 'profileId' | 'model' | 'reasoningLevel'>>,
): ResolvedLlmConfig {
  const resolved = getResolvedLlmConfig(input?.profileId)
  return {
    ...resolved,
    model: normalizeStoredModel(resolved.profileId, input?.model ?? resolved.model),
    reasoningLevel: isLlmReasoningLevel(input?.reasoningLevel)
      ? input.reasoningLevel
      : resolved.reasoningLevel,
  }
}

export function upsertLlmProfileSettings(
  input: LlmProfileSettingsInput & { secretRef: string | null },
) {
  const profileId = input.profileId
  const model = assertKnownModel(profileId, input.model)
  const current = getProfileRow(profileId)
  const reasoningLevel = normalizeStoredReasoning(profileId, model, input.reasoningLevel)
  const nextIsActive = input.makeActive ? 1 : current?.is_active ?? 0
  const db = getDB()

  const tx = db.transaction(() => {
    if (input.makeActive) {
      db.prepare('UPDATE llm_profile_settings SET is_active = 0 WHERE is_active <> 0').run()
    }

    db.prepare(
      `INSERT INTO llm_profile_settings (
        profile_id, model, reasoning_level, knowledge_model, secret_ref, is_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(profile_id) DO UPDATE SET
        model = excluded.model,
        reasoning_level = excluded.reasoning_level,
        knowledge_model = excluded.knowledge_model,
        secret_ref = excluded.secret_ref,
        is_active = excluded.is_active,
        updated_at = datetime('now','localtime')`,
    ).run(profileId, model, reasoningLevel, current?.knowledge_model ?? '', input.secretRef, nextIsActive)

    const hasActive = (
      db.prepare('SELECT 1 FROM llm_profile_settings WHERE is_active = 1 LIMIT 1').get() as
        | { 1: number }
        | undefined
    )

    if (!hasActive) {
      db.prepare(
        'UPDATE llm_profile_settings SET is_active = CASE WHEN profile_id = ? THEN 1 ELSE 0 END',
      ).run(DEFAULT_LLM_PROFILE_ID)
    }
  })

  tx()
  return getLlmSettingsView()
}

export function listAvailableProfileIds() {
  return LLM_PROVIDER_PROFILES.map((profile) => profile.id)
}

export function getStoredApiKeyRef(profileId?: LlmProfileId) {
  return getResolvedLlmConfig(profileId).secretRef
}
