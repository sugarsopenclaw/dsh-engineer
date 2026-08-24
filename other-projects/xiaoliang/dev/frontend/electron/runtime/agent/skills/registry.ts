import fs from 'node:fs'
import path from 'node:path'
import { SKILL_PACK_METADATA } from '../../../../src/shared/skill-pack-metadata'
import { getBundledCadSkillsRoot, getManagedSkillsRoot, getManagedManifestPath } from './paths'
import type { ManagedSkillManifest } from './pack/types'
import { migrateLegacyProjectToolReferences } from './legacy-project-tool-compat'

export type SkillSource = 'managed' | 'bundled'

export interface LoadedSkill {
  slug: string
  domain: string
  name: string
  description: string
  version: string
  checksum?: string
  source: SkillSource
  filePath: string
  baseDir: string
  content: string
  files: Array<{ path: string; content: string }>
  triggers: string[]
  componentTypes: string[]
  geometryFamily: string[]
  tags: string[]
  priority: number
  updatedAt?: string
}

const FRUSTUM_TEXT_PATTERN =
  /截头体|棱台|截锥|锥形独立基础|D[_\s-]?Jp|DJP|DJ\b|DU\b|h1\s*\/\s*h2|h1|h2|300\s*\/\s*600|300\s*\/\s*700/i
const MAX_CONTEXT_CHARS = 14_000
const VERIFIED_CAD_SKILL_SLUGS = new Set(['frustum-box-foundation'])

type AutoSkillContextMode = 'component_teaching'

class SkillRegistry {
  private cache: LoadedSkill[] | null = null

  refresh() {
    this.cache = null
  }

  listSkills(): LoadedSkill[] {
    if (!this.cache) {
      this.cache = this.loadSkills()
    }
    return this.cache
  }

  readSkill(slug: string): LoadedSkill | null {
    const normalized = slug.trim()
    if (!normalized) return null
    return this.listSkills().find((skill) => skill.slug === normalized) ?? null
  }

  buildAvailableSkillsPrompt(): string {
    const skills = this.listSkills()
    if (skills.length === 0) {
      return [
        '当前未加载 CAD 领域 skill。',
        '遇到截图/图纸算量任务时，先基于可见证据说明缺少 skill，而不是编造算法。',
      ].join('\n')
    }

    const lines = [
      '以下 CAD skills 提供构件算量的专门指令。',
      '统一对话默认不主动注入技能全文；仅当用户明确进入构件算法/算量任务时，才按需读取 skill。',
      '如果本轮上下文已经注入了 [skill_context]，优先遵循其中内容，不必重复读取。',
      '',
      '<available_skills>',
    ]
    for (const skill of skills) {
      lines.push('  <skill>')
      lines.push(`    <slug>${escapeXml(skill.slug)}</slug>`)
      lines.push(`    <name>${escapeXml(skill.name)}</name>`)
      lines.push(`    <description>${escapeXml(skill.description)}</description>`)
      lines.push(`    <version>${escapeXml(skill.version)}</version>`)
      lines.push(`    <source>${skill.source}</source>`)
      lines.push('  </skill>')
    }
    lines.push('</available_skills>')
    return lines.join('\n')
  }

  buildAutoSkillContext(input: {
    query: string
    hasImages: boolean
    mode: AutoSkillContextMode
  }): string {
    if (input.mode !== 'component_teaching') {
      return ''
    }
    const matched = this.matchSkills(input.query, input.hasImages)
    if (matched.length === 0) {
      return ''
    }
    return matched
      .map((skill) => renderSkillForContext(skill))
      .join('\n\n')
      .slice(0, MAX_CONTEXT_CHARS)
  }

  renderSkillContent(slug: string): string | null {
    const skill = this.readSkill(slug)
    if (!skill) return null
    return renderSkillForContext(skill)
  }

  private matchSkills(query: string, hasImages: boolean): LoadedSkill[] {
    const normalizedQuery = query.trim()
    const skills = this.listSkills()
    if (skills.length === 0 || !normalizedQuery) return []

    const scored = skills.flatMap((skill) => {
      let score = 0
      const frustumMatched = FRUSTUM_TEXT_PATTERN.test(normalizedQuery)
      if (skill.slug === 'frustum-box-foundation' && frustumMatched) {
        score += 18
        score += hasImages ? 6 : 0
      }
      for (const token of [...skill.triggers, ...skill.componentTypes, ...skill.tags]) {
        if (token && normalizedQuery.toLowerCase().includes(token.toLowerCase())) {
          score += 3
        }
      }
      if (score <= 0) return []
      return [{ skill, score: score + skill.priority }]
    })

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 1)
      .map((item) => item.skill)
  }

  private loadSkills(): LoadedSkill[] {
    const managedManifest = readManagedManifest()
    const managed = loadSkillsFromDomainRoot(
      path.join(getManagedSkillsRoot(), 'cad'),
      'managed',
      managedManifest,
    )
    const bundled = loadSkillsFromDomainRoot(getBundledCadSkillsRoot(), 'bundled', null)
    const bySlug = new Map<string, LoadedSkill>()
    for (const skill of [...managed, ...bundled]) {
      if (!bySlug.has(skill.slug)) {
        bySlug.set(skill.slug, skill)
      }
    }
    return [...bySlug.values()].sort((a, b) => b.priority - a.priority || a.slug.localeCompare(b.slug))
  }
}

const registry = new SkillRegistry()

export function getSkillRegistry() {
  return registry
}

export function refreshSkillRegistry() {
  registry.refresh()
}

function loadSkillsFromDomainRoot(
  domainRoot: string,
  source: SkillSource,
  manifest: ManagedSkillManifest | null,
): LoadedSkill[] {
  if (!fs.existsSync(domainRoot)) return []
  const domain = path.basename(domainRoot)
  return fs
    .readdirSync(domainRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory()
        && !entry.name.startsWith('.')
        && VERIFIED_CAD_SKILL_SLUGS.has(entry.name),
    )
    .flatMap((entry) => {
      const baseDir = path.join(domainRoot, entry.name)
      const skillPath = path.join(baseDir, 'SKILL.md')
      if (!fs.existsSync(skillPath)) return []
      const content = fs.readFileSync(skillPath, 'utf-8')
      const frontmatter = parseFrontmatter(content)
      const manifestSkill = manifest?.skills.find((item) => item.slug === entry.name)
      return [
        {
          slug: entry.name,
          domain,
          name: extractMarkdownTitle(content) || frontmatter.name || manifestSkill?.name || entry.name,
          description: frontmatter.description || manifestSkill?.description || entry.name,
          version: frontmatter.version || manifestSkill?.version || SKILL_PACK_METADATA.skill_pack_version,
          checksum: manifestSkill?.checksum,
          source,
          filePath: skillPath,
          baseDir,
          content: migrateLegacyProjectToolReferences(content),
          files: readSkillFiles(baseDir),
          triggers: readStringList(frontmatter.triggers),
          componentTypes: readStringList(frontmatter.component_types || frontmatter.component_type),
          geometryFamily: readStringList(frontmatter.geometry_family || frontmatter.geometry_shape),
          tags: readStringList(frontmatter.tags),
          priority: Number.parseInt(frontmatter.priority || '', 10) || 0,
          updatedAt: manifestSkill?.updated_at || (source === 'bundled' ? SKILL_PACK_METADATA.built_at : undefined),
        } satisfies LoadedSkill,
      ]
    })
}

function readSkillFiles(baseDir: string) {
  const files: Array<{ path: string; content: string }> = []
  for (const relativePath of ['SKILL.md']) {
    const fullPath = path.join(baseDir, relativePath)
    if (fs.existsSync(fullPath)) {
      files.push({
        path: relativePath,
        content: migrateLegacyProjectToolReferences(fs.readFileSync(fullPath, 'utf-8')),
      })
    }
  }
  const referencesDir = path.join(baseDir, 'references')
  if (fs.existsSync(referencesDir)) {
    for (const entry of fs.readdirSync(referencesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(md|json)$/i.test(entry.name)) continue
      const relativePath = path.posix.join('references', entry.name)
      files.push({
        path: relativePath,
        content: migrateLegacyProjectToolReferences(
          fs.readFileSync(path.join(referencesDir, entry.name), 'utf-8'),
        ),
      })
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function readManagedManifest(): ManagedSkillManifest | null {
  const manifestPath = getManagedManifestPath()
  if (!fs.existsSync(manifestPath)) return null
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManagedSkillManifest
  } catch {
    return null
  }
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

function renderSkillForContext(skill: LoadedSkill) {
  const lines = [
    `[Skill: ${skill.slug}]`,
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `version: ${skill.version}`,
    `source: ${skill.source}`,
    '',
  ]
  for (const file of skill.files) {
    lines.push(`--- ${file.path} ---`)
    lines.push(file.content.trim())
    lines.push('')
  }
  return lines.join('\n').trim()
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
