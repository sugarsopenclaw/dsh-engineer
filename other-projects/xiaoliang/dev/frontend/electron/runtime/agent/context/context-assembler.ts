export interface ContextLayer {
  key: string
  content: string
}

export interface ContextProviderContext {
  now: Date
  conversationId: string
}

export interface ContextProvider {
  key: string
  provide(
    context: ContextProviderContext,
  ): Promise<ContextLayer | string | null | undefined> | ContextLayer | string | null | undefined
}

export interface ContextAssemblyInput {
  reminders?: string[]
  taskContext?: string
  skillContext?: string
  memoryContext?: string
  providerLayers?: ContextLayer[]
}

export interface ContextAssemblyOptions {
  maxTokens?: number
}

export interface ContextAssemblyResult {
  layers: ContextLayer[]
  estimatedTokens: number
  droppedKeys: string[]
}

export const DEFAULT_CONTEXT_TOKEN_BUDGET = 4_000

export function estimateContextTokens(text: string) {
  return Math.ceil(text.length / 4)
}

export async function collectContextProviderLayers(
  providers: ContextProvider[],
  context: ContextProviderContext,
) {
  const results = await Promise.all(
    providers.map(async (provider) => {
      const output = await provider.provide(context)
      if (!output) return null
      if (typeof output === 'string') {
        return {
          key: provider.key,
          content: output.trim(),
        }
      }
      return {
        key: output.key || provider.key,
        content: output.content.trim(),
      }
    }),
  )

  return results.filter((layer): layer is ContextLayer => Boolean(layer?.content))
}

function trimToBudget(layers: ContextLayer[], maxTokens: number): ContextAssemblyResult {
  const accepted: ContextLayer[] = []
  const droppedKeys: string[] = []
  let tokenCount = 0

  for (const layer of layers) {
    const next = estimateContextTokens(layer.content)
    if (accepted.length > 0 && tokenCount + next > maxTokens) {
      droppedKeys.push(layer.key)
      continue
    }

    accepted.push(layer)
    tokenCount += next
  }

  return {
    layers: accepted,
    estimatedTokens: tokenCount,
    droppedKeys,
  }
}

export function assembleContextLayers(
  input: ContextAssemblyInput,
  options: ContextAssemblyOptions = {},
): ContextAssemblyResult {
  const layers: ContextLayer[] = [
    ...(input.reminders ?? [])
      .map((content, index) => ({ key: `reminder_${index}`, content: content.trim() }))
      .filter((layer) => layer.content),
    input.taskContext ? { key: 'task_context', content: input.taskContext.trim() } : null,
    input.skillContext ? { key: 'skill_context', content: input.skillContext.trim() } : null,
    input.memoryContext ? { key: 'memory_context', content: input.memoryContext.trim() } : null,
    ...(input.providerLayers ?? []).map((layer) => ({
      key: layer.key,
      content: layer.content.trim(),
    })),
  ].filter((layer): layer is ContextLayer => Boolean(layer && layer.content))

  return trimToBudget(layers, options.maxTokens ?? DEFAULT_CONTEXT_TOKEN_BUDGET)
}

/**
 * 队尾注入的伪 user 消息需要自证来源，否则模型会把状态快照当成用户最新发言。
 * 内容必须逐轮字节稳定，它处在缓存前缀之外但仍影响后续轮次的前缀匹配。
 */
export const CONTEXT_SNAPSHOT_PREFACE =
  '[context_snapshot] 以下是运行时自动附加的状态快照，不是用户发言；请据此继续处理用户最近一次请求。'

export function renderContextLayers(layers: ContextLayer[]) {
  return layers
    .map((layer) => (
      layer.content.startsWith(`[${layer.key}]`)
        ? layer.content
        : `[${layer.key}]\n${layer.content}`
    ))
    .join('\n\n')
    .trim()
}
