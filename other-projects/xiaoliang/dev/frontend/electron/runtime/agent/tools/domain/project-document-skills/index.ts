import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { getProjectDocumentSkillRegistry } from '../../../document-skills/registry'

export function buildProjectDocumentSkillTools(): AgentTool<any>[] {
  const readTool: AgentTool = {
    name: 'project_document_skill_read',
    label: 'Read General Skill',
    description:
      [
        '按 slug 读取客户端内置 skill 全文（可用 slug 见参数枚举）。',
        '只适用于生成 DOCX/XLSX/PPTX/报告或创建自制 skill；项目富文档直接用 doc_parse，CAD 图纸内容仍走 CAD 取证，最新政策规范仍走联网工具。',
      ].join('\n'),
    parameters: Type.Object({
      slug: Type.Union([
        Type.Literal('spreadsheet-writing'),
        Type.Literal('document-writing'),
        Type.Literal('presentation-writing'),
        Type.Literal('report-writing'),
        Type.Literal('create-skills'),
      ], {
        description: '要读取的通用内置 skill slug。',
      }),
    }),
    execute: async (_toolCallId, params) => {
      const rawParams = params as { slug?: unknown }
      const slug = typeof rawParams.slug === 'string' ? rawParams.slug.trim() : ''
      const content = getProjectDocumentSkillRegistry().renderSkillContent(slug)
      return {
        content: [{
          type: 'text',
          text: content || `未找到通用内置 skill：${slug || '(empty)'}`,
        }],
        details: {
          slug,
          found: Boolean(content),
        },
      }
    },
  }

  return [readTool]
}
