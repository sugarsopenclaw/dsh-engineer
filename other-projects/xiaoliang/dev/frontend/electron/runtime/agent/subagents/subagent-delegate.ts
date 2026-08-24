import { randomUUID } from 'node:crypto'

import type { ThinkingMode } from '../../../../src/shared/billing-domain'
import { REGISTERED_SUBAGENT_TYPES, type AgentDefinition } from './agent-definition-registry'
import {
  BLENDER_MODELER_AGENT_TYPE,
  CAD_ANALYST_AGENT_TYPE,
  CAD_DRAFTER_AGENT_TYPE,
  EMPTY_SUBAGENT_USAGE,
  isTerminalSubagentFailureCode,
  RESEARCH_ANALYST_AGENT_TYPE,
  SUBAGENT_RETRY_REFUSED_ERROR_CODE,
  SubagentRunError,
  type SafeSubagentTaskLaunchResult,
  type SafeSubagentToolResult,
  type SubagentTerminalResult,
  type SubagentType,
} from './contracts'
import type { CadDrafterMode, CadSubagentMode } from './feature-flags'
import {
  DEFAULT_CAD_DRAFTER_MODE,
  isCadDrafterEnabled,
  isCadSubagentEnabled,
} from './feature-flags'
import { projectSafeSubagentResult, projectSafeSubagentTaskLaunch } from './safe-result-projector'
import type { SubagentTaskService } from '../tasks/background/subagent-task-service'
import type { SubagentCoordinator, SubagentSnapshotListener } from './subagent-coordinator'

export interface SubagentDelegateExecutionContext {
  parentSessionId: string
  parentPromptId: string
  clientRunId: string
  projectId: string
  projectRoot: string
  thinkingMode: ThinkingMode
}

const DELEGATE_DESCRIPTIONS: Readonly<Partial<Record<SubagentType, string>>> = Object.freeze({
  [CAD_ANALYST_AGENT_TYPE]: 'Collecting isolated CAD evidence',
  [CAD_DRAFTER_AGENT_TYPE]: 'Collecting isolated CAD evidence',
  [BLENDER_MODELER_AGENT_TYPE]: 'Building and verifying the Blender scene',
})

export interface SubagentDelegateServiceOptions {
  coordinator: SubagentCoordinator
  definitions: Readonly<Partial<Record<SubagentType, AgentDefinition>>>
  cadMode: CadSubagentMode
  cadDrafterMode?: CadDrafterMode
  cadCanaryProjectIds?: ReadonlySet<string>
  createChildRunId?: () => string
  taskService?: SubagentTaskService
  backgroundEnabled?: boolean
}

export class SubagentDelegateService {
  private readonly createChildRunId: () => string
  private readonly terminalFailureCounts = new Map<string, number>()

  constructor(private readonly options: SubagentDelegateServiceOptions) {
    for (const type of REGISTERED_SUBAGENT_TYPES) {
      if (options.definitions[type]?.name !== type) {
        throw new Error(`SubagentDelegateService requires the ${type} definition.`)
      }
    }
    this.createChildRunId = options.createChildRunId ?? (() => `child-${randomUUID()}`)
  }

  get backgroundEnabled(): boolean {
    return Boolean(this.options.backgroundEnabled && this.options.taskService)
  }

  get taskService(): SubagentTaskService | undefined {
    return this.options.taskService
  }

  isEnabled(type: SubagentType, projectId?: string | null): boolean {
    if (type === BLENDER_MODELER_AGENT_TYPE) return true
    if (type === RESEARCH_ANALYST_AGENT_TYPE) return false
    const cadEnabled = isCadSubagentEnabled({
      mode: this.options.cadMode,
      projectId,
      canaryProjectIds: this.options.cadCanaryProjectIds,
    })
    if (type === CAD_DRAFTER_AGENT_TYPE) {
      return isCadDrafterEnabled({
        cadEnabled,
        drafterMode: this.options.cadDrafterMode ?? DEFAULT_CAD_DRAFTER_MODE,
      })
    }
    return cadEnabled
  }

  subscribe(listener: SubagentSnapshotListener): () => void {
    return this.options.coordinator.subscribe(listener)
  }

  cancelByParent(parentSessionId: string, parentPromptId?: string): number {
    this.options.taskService?.suppressByParent(parentSessionId, parentPromptId)
    return this.options.coordinator.cancelByParent(parentSessionId, parentPromptId)
  }

  hasActiveType(parentSessionId: string, type: SubagentType): boolean {
    return this.options.coordinator.hasActiveType(parentSessionId, type)
  }

  async delegate(
    type: SubagentType,
    task: string,
    context: SubagentDelegateExecutionContext,
    signal?: AbortSignal,
  ): Promise<SafeSubagentToolResult | SafeSubagentTaskLaunchResult> {
    if (type === RESEARCH_ANALYST_AGENT_TYPE) {
      throw new SubagentRunError('SUBAGENT_TYPE_RETIRED', 'Research subagent has been removed.')
    }
    if (!this.isEnabled(type, context.projectId)) {
      throw new SubagentRunError('CAD_SUBAGENT_DISABLED', 'CAD subagent is disabled for this project.')
    }

    const definition = this.options.definitions[type]
    const description = DELEGATE_DESCRIPTIONS[type]
    if (!definition || !description) {
      throw new SubagentRunError('SUBAGENT_TYPE_RETIRED', `Subagent type "${type}" is not registered.`)
    }
    const failureKey = this.failureKey(type, context)
    if ((this.terminalFailureCounts.get(failureKey) ?? 0) >= 1) {
      return projectSafeSubagentResult({
        childRunId: this.createChildRunId(),
        type,
        status: 'failed',
        model: definition.model,
        usage: { ...EMPTY_SUBAGENT_USAGE },
        durationMs: 0,
        toolCallCount: 0,
        artifactRefs: [],
        error: {
          code: SUBAGENT_RETRY_REFUSED_ERROR_CODE,
          message: 'A terminal failure already consumed this user task delegation budget.',
          retryable: false,
        },
      })
    }
    const handle = this.options.coordinator.enqueue({
      childRunId: this.createChildRunId(),
      type,
      task,
      description,
      parentSessionId: context.parentSessionId,
      parentPromptId: context.parentPromptId,
      clientRunId: context.clientRunId,
      projectId: context.projectId,
      projectRoot: context.projectRoot,
      model: definition.model,
      thinkingMode: context.thinkingMode,
      spawnDepth: 0,
      signal: this.backgroundEnabled ? undefined : signal,
    })
    const record = (result: unknown): void => this.recordTerminalResult(failureKey, result)
    if (this.backgroundEnabled && this.options.taskService) {
      this.options.taskService.register({
        parentConversationId: context.parentSessionId,
        parentPromptId: context.parentPromptId,
        clientRunId: context.clientRunId,
        handle,
      })
      void handle.result.then(record, record)
      return projectSafeSubagentTaskLaunch(handle.snapshot())
    }
    const result = await handle.result
    record(result)
    return projectSafeSubagentResult(result)
  }

  private failureKey(type: SubagentType, context: SubagentDelegateExecutionContext): string {
    return `${context.parentSessionId}\u0000${context.parentPromptId}\u0000${type}`
  }

  private recordTerminalResult(key: string, value: unknown): void {
    if (!value || typeof value !== 'object') return
    const result = value as Partial<SubagentTerminalResult>
    if (result.status === 'completed') {
      this.terminalFailureCounts.delete(key)
      return
    }
    if (result.status !== 'failed' || !isTerminalSubagentFailureCode(result.error?.code)) return
    this.terminalFailureCounts.set(key, (this.terminalFailureCounts.get(key) ?? 0) + 1)
  }
}
