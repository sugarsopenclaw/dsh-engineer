import { getDB } from '../../db'
import {
  applyPlanAbandoned,
  applyPlanApproved,
  applyPlanRevised,
  applyPreferredMode,
  applyPromptStart,
  applyTurnEnd,
  createInitialPlanState,
  foldOnRestart,
  normalizeConversationAgentMode,
  normalizePlanPhase,
  setAwaitingPlanApproval,
  type PlanModeState,
} from './plan-mode'
import type { ConversationAgentMode } from '../../../../src/shared/local-agent'

interface PlanModeRow {
  conversation_id: string
  preferred_mode: string
  phase: string
  reminder_count: number
  awaiting_plan_approval: number
  pending_exit_reminder: number
}

function rowToState(row: PlanModeRow): PlanModeState {
  return {
    preferredMode: normalizeConversationAgentMode(row.preferred_mode),
    phase: normalizePlanPhase(row.phase),
    reminderCount: Number(row.reminder_count) || 0,
    awaitingPlanApproval: row.awaiting_plan_approval === 1,
    pendingExitReminder: row.pending_exit_reminder === 1,
  }
}

export function loadPlanModeState(conversationId: string): PlanModeState {
  const row = getDB()
    .prepare(
      `SELECT conversation_id, preferred_mode, phase, reminder_count,
              awaiting_plan_approval, pending_exit_reminder
         FROM conversation_plan_mode
        WHERE conversation_id = ?`,
    )
    .get(conversationId) as PlanModeRow | undefined
  return row ? rowToState(row) : createInitialPlanState()
}

export function persistPlanModeState(conversationId: string, state: PlanModeState) {
  getDB()
    .prepare(
      `INSERT INTO conversation_plan_mode (
         conversation_id, preferred_mode, phase, reminder_count,
         awaiting_plan_approval, pending_exit_reminder, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(conversation_id) DO UPDATE SET
         preferred_mode = excluded.preferred_mode,
         phase = excluded.phase,
         reminder_count = excluded.reminder_count,
         awaiting_plan_approval = excluded.awaiting_plan_approval,
         pending_exit_reminder = excluded.pending_exit_reminder,
         updated_at = excluded.updated_at`,
    )
    .run(
      conversationId,
      state.preferredMode,
      state.phase,
      state.reminderCount,
      state.awaitingPlanApproval ? 1 : 0,
      state.pendingExitReminder ? 1 : 0,
    )
}

function mutate(
  conversationId: string,
  next: (state: PlanModeState) => PlanModeState,
): PlanModeState {
  const state = next(loadPlanModeState(conversationId))
  persistPlanModeState(conversationId, state)
  return state
}

export function setConversationAgentMode(
  conversationId: string,
  mode: ConversationAgentMode,
): PlanModeState {
  return mutate(conversationId, (state) => applyPreferredMode(state, mode))
}

export function markPlanPromptStart(conversationId: string): PlanModeState {
  return mutate(conversationId, applyPromptStart)
}

export function markPlanTurnEnd(conversationId: string): PlanModeState {
  return mutate(conversationId, applyTurnEnd)
}

export function markPlanApproved(conversationId: string): PlanModeState {
  return mutate(conversationId, applyPlanApproved)
}

export function markPlanRevised(conversationId: string): PlanModeState {
  return mutate(conversationId, applyPlanRevised)
}

export function markPlanAbandoned(conversationId: string): PlanModeState {
  return mutate(conversationId, applyPlanAbandoned)
}

export function markAwaitingPlanApproval(
  conversationId: string,
  awaiting: boolean,
): PlanModeState {
  return mutate(conversationId, (state) => setAwaitingPlanApproval(state, awaiting))
}

export function foldAllPlanModesOnRestart(): number {
  const rows = getDB()
    .prepare(
      `SELECT conversation_id, preferred_mode, phase, reminder_count,
              awaiting_plan_approval, pending_exit_reminder
         FROM conversation_plan_mode`,
    )
    .all() as PlanModeRow[]

  let folded = 0
  for (const row of rows) {
    const current = rowToState(row)
    const next = foldOnRestart(current)
    if (
      next.phase !== current.phase
      || next.preferredMode !== current.preferredMode
      || next.pendingExitReminder !== current.pendingExitReminder
    ) {
      persistPlanModeState(row.conversation_id, next)
      folded += 1
    }
  }
  return folded
}

export function listAwaitingPlanApprovalConversationIds(): string[] {
  return (
    getDB()
      .prepare(
        `SELECT conversation_id
           FROM conversation_plan_mode
          WHERE awaiting_plan_approval = 1`,
      )
      .all() as Array<{ conversation_id: string }>
  ).map((row) => row.conversation_id)
}
