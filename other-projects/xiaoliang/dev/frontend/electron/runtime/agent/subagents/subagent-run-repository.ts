import { getDB } from '../../db'
import type {
  StoredSubagentRun,
  SubagentRunMetadataIndex,
} from './subagent-run-store'
function traceRef(metadata: Readonly<StoredSubagentRun>): string {
  const filename = metadata.trace_compressed ? 'trace.jsonl.gz' : 'trace.jsonl'
  return `subagent-runs/${metadata.child_run_id}/${filename}`
}

function upsert(metadata: Readonly<StoredSubagentRun>): void {
  getDB().prepare(
    `INSERT INTO subagent_runs (
       child_run_id, parent_session_id, parent_prompt_id, client_run_id,
       project_id, agent_type, status, model, started_at, finished_at,
       description, task_preview, thinking_mode,
       usage_json, tool_call_count, safe_artifact_refs_json, trace_ref,
       trace_schema_version, trace_event_count, trace_last_sequence,
       trace_sha256, trace_size_bytes, trace_compressed, upload_status,
       remote_storage_key, uploaded_at, upload_error, error_code, error_message,
       orphan_notice_consumed, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(child_run_id) DO UPDATE SET
       parent_session_id = excluded.parent_session_id,
       parent_prompt_id = excluded.parent_prompt_id,
       client_run_id = excluded.client_run_id,
       project_id = excluded.project_id,
       agent_type = excluded.agent_type,
       status = excluded.status,
       model = excluded.model,
       description = excluded.description,
       task_preview = excluded.task_preview,
       thinking_mode = excluded.thinking_mode,
       started_at = excluded.started_at,
       finished_at = excluded.finished_at,
       usage_json = excluded.usage_json,
       tool_call_count = excluded.tool_call_count,
       safe_artifact_refs_json = excluded.safe_artifact_refs_json,
       trace_ref = excluded.trace_ref,
       trace_schema_version = excluded.trace_schema_version,
       trace_event_count = excluded.trace_event_count,
       trace_last_sequence = excluded.trace_last_sequence,
       trace_sha256 = excluded.trace_sha256,
       trace_size_bytes = excluded.trace_size_bytes,
       trace_compressed = excluded.trace_compressed,
       upload_status = excluded.upload_status,
       remote_storage_key = excluded.remote_storage_key,
       uploaded_at = excluded.uploaded_at,
       upload_error = excluded.upload_error,
       error_code = excluded.error_code,
       error_message = excluded.error_message,
       orphan_notice_consumed = excluded.orphan_notice_consumed,
       updated_at = excluded.updated_at`,
  ).run(
    metadata.child_run_id,
    metadata.parent_session_id,
    metadata.parent_prompt_id,
    metadata.client_run_id,
    metadata.project_id,
    metadata.type,
    metadata.status,
    metadata.model,
    metadata.started_at,
    metadata.finished_at,
    metadata.description,
    metadata.task_preview,
    metadata.thinking_mode,
    JSON.stringify(metadata.usage),
    metadata.tool_call_count,
    JSON.stringify(metadata.artifact_refs),
    traceRef(metadata),
    metadata.trace_schema_version,
    metadata.trace_event_count,
    metadata.trace_last_sequence,
    metadata.trace_sha256,
    metadata.trace_size_bytes,
    metadata.trace_compressed ? 1 : 0,
    metadata.upload_status,
    metadata.remote_storage_key,
    metadata.uploaded_at,
    metadata.upload_error,
    metadata.error_code,
    metadata.error_message ?? null,
    metadata.orphan_notice_consumed ? 1 : 0,
  )
}

export function hasPendingRestartedSubagentTaskNotices(parentConversationId: string): boolean {
  const normalizedConversationId = parentConversationId.trim()
  if (!normalizedConversationId) return false
  const pending = getDB().prepare(
    `SELECT 1
       FROM subagent_runs
      WHERE parent_session_id = ?
        AND orphan_notice_consumed = 0
        AND (status = 'running' OR error_code = 'HOST_RESTARTED')
      LIMIT 1`,
  ).get(normalizedConversationId)
  return Boolean(pending)
}

export function createSqliteSubagentRunMetadataIndex(): SubagentRunMetadataIndex {
  return {
    upsert,
    remove(childRunId) {
      getDB().prepare(
        `DELETE FROM subagent_runs WHERE child_run_id = ?`,
      ).run(childRunId)
    },
    replaceAll(metadata) {
      const replace = getDB().transaction((runs: readonly Readonly<StoredSubagentRun>[]) => {
        getDB().prepare(`DELETE FROM subagent_runs`).run()
        for (const run of runs) upsert(run)
      })
      replace(metadata)
    },
  }
}
