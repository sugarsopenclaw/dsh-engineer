import { getDB } from '../../db'
import type { CadArtifactInventory } from '../../agent/tools/domain/cad-subagent/artifact-store'

export type CadArtifactSetKind = 'entities' | 'visual' | 'unknown' | 'legacy'

export interface CadArtifactSetRecord {
  projectId: string
  drawingRelpath: string
  kind: CadArtifactSetKind
  storageScope: 'project' | 'userdata_legacy'
  artifactKey: string
  legacyDrawingId: string | null
  manifestRelpath: string
  sourceSha256: string
  producerFingerprint: string
  status: string
  reason: string
  generatedAt: string | null
  verifiedAt: string | null
  updatedAt: string
}

interface CadArtifactSetRow {
  project_id: string
  drawing_relpath: string
  kind: CadArtifactSetKind
  storage_scope: 'project' | 'userdata_legacy'
  artifact_key: string
  legacy_drawing_id: string | null
  manifest_relpath: string
  source_sha256: string
  producer_fingerprint: string
  status: string
  reason: string
  generated_at: string | null
  verified_at: string | null
  updated_at: string
}

interface ArtifactSetDraft {
  drawingRelpath: string
  kind: CadArtifactSetKind
  artifactKey: string
  manifestRelpath: string
  sourceSha256: string
  producerFingerprint: string
  status: string
  reason: string
  generatedAt: string | null
}

function bounded(value: string | null | undefined, maximum: number): string {
  return (value || '').trim().slice(0, maximum)
}

function validTimestamp(value: string | null | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function inventoryDrafts(inventory: CadArtifactInventory): ArtifactSetDraft[] {
  const manifestRelpath = bounded(inventory.manifest_path, 4_096)
  const sourceSha256 = bounded(inventory.source_sha256, 64)
  if (!inventory.drawing) {
    return [{
      drawingRelpath: `.untracked/${bounded(inventory.artifact_key, 512)}`,
      kind: 'unknown',
      artifactKey: bounded(inventory.artifact_key, 512),
      manifestRelpath,
      sourceSha256,
      producerFingerprint: '',
      status: inventory.entities_status === 'untracked' ? inventory.visual_status : inventory.entities_status,
      reason: bounded(`${inventory.reason} ${inventory.visual_reason}`, 4_000),
      generatedAt: null,
    }]
  }
  return [
    {
      drawingRelpath: bounded(inventory.drawing.project_relative_path, 4_096),
      kind: 'entities',
      artifactKey: bounded(inventory.artifact_key, 512),
      manifestRelpath,
      sourceSha256,
      producerFingerprint: bounded(inventory.entities_producer_fingerprint, 128),
      status: inventory.entities_status,
      reason: bounded(inventory.reason, 4_000),
      generatedAt: validTimestamp(inventory.entities_generated_at),
    },
    {
      drawingRelpath: bounded(inventory.drawing.project_relative_path, 4_096),
      kind: 'visual',
      artifactKey: bounded(inventory.artifact_key, 512),
      manifestRelpath,
      sourceSha256,
      producerFingerprint: bounded(inventory.visual_producer_fingerprint, 128),
      status: inventory.visual_status,
      reason: bounded(inventory.visual_reason, 4_000),
      generatedAt: validTimestamp(inventory.visual_generated_at),
    },
  ]
}

export function reconcileCadArtifactSetReferences(input: {
  projectId: string
  inventories: readonly CadArtifactInventory[]
  truncated: boolean
  verifiedAt?: string
}): number {
  const projectId = input.projectId.trim()
  if (!projectId) throw new Error('CAD artifact reconciliation requires a project id.')
  const verifiedAt = validTimestamp(input.verifiedAt) ?? new Date().toISOString()
  const drafts = input.inventories.flatMap(inventoryDrafts)
  const db = getDB()
  const upsert = db.prepare(
    `INSERT INTO cad_artifact_sets (
       project_id, drawing_relpath, kind, storage_scope, artifact_key,
       legacy_drawing_id, manifest_relpath, source_sha256, producer_fingerprint,
       status, reason, summary_json, generated_at, verified_at, updated_at
     ) VALUES (?, ?, ?, 'project', ?, NULL, ?, ?, ?, ?, ?, '{}', ?, ?, datetime('now','localtime'))
     ON CONFLICT(project_id, drawing_relpath, kind) DO UPDATE SET
       storage_scope = 'project',
       artifact_key = excluded.artifact_key,
       legacy_drawing_id = NULL,
       manifest_relpath = excluded.manifest_relpath,
       source_sha256 = excluded.source_sha256,
       producer_fingerprint = excluded.producer_fingerprint,
       status = excluded.status,
       reason = excluded.reason,
       summary_json = excluded.summary_json,
       generated_at = excluded.generated_at,
       verified_at = excluded.verified_at,
       updated_at = excluded.updated_at`,
  )
  const reconcile = db.transaction(() => {
    if (!input.truncated) {
      db.prepare(
        `DELETE FROM cad_artifact_sets WHERE project_id = ? AND storage_scope = 'project'`,
      ).run(projectId)
    }
    for (const draft of drafts) {
      if (!draft.drawingRelpath || !draft.artifactKey) continue
      upsert.run(
        projectId,
        draft.drawingRelpath,
        draft.kind,
        draft.artifactKey,
        draft.manifestRelpath,
        draft.sourceSha256,
        draft.producerFingerprint,
        draft.status,
        draft.reason,
        draft.generatedAt,
        verifiedAt,
      )
    }
  })
  reconcile()
  return drafts.length
}

export function listCadArtifactSetRecords(projectId: string): CadArtifactSetRecord[] {
  const rows = getDB().prepare(
    `SELECT project_id, drawing_relpath, kind, storage_scope, artifact_key,
            legacy_drawing_id, manifest_relpath, source_sha256, producer_fingerprint,
            status, reason, generated_at, verified_at, updated_at
       FROM cad_artifact_sets
      WHERE project_id = ?
      ORDER BY storage_scope, drawing_relpath, kind`,
  ).all(projectId.trim()) as CadArtifactSetRow[]
  return rows.map((row) => ({
    projectId: row.project_id,
    drawingRelpath: row.drawing_relpath,
    kind: row.kind,
    storageScope: row.storage_scope,
    artifactKey: row.artifact_key,
    legacyDrawingId: row.legacy_drawing_id,
    manifestRelpath: row.manifest_relpath,
    sourceSha256: row.source_sha256,
    producerFingerprint: row.producer_fingerprint,
    status: row.status,
    reason: row.reason,
    generatedAt: row.generated_at,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
  }))
}

