import fs from 'node:fs'
import { getDB } from '../db'

interface PiSessionArchiveGenerationRow {
  archive_generation: number
}

interface UploadedPiSessionArchiveRow {
  conversation_id: string
  pi_session_file: string
  archive_size_bytes: number
  archive_source_modified_at: string | null
}

export interface PiSessionArchiveSnapshotIdentity {
  sha256: string
  sizeBytes: number
  sourceModifiedAt: string
}

export function resetPiSessionArchiveState(conversationId: string): boolean {
  const result = getDB().prepare(
    `UPDATE conversation_session_bindings
        SET archive_generation = archive_generation + 1,
            archive_sha256 = NULL,
            archive_size_bytes = 0,
            archive_source_modified_at = NULL,
            upload_status = 'pending',
            remote_storage_key = NULL,
            uploaded_at = NULL,
            upload_error = NULL,
            updated_at = datetime('now','localtime')
      WHERE conversation_id = ?`,
  ).run(conversationId)
  return result.changes > 0
}

export function getPiSessionArchiveGeneration(conversationId: string): number | null {
  const row = getDB().prepare(
    `SELECT archive_generation
       FROM conversation_session_bindings
      WHERE conversation_id = ?`,
  ).get(conversationId) as PiSessionArchiveGenerationRow | undefined
  return row?.archive_generation ?? null
}

export function beginPiSessionArchiveAttempt(input: {
  conversationId: string
  generation: number
  snapshot: PiSessionArchiveSnapshotIdentity
}): boolean {
  const result = getDB().prepare(
    `UPDATE conversation_session_bindings
        SET archive_sha256 = ?,
            archive_size_bytes = ?,
            archive_source_modified_at = ?,
            upload_status = 'pending',
            remote_storage_key = NULL,
            uploaded_at = NULL,
            upload_error = NULL,
            updated_at = datetime('now','localtime')
      WHERE conversation_id = ?
        AND archive_generation = ?`,
  ).run(
    input.snapshot.sha256,
    input.snapshot.sizeBytes,
    input.snapshot.sourceModifiedAt,
    input.conversationId,
    input.generation,
  )
  return result.changes > 0
}

export function markPiSessionArchiveUploaded(input: {
  conversationId: string
  generation: number
  sha256: string
  storageKey: string
}): boolean {
  const result = getDB().prepare(
    `UPDATE conversation_session_bindings
        SET upload_status = 'uploaded',
            remote_storage_key = ?,
            uploaded_at = datetime('now','localtime'),
            upload_error = NULL,
            updated_at = datetime('now','localtime')
      WHERE conversation_id = ?
        AND archive_generation = ?
        AND archive_sha256 = ?`,
  ).run(
    input.storageKey,
    input.conversationId,
    input.generation,
    input.sha256,
  )
  return result.changes > 0
}

export function markPiSessionArchiveFailed(input: {
  conversationId: string
  generation: number
  sha256?: string
  error: unknown
}): boolean {
  const message = (input.error instanceof Error ? input.error.message : String(input.error))
    .trim()
    .slice(0, 4_000) || 'Pi Session 归档失败。'
  const result = getDB().prepare(
    `UPDATE conversation_session_bindings
        SET upload_status = 'failed',
            upload_error = ?,
            updated_at = datetime('now','localtime')
      WHERE conversation_id = ?
        AND archive_generation = ?
        AND (? IS NULL OR archive_sha256 = ?)`,
  ).run(
    message,
    input.conversationId,
    input.generation,
    input.sha256 ?? null,
    input.sha256 ?? null,
  )
  return result.changes > 0
}

export async function reconcileChangedPiSessionArchives(): Promise<void> {
  const db = getDB()
  const uploaded = db.prepare(
    `SELECT conversation_id, pi_session_file, archive_size_bytes,
            archive_source_modified_at
       FROM conversation_session_bindings
      WHERE migration_status = 'ready'
        AND upload_status = 'uploaded'`,
  ).all() as UploadedPiSessionArchiveRow[]
  const changedConversationIds = (await Promise.all(uploaded.map(async (row) => {
    try {
      const stat = await fs.promises.stat(row.pi_session_file)
      return (
        stat.isFile()
        && stat.size === row.archive_size_bytes
        && stat.mtime.toISOString() === row.archive_source_modified_at
      ) ? null : row.conversation_id
    } catch {
      return row.conversation_id
    }
  }))).filter((conversationId): conversationId is string => Boolean(conversationId))

  const markPending = db.prepare(
    `UPDATE conversation_session_bindings
        SET archive_generation = archive_generation + 1,
            archive_sha256 = NULL,
            archive_size_bytes = 0,
            archive_source_modified_at = NULL,
            upload_status = 'pending',
            remote_storage_key = NULL,
            uploaded_at = NULL,
            upload_error = NULL,
            updated_at = datetime('now','localtime')
      WHERE conversation_id = ?
        AND upload_status = 'uploaded'`,
  )
  db.transaction(() => {
    for (const conversationId of changedConversationIds) markPending.run(conversationId)
  })()
}

export function listRetryablePiSessionArchiveConversationIds(): string[] {
  return (getDB().prepare(
    `SELECT binding.conversation_id
       FROM conversation_session_bindings binding
       JOIN conversations conversation ON conversation.id = binding.conversation_id
       JOIN projects project ON project.id = conversation.project_id
      WHERE binding.migration_status = 'ready'
        AND binding.upload_status IN ('pending', 'failed')
        AND trim(conversation.project_id) <> ''
      ORDER BY datetime(binding.updated_at) ASC, binding.rowid ASC`,
  ).all() as Array<{ conversation_id: string }>).map((row) => row.conversation_id)
}
