import type { AgentPendingInteraction } from '../../../../src/shared/local-agent'
import { getDB } from '../../db'

export interface StoredPendingInteraction {
  conversationId: string
  interaction: AgentPendingInteraction
  responseToken: string
  allowedActions: string[]
}

export interface PersistentInteractionStore {
  upsert(record: StoredPendingInteraction): void
  remove(conversationId: string): void
  list(): StoredPendingInteraction[]
  get(conversationId: string): StoredPendingInteraction | null
}

interface PendingRow {
  conversation_id: string
  interaction_json: string
  response_token: string
  allowed_actions_json: string
}

function parseRow(row: PendingRow): StoredPendingInteraction | null {
  try {
    const interaction = JSON.parse(row.interaction_json) as AgentPendingInteraction
    const allowedActions = JSON.parse(row.allowed_actions_json) as unknown
    if (!interaction?.id || !Array.isArray(allowedActions)) return null
    return {
      conversationId: row.conversation_id,
      interaction,
      responseToken: row.response_token,
      allowedActions: allowedActions.filter((item): item is string => typeof item === 'string'),
    }
  } catch {
    return null
  }
}

export function createSqlitePersistentInteractionStore(): PersistentInteractionStore {
  return {
    upsert(record) {
      getDB()
        .prepare(
          `INSERT INTO conversation_pending_interactions (
             conversation_id, interaction_json, response_token, allowed_actions_json,
             persistence, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'persistent', datetime('now','localtime'), datetime('now','localtime'))
           ON CONFLICT(conversation_id) DO UPDATE SET
             interaction_json = excluded.interaction_json,
             response_token = excluded.response_token,
             allowed_actions_json = excluded.allowed_actions_json,
             persistence = 'persistent',
             updated_at = excluded.updated_at`,
        )
        .run(
          record.conversationId,
          JSON.stringify(record.interaction),
          record.responseToken,
          JSON.stringify(record.allowedActions),
        )
    },
    remove(conversationId) {
      getDB()
        .prepare('DELETE FROM conversation_pending_interactions WHERE conversation_id = ?')
        .run(conversationId)
    },
    list() {
      return (
        getDB()
          .prepare(
            `SELECT conversation_id, interaction_json, response_token, allowed_actions_json
               FROM conversation_pending_interactions`,
          )
          .all() as PendingRow[]
      ).flatMap((row) => {
        const parsed = parseRow(row)
        return parsed ? [parsed] : []
      })
    },
    get(conversationId) {
      const row = getDB()
        .prepare(
          `SELECT conversation_id, interaction_json, response_token, allowed_actions_json
             FROM conversation_pending_interactions
            WHERE conversation_id = ?`,
        )
        .get(conversationId) as PendingRow | undefined
      return row ? parseRow(row) : null
    },
  }
}

export function createMemoryPersistentInteractionStore(
  seed: StoredPendingInteraction[] = [],
): PersistentInteractionStore {
  const records = new Map(seed.map((item) => [item.conversationId, item]))
  return {
    upsert(record) {
      records.set(record.conversationId, record)
    },
    remove(conversationId) {
      records.delete(conversationId)
    },
    list() {
      return [...records.values()]
    },
    get(conversationId) {
      return records.get(conversationId) ?? null
    },
  }
}
