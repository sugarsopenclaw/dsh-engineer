import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '@earendil-works/pi-agent-core'
import type {
  AgentInteractionDetail,
  AgentInteractionRisk,
} from '../../../../src/shared/local-agent'
import { getCadToolMetadata } from '../tools/domain/cad/metadata'

export interface ToolConfirmationRequest {
  title: string
  description: string
  risk: AgentInteractionRisk
  confirmLabel: string
  cancelLabel: string
  details: AgentInteractionDetail[]
}

export interface ToolApprovalContext {
  toolCall: Pick<BeforeToolCallContext['toolCall'], 'id' | 'name'>
  args: unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function compactText(value: unknown, maxLength = 320): string {
  const text = typeof value === 'string'
    ? value
    : value == null
      ? ''
      : String(value)
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function joinCompact(values: unknown[], maxItems = 6): string {
  const normalized = values
    .map((value) => compactText(value, 80))
    .filter(Boolean)
  if (normalized.length === 0) return '—'
  const visible = normalized.slice(0, maxItems)
  return normalized.length > visible.length
    ? `${visible.join('、')} 等 ${normalized.length} 项`
    : visible.join('、')
}

function formatComponentSummary(value: unknown): string {
  const component = asRecord(value)
  const identity = asRecord(component.identity)
  const anchors = asRecord(component.anchors)
  const quantities = asRecord(component.quantities)
  const evidence = asRecord(component.evidence)
  const name = compactText(
    identity.semantic_name || identity.component_subtype || identity.component_type || '未命名构件',
    100,
  )
  const type = compactText(identity.component_type || '类型未填写', 80)
  const drawing = compactText(anchors.drawing_relpath || '图纸未填写', 140)
  const layout = compactText(anchors.layout_name, 80)
  const handles = Array.isArray(anchors.source_handles)
    ? anchors.source_handles.map((item) => asRecord(item).handle)
    : []

  const dimensions = Object.entries(asRecord(quantities.dimensions))
    .slice(0, 4)
    .map(([key, dimension]) => `${compactText(key, 40)}=${compactText(dimension, 60)}`)
  const quantityItems = Array.isArray(quantities.items)
    ? quantities.items.slice(0, 3).map((item) => {
        const row = asRecord(item)
        return `${compactText(row.name, 50)}=${compactText(row.value, 40)}${compactText(row.unit, 20)}`
      })
    : []
  const evidencePack = compactText(evidence.evidence_pack, 120)

  return [
    `${name} · ${type}`,
    `尺寸/工程量：${joinCompact([...dimensions, ...quantityItems], 6)}`,
    `图纸：${drawing}${layout ? ` · ${layout}` : ''}`,
    `锚点：${joinCompact(handles, 4)}${handles.length ? `（共 ${handles.length} 个）` : ''}`,
    evidencePack ? '证据包：已关联' : '',
  ].filter(Boolean).join('；')
}

function componentSaveRequest(args: Record<string, unknown>): ToolConfirmationRequest | null {
  if (args.status !== 'confirmed') return null
  const components = Array.isArray(args.components) ? args.components : []
  const overwrite = args.overwrite_confirmed === true
  const visibleComponents = components.slice(0, 5)
  const details: AgentInteractionDetail[] = [
    ...(components.length > 1
      ? [{ label: '构件数量', value: String(components.length) }]
      : []),
    ...visibleComponents.map((component, index) => ({
      label: `构件 ${index + 1}`,
      value: formatComponentSummary(component),
    })),
  ]
  if (components.length > visibleComponents.length) {
    details.push({
      label: '其余构件',
      value: `另有 ${components.length - visibleComponents.length} 条，将与本批次一并处理。`,
    })
  }
  if (overwrite) {
    details.unshift({ label: '覆盖策略', value: '将覆盖 source_key 冲突的已确认构件' })
  }

  return {
    title: overwrite ? '确认覆盖已确认构件' : '确认构件入库',
    description: overwrite
      ? '这是覆盖确认。继续后，冲突的 confirmed 构件会被新数据替换。'
      : '核对构件摘要，确认后写入项目构件库。',
    risk: overwrite ? 'high' : 'medium',
    confirmLabel: overwrite ? '确认覆盖并保存' : '确认入库',
    cancelLabel: '取消',
    details,
  }
}

function algorithmSaveRequest(args: Record<string, unknown>): ToolConfirmationRequest {
  return {
    title: '确认保存算法资产',
    description: '请确认验证结果与算法正确。继续后，calculator.py 会保存到本机已确认算法库。',
    risk: 'medium',
    confirmLabel: '确认保存',
    cancelLabel: '取消',
    details: [
      { label: '算法', value: compactText(args.algorithm_slug, 160) || '未命名' },
      { label: '构件', value: compactText(args.component_label, 240) || '未填写' },
      { label: '亚型', value: compactText(args.subtype_code, 120) || '未填写' },
      { label: '图纸', value: compactText(args.drawing_name, 240) || '未填写' },
      { label: '验证摘要', value: compactText(args.confirmation_summary, 600) || '未填写' },
    ],
  }
}

function artifactOverwriteRequest(args: Record<string, unknown>): ToolConfirmationRequest {
  return {
    title: '确认覆盖已有项目产物',
    description: '目标位置已有文件。继续后，旧文件内容将被本次生成结果替换。',
    risk: 'high',
    confirmLabel: '确认覆盖',
    cancelLabel: '取消',
    details: [
      { label: '目标路径', value: compactText(args.path, 500) || '未填写' },
      { label: '格式', value: compactText(args.format, 80) || '未填写' },
      { label: '标题', value: compactText(args.title, 240) || '未填写' },
    ],
  }
}

function algorithmExportOverwriteRequest(args: Record<string, unknown>): ToolConfirmationRequest {
  return {
    title: '确认覆盖算法导出文件',
    description: '继续后，目标目录中的同名算法文件会被本次导出结果替换。',
    risk: 'high',
    confirmLabel: '确认覆盖并导出',
    cancelLabel: '取消',
    details: [
      { label: '算法', value: compactText(args.algorithm_slug, 160) || '未命名' },
      { label: '来源', value: compactText(args.source, 80) || 'saved' },
      { label: '目标目录', value: compactText(args.target_dir, 500) || '默认算法目录' },
    ],
  }
}

export function getToolConfirmationRequest(
  context: ToolApprovalContext,
): ToolConfirmationRequest | null {
  const args = asRecord(context.args)
  switch (context.toolCall.name) {
    case 'component_save':
      return componentSaveRequest(args)
    case 'component_delete':
      return {
        title: '确认永久删除构件',
        description: '删除后该构件记录不能从构件库中直接恢复。',
        risk: 'high',
        confirmLabel: '永久删除',
        cancelLabel: '取消',
        details: [
          { label: 'component_id', value: compactText(args.component_id, 200) || '未填写' },
        ],
      }
    case 'cad_algorithm_save':
      return algorithmSaveRequest(args)
    case 'project_artifact_create':
      return args.overwrite_confirmed === true ? artifactOverwriteRequest(args) : null
    case 'project_algorithm_export':
      return args.overwrite_confirmed === true ? algorithmExportOverwriteRequest(args) : null
    default:
      return null
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, canonicalize(item)]),
  )
}

export function serializeToolApprovalPayload(context: ToolApprovalContext): string {
  return JSON.stringify({
    toolCallId: context.toolCall.id,
    toolName: context.toolCall.name,
    args: canonicalize(context.args),
  })
}

export async function guardToolExecution(
  context: ToolApprovalContext,
): Promise<BeforeToolCallResult | undefined> {
  const metadata = getCadToolMetadata(context.toolCall.name)
  if (!metadata) return undefined

  if (metadata.visibility === 'hidden' || metadata.approvalMode === 'manual-enable') {
    return {
      block: true,
      reason: `工具 ${context.toolCall.name} 需人工启用，当前默认拒绝执行。`,
    }
  }

  return undefined
}
