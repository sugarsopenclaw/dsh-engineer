import type {
  AgentInteractionResolution,
  AgentPendingInteraction,
} from '../../../../src/shared/local-agent'
import { getDB } from '../../db'

export function recordInteractionRequested(interaction: AgentPendingInteraction) {
  getDB().prepare(
    `INSERT INTO agent_interaction_audit (
       id, conversation_id, tool_call_id, tool_name, payload_hash, kind,
       title, risk, details_json, status, action_id, created_at, expires_at, resolved_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?, NULL)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    interaction.id,
    interaction.conversationId,
    interaction.toolCallId,
    interaction.toolName,
    interaction.payloadHash,
    interaction.kind,
    interaction.title,
    interaction.risk,
    JSON.stringify(interaction.details),
    interaction.createdAt,
    interaction.expiresAt,
  )
}

export function recordInteractionResolved(resolution: AgentInteractionResolution) {
  getDB().prepare(
    `UPDATE agent_interaction_audit
        SET status = ?, action_id = ?, resolved_at = ?
      WHERE id = ? AND conversation_id = ?`,
  ).run(
    resolution.status,
    resolution.actionId,
    resolution.resolvedAt,
    resolution.interactionId,
    resolution.conversationId,
  )
}
