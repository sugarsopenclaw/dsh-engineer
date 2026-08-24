import type { Model, OpenAICompletionsCompat } from '@earendil-works/pi-ai'

import type {
  ManagedAgentModelCatalogView,
  ManagedAgentModelView,
} from '../../../src/shared/backend-api'
import {
  MANAGED_MODEL_ALIASES,
  type ManagedCallPurpose,
  type ManagedModelKind,
  type ThinkingMode,
  DEFAULT_THINKING_MODE,
} from '../../../src/shared/billing-domain'
import { agentModelCatalogApiClient } from '../backend/agent-model-catalog-client'
import { getBackendBaseUrl } from '../backend/http'

const CATALOG_TTL_MS = 10 * 60 * 1_000
// schema_repair is a reserved purpose with no caller; it stays in the required set so a
// catalog that silently drops purposes still fails verification.
const REQUIRED_PURPOSES: ManagedCallPurpose[] = [
  'main',
  'subagent',
  'cad_query',
  'visual_index',
  'schema_repair',
  'compaction',
]

interface TrustedManagedCatalog {
  catalogVersion: string
  expiresAt: number
  models: Map<ManagedModelKind, ManagedAgentModelView>
}

let trustedCatalog: TrustedManagedCatalog | null = null
let catalogLoad: Promise<TrustedManagedCatalog> | null = null

const MANAGED_PI_PROVIDER = 'xiaoliang-backend'

export function getManagedPiSessionIdentity(
  kind: ManagedModelKind = 'default',
): Readonly<{ provider: string; modelId: string }> {
  return Object.freeze({
    provider: MANAGED_PI_PROVIDER,
    modelId: MANAGED_MODEL_ALIASES[kind],
  })
}

function validPositiveInteger(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum
}

function validateCatalog(input: ManagedAgentModelCatalogView): TrustedManagedCatalog {
  if (
    input.object !== 'list'
    || typeof input.catalog_version !== 'string'
    || !input.catalog_version.trim()
    || !Array.isArray(input.data)
  ) {
    throw new Error('托管模型能力目录格式无效。')
  }
  const byKind = new Map<ManagedModelKind, ManagedAgentModelView>()
  for (const entry of input.data) {
    const expectedAlias = MANAGED_MODEL_ALIASES[entry.kind]
    if (
      !expectedAlias
      || entry.id !== expectedAlias
      || entry.object !== 'model'
      || entry.provider_model !== 'qwen3.8-max'
      || !Array.isArray(entry.input_modalities)
      || !entry.input_modalities.includes('text')
      || !entry.input_modalities.includes('image')
      || !validPositiveInteger(entry.context_window, 8_192)
      || !validPositiveInteger(entry.max_output_tokens, 256)
      || entry.max_output_tokens > entry.context_window
      || typeof entry.purpose_max_output_tokens !== 'object'
      || entry.purpose_max_output_tokens === null
      || byKind.has(entry.kind)
    ) {
      throw new Error('托管模型能力目录包含不受信模型或限制。')
    }
    for (const purpose of REQUIRED_PURPOSES) {
      const limit = entry.purpose_max_output_tokens[purpose]
      if (!validPositiveInteger(limit, 256) || limit > entry.max_output_tokens) {
        throw new Error(`托管模型能力目录缺少 ${purpose} 输出限制。`)
      }
    }
    byKind.set(entry.kind, Object.freeze({ ...entry }))
  }
  if (byKind.size !== Object.keys(MANAGED_MODEL_ALIASES).length) {
    throw new Error('托管模型能力目录不完整。')
  }
  return {
    catalogVersion: input.catalog_version,
    expiresAt: Date.now() + CATALOG_TTL_MS,
    models: byKind,
  }
}

export async function ensureManagedModelCatalog(
  accessToken: string,
  force = false,
): Promise<void> {
  const token = accessToken.trim()
  if (!token) throw new Error('读取托管模型能力目录需要登录。')
  if (!force && trustedCatalog && trustedCatalog.expiresAt > Date.now()) return
  if (!catalogLoad) {
    catalogLoad = agentModelCatalogApiClient.getCatalog(token)
      .then(validateCatalog)
      .then((catalog) => {
        trustedCatalog = catalog
        return catalog
      })
      .finally(() => {
        catalogLoad = null
      })
  }
  await catalogLoad
}

export function getManagedModelCapability(
  kind: ManagedModelKind = 'default',
): ManagedAgentModelView {
  const entry = trustedCatalog?.models.get(kind)
  if (!entry) {
    throw new Error('托管模型能力目录尚未加载，请检查登录状态和后端连接。')
  }
  return entry
}

export function getManagedModelBaseUrl(): string {
  return `${getBackendBaseUrl()}/agent/v1`
}

export function buildManagedPiModel(
  kind: ManagedModelKind = 'default',
  purpose: ManagedCallPurpose = 'main',
): Model<'openai-completions'> {
  const capability = getManagedModelCapability(kind)
  const sessionIdentity = getManagedPiSessionIdentity(kind)
  const compat: OpenAICompletionsCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: true,
    maxTokensField: 'max_completion_tokens',
    requiresToolResultName: false,
    supportsStrictMode: false,
  }

  return {
    id: sessionIdentity.modelId,
    name: capability.provider_model,
    api: 'openai-completions',
    provider: sessionIdentity.provider,
    baseUrl: getManagedModelBaseUrl(),
    reasoning: capability.supports_reasoning_effort,
    thinkingLevelMap: capability.supports_reasoning_effort
      ? {
          off: 'off',
          minimal: 'minimal',
          low: 'low',
          medium: 'medium',
          high: 'high',
          xhigh: 'xhigh',
          max: null,
        }
      : undefined,
    input: [...capability.input_modalities],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: capability.context_window,
    maxTokens: capability.purpose_max_output_tokens[purpose],
    compat,
  }
}

export function getManagedLlmFingerprint(
  accessToken: string,
  kind: ManagedModelKind = 'default',
  thinkingMode: ThinkingMode = DEFAULT_THINKING_MODE,
) {
  const capability = getManagedModelCapability(kind)
  // Fingerprint must NOT include client_run_id (changes every message); only stable auth + model + thinking.
  const raw = accessToken.trim()
  const tokenOnly = raw.startsWith('xl.') ? raw.split('.').slice(2).join('.') : raw
  return JSON.stringify({
    mode: 'managed',
    kind,
    thinkingMode,
    model: capability.id,
    providerModel: capability.provider_model,
    contextWindow: capability.context_window,
    maxOutputTokens: capability.max_output_tokens,
    catalogVersion: trustedCatalog?.catalogVersion,
    baseUrl: getManagedModelBaseUrl(),
    tokenFingerprint: tokenOnly.slice(-16),
  })
}
