import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import { createHash } from 'node:crypto'

import {
  AgentDefinitionRegistry,
  type AgentDefinition,
} from './agent-definition-registry'
import {
  SubagentDelegateService,
  type SubagentDelegateExecutionContext,
} from './subagent-delegate'
import {
  BLENDER_MODELER_AGENT_TYPE,
  CAD_ANALYST_AGENT_TYPE,
  CAD_DRAFTER_AGENT_TYPE,
  type SubagentRequest,
  type SubagentType,
  type SubagentUsage,
} from './contracts'
import { EvidencePackWriter } from './evidence-pack-writer'
import {
  getCadDrafterMaxConcurrent,
  getCadDrafterMode,
  getCadSubagentMode,
  getSubagentBackgroundMode,
  getSubagentInteractiveMode,
  type CadDrafterMode,
  type CadSubagentMode,
  type SubagentBackgroundMode,
  type SubagentInteractiveMode,
} from './feature-flags'
import {
  FreshPiSubagentRunner,
  type PiSubagentAgentFactory,
  type SubagentToolFactoryResult,
} from './fresh-pi-subagent-runner'
import {
  DEFAULT_SUBAGENT_TYPE_POLICIES,
  SubagentCoordinator,
} from './subagent-coordinator'
import {
  SubagentRunStore,
  type SubagentRunMetadataIndex,
} from './subagent-run-store'
import { addSubagentUsage, UsageAggregator } from './usage-aggregator'
import { normalizeSubagentUsage } from './safe-result-projector'
import {
  type ProjectScopedCadHttpRuntime,
} from '../../cad/drivers/autocad-http/cad-http-runtime'
import {
  createDesktopMLightCadExtractionService,
  type MLightCadEngine,
} from '../../cad/mlight/mlight-extraction-service'
import { buildCadDrafterTools } from '../tools/domain/cad-drafter'
import { buildCadSubagentTools } from '../tools/domain/cad-subagent'
import { buildBlenderSubagentTools } from '../tools/domain/blender-mcp'
import { buildSubagentDelegateTools } from '../tools/domain/delegate'
import { blenderMcpClientManager } from '../mcp/blender-mcp-service'
import {
  SubagentTaskService,
  type SubagentTaskDeliveryCallbacks,
} from '../tasks/background/subagent-task-service'

const MAX_CAD_QUERY_CALLS_PER_CHILD = 3

export function cadQueryCallBudget(_task: string): number {
  // This is a safety ceiling, not a task-planning target. The CAD analyst prompt
  // decides whether another query is warranted from the remaining evidence gap.
  return MAX_CAD_QUERY_CALLS_PER_CHILD
}

export interface CreateSubagentRuntimeOptions {
  definitionsDir: string
  runStoreRoot: string
  runMetadataIndex?: SubagentRunMetadataIndex
  createTools?: (
    request: Readonly<SubagentRequest>,
    definition: Readonly<AgentDefinition>,
  ) => Promise<SubagentToolFactoryResult> | SubagentToolFactoryResult
  cadHttpRuntime?: ProjectScopedCadHttpRuntime
  mlightEngine?: MLightCadEngine
  resolveApiKey: (request: Readonly<SubagentRequest>) => Promise<string> | string
  mode?: CadSubagentMode
  drafterMode?: CadDrafterMode
  /** Overrides the window-budget-derived drafter parallelism; for tests and diagnostics. */
  drafterMaxConcurrent?: number
  backgroundMode?: SubagentBackgroundMode
  interactiveMode?: SubagentInteractiveMode
  backgroundTaskDelivery?: SubagentTaskDeliveryCallbacks
  canaryProjectIds?: ReadonlySet<string>
  usageAggregator?: UsageAggregator
  /** Fires on every usage contribution, including ones that fail to aggregate. */
  onUsageRecorded?: (clientRunId: string) => void
  createModel?: (request: Readonly<SubagentRequest>) => Model<any>
  createAgent?: PiSubagentAgentFactory
  createChildRunId?: () => string
  now?: () => number
}

export interface SubagentRuntime {
  definitions: AgentDefinitionRegistry
  runStore: SubagentRunStore
  usageAggregator: UsageAggregator
  coordinator: SubagentCoordinator
  delegateService: SubagentDelegateService
  taskService: SubagentTaskService | null
  buildDelegateTools(input: {
    projectId?: string | null
    cadContextAvailable: boolean
    resolveContext: (type: SubagentType) => SubagentDelegateExecutionContext
    resolveCadSessionContext?: () => Promise<string | null> | string | null
    resolveParentConversationId?: () => string
    observeParentUserMessage?: (signal: AbortSignal) => Promise<void>
    interactiveDelegation?: boolean
  }): AgentTool<any>[]
  dispose(): Promise<void>
}

export async function createSubagentRuntime(
  options: CreateSubagentRuntimeOptions,
): Promise<SubagentRuntime> {
  const definitions = new AgentDefinitionRegistry({ definitionsDir: options.definitionsDir })
  const definitionByType: Partial<Record<SubagentType, AgentDefinition>> = {
    [CAD_ANALYST_AGENT_TYPE]: definitions.load(CAD_ANALYST_AGENT_TYPE),
    [CAD_DRAFTER_AGENT_TYPE]: definitions.load(CAD_DRAFTER_AGENT_TYPE),
    [BLENDER_MODELER_AGENT_TYPE]: definitions.load(BLENDER_MODELER_AGENT_TYPE),
  }
  const runStore = new SubagentRunStore({
    rootDir: options.runStoreRoot,
    ...(options.now ? { now: options.now } : {}),
    ...(options.runMetadataIndex ? { metadataIndex: options.runMetadataIndex } : {}),
  })
  await runStore.initialize()
  const usageAggregator = options.usageAggregator
    ?? new UsageAggregator(
      options.onUsageRecorded ? { onContribution: options.onUsageRecorded } : undefined,
    )
  const evidenceWriter = new EvidencePackWriter()
  let ownedMLightEngine: MLightCadEngine | undefined
  let createTools = options.createTools
  if (!createTools) {
    const cadHttpRuntime = options.cadHttpRuntime
    if (!cadHttpRuntime) {
      throw new Error('CAD subagent runtime requires the host-owned CAD HTTP runtime.')
    }
    const mlightEngine = options.mlightEngine ?? createDesktopMLightCadExtractionService()
    if (!options.mlightEngine) ownedMLightEngine = mlightEngine
    // Both CAD children bill their helper model calls the same way, so the budget and the
    // usage ledger live here rather than being re-derived per agent type.
    const createAuxiliarySupport = (request: Readonly<SubagentRequest>, apiKey: string) => {
      let auxiliaryUsage: SubagentUsage = {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
        total: 0,
        cost: 0,
      }
      let visualCallCount = 0
      let queryCallCount = 0
      let queryAttemptCount = 0
      const maximumQueryAttempts = cadQueryCallBudget(request.task)
      const recordAuxiliaryUsage = (
        callPurpose: 'visual_index' | 'cad_query',
        contributionPrefix: 'visual-call' | 'cad-query-call',
        callCount: number,
        rawUsage: SubagentUsage,
      ): void => {
        const usage = normalizeSubagentUsage(rawUsage)
        auxiliaryUsage = addSubagentUsage(auxiliaryUsage, usage)
        const digest = createHash('sha256')
          .update(`${request.childRunId}:${callPurpose}:${callCount}`, 'utf8')
          .digest('hex')
          .slice(0, 24)
        try {
          usageAggregator.record({
            clientRunId: request.clientRunId,
            contributionId: `${contributionPrefix}-${digest}`,
            callPurpose,
            childRunId: request.childRunId,
            usage,
          })
        } catch {
          // The child result still includes this usage when no parent aggregation run is active.
        }
      }
      return {
        getUsage: () => auxiliaryUsage,
        cadQuery: {
          apiKey,
          clientRunId: request.clientRunId,
          childRunId: request.childRunId,
          authorizeCall: () => {
            queryAttemptCount += 1
            if (queryAttemptCount > maximumQueryAttempts) {
              throw new Error(
                `cad_query call budget exhausted (${maximumQueryAttempts}); use cad_search and prior local evidence.`,
              )
            }
          },
          recordUsage: (_localCallIndex: number, rawUsage: SubagentUsage) => {
            queryCallCount += 1
            recordAuxiliaryUsage('cad_query', 'cad-query-call', queryCallCount, rawUsage)
          },
        },
        visualIndex: {
          apiKey,
          clientRunId: request.clientRunId,
          childRunId: request.childRunId,
          recordUsage: (_localCallIndex: number, rawUsage: SubagentUsage) => {
            visualCallCount += 1
            recordAuxiliaryUsage('visual_index', 'visual-call', visualCallCount, rawUsage)
          },
        },
      }
    }
    createTools = async (request) => {
      if (request.type === BLENDER_MODELER_AGENT_TYPE) {
        return buildBlenderSubagentTools()
      }
      const apiKey = await options.resolveApiKey(request)
      const support = createAuxiliarySupport(request, apiKey)
      // The drafter reaches drawings through the session pool, so it takes no AutoCAD
      // lease and stays runnable while the analyst holds the COM apartment.
      if (request.type === CAD_DRAFTER_AGENT_TYPE) {
        return {
          tools: buildCadDrafterTools({
            projectRoot: request.projectRoot,
            childRunId: request.childRunId,
            engine: mlightEngine,
            cadQuery: support.cadQuery,
          }),
          getUsage: support.getUsage,
          // The session pool outlives the child and is owned by the runtime, so unlike
          // the analyst's AutoCAD lease there is nothing to hand back here.
          dispose() {},
        }
      }
      const lease = await cadHttpRuntime.acquire(request.projectRoot, {
        kind: 'xiaoliang-cad-subagent',
        childRunId: request.childRunId,
        agentRole: 'cad-analyst',
      })
      try {
        return {
          tools: buildCadSubagentTools({
            projectRoot: lease.projectRoot,
            facade: lease.facade,
            mlightExtractor: mlightEngine,
            cadQuery: support.cadQuery,
            visualIndex: support.visualIndex,
            clientRunId: request.clientRunId,
            childRunId: request.childRunId,
            capabilities: lease.capabilities,
            diagnose: lease.diagnose,
          }),
          getUsage: support.getUsage,
          dispose: () => lease.release(),
        }
      } catch (error) {
        await lease.release().catch(() => undefined)
        throw error
      }
    }
  }
  const runner = new FreshPiSubagentRunner({
    definitions,
    evidenceWriter,
    runStore,
    createTools,
    resolveApiKey: options.resolveApiKey,
    usageAggregator,
    ...(options.createModel ? { createModel: options.createModel } : {}),
    ...(options.createAgent ? { createAgent: options.createAgent } : {}),
    ...(options.now ? { now: options.now } : {}),
  })
  const defaultDrafterPolicy = DEFAULT_SUBAGENT_TYPE_POLICIES[CAD_DRAFTER_AGENT_TYPE]
  if (!defaultDrafterPolicy) throw new Error('CAD drafter policy is not configured.')
  const coordinator = new SubagentCoordinator({
    runner,
    // Drafter parallelism is bounded by the MLightCAD window budget, which is configurable
    // per machine, so the policy is resolved here rather than fixed in the coordinator.
    policies: {
      ...DEFAULT_SUBAGENT_TYPE_POLICIES,
      [CAD_DRAFTER_AGENT_TYPE]: {
        ...defaultDrafterPolicy,
        maxConcurrent: options.drafterMaxConcurrent ?? getCadDrafterMaxConcurrent(),
      },
    },
    ...(options.now ? { now: options.now } : {}),
  })
  const backgroundEnabled = (options.backgroundMode ?? getSubagentBackgroundMode()) === 'on'
  const interactiveEnabled = backgroundEnabled
    && (options.interactiveMode ?? getSubagentInteractiveMode()) === 'on'
  const taskService = backgroundEnabled && options.backgroundTaskDelivery
    ? new SubagentTaskService({
        delivery: options.backgroundTaskDelivery,
        runStore,
        ...(interactiveEnabled ? {} : { wakeGraceMs: 0 }),
      })
    : null
  if (taskService) {
    await taskService.restoreRestartedTasks(await runStore.listMetadata())
  }
  const delegateService = new SubagentDelegateService({
    coordinator,
    definitions: definitionByType,
    cadMode: options.mode ?? getCadSubagentMode(),
    cadDrafterMode: options.drafterMode ?? getCadDrafterMode(),
    cadCanaryProjectIds: options.canaryProjectIds,
    createChildRunId: options.createChildRunId,
    taskService: taskService ?? undefined,
    backgroundEnabled,
  })

  return {
    definitions,
    runStore,
    usageAggregator,
    coordinator,
    delegateService,
    taskService,
    buildDelegateTools: ({
      projectId,
      cadContextAvailable,
      resolveContext,
      resolveCadSessionContext,
      resolveParentConversationId,
      observeParentUserMessage,
      interactiveDelegation,
    }) => buildSubagentDelegateTools({
      service: delegateService,
      projectId,
      cadContextAvailable,
      resolveContext,
      resolveCadSessionContext,
      taskService: taskService ?? undefined,
      resolveParentConversationId,
      observeParentUserMessage,
      interactiveDelegation: interactiveDelegation ?? interactiveEnabled,
    }),
    dispose: async () => {
      taskService?.dispose()
      const disposed = await Promise.allSettled([
        ...(ownedMLightEngine ? [ownedMLightEngine.dispose()] : []),
        blenderMcpClientManager.close(),
      ])
      const failure = disposed.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
    },
  }
}
