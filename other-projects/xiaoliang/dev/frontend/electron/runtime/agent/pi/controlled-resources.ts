import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { calculatePackChecksum, calculateSkillChecksum, sha256Text } from '../skills/pack/checksum'
import type { ManagedSkillManifest, SkillPackPayload, SkillPackSkill } from '../skills/pack/types'

export const XIAOLIANG_PROJECT_PROMPTS_RELATIVE_PATH = path.join('.xiaoliang', 'prompts')

export interface XiaoliangPiResourceDiagnostic {
  level: 'warning' | 'error'
  code:
    | 'bundled_skill_root_invalid'
    | 'managed_manifest_invalid'
    | 'managed_pack_checksum_mismatch'
    | 'managed_skill_invalid'
    | 'managed_skill_checksum_mismatch'
    | 'project_prompt_invalid'
    | 'pi_loader_diagnostic'
    | 'extension_runtime_error'
  message: string
  path?: string
}

export interface XiaoliangPiControlledResourceResolution {
  skillPaths: string[]
  promptTemplatePaths: string[]
  diagnostics: XiaoliangPiResourceDiagnostic[]
  revision: string
}

export interface ResolveXiaoliangPiControlledResourcesOptions {
  bundledSkillRoots?: readonly string[]
  managedSkillsRoot?: string | null
  projectRoot?: string | null
}

const SAFE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const SAFE_PROMPT_FILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}\.md$/i
const ALLOWED_MANAGED_REFERENCE_PATTERN = /^references\/[a-z0-9][a-z0-9._-]*\.(md|json)$/i
const MAX_MANIFEST_BYTES = 1_000_000
const MAX_MANAGED_FILES_PER_SKILL = 50
const MAX_MANAGED_FILE_CHARS = 120_000
const MAX_MANAGED_SKILL_CHARS = 2_000_000
const MAX_PROJECT_PROMPTS = 50
const MAX_PROJECT_PROMPT_CHARS = 64_000
const MAX_PROJECT_PROMPT_BYTES = MAX_PROJECT_PROMPT_CHARS * 4

/**
 * Resolve only resources owned or explicitly trusted by Xiaoliang.
 *
 * Pi's default ~/.pi and project .pi discovery stays disabled. Managed skills
 * are re-verified against the atomically installed manifest before their paths
 * are exposed, and project prompt templates are limited to regular Markdown
 * files directly under .xiaoliang/prompts.
 */
export function resolveXiaoliangPiControlledResources(
  options: ResolveXiaoliangPiControlledResourcesOptions,
): XiaoliangPiControlledResourceResolution {
  const skillPaths: string[] = []
  const promptTemplatePaths: string[] = []
  const diagnostics: XiaoliangPiResourceDiagnostic[] = []
  const revisionParts: string[] = []

  for (const candidate of options.bundledSkillRoots ?? []) {
    const root = normalizeExistingDirectory(candidate)
    if (!root) {
      diagnostics.push({
        level: 'error',
        code: 'bundled_skill_root_invalid',
        message: '内置 skill 目录不存在或不是普通目录。',
        path: path.resolve(candidate),
      })
      continue
    }
    skillPaths.push(root)
    revisionParts.push(`bundled:${root}`)
  }

  if (options.managedSkillsRoot?.trim()) {
    const managed = resolveVerifiedManagedSkills(options.managedSkillsRoot)
    skillPaths.push(...managed.skillPaths)
    diagnostics.push(...managed.diagnostics)
    revisionParts.push(...managed.revisionParts)
  }

  if (options.projectRoot?.trim()) {
    const projectPrompts = resolveProjectPromptTemplates(options.projectRoot)
    promptTemplatePaths.push(...projectPrompts.promptTemplatePaths)
    diagnostics.push(...projectPrompts.diagnostics)
    revisionParts.push(...projectPrompts.revisionParts)
  }

  return {
    skillPaths: dedupePaths(skillPaths),
    promptTemplatePaths: dedupePaths(promptTemplatePaths),
    diagnostics,
    revision: crypto
      .createHash('sha256')
      .update(revisionParts.sort().join('\0'), 'utf8')
      .digest('hex'),
  }
}

function resolveVerifiedManagedSkills(managedSkillsRoot: string): {
  skillPaths: string[]
  diagnostics: XiaoliangPiResourceDiagnostic[]
  revisionParts: string[]
} {
  const skillPaths: string[] = []
  const diagnostics: XiaoliangPiResourceDiagnostic[] = []
  const revisionParts: string[] = []
  const root = normalizeExistingDirectory(managedSkillsRoot)
  const manifestPath = path.join(path.resolve(managedSkillsRoot), 'manifest.json')
  if (!root) {
    if (fs.existsSync(path.resolve(managedSkillsRoot))) {
      diagnostics.push({
        level: 'error',
        code: 'managed_manifest_invalid',
        message: '托管 skill 根路径不是安全的普通目录。',
        path: path.resolve(managedSkillsRoot),
      })
    }
    return { skillPaths, diagnostics, revisionParts }
  }

  let manifest: ManagedSkillManifest
  try {
    const manifestStat = fs.lstatSync(manifestPath)
    if (manifestStat.isSymbolicLink() || !manifestStat.isFile() || manifestStat.size > MAX_MANIFEST_BYTES) {
      throw new Error('manifest.json 不是允许的普通文件或文件过大')
    }
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManagedSkillManifest
    validateManagedManifestShape(manifest)
  } catch (error) {
    diagnostics.push({
      level: 'error',
      code: 'managed_manifest_invalid',
      message: `托管 skill manifest 校验失败：${error instanceof Error ? error.message : String(error)}`,
      path: manifestPath,
    })
    return { skillPaths, diagnostics, revisionParts }
  }

  const calculatedPackChecksum = calculatePackChecksum(toChecksumPayload(manifest))
  if (calculatedPackChecksum !== manifest.skill_pack_checksum) {
    diagnostics.push({
      level: 'error',
      code: 'managed_pack_checksum_mismatch',
      message: '托管 skill 包 checksum 与 manifest 不一致，已拒绝加载整个托管包。',
      path: manifestPath,
    })
    return { skillPaths, diagnostics, revisionParts }
  }
  revisionParts.push(`managed-pack:${manifest.skill_pack_checksum}`)

  for (const entry of manifest.skills) {
    const skillRoot = path.join(root, entry.domain, entry.slug)
    try {
      const realSkillRoot = requireDirectoryInsideRoot(root, skillRoot)
      const files = readManagedSkillFiles(realSkillRoot)
      const actualChecksum = calculateSkillChecksum(files)
      if (actualChecksum !== entry.checksum) {
        diagnostics.push({
          level: 'error',
          code: 'managed_skill_checksum_mismatch',
          message: `托管 skill ${entry.slug} 的本地内容 checksum 不一致，已跳过。`,
          path: realSkillRoot,
        })
        continue
      }
      skillPaths.push(realSkillRoot)
      revisionParts.push(`managed-skill:${entry.domain}/${entry.slug}:${actualChecksum}`)
    } catch (error) {
      diagnostics.push({
        level: 'error',
        code: 'managed_skill_invalid',
        message: `托管 skill ${entry.slug} 校验失败：${error instanceof Error ? error.message : String(error)}`,
        path: skillRoot,
      })
    }
  }

  return { skillPaths, diagnostics, revisionParts }
}

function resolveProjectPromptTemplates(projectRoot: string): {
  promptTemplatePaths: string[]
  diagnostics: XiaoliangPiResourceDiagnostic[]
  revisionParts: string[]
} {
  const promptTemplatePaths: string[] = []
  const diagnostics: XiaoliangPiResourceDiagnostic[] = []
  const revisionParts: string[] = []
  const normalizedProjectRoot = normalizeExistingDirectory(projectRoot)
  if (!normalizedProjectRoot) return { promptTemplatePaths, diagnostics, revisionParts }

  const promptRoot = path.join(normalizedProjectRoot, XIAOLIANG_PROJECT_PROMPTS_RELATIVE_PATH)
  if (!fs.existsSync(promptRoot)) return { promptTemplatePaths, diagnostics, revisionParts }

  let realPromptRoot: string
  try {
    realPromptRoot = requireDirectoryInsideRoot(normalizedProjectRoot, promptRoot)
  } catch (error) {
    diagnostics.push({
      level: 'error',
      code: 'project_prompt_invalid',
      message: `项目 prompt templates 目录校验失败：${error instanceof Error ? error.message : String(error)}`,
      path: promptRoot,
    })
    return { promptTemplatePaths, diagnostics, revisionParts }
  }

  const entries = fs.readdirSync(realPromptRoot, { withFileTypes: true })
  let accepted = 0
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const filePath = path.join(realPromptRoot, entry.name)
    if (entry.isSymbolicLink()) {
      diagnostics.push({
        level: 'error',
        code: 'project_prompt_invalid',
        message: `项目 prompt template 不允许使用符号链接：${entry.name}`,
        path: filePath,
      })
      continue
    }
    if (!entry.isFile() || !SAFE_PROMPT_FILE_PATTERN.test(entry.name)) continue
    if (accepted >= MAX_PROJECT_PROMPTS) {
      diagnostics.push({
        level: 'warning',
        code: 'project_prompt_invalid',
        message: `项目 prompt templates 最多加载 ${MAX_PROJECT_PROMPTS} 个文件。`,
        path: realPromptRoot,
      })
      break
    }

    try {
      const realFilePath = fs.realpathSync(filePath)
      assertPathInsideRoot(realPromptRoot, realFilePath)
      if (fs.lstatSync(realFilePath).size > MAX_PROJECT_PROMPT_BYTES) {
        throw new Error(`文件超过 ${MAX_PROJECT_PROMPT_BYTES} bytes`)
      }
      const content = fs.readFileSync(realFilePath, 'utf8')
      if (!content.trim()) throw new Error('文件内容为空')
      if (content.length > MAX_PROJECT_PROMPT_CHARS) {
        throw new Error(`文件超过 ${MAX_PROJECT_PROMPT_CHARS} 字符`)
      }
      promptTemplatePaths.push(realFilePath)
      revisionParts.push(`project-prompt:${entry.name}:${sha256Text(content)}`)
      accepted += 1
    } catch (error) {
      diagnostics.push({
        level: 'error',
        code: 'project_prompt_invalid',
        message: `项目 prompt template ${entry.name} 校验失败：${error instanceof Error ? error.message : String(error)}`,
        path: filePath,
      })
    }
  }

  return { promptTemplatePaths, diagnostics, revisionParts }
}

function validateManagedManifestShape(manifest: ManagedSkillManifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest 不是对象')
  if (manifest.pack_format_version !== 1) throw new Error('不支持的 pack_format_version')
  if (typeof manifest.release_channel !== 'string' || !manifest.release_channel.trim()) {
    throw new Error('release_channel 无效')
  }
  if (typeof manifest.skill_pack_version !== 'string' || !manifest.skill_pack_version.trim()) {
    throw new Error('skill_pack_version 无效')
  }
  if (!/^[a-f0-9]{64}$/i.test(manifest.skill_pack_checksum)) {
    throw new Error('skill_pack_checksum 无效')
  }
  if (!Array.isArray(manifest.skills) || manifest.skills.length > 50) {
    throw new Error('skills 列表无效')
  }
  if (typeof manifest.installed_at !== 'string' || !manifest.installed_at.trim()) {
    throw new Error('installed_at 无效')
  }

  const seen = new Set<string>()
  for (const skill of manifest.skills) {
    if (!skill || typeof skill !== 'object') throw new Error('skill 条目无效')
    if (!SAFE_SEGMENT_PATTERN.test(skill.slug) || !SAFE_SEGMENT_PATTERN.test(skill.domain)) {
      throw new Error(`skill 路径字段无效：${String(skill.slug || '')}`)
    }
    if (!/^[a-f0-9]{64}$/i.test(skill.checksum)) {
      throw new Error(`skill checksum 无效：${skill.slug}`)
    }
    if (
      typeof skill.name !== 'string'
      || !skill.name.trim()
      || typeof skill.description !== 'string'
      || !skill.description.trim()
      || typeof skill.version !== 'string'
      || !skill.version.trim()
      || typeof skill.updated_at !== 'string'
      || !skill.updated_at.trim()
      || skill.source !== 'managed'
    ) {
      throw new Error(`skill 元数据无效：${skill.slug}`)
    }
    const key = `${skill.domain}/${skill.slug}`
    if (seen.has(key)) throw new Error(`重复 skill：${key}`)
    seen.add(key)
  }
}

function readManagedSkillFiles(skillRoot: string): SkillPackSkill['files'] {
  const files: SkillPackSkill['files'] = []
  const skillFile = path.join(skillRoot, 'SKILL.md')
  const skillStat = fs.lstatSync(skillFile)
  if (skillStat.isSymbolicLink() || !skillStat.isFile()) {
    throw new Error('缺少安全的 SKILL.md')
  }
  files.push(readManagedFile(skillRoot, skillFile, 'SKILL.md'))

  for (const entry of fs.readdirSync(skillRoot, { withFileTypes: true })) {
    if (entry.name === 'SKILL.md') continue
    const entryPath = path.join(skillRoot, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`不允许符号链接：${entry.name}`)
    if (entry.name !== 'references' || !entry.isDirectory()) {
      throw new Error(`包含未签入 manifest checksum 规则的资源：${entry.name}`)
    }
    for (const reference of fs.readdirSync(entryPath, { withFileTypes: true })) {
      const relativePath = path.posix.join('references', reference.name)
      if (
        reference.isSymbolicLink()
        || !reference.isFile()
        || !ALLOWED_MANAGED_REFERENCE_PATTERN.test(relativePath)
      ) {
        throw new Error(`包含不允许的 reference：${relativePath}`)
      }
      if (files.length >= MAX_MANAGED_FILES_PER_SKILL) {
        throw new Error(`skill 文件数超过 ${MAX_MANAGED_FILES_PER_SKILL}`)
      }
      files.push(readManagedFile(skillRoot, path.join(entryPath, reference.name), relativePath))
    }
  }

  const totalChars = files.reduce((total, file) => total + file.content.length, 0)
  if (totalChars > MAX_MANAGED_SKILL_CHARS) {
    throw new Error(`skill 内容超过 ${MAX_MANAGED_SKILL_CHARS} 字符`)
  }

  return files
}

function readManagedFile(root: string, filePath: string, relativePath: string): SkillPackSkill['files'][number] {
  const realFilePath = fs.realpathSync(filePath)
  assertPathInsideRoot(root, realFilePath)
  if (fs.lstatSync(realFilePath).size > MAX_MANAGED_FILE_CHARS * 4) {
    throw new Error(`skill 文件过大：${relativePath}`)
  }
  const content = fs.readFileSync(realFilePath, 'utf8')
  if (content.length > MAX_MANAGED_FILE_CHARS) {
    throw new Error(`skill 文件超过 ${MAX_MANAGED_FILE_CHARS} 字符：${relativePath}`)
  }
  return {
    path: relativePath,
    content,
    checksum: sha256Text(content),
  }
}

function toChecksumPayload(manifest: ManagedSkillManifest): SkillPackPayload {
  return {
    pack_format_version: manifest.pack_format_version,
    release_channel: manifest.release_channel,
    skill_pack_version: manifest.skill_pack_version,
    skill_pack_checksum: manifest.skill_pack_checksum,
    built_at: '',
    skills: manifest.skills.map((skill) => ({
      slug: skill.slug,
      domain: skill.domain,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      checksum: skill.checksum,
      updated_at: skill.updated_at,
      files: [],
    })),
  }
}

function normalizeExistingDirectory(candidate: string): string | null {
  const resolved = path.resolve(candidate)
  try {
    const stat = fs.lstatSync(resolved)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null
    return fs.realpathSync(resolved)
  } catch {
    return null
  }
}

function requireDirectoryInsideRoot(root: string, candidate: string): string {
  const stat = fs.lstatSync(candidate)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('路径不是安全的普通目录')
  }
  const realPath = fs.realpathSync(candidate)
  assertPathInsideRoot(root, realPath)
  return realPath
}

function assertPathInsideRoot(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw new Error('资源路径越过受控根目录')
}

function dedupePaths(paths: readonly string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of paths) {
    const normalized = path.resolve(candidate)
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}
