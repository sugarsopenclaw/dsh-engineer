import type { ProjectComponentSaveInput } from '../../../../../src/shared/local-agent'

export const COMPONENT_REVIEW_EXTRACTION_SYSTEM_PROMPT = [
  '你是晓量的构件抽取器。只根据用户问题与助手回答，提取已经写明的工程构件。',
  '只输出一个 JSON 对象，不要 Markdown，不要解释。',
  'schema: {"components":[{identity,anchors,quantities,semantics,evidence}]}',
  'identity 必填 component_type；semantic_name 能填则填。',
  'anchors.drawing_relpath 未知时用空字符串，source_handles 用回答里出现的 handle，没有则 []。',
  'quantities.dimensions / items 只填文本里明确给出的数字，不要估算。',
  'semantics.description 用一句话复述该构件。',
  '没有可入库构件时输出 {"components":[]}。',
  '禁止编造图纸路径、尺寸或 handle。',
].join('\n')

export function buildComponentReviewExtractionUserPrompt(input: {
  userText: string
  assistantText: string
}): string {
  return [
    '## 用户问题',
    input.userText.trim() || '（空）',
    '',
    '## 助手回答',
    input.assistantText.trim() || '（空）',
  ].join('\n')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced?.[1]?.trim() || trimmed
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

export function parseExtractedComponents(text: string): ProjectComponentSaveInput[] {
  const parsed = parseJsonObject(text)
  if (!parsed) return []
  const rows = Array.isArray(parsed.components) ? parsed.components : []
  const components: ProjectComponentSaveInput[] = []

  for (const row of rows) {
    const record = asRecord(row)
    const identity = asRecord(record.identity)
    const anchors = asRecord(record.anchors)
    const quantities = asRecord(record.quantities)
    const semantics = asRecord(record.semantics)
    const evidence = asRecord(record.evidence)
    const componentType = asString(identity.component_type)
    const description = asString(semantics.description)
    if (!componentType || !description) continue

    const handles = Array.isArray(anchors.source_handles)
      ? anchors.source_handles
        .map((item) => asRecord(item))
        .map((item) => asString(item.handle))
        .filter(Boolean)
        .map((handle) => ({ handle }))
      : []

    components.push({
      identity: {
        component_type: componentType,
        component_subtype: asString(identity.component_subtype) || undefined,
        semantic_name: asString(identity.semantic_name) || undefined,
        discipline: asString(identity.discipline) || undefined,
      },
      anchors: {
        drawing_relpath: asString(anchors.drawing_relpath),
        layout_name: asString(anchors.layout_name) || undefined,
        source_handles: handles,
      },
      quantities: {
        dimensions: asRecord(quantities.dimensions) as Record<string, number | string>,
        items: Array.isArray(quantities.items)
          ? quantities.items.map((item) => {
              const rowItem = asRecord(item)
              return {
                name: asString(rowItem.name) || '工程量',
                value: Number(rowItem.value) || 0,
                unit: asString(rowItem.unit),
              }
            })
          : undefined,
      },
      semantics: { description },
      evidence: {
        evidence_pack: asString(evidence.evidence_pack) || undefined,
      },
      provenance: { created_by: 'agent' },
    })
  }

  return components
}
