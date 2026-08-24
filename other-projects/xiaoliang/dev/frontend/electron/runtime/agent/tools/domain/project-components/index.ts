import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { Check, Errors } from 'typebox/value'
import type {
  ProjectComponentFilter,
  ProjectComponentPatch,
  ProjectComponentRecord,
  ProjectComponentSaveInput,
  ProjectComponentSaveItemResult,
  ProjectComponentStatus,
  ProjectComponentSummary,
} from '../../../../../../src/shared/local-agent'

export interface ProjectComponentsSaveToolInput {
  components: ProjectComponentSaveInput[]
  status: ProjectComponentStatus
  overwrite_confirmed?: boolean
}

export interface ProjectComponentsQueryToolInput extends ProjectComponentFilter {
  limit?: number
}

export interface ProjectComponentUpdateToolInput {
  component_id: string
  patch: ProjectComponentPatch
}

export type ProjectComponentsSaveExecutor = (
  input: ProjectComponentsSaveToolInput,
  signal?: AbortSignal,
) => Promise<ProjectComponentSaveItemResult[]>

export type ProjectComponentsQueryExecutor = (
  input: ProjectComponentFilter,
  signal?: AbortSignal,
) => Promise<ProjectComponentSummary[]>

export type ProjectComponentGetExecutor = (
  componentId: string,
  signal?: AbortSignal,
) => Promise<ProjectComponentRecord>

export type ProjectComponentUpdateExecutor = (
  input: ProjectComponentUpdateToolInput,
  signal?: AbortSignal,
) => Promise<ProjectComponentRecord>

export type ProjectComponentDeleteExecutor = (
  componentId: string,
  signal?: AbortSignal,
) => Promise<void>

const statusSchema = Type.Union([Type.Literal('draft'), Type.Literal('confirmed')])

const identitySchema = Type.Object({
  component_type: Type.String({ minLength: 1, maxLength: 200 }),
  component_subtype: Type.Optional(Type.String({ maxLength: 200 })),
  semantic_name: Type.Optional(Type.String({ maxLength: 300 })),
  discipline: Type.Optional(Type.String({ maxLength: 100 })),
  aliases: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 100 })),
}, { additionalProperties: false })

const sourceHandleSchema = Type.Object({
  handle: Type.String({ minLength: 1, maxLength: 100 }),
  role: Type.Optional(Type.String({ maxLength: 100 })),
}, { additionalProperties: false })

const anchorsSchema = Type.Object({
  drawing_relpath: Type.String({ minLength: 1, maxLength: 1_000 }),
  layout_name: Type.Optional(Type.String({ maxLength: 300 })),
  source_handles: Type.Array(sourceHandleSchema, { minItems: 1, maxItems: 1_000 }),
  bbox: Type.Optional(Type.Array(Type.Number(), { minItems: 4, maxItems: 12 })),
}, { additionalProperties: false })

const quantityItemSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 300 }),
  value: Type.Number(),
  unit: Type.String({ minLength: 1, maxLength: 100 }),
  formula: Type.Optional(Type.String({ maxLength: 2_000 })),
  basis: Type.Optional(Type.String({ maxLength: 4_000 })),
}, { additionalProperties: false })

const quantitiesSchema = Type.Object({
  unit: Type.Optional(Type.String({ maxLength: 100 })),
  dimensions: Type.Optional(Type.Record(
    Type.String({ minLength: 1, maxLength: 200 }),
    Type.Union([Type.Number(), Type.String({ minLength: 1, maxLength: 500 })]),
  )),
  items: Type.Optional(Type.Array(quantityItemSchema, { maxItems: 1_000 })),
}, { additionalProperties: false })

const semanticsSchema = Type.Object({
  description: Type.String({ minLength: 1, maxLength: 50_000 }),
  notes: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4_000 }), { maxItems: 500 })),
}, { additionalProperties: false })

const evidenceSchema = Type.Object({
  evidence_pack: Type.Optional(Type.String({ maxLength: 1_000 })),
  images: Type.Optional(Type.Array(Type.Object({
    path: Type.String({ minLength: 1, maxLength: 1_000 }),
    note: Type.Optional(Type.String({ maxLength: 4_000 })),
  }, { additionalProperties: false }), { maxItems: 100 })),
  text: Type.Optional(Type.Array(Type.Object({
    handle: Type.Optional(Type.String({ maxLength: 100 })),
    text: Type.String({ minLength: 1, maxLength: 20_000 }),
    role: Type.Optional(Type.String({ maxLength: 100 })),
  }, { additionalProperties: false }), { maxItems: 1_000 })),
}, { additionalProperties: false })

const relationSchema = Type.Object({
  type: Type.String({ minLength: 1, maxLength: 200 }),
  target_component_id: Type.Optional(Type.String({ maxLength: 100 })),
  target_handle: Type.Optional(Type.String({ maxLength: 100 })),
}, { additionalProperties: false })

const componentInputSchema = Type.Object({
  identity: identitySchema,
  anchors: anchorsSchema,
  quantities: Type.Optional(quantitiesSchema),
  semantics: semanticsSchema,
  evidence: Type.Optional(evidenceSchema),
  relations: Type.Optional(Type.Array(relationSchema, { maxItems: 500 })),
  provenance: Type.Optional(Type.Object({
    created_by: Type.Optional(Type.Union([Type.Literal('agent'), Type.Literal('user')])),
    run_id: Type.Optional(Type.String({ maxLength: 300 })),
  }, { additionalProperties: false })),
}, { additionalProperties: false })

const identityPatchSchema = Type.Partial(identitySchema)
const anchorsPatchSchema = Type.Partial(anchorsSchema)
const semanticsPatchSchema = Type.Partial(semanticsSchema)
/**
 * component_update 的完整 patch 契约。为了不在 tools 上下文里重复发送
 * component_save 的整棵结构树，wire schema 只暴露一个宽松对象，
 * 本 schema 在 execute() 内做全量校验（安全不降级）。
 */
const patchSchema = Type.Object({
  identity: Type.Optional(identityPatchSchema),
  anchors: Type.Optional(anchorsPatchSchema),
  quantities: Type.Optional(quantitiesSchema),
  semantics: Type.Optional(semanticsPatchSchema),
  evidence: Type.Optional(evidenceSchema),
  relations: Type.Optional(Type.Array(relationSchema, { maxItems: 500 })),
}, { additionalProperties: false })

function formatPatchIssues(patch: unknown) {
  return Errors(patchSchema, patch)
    .slice(0, 8)
    .map((issue) => `${issue.instancePath || '(root)'}: ${issue.message}`)
}

function componentDisplayName(component: ProjectComponentSummary) {
  return component.semantic_name || component.component_subtype || component.component_type
}

function formatSummary(component: ProjectComponentSummary) {
  return [
    `- ${componentDisplayName(component)} [${component.status}]`,
    `  component_id: ${component.component_id}`,
    `  类型: ${component.component_type}${component.component_subtype ? ` / ${component.component_subtype}` : ''}`,
    `  图纸: ${component.drawing_relpath}${component.layout_name ? ` · ${component.layout_name}` : ''}`,
    `  锚点: ${component.source_handle_count} · 工程量条目: ${component.quantity_item_count} · 更新: ${component.updated_at}`,
  ].join('\n')
}

function formatSaveResults(results: ProjectComponentSaveItemResult[]) {
  const counts = results.reduce(
    (summary, result) => {
      summary[result.action] += 1
      return summary
    },
    { created: 0, updated: 0, conflict: 0 },
  )
  const lines = [
    `构件保存完成：新建 ${counts.created}，更新 ${counts.updated}，冲突未覆盖 ${counts.conflict}。`,
  ]
  results.forEach((result) => {
    lines.push(formatSummary(result.component))
    if (result.warning) lines.push(`  提示: ${result.warning}`)
  })
  return lines.join('\n')
}

export function buildProjectComponentTools(deps: {
  saveProjectComponents: ProjectComponentsSaveExecutor
  queryProjectComponents: ProjectComponentsQueryExecutor
  getProjectComponent: ProjectComponentGetExecutor
  updateProjectComponent: ProjectComponentUpdateExecutor
  deleteProjectComponent: ProjectComponentDeleteExecutor
}): AgentTool<any>[] {
  const saveTool: AgentTool = {
    name: 'component_save',
    label: 'Save Project Components',
    description: [
      '把 CAD evidence pack 中已核验的构件语义与量化数据批量沉淀到当前项目构件库。',
      '普通识图结论先在本轮展示结构化结果，再直接发起 status=confirmed；运行时会弹 A2UI 确认卡并阻塞写入，不要要求用户另发文字“确认”。只有用户明确要求批量识别/批量入库时可先传 status=draft。',
      '服务会按图纸、布局、构件类型和 source_handles 计算 source_key 幂等 upsert。已 confirmed 记录默认不覆盖；冲突后需要覆盖时传 overwrite_confirmed=true，运行时会再次弹出高风险覆盖确认卡。',
    ].join('\n'),
    parameters: Type.Object({
      components: Type.Array(componentInputSchema, {
        minItems: 1,
        maxItems: 200,
        description: '待保存构件；数字必须来自 evidence pack 或权威实体字段。',
      }),
      status: statusSchema,
      overwrite_confirmed: Type.Optional(Type.Boolean({
        default: false,
        description: '仅在确需覆盖已确认构件时传 true；运行时会要求用户通过覆盖确认卡授权。',
      })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params, signal) => {
      const results = await deps.saveProjectComponents(params as ProjectComponentsSaveToolInput, signal)
      return {
        content: [{ type: 'text', text: formatSaveResults(results) }],
        details: { results },
      }
    },
  }

  const queryTool: AgentTool = {
    name: 'component_query',
    label: 'Query Project Components',
    description: [
      '按关键词、类型、图纸或状态查询当前项目构件库，返回紧凑摘要和 component_id。',
      '开始算量、设计或复用既有识图结论前先查询并传 status=confirmed；草稿只能作为待复核线索。',
    ].join('\n'),
    parameters: Type.Object({
      keyword: Type.Optional(Type.String({ maxLength: 500 })),
      component_type: Type.Optional(Type.String({ maxLength: 200 })),
      drawing_relpath: Type.Optional(Type.String({ maxLength: 1_000 })),
      status: Type.Optional(statusSchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params, signal) => {
      const input = params as ProjectComponentsQueryToolInput
      const { limit = 30, ...filter } = input
      const allComponents = await deps.queryProjectComponents(filter, signal)
      const components = allComponents.slice(0, limit)
      const lines = [
        `匹配构件 ${allComponents.length} 条，返回 ${components.length} 条。`,
        components.length > 0 ? components.map(formatSummary).join('\n') : '未找到匹配构件。',
      ]
      if (allComponents.length > components.length) {
        lines.push(`结果已截断；请增加过滤条件或提高 limit（最多 100）。`)
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { total: allComponents.length, components },
      }
    },
  }

  const getTool: AgentTool = {
    name: 'component_get',
    label: 'Get Project Component',
    description: '按 component_id 读取一条完整构件 JSON。仅在摘要不足以回答、更新或复用时调用。',
    parameters: Type.Object({
      component_id: Type.String({ minLength: 1, maxLength: 100 }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params, signal) => {
      const componentId = (params as { component_id: string }).component_id
      const component = await deps.getProjectComponent(componentId, signal)
      return {
        content: [{ type: 'text', text: JSON.stringify(component, null, 2) }],
        details: component,
      }
    },
  }

  const updateTool: AgentTool = {
    name: 'component_update',
    label: 'Update Project Component',
    description: [
      '按 component_id 局部修改构件；仅在用户明确指出修改内容时调用。',
      'patch 与 component_save 的 components[] 条目同构（identity/anchors/quantities/semantics/evidence/relations），只传需要修改的字段。',
      'identity/anchors/semantics 使用局部合并；quantities/evidence/relations 传入后整体替换。修改锚点会重新计算 source_key 并检查冲突。',
    ].join('\n'),
    parameters: Type.Object({
      component_id: Type.String({ minLength: 1, maxLength: 100 }),
      patch: Type.Object({}, {
        additionalProperties: true,
        description: '与 component_save 的 components[] 条目同构的局部补丁；只传需修改字段，运行时会做完整结构校验。',
      }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params, signal) => {
      const input = params as ProjectComponentUpdateToolInput
      if (!Check(patchSchema, input.patch)) {
        const issues = formatPatchIssues(input.patch)
        return {
          content: [{
            type: 'text' as const,
            text: [
              'patch 结构校验失败，未执行更新。字段契约与 component_save 的 components[] 条目一致，请修正后重试：',
              ...issues.map((issue) => `- ${issue}`),
            ].join('\n'),
          }],
          details: { error: 'COMPONENT_PATCH_INVALID', issues },
        }
      }
      const component = await deps.updateProjectComponent(input, signal)
      return {
        content: [{ type: 'text', text: `已更新构件。\n${formatSummary({
          component_id: component.component_id,
          source_key: component.source_key,
          status: component.status,
          component_type: component.identity.component_type,
          component_subtype: component.identity.component_subtype,
          semantic_name: component.identity.semantic_name,
          discipline: component.identity.discipline,
          drawing_relpath: component.anchors.drawing_relpath,
          layout_name: component.anchors.layout_name,
          source_handle_count: component.anchors.source_handles.length,
          quantity_item_count: component.quantities.items?.length ?? 0,
          updated_at: component.provenance.updated_at,
          confirmed_at: component.provenance.confirmed_at,
        })}` }],
        details: component,
      }
    },
  }

  const deleteTool: AgentTool = {
    name: 'component_delete',
    label: 'Delete Project Component',
    description: '永久删除一条项目构件记录。只有用户明确要求删除该 component_id 时才允许调用；不得把“忽略、不采用、重做”推断为删除。',
    parameters: Type.Object({
      component_id: Type.String({ minLength: 1, maxLength: 100 }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params, signal) => {
      const componentId = (params as { component_id: string }).component_id
      await deps.deleteProjectComponent(componentId, signal)
      return {
        content: [{ type: 'text', text: `已删除构件：${componentId}。` }],
        details: { component_id: componentId, deleted: true },
      }
    },
  }

  return [saveTool, queryTool, getTool, updateTool, deleteTool]
}
