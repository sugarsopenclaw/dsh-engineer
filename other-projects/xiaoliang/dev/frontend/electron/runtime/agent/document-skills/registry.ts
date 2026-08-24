import fs from 'node:fs'
import path from 'node:path'

export interface ProjectDocumentSkill {
  slug: string
  name: string
  description: string
  version: string
  filePath: string
  content: string
  tags: string[]
}

const VERIFIED_PROJECT_DOCUMENT_SKILL_SLUGS = new Set([
  'spreadsheet-writing',
  'document-writing',
  'presentation-writing',
  'report-writing',
  'create-skills',
])

class ProjectDocumentSkillRegistry {
  private cache: ProjectDocumentSkill[] | null = null

  refresh() {
    this.cache = null
  }

  listSkills() {
    if (!this.cache) {
      this.cache = this.loadSkills()
    }
    return this.cache
  }

  readSkill(slug: string) {
    const normalized = slug.trim()
    if (!normalized) return null
    return this.listSkills().find((skill) => skill.slug === normalized) ?? null
  }

  renderAvailableSkillsPrompt() {
    const skills = this.listSkills()
    if (skills.length === 0) {
      return '当前未加载通用内置 skill；仍可使用项目资料与项目产物工具。'
    }

    const lines = [
      '以下客户端内置 skills 用于生成项目产物或创建用户 skill，任务匹配时按需读取。',
      '默认先用 ls / find / grep 定位资料；生成 DOCX、XLSX、PPTX 或文本交付物时读取对应 writing skill；创建用户 skill 时读取 create-skills；不要为普通 CAD 图纸识图问题读取这些 skills。',
      '',
      '<available_general_skills>',
    ]
    for (const skill of skills) {
      lines.push('  <skill>')
      lines.push(`    <slug>${escapeXml(skill.slug)}</slug>`)
      lines.push(`    <name>${escapeXml(skill.name)}</name>`)
      lines.push(`    <description>${escapeXml(skill.description)}</description>`)
      lines.push(`    <version>${escapeXml(skill.version)}</version>`)
      lines.push('  </skill>')
    }
    lines.push('</available_general_skills>')
    return lines.join('\n')
  }

  renderSkillContent(slug: string) {
    const skill = this.readSkill(slug)
    if (!skill) return null
    return [
      `[Project Document Skill: ${skill.slug}]`,
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      `version: ${skill.version}`,
      '',
      '--- SKILL.md ---',
      skill.content.trim(),
    ].join('\n')
  }

  private loadSkills(): ProjectDocumentSkill[] {
    const root = getBundledProjectDocumentSkillsRoot()
    if (!fs.existsSync(root)) return []
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) =>
        entry.isDirectory()
        && !entry.name.startsWith('.')
        && VERIFIED_PROJECT_DOCUMENT_SKILL_SLUGS.has(entry.name),
      )
      .flatMap((entry) => {
        const baseDir = path.join(root, entry.name)
        const filePath = path.join(baseDir, 'SKILL.md')
        if (!fs.existsSync(filePath)) return []
        const content = fs.readFileSync(filePath, 'utf-8')
        const frontmatter = parseFrontmatter(content)
        return [{
          slug: entry.name,
          name: extractMarkdownTitle(content) || frontmatter.name || entry.name,
          description: frontmatter.description || entry.name,
          version: 'built-in-v1',
          filePath,
          content,
          tags: readStringList(frontmatter.tags),
        }]
      })
      .sort((a, b) => a.slug.localeCompare(b.slug))
  }
}

const registry = new ProjectDocumentSkillRegistry()

export function getProjectDocumentSkillRegistry() {
  return registry
}

export function buildProjectDocumentSkillsPromptSection() {
  return registry.renderAvailableSkillsPrompt()
}

export function getBundledProjectDocumentSkillsRoot() {
  const candidates = [
    path.resolve(__dirname, 'runtime', 'agent', 'document-skills', 'library'),
    path.resolve(__dirname, 'library'),
    path.resolve(__dirname, '..', 'document-skills', 'library'),
    path.resolve(process.cwd(), 'electron', 'runtime', 'agent', 'document-skills', 'library'),
  ]
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? candidates[0]
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {}
  const parts = content.split('---', 3)
  if (parts.length < 3) return {}
  const output: Record<string, string> = {}
  for (const line of parts[1].split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (key) output[key] = value
  }
  return output
}

function readStringList(value: string | undefined): string[] {
  if (!value) return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  }
  return [trimmed.replace(/^['"]|['"]$/g, '')].filter(Boolean)
}

function extractMarkdownTitle(content: string) {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || ''
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
