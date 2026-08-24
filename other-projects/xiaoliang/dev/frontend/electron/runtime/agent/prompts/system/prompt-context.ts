import type { ConversationAgentMode } from '../../../../../src/shared/local-agent'

export interface SystemPromptContext {
  now: Date
  conversationTitle: string
  modelId: string
  provider: string
  imageCount: number
  toolNames: string[]
  /** Pi owns the built-in/managed skill catalog when controlled resources are enabled. */
  piResourcesEnabled?: boolean
  mode?: ConversationAgentMode
  planFilePath?: string
  computerRegionCode: string
  systemLocale: string
  timeZone: string
  /** True when this conversation already has an unfinished AutoCAD evidence child. */
  activeCadEvidenceTask?: boolean
}

export function formatComputerRegionFallback(countryCode: string) {
  const normalized = countryCode.trim().toUpperCase()
  if (normalized === 'CN') {
    return '全国（电脑区域 CN 兜底；项目省市未确认）'
  }
  if (normalized) {
    return `${normalized}（电脑区域国家级兜底；项目具体地区未确认）`
  }
  return '未指定（电脑区域不可用）'
}
