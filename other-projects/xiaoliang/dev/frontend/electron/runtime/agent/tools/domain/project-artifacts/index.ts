import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type {
  ProjectAlgorithmExportInput,
  ProjectArtifactCreateInput,
  ProjectArtifactWriteResult,
  ProjectDocxArtifactInput,
  ProjectExcelArtifactInput,
  ProjectPptxArtifactInput,
  ProjectTextArtifactInput,
  ProjectTextArtifactKind,
} from '../../../../../../src/shared/local-agent'

export type ProjectTextArtifactWriteExecutor = (
  input: ProjectTextArtifactInput,
  signal?: AbortSignal,
) => Promise<ProjectArtifactWriteResult>

export type ProjectExcelArtifactWriteExecutor = (
  input: ProjectExcelArtifactInput,
  signal?: AbortSignal,
) => Promise<ProjectArtifactWriteResult>

export type ProjectDocxArtifactWriteExecutor = (
  input: ProjectDocxArtifactInput,
  signal?: AbortSignal,
) => Promise<ProjectArtifactWriteResult>

export type ProjectPptxArtifactWriteExecutor = (
  input: ProjectPptxArtifactInput,
  signal?: AbortSignal,
) => Promise<ProjectArtifactWriteResult>

export type ProjectAlgorithmExportExecutor = (
  input: ProjectAlgorithmExportInput,
  signal?: AbortSignal,
) => Promise<ProjectArtifactWriteResult[]>

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatWriteResult(result: ProjectArtifactWriteResult) {
  const lines = [
    `${result.overwritten ? '已覆盖' : '已写入'}项目产物：${result.path}`,
    `类型：${result.kind} · 大小：${formatBytes(result.sizeBytes)}`,
  ]
  if (result.warning) lines.push(`[项目产物提示] ${result.warning}`)
  if (result.opened) {
    lines.push('已用系统默认应用打开。')
  } else if (result.openError) {
    lines.push(`自动打开失败：${result.openError}`)
  }
  return lines.join('\n')
}

function requireCreatePayload(input: Record<string, unknown>) {
  const format = String(input.format || '') as ProjectArtifactCreateInput['format']
  if (!['text', 'markdown', 'json', 'csv', 'xlsx', 'docx', 'pptx'].includes(format)) {
    throw new Error(`不支持的项目产物格式：${format || '未提供'}`)
  }
  if (typeof input.path !== 'string' || !input.path.trim()) {
    throw new Error('项目产物必须提供 path。')
  }
  if (['text', 'markdown', 'json', 'csv'].includes(format)) {
    if (typeof input.content !== 'string' || !input.content.length) {
      throw new Error(`${format} 产物必须提供 content。`)
    }
    if (format === 'json') {
      try {
        JSON.parse(input.content)
      } catch {
        throw new Error('json 产物的 content 必须是有效 JSON。')
      }
    }
  } else if (format === 'xlsx') {
    if (!Array.isArray(input.sheets) || input.sheets.length === 0) {
      throw new Error('xlsx 产物至少需要一个 sheet。')
    }
  } else if (format === 'docx') {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw new Error('docx 产物必须提供 title。')
    }
    if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
      throw new Error('docx 产物至少需要一个 block。')
    }
  } else if (format === 'pptx') {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw new Error('pptx 产物必须提供 title。')
    }
    if (!Array.isArray(input.slides) || input.slides.length === 0) {
      throw new Error('pptx 产物至少需要一页 slide。')
    }
  }
  return format
}

export function buildProjectArtifactTools(deps: {
  writeProjectTextArtifact: ProjectTextArtifactWriteExecutor
  writeProjectExcelArtifact: ProjectExcelArtifactWriteExecutor
  writeProjectDocxArtifact: ProjectDocxArtifactWriteExecutor
  writeProjectPptxArtifact: ProjectPptxArtifactWriteExecutor
  exportProjectAlgorithm: ProjectAlgorithmExportExecutor
}): AgentTool<any>[] {
  const createTool: AgentTool = {
    name: 'project_artifact_create',
    label: 'Create Project Artifact',
    description:
      [
        '在当前项目 xiaoliang-outputs 内创建文本、Markdown、JSON、CSV、XLSX、DOCX 或 PPTX 产物。',
        'format 决定所需载荷：文本类传 content；xlsx 传 sheets；docx 传 title + blocks；pptx 传 title + slides。',
        '所有格式都沿用受控后端：路径不能越界、默认不覆盖、写入保持原子性；确需覆盖时传 overwrite_confirmed=true，运行时会弹高风险确认卡并阻塞写入。',
      ].join('\n'),
    parameters: Type.Object({
      format: Type.Union([
        Type.Literal('text'),
        Type.Literal('markdown'),
        Type.Literal('json'),
        Type.Literal('csv'),
        Type.Literal('xlsx'),
        Type.Literal('docx'),
        Type.Literal('pptx'),
      ], {
        description: '目标格式。文本类使用 content；Office 格式使用对应结构化字段。',
      }),
      path: Type.String({
        minLength: 1,
        description: 'xiaoliang-outputs 内相对路径；可省略扩展名，例如 reports/审查报告。',
      }),
      content: Type.Optional(Type.String({
        minLength: 1,
        description: 'text/markdown/json/csv 必填的 UTF-8 内容。',
      })),
      sheets: Type.Optional(Type.Array(Type.Object({
        name: Type.String({ minLength: 1 }),
        rows: Type.Array(Type.Any(), { minItems: 0 }),
      }), {
        minItems: 1,
        maxItems: 20,
        description: 'xlsx 必填。每个 sheet 包含 name 和对象数组或二维数组 rows。',
      })),
      title: Type.Optional(Type.String({
        minLength: 1,
        maxLength: 200,
        description: 'docx/pptx 必填的文档标题。',
      })),
      subtitle: Type.Optional(Type.String({ maxLength: 300 })),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
      blocks: Type.Optional(Type.Array(Type.Object({
        type: Type.Union([
          Type.Literal('heading'),
          Type.Literal('paragraph'),
          Type.Literal('bullets'),
          Type.Literal('key_values'),
          Type.Literal('table'),
          Type.Literal('note'),
        ]),
        text: Type.Optional(Type.String()),
        level: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)])),
        tone: Type.Optional(Type.Union([Type.Literal('note'), Type.Literal('warning')])),
        items: Type.Optional(Type.Array(Type.Any())),
        columns: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
        rows: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
      }), {
        minItems: 1,
        maxItems: 300,
        description: 'docx 必填的结构化内容块。',
      })),
      slides: Type.Optional(Type.Array(Type.Object({
        type: Type.Union([
          Type.Literal('title'),
          Type.Literal('section'),
          Type.Literal('bullets'),
          Type.Literal('content'),
          Type.Literal('table'),
          Type.Literal('closing'),
        ]),
        title: Type.String({ minLength: 1, maxLength: 200 }),
        subtitle: Type.Optional(Type.String({ maxLength: 300 })),
        body: Type.Optional(Type.String()),
        bullets: Type.Optional(Type.Array(Type.String(), { maxItems: 12 })),
        columns: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 12 })),
        rows: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()), { maxItems: 30 })),
        notes: Type.Optional(Type.String()),
      }), {
        minItems: 1,
        maxItems: 80,
        description: 'pptx 必填的结构化幻灯片。',
      })),
      open_after_write: Type.Optional(Type.Boolean({
        default: true,
        description: 'Office 文件写入后是否用系统默认应用打开；默认 true。',
      })),
      overwrite_confirmed: Type.Optional(Type.Boolean({
        default: false,
        description: '确需覆盖旧文件时传 true；运行时会要求用户通过覆盖确认卡授权。',
      })),
    }),
    execute: async (_toolCallId, rawParams, signal) => {
      const params = rawParams as Record<string, unknown>
      const format = requireCreatePayload(params)
      const { format: _format, ...payload } = params
      let result: ProjectArtifactWriteResult
      if (['text', 'markdown', 'json', 'csv'].includes(format)) {
        result = await deps.writeProjectTextArtifact({
          ...(payload as unknown as Omit<ProjectTextArtifactInput, 'kind'>),
          kind: format as ProjectTextArtifactKind,
        }, signal)
      } else if (format === 'xlsx') {
        result = await deps.writeProjectExcelArtifact(payload as unknown as ProjectExcelArtifactInput, signal)
      } else if (format === 'docx') {
        result = await deps.writeProjectDocxArtifact(payload as unknown as ProjectDocxArtifactInput, signal)
      } else {
        result = await deps.writeProjectPptxArtifact(payload as unknown as ProjectPptxArtifactInput, signal)
      }
      return {
        content: [{ type: 'text', text: formatWriteResult(result) }],
        details: result,
      }
    },
  }

  const exportAlgorithmTool: AgentTool = {
    name: 'project_algorithm_export',
    label: 'Export CAD Algorithm To Project',
    description:
      [
        '把本地草稿或已确认 CAD 算法资产导出为用户可见项目产物副本，默认写入 xiaoliang-outputs/algorithms/<slug>/。',
        '内部算法库仍是运行 source of truth；默认不覆盖已有文件，目录冲突时自动加时间戳。',
      ].join('\n'),
    parameters: Type.Object({
      algorithm_slug: Type.String({ minLength: 2, description: '算法 slug。' }),
      source: Type.Optional(Type.Union([
        Type.Literal('draft'),
        Type.Literal('saved'),
      ], { default: 'saved', description: '导出草稿或已确认算法；默认 saved。' })),
      target_dir: Type.Optional(Type.String({
        minLength: 1,
        description: '可选。xiaoliang-outputs 内目标目录。',
      })),
      overwrite_confirmed: Type.Optional(Type.Boolean({
        default: false,
        description: '确需覆盖旧文件时传 true；运行时会要求用户通过覆盖确认卡授权。',
      })),
    }),
    execute: async (_toolCallId, params, signal) => {
      const results = await deps.exportProjectAlgorithm(params as ProjectAlgorithmExportInput, signal)
      return {
        content: [{
          type: 'text',
          text: results.length ? results.map(formatWriteResult).join('\n\n') : '未导出任何算法文件。',
        }],
        details: { files: results },
      }
    },
  }

  return [createTool, exportAlgorithmTool]
}
