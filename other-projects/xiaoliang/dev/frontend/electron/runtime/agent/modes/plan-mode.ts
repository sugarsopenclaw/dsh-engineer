import fs from 'node:fs/promises'
import path from 'node:path'
import type { ConversationAgentMode, PlanPhase } from '../../../../src/shared/local-agent'

export type PlanReminderKind = 'full' | 'sparse' | 'exit'

export interface PlanModeState {
  preferredMode: ConversationAgentMode
  phase: PlanPhase
  reminderCount: number
  awaitingPlanApproval: boolean
  pendingExitReminder: boolean
}

export function normalizeConversationAgentMode(value: unknown): ConversationAgentMode {
  return value === 'plan' ? 'plan' : 'agent'
}

export function normalizePlanPhase(value: unknown): PlanPhase {
  if (value === 'pending' || value === 'active' || value === 'exit_pending') {
    return value
  }
  return 'inactive'
}

export function createInitialPlanState(): PlanModeState {
  return {
    preferredMode: 'agent',
    phase: 'inactive',
    reminderCount: 0,
    awaitingPlanApproval: false,
    pendingExitReminder: false,
  }
}

export function applyPreferredMode(
  state: PlanModeState,
  mode: ConversationAgentMode,
): PlanModeState {
  if (mode === 'plan') {
    if (state.phase === 'active' || state.phase === 'exit_pending') {
      return { ...state, preferredMode: 'plan', phase: 'active' }
    }
    return { ...state, preferredMode: 'plan', phase: 'pending' }
  }

  if (state.phase === 'active' || state.phase === 'exit_pending') {
    // The pill changes the next-turn preference only. The current Plan turn
    // stays active (and write-restricted) until it settles or is approved.
    return { ...state, preferredMode: 'agent', phase: 'active' }
  }
  return {
    ...state,
    preferredMode: 'agent',
    phase: 'inactive',
  }
}

export function applyPromptStart(state: PlanModeState): PlanModeState {
  if (state.preferredMode === 'plan' && (state.phase === 'inactive' || state.phase === 'pending')) {
    return {
      ...state,
      phase: 'active',
      reminderCount: 0,
      pendingExitReminder: false,
    }
  }
  if (state.phase === 'active') {
    return {
      ...state,
      reminderCount: state.reminderCount + 1,
      pendingExitReminder: false,
    }
  }
  if (state.pendingExitReminder) {
    return { ...state, pendingExitReminder: false }
  }
  return state
}

export function applyTurnEnd(state: PlanModeState): PlanModeState {
  if (
    state.phase === 'exit_pending'
    || (state.phase === 'active' && state.preferredMode === 'agent')
  ) {
    return {
      ...state,
      preferredMode: 'agent',
      phase: 'inactive',
      reminderCount: 0,
      awaitingPlanApproval: false,
      // A preference-only exit is not an approved plan. Only
      // applyPlanApproved may schedule the implementation reminder.
      pendingExitReminder: false,
    }
  }
  return state
}

export function applyPlanApproved(state: PlanModeState): PlanModeState {
  return {
    ...state,
    preferredMode: 'agent',
    phase: 'inactive',
    reminderCount: 0,
    awaitingPlanApproval: false,
    pendingExitReminder: true,
  }
}

export function applyPlanRevised(state: PlanModeState): PlanModeState {
  return {
    ...state,
    preferredMode: 'plan',
    phase: 'active',
    awaitingPlanApproval: false,
  }
}

export function applyPlanAbandoned(state: PlanModeState): PlanModeState {
  return {
    ...state,
    preferredMode: 'agent',
    phase: 'inactive',
    reminderCount: 0,
    awaitingPlanApproval: false,
    pendingExitReminder: false,
  }
}

export function setAwaitingPlanApproval(
  state: PlanModeState,
  awaiting: boolean,
): PlanModeState {
  return { ...state, awaitingPlanApproval: awaiting }
}

/** 进程重启时折叠未落地的过渡态；active 与审批挂起保留。 */
export function foldOnRestart(state: PlanModeState): PlanModeState {
  if (state.phase === 'pending') {
    return { ...state, phase: 'inactive' }
  }
  if (
    state.phase === 'exit_pending'
    || (state.phase === 'active' && state.preferredMode === 'agent')
  ) {
    return {
      ...state,
      preferredMode: 'agent',
      phase: 'inactive',
      reminderCount: 0,
      awaitingPlanApproval: false,
      pendingExitReminder: false,
    }
  }
  return state
}

export function nextReminderKind(state: PlanModeState): PlanReminderKind | null {
  if (state.phase === 'active') {
    return state.reminderCount % 2 === 0 ? 'full' : 'sparse'
  }
  if (state.pendingExitReminder && state.phase === 'inactive') {
    return 'exit'
  }
  return null
}

export function isPlanWriteRestricted(state: PlanModeState): boolean {
  // exit_pending may still exist in rows written by older builds. Keep it
  // restricted so a restart/deploy cannot turn that legacy transition into a
  // write-gate bypass.
  return state.phase === 'active' || state.phase === 'exit_pending'
}

export function resolvePlanDocumentPath(cwd: string, conversationId: string): string {
  return path.join(cwd, '.xiaoliang', 'plans', conversationId, 'plan.md')
}

export async function ensurePlanDocument(planFilePath: string): Promise<void> {
  await fs.mkdir(path.dirname(planFilePath), { recursive: true })
  try {
    await fs.access(planFilePath)
  } catch {
    await fs.writeFile(planFilePath, '', 'utf8')
  }
}

export async function readPlanDocument(planFilePath: string): Promise<string> {
  try {
    return await fs.readFile(planFilePath, 'utf8')
  } catch {
    return ''
  }
}
