import type { AgentRunSource } from '../../../../src/shared/backend-api'

export type AgentPromptCreationSource = 'user' | 'subagent_completion'

export function toAgentRunSource(source: AgentPromptCreationSource | undefined): AgentRunSource {
  return source === 'subagent_completion' ? 'subagent_completion' : 'desktop_chat'
}
