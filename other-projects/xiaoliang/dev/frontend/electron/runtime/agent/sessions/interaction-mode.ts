import type { ConversationCreationSource } from '../../../../src/shared/local-agent'

export type AgentInteractionMode = 'a2ui' | 'unavailable'

/**
 * 确认卡只在桌面会话弹出。飞书与未知空会话保持 unavailable，
 * 避免无头通道卡在无法渲染的交互面上。
 */
export function resolveInteractionModeForConversation(
  creationSource: ConversationCreationSource | null | undefined,
): AgentInteractionMode {
  return creationSource === 'feishu' ? 'unavailable' : 'a2ui'
}
