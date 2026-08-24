import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type { ProjectFileReadResult } from '../../../../../../src/shared/local-agent'

export interface ProjectDocumentParseInput {
  path: string
  max_chars?: number
  page_range?: string
  sheet_names?: string[]
  max_rows_per_sheet?: number
  max_cols_per_sheet?: number
  include_formulas?: boolean
  mode?: 'auto' | 'local' | 'cloud'
}

export type ProjectDocumentParseExecutor = (
  input: ProjectDocumentParseInput,
  signal?: AbortSignal,
) => Promise<ProjectFileReadResult>

/**
 * doc_parse 只处理需要专用解析器的富文档。
 * 纯文本/代码/图片归 Pi read;此白名单收窄自
 * project-file-service 的 SUPPORTED_KIND_BY_EXTENSION 中的 document/docx/pdf/xlsx kinds。
 */
const RICH_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.epub',
  '.mobi',
])

function documentExtension(value: string) {
  const normalized = value.trim().toLowerCase()
  const dotIndex = normalized.lastIndexOf('.')
  return dotIndex >= 0 ? normalized.slice(dotIndex) : ''
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatProjectDocumentParse(result: ProjectFileReadResult) {
  const lines = [
    `文件：${result.path}`,
    `类型：${result.kind} · 大小：${formatBytes(result.sizeBytes)} · 更新时间：${result.modifiedAt}`,
  ]
  if (result.sheets?.length) {
    lines.push(`工作表：${result.sheets.join('、')}`)
  }
  if (result.pageCount) {
    lines.push(`页数：${result.pageCount}`)
  }
  if (result.parser) {
    lines.push(`解析器：${result.parser}`)
  }
  if (result.warning) {
    lines.push(`[项目资料提示] ${result.warning}`)
  }
  if (result.content.trim()) {
    lines.push('')
    lines.push(result.content.trim())
  }
  if (!result.content.trim() && !result.warning) {
    lines.push('')
    lines.push('未读取到可用文本内容。')
  }
  return lines.join('\n')
}

export function buildProjectFileTools(deps: {
  parseProjectDocument: ProjectDocumentParseExecutor
}): AgentTool<any>[] {
  const projectDocumentParseTool: AgentTool = {
    name: 'doc_parse',
    label: 'Parse Rich Document',
    description:
      [
        '解析当前项目资料目录中的单个富文档(PDF、Word、PowerPoint、Excel),提取为可引用文本;只允许项目内相对路径,引用结果时写明来源文件相对路径。',
        '纯文本、代码、Markdown、CSV、JSON 和图片不要用本工具,改用 read;DWG/DXF 一律经 CAD 取证。Excel 读取模式见 mode 参数。',
      ].join('\n'),
    parameters: Type.Object({
      path: Type.String({
        minLength: 1,
        description: '项目资料目录内的富文档相对路径,例如 资料/结算书.pdf。',
      }),
      max_chars: Type.Optional(Type.Integer({
        minimum: 1000,
        maximum: 120000,
        default: 40000,
        description: '返回文本字符数上限,默认 40000。',
      })),
      page_range: Type.Optional(Type.String({
        minLength: 1,
        description: '可选。PDF 页码范围,1-based,例如 1-3 或 1,3,5;该要求会传给云文档解析器。',
      })),
      sheet_names: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
        description: '可选。Excel 指定读取的工作表名称;该要求会传给云文档解析器。',
      })),
      max_rows_per_sheet: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: 500,
        default: 80,
        description: '可选。xlsx 每个 sheet 的预览行数上限,默认 80。',
      })),
      max_cols_per_sheet: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: 120,
        default: 30,
        description: '可选。xlsx 每个 sheet 的预览列数上限,默认 30。',
      })),
      include_formulas: Type.Optional(Type.Boolean({
        default: true,
        description: '可选。xlsx 是否返回公式文本,默认 true。',
      })),
      mode: Type.Optional(Type.Union([
        Type.Literal('auto'),
        Type.Literal('local'),
        Type.Literal('cloud'),
      ], {
        default: 'auto',
        description: 'Excel 读取模式:auto=本地优先、失败自动云解析;local=仅本地不上传;cloud=云端语义解析图表、图片和复杂版式。',
      })),
    }),
    execute: async (_toolCallId, params, signal) => {
      const input = params as ProjectDocumentParseInput
      const extension = documentExtension(input.path)
      if (!RICH_DOCUMENT_EXTENSIONS.has(extension)) {
        throw new Error(
          `doc_parse 只解析富文档(${[...RICH_DOCUMENT_EXTENSIONS].join('、')})。`
          + '纯文本、代码和图片请用 read 读取;DWG/DXF 请通过 CAD 子代理取证。',
        )
      }
      const result = await deps.parseProjectDocument(input, signal)
      return {
        content: [{ type: 'text', text: formatProjectDocumentParse(result) }],
        details: result,
      }
    },
  }

  return [projectDocumentParseTool]
}
