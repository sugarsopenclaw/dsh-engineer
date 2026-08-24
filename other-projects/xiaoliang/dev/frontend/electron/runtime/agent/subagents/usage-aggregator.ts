import type { SubagentUsage } from './contracts'
import { normalizeSubagentUsage } from './safe-result-projector'

export type AgentCallPurpose =
  | 'main'
  | 'subagent'
  | 'cad_query'
  | 'visual_index'
  | 'compaction'

export interface UsageContribution {
  clientRunId: string
  contributionId: string
  callPurpose: AgentCallPurpose
  usage: Partial<SubagentUsage>
  childRunId?: string | null
}

export interface UsageBreakdownItem {
  call_purpose: AgentCallPurpose
  child_run_id: string | null
  call_count: number
  usage: SubagentUsage
}

export interface AgentRunUsageSnapshot {
  client_run_id: string
  status: 'active' | 'completed'
  call_count: number
  usage: SubagentUsage
  breakdown: UsageBreakdownItem[]
}

interface StoredContribution extends UsageContribution {
  usage: SubagentUsage
}

interface ActiveUsageRun {
  status: 'active' | 'completed'
  contributions: Map<string, StoredContribution>
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u
const CHILD_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const CALL_PURPOSES = new Set<AgentCallPurpose>([
  'main',
  'subagent',
  'cad_query',
  'visual_index',
  'compaction',
])

function zeroUsage(): SubagentUsage {
  return { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0, cost: 0 }
}

export function addSubagentUsage(left: SubagentUsage, right: SubagentUsage): SubagentUsage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cache_read: left.cache_read + right.cache_read,
    cache_write: left.cache_write + right.cache_write,
    total: left.total + right.total,
    cost: left.cost + right.cost,
  }
}

function contributionFingerprint(value: StoredContribution): string {
  return JSON.stringify({
    clientRunId: value.clientRunId,
    contributionId: value.contributionId,
    callPurpose: value.callPurpose,
    childRunId: value.childRunId ?? null,
    usage: value.usage,
  })
}

export class UsageAggregator {
  private readonly runs = new Map<string, ActiveUsageRun>()
  private readonly onContribution?: (clientRunId: string) => void

  constructor(options?: { onContribution?: (clientRunId: string) => void }) {
    this.onContribution = options?.onContribution
  }

  beginRun(clientRunId: string): void {
    if (!ID_PATTERN.test(clientRunId)) throw new Error('Usage client run id is invalid.')
    const existing = this.runs.get(clientRunId)
    if (existing?.status === 'active') throw new Error(`Usage run "${clientRunId}" is already active.`)
    this.runs.set(clientRunId, { status: 'active', contributions: new Map() })
  }

  record(input: UsageContribution): boolean {
    // Billing may settle even when parent-run aggregation cannot accept the contribution.
    if (this.onContribution) {
      try {
        this.onContribution(input.clientRunId)
      } catch {
        /* observer is best-effort */
      }
    }
    if (!ID_PATTERN.test(input.clientRunId)) throw new Error('Usage client run id is invalid.')
    if (!ID_PATTERN.test(input.contributionId)) throw new Error('Usage contribution id is invalid.')
    if (input.childRunId && !CHILD_RUN_ID_PATTERN.test(input.childRunId)) {
      throw new Error('Usage child run id is invalid.')
    }
    if (!CALL_PURPOSES.has(input.callPurpose)) throw new Error('Usage call purpose is invalid.')
    if (input.callPurpose === 'subagent' && !input.childRunId) {
      throw new Error('Subagent usage contribution requires a child run id.')
    }
    const run = this.runs.get(input.clientRunId)
    if (!run || run.status !== 'active') {
      throw new Error(`Usage run "${input.clientRunId}" is not active.`)
    }

    const normalized: StoredContribution = {
      ...input,
      childRunId: input.childRunId ?? null,
      usage: normalizeSubagentUsage(input.usage),
    }
    const existing = run.contributions.get(input.contributionId)
    if (existing) {
      if (contributionFingerprint(existing) !== contributionFingerprint(normalized)) {
        throw new Error(`Usage contribution "${input.contributionId}" was replayed with different data.`)
      }
      return false
    }
    run.contributions.set(input.contributionId, normalized)
    return true
  }

  snapshot(clientRunId: string): AgentRunUsageSnapshot {
    const run = this.runs.get(clientRunId)
    if (!run) throw new Error(`Usage run "${clientRunId}" does not exist.`)

    let total = zeroUsage()
    const buckets = new Map<string, UsageBreakdownItem>()
    for (const contribution of run.contributions.values()) {
      total = addSubagentUsage(total, contribution.usage)
      const childRunId = contribution.childRunId ?? null
      const key = `${contribution.callPurpose}:${childRunId ?? ''}`
      const current = buckets.get(key) ?? {
        call_purpose: contribution.callPurpose,
        child_run_id: childRunId,
        call_count: 0,
        usage: zeroUsage(),
      }
      current.call_count += 1
      current.usage = addSubagentUsage(current.usage, contribution.usage)
      buckets.set(key, current)
    }

    return {
      client_run_id: clientRunId,
      status: run.status,
      call_count: run.contributions.size,
      usage: total,
      breakdown: [...buckets.values()].sort((left, right) => {
        const purposeOrder = left.call_purpose.localeCompare(right.call_purpose)
        return purposeOrder || (left.child_run_id ?? '').localeCompare(right.child_run_id ?? '')
      }),
    }
  }

  completeRun(clientRunId: string): AgentRunUsageSnapshot {
    const run = this.runs.get(clientRunId)
    if (!run || run.status !== 'active') throw new Error(`Usage run "${clientRunId}" is not active.`)
    run.status = 'completed'
    return this.snapshot(clientRunId)
  }

  deleteRun(clientRunId: string): boolean {
    return this.runs.delete(clientRunId)
  }
}
