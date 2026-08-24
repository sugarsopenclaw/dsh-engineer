import type {
  ComponentReviewItem,
  ComponentReviewPayload,
  ProjectComponentRecord,
  ProjectComponentSaveInput,
  ProjectComponentSummary,
} from '../../../../src/shared/local-agent'
import {
  buildComponentReviewExtractionUserPrompt,
  COMPONENT_REVIEW_EXTRACTION_SYSTEM_PROMPT,
  parseExtractedComponents,
} from '../prompts/review/component-review-extraction'
import { findGenuineTurnStartIndex } from './turn-window'

export const COMPONENT_SAVE_OPT_OUT_PATTERN = /不要(?:保存|入库)|不(?:保存|入库)|无需(?:保存|入库)|禁止(?:保存|入库)/i

const CAD_EVIDENCE_TOOLS = new Set(['delegate_cad', 'cad_evidence_image'])
const READ_TOOLS = new Set(['read'])

export type ReviewTrigger = 'draft_records' | 'extract' | 'skip'

export interface TurnToolInspection {
  toolNames: Set<string>
  savedDraft: boolean
  savedConfirmed: boolean
}

export function inspectTurnToolActivity(messages: unknown): TurnToolInspection {
  const toolNames = new Set<string>()
  let savedDraft = false
  let savedConfirmed = false
  if (!Array.isArray(messages)) {
    return { toolNames, savedDraft, savedConfirmed }
  }

  const start = findGenuineTurnStartIndex(messages)

  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index] as {
      role?: unknown
      toolName?: unknown
      content?: unknown
    }
    if (message.role === 'toolResult' && typeof message.toolName === 'string') {
      toolNames.add(message.toolName)
    }
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue
      const candidate = block as { type?: unknown; name?: unknown; arguments?: unknown }
      if (
        (candidate.type === 'toolCall' || candidate.type === 'tool')
        && typeof candidate.name === 'string'
      ) {
        toolNames.add(candidate.name)
        if (candidate.name === 'component_save') {
          const status = (candidate.arguments as { status?: unknown } | undefined)?.status
          if (status === 'draft') savedDraft = true
          if (status === 'confirmed') savedConfirmed = true
        }
      }
    }
  }

  return { toolNames, savedDraft, savedConfirmed }
}

/**
 * Extract runs on any turn that actually read a CAD evidence pack. A keyword
 * table cannot enumerate every component (elevator pits, stairs, slabs …), so
 * the judgement is delegated to the extraction model: it returns an empty list
 * when the turn produced nothing worth saving, and no card is shown.
 */
export function detectReviewTrigger(input: {
  savedDraft: boolean
  savedConfirmed: boolean
  usedCadEvidence: boolean
  usedRead: boolean
  userOptOut: boolean
}): ReviewTrigger {
  if (input.userOptOut) return 'skip'
  if (input.savedConfirmed && !input.savedDraft) return 'skip'
  if (input.savedDraft) return 'draft_records'
  if (input.usedCadEvidence && input.usedRead) {
    return 'extract'
  }
  return 'skip'
}

export function detectReviewTriggerFromTurn(input: {
  messages: unknown
  userText: string
}): ReviewTrigger {
  const inspection = inspectTurnToolActivity(input.messages)
  const usedCadEvidence = [...inspection.toolNames].some((name) => CAD_EVIDENCE_TOOLS.has(name))
  const usedRead = [...inspection.toolNames].some((name) => READ_TOOLS.has(name))
  return detectReviewTrigger({
    savedDraft: inspection.savedDraft,
    savedConfirmed: inspection.savedConfirmed,
    usedCadEvidence,
    usedRead,
    userOptOut: COMPONENT_SAVE_OPT_OUT_PATTERN.test(input.userText),
  })
}

function formatDimensions(record: Pick<ProjectComponentRecord, 'quantities'>): string {
  const dimensions = Object.entries(record.quantities.dimensions ?? {})
    .slice(0, 4)
    .map(([key, value]) => `${key}=${value}`)
  const items = (record.quantities.items ?? [])
    .slice(0, 3)
    .map((item) => `${item.name}=${item.value}${item.unit || ''}`)
  const parts = [...dimensions, ...items]
  return parts.length > 0 ? parts.join('，') : '—'
}

export function buildReviewItems(
  records: ProjectComponentRecord[],
  confirmedSourceKeys: ReadonlySet<string>,
): ComponentReviewItem[] {
  return records.map((record) => ({
    componentId: record.component_id,
    name: record.identity.semantic_name
      || record.identity.component_subtype
      || record.identity.component_type
      || '未命名构件',
    componentType: record.identity.component_type,
    dimensions: formatDimensions(record),
    drawing: record.anchors.drawing_relpath || '—',
    handles: record.anchors.source_handles.map((item) => item.handle).filter(Boolean),
    evidencePack: record.evidence.evidence_pack,
    evidenceImages: (record.evidence.images ?? []).map((image) => image.path).filter(Boolean),
    status: record.status,
    wouldOverwriteConfirmed: record.status !== 'confirmed'
      && confirmedSourceKeys.has(record.source_key),
  }))
}

export function isRecordFromThisTurn(
  record: ProjectComponentRecord,
  input: { clientRunId?: string; turnStartedAt?: string },
): boolean {
  if (input.clientRunId && record.provenance.run_id === input.clientRunId) {
    return true
  }
  if (input.turnStartedAt && record.provenance.updated_at >= input.turnStartedAt) {
    return true
  }
  return false
}

export function selectReviewedComponentIds(
  selected: unknown,
  payload: ComponentReviewPayload,
): string[] {
  if (!Array.isArray(selected)) return []
  const allowed = new Set(payload.items.map((item) => item.componentId))
  return [...new Set(selected.filter((item): item is string => (
    typeof item === 'string' && allowed.has(item)
  )))]
}

export interface ComponentReviewServiceDeps {
  listComponents(
    projectId: string,
    filter?: { status?: 'draft' | 'confirmed' },
  ): Promise<ProjectComponentSummary[]>
  getComponent(projectId: string, componentId: string): Promise<ProjectComponentRecord>
  saveDrafts(
    projectId: string,
    components: ProjectComponentSaveInput[],
  ): Promise<Array<{ component: ProjectComponentSummary }>>
  extractComponents(userText: string, assistantText: string): Promise<string>
}

export async function buildComponentReviewPayload(input: {
  projectId: string
  trigger: ReviewTrigger
  records: ProjectComponentRecord[]
  confirmed: ProjectComponentSummary[]
  source: ComponentReviewPayload['source']
}): Promise<ComponentReviewPayload | null> {
  if (input.trigger === 'skip' || input.records.length === 0) return null
  const confirmedKeys = new Set(
    input.confirmed
      .filter((item) => item.status === 'confirmed')
      .map((item) => item.source_key),
  )
  const items = buildReviewItems(input.records, confirmedKeys)
  if (items.length === 0) return null
  return {
    projectId: input.projectId,
    items,
    source: input.source,
  }
}

export async function maybeBuildComponentReview(input: {
  projectId: string
  messages: unknown
  userText: string
  assistantText: string
  clientRunId?: string
  turnStartedAt?: string
  deps: ComponentReviewServiceDeps
}): Promise<ComponentReviewPayload | null> {
  const trigger = detectReviewTriggerFromTurn({
    messages: input.messages,
    userText: input.userText,
  })
  if (trigger === 'skip' || !input.projectId.trim()) return null

  const [draftSummaries, confirmed] = await Promise.all([
    input.deps.listComponents(input.projectId, { status: 'draft' }),
    input.deps.listComponents(input.projectId, { status: 'confirmed' }),
  ])

  if (trigger === 'draft_records') {
    const records = (
      await Promise.all(
        draftSummaries.map((item) => input.deps.getComponent(input.projectId, item.component_id)),
      )
    ).filter((record) => (
      isRecordFromThisTurn(record, {
        clientRunId: input.clientRunId,
        turnStartedAt: input.turnStartedAt,
      })
    ))
    return buildComponentReviewPayload({
      projectId: input.projectId,
      trigger,
      records,
      confirmed,
      source: 'draft_records',
    })
  }

  const extractedText = await input.deps.extractComponents(input.userText, input.assistantText)
  const components = parseExtractedComponents(extractedText)
  if (components.length === 0) return null
  const saved = await input.deps.saveDrafts(input.projectId, components)
  const records = await Promise.all(
    saved.map((item) => input.deps.getComponent(input.projectId, item.component.component_id)),
  )
  return buildComponentReviewPayload({
    projectId: input.projectId,
    trigger,
    records,
    confirmed,
    source: 'extracted',
  })
}

export function createExtractionPrompt(userText: string, assistantText: string) {
  return {
    system: COMPONENT_REVIEW_EXTRACTION_SYSTEM_PROMPT,
    user: buildComponentReviewExtractionUserPrompt({ userText, assistantText }),
  }
}
