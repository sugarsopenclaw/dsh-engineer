import type { AgentMessage } from '@earendil-works/pi-agent-core'

type RunLinkedAgentMessage = AgentMessage & {
  clientRunId?: string
  role?: string
}

export function stampAgentMessageRun(message: AgentMessage, clientRunId: string): void {
  const normalizedRunId = clientRunId.trim()
  if (!normalizedRunId) return
  Object.assign(message, { clientRunId: normalizedRunId })
}

export function findLastAssistantMessageForRun(
  messages: readonly AgentMessage[],
  clientRunId: string,
): AgentMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as RunLinkedAgentMessage
    if (message.role === 'assistant' && message.clientRunId === clientRunId) {
      return message
    }
  }
  return null
}
