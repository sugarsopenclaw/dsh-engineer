import type { Model, OpenAICompletionsCompat } from '@earendil-works/pi-ai'
import {
  getLlmModelOption,
  getLlmProfileCatalogEntry,
  getLlmModelReasoningSupport,
} from '../../../src/shared/local-agent'
import { getResolvedLlmConfig, type ResolvedLlmConfig } from '../settings/settings-repository'

type EffectiveSettings = Pick<
  ResolvedLlmConfig,
  'profileId' | 'provider' | 'apiMode' | 'baseUrl' | 'runtimeProvider' | 'model' | 'reasoningLevel'
>

function normalizeSettings(settings: Partial<ResolvedLlmConfig> | undefined): EffectiveSettings {
  const stored = getResolvedLlmConfig(settings?.profileId)
  return {
    profileId: settings?.profileId ?? stored.profileId,
    provider: settings?.provider ?? stored.provider,
    apiMode: settings?.apiMode ?? stored.apiMode,
    baseUrl: settings?.baseUrl?.trim() || stored.baseUrl,
    runtimeProvider: settings?.runtimeProvider ?? stored.runtimeProvider,
    model: settings?.model?.trim() || stored.model,
    reasoningLevel: settings?.reasoningLevel ?? stored.reasoningLevel,
  }
}

/** 仅对明确支持「深思/推理」通道的模型开启 reasoning，避免普通 qwen-plus 等被误配 thinking payload 导致 400。 */
export function isReasoningModel(modelId: string): boolean {
  const m = modelId.toLowerCase()
  return (
    m.startsWith('kimi-k2.7-code') ||
    m.includes('-thinking') ||
    m.includes('qwq') ||
    m.includes('qvq') ||
    m.includes('-deepseek')
  )
}

export function getLlmFingerprint(
  settings: Partial<ResolvedLlmConfig> | undefined,
  apiKey: string,
) {
  const normalized = normalizeSettings(settings)
  return JSON.stringify({ ...normalized, apiKey })
}

export function buildPiModel(
  settings: Partial<ResolvedLlmConfig> | undefined,
): Model<'openai-completions'> {
  const normalized = normalizeSettings(settings)
  const isQwen = normalized.baseUrl.includes('dashscope') || normalized.runtimeProvider === 'qwen'
  const modelOption = getLlmModelOption(normalized.profileId, normalized.model)
  const reasoningSupport = getLlmModelReasoningSupport(normalized.profileId, normalized.model)
  const reasoning = Boolean(reasoningSupport) || isReasoningModel(normalized.model)
  const catalog = getLlmProfileCatalogEntry(normalized.profileId)
  const compat: OpenAICompletionsCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: true,
    maxTokensField: 'max_tokens',
    requiresToolResultName: false,
    supportsStrictMode: false,
    ...(isQwen && reasoning ? { thinkingFormat: 'qwen' as const } : {}),
  }

  return {
    id: normalized.model,
    name: modelOption?.label ?? normalized.model,
    api: 'openai-completions',
    provider: catalog.runtimeProvider,
    baseUrl: normalized.baseUrl,
    reasoning,
    input: modelOption?.input ?? ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: modelOption?.contextWindow ?? 128000,
    maxTokens: 8192,
    compat,
  }
}
