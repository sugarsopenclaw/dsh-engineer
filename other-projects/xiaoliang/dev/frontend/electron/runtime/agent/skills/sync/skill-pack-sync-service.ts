import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { SKILL_PACK_METADATA } from '../../../../../src/shared/skill-pack-metadata'
import type {
  SkillInstallUpdateInput,
  SkillInstallUpdateResult,
  SkillRuntimeStatus,
  SkillUpdateCheckResult,
} from '../../../../../src/shared/local-agent'
import { getSkillRegistry, refreshSkillRegistry } from '../registry'
import { getManagedManifestPath, getManagedSkillsRoot } from '../paths'
import { calculatePackChecksum, calculateSkillChecksum, sha256Text } from '../pack/checksum'
import { readTrustedSkillMetadata, verifyDeclaredSkillMetadata } from '../pack/metadata'
import { verifySkillPackSignature } from '../pack/signature'
import {
  TRUSTED_SKILL_PACK_PUBLIC_KEY_BASE64,
  TRUSTED_SKILL_PACK_SIGNING_KEY_ID,
} from '../pack/trust'
import type { ManagedSkillManifest, SkillPackPayload } from '../pack/types'
import { listLocalAlgorithms } from '../../algorithms/store'
import { getProjectDocumentSkillRegistry } from '../../document-skills/registry'
import { userSkillService } from '../../user-skills/service'

interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
  message?: string | null
}

interface BackendCheckResponse {
  status: 'up_to_date' | 'update_available' | 'unsupported_client'
  latest_skill_pack_version: string | null
  latest_skill_pack_checksum: string | null
  skill_count: number
  release_notes: string | null
  required_electron_version: string | null
}

const FALLBACK_BACKEND_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://127.0.0.1:8000'
  : 'https://xl.x3yun.com/api'
const ALLOWED_REMOTE_FILE_PATTERN = /^(SKILL\.md|references\/[^/]+\.(md|json))$/i
const SKILL_SLUG_PATTERN = /^(?=.{2,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/
const SKILL_DOMAIN_PATTERN = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_REMOTE_SKILLS = 50
const MAX_REMOTE_FILES_PER_SKILL = 50
const MAX_REMOTE_FILE_CHARS = 120_000
const MAX_REMOTE_PACK_CHARS = 2_000_000
type AccessTokenProvider = () => Promise<string | null>

export class SkillPackSyncService {
  constructor(private readonly getAccessToken: AccessTokenProvider) {}

  getStatus(): SkillRuntimeStatus {
    const manifest = readManagedManifest()
    const algorithms = listLocalAlgorithms()
    const userSkillStatus = userSkillService.getStatus()
    const skills = getSkillRegistry().listSkills().map((skill) => ({
      slug: skill.slug,
      domain: skill.domain,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      source: skill.source,
      checksum: skill.checksum,
      updatedAt: skill.updatedAt,
    }))
    const documentSkills = getProjectDocumentSkillRegistry().listSkills().map((skill) => ({
      slug: skill.slug,
      domain: 'general',
      name: skill.name,
      description: skill.description,
      version: skill.version,
      source: 'bundled' as const,
      updatedAt: SKILL_PACK_METADATA.built_at,
    }))

    if (manifest) {
      return {
        releaseChannel: manifest.release_channel,
        skillPackVersion: manifest.skill_pack_version,
        skillPackChecksum: manifest.skill_pack_checksum,
        builtAt: null,
        installedAt: manifest.installed_at,
        source: 'managed',
        skills,
        documentSkills,
        userSkills: userSkillStatus.skills,
        userSkillRootPath: userSkillStatus.rootPath,
        userSkillWarning: userSkillStatus.warning,
        algorithms,
      }
    }

    return {
      releaseChannel: 'stable',
      skillPackVersion: SKILL_PACK_METADATA.skill_pack_version,
      skillPackChecksum: SKILL_PACK_METADATA.skill_pack_checksum,
      builtAt: SKILL_PACK_METADATA.built_at,
      installedAt: null,
      source: 'bundled',
      skills,
      documentSkills,
      userSkills: userSkillStatus.skills,
      userSkillRootPath: userSkillStatus.rootPath,
      userSkillWarning: userSkillStatus.warning,
      algorithms,
    }
  }

  async checkUpdates(releaseChannel = 'stable'): Promise<SkillUpdateCheckResult> {
    releaseChannel = normalizeReleaseChannel(releaseChannel)
    const current = this.getStatus()
    const query = new URLSearchParams({
      release_channel: releaseChannel,
      electron_version: app.getVersion(),
      current_skill_pack_version: current.skillPackVersion,
      current_skill_pack_checksum: current.skillPackChecksum,
    })
    const data = await requestBackend<BackendCheckResponse>(
      `/skills/releases/check?${query}`,
      this.getAccessToken,
    )
    return {
      status: data.status,
      releaseChannel,
      currentSkillPackVersion: current.skillPackVersion,
      currentSkillPackChecksum: current.skillPackChecksum,
      latestSkillPackVersion: data.latest_skill_pack_version,
      latestSkillPackChecksum: data.latest_skill_pack_checksum,
      skillCount: data.skill_count || 0,
      releaseNotes: data.release_notes,
      requiredElectronVersion: data.required_electron_version,
    }
  }

  async installUpdate(input: SkillInstallUpdateInput = {}): Promise<SkillInstallUpdateResult> {
    const releaseChannel = normalizeReleaseChannel(input.releaseChannel || 'stable')
    const version = input.skillPackVersion?.trim()
    const expectedChecksum = input.expectedChecksum?.trim()
    const query = new URLSearchParams({ release_channel: releaseChannel })
    if (version) {
      query.set('skill_pack_version', version)
    }
    const pack = await requestBackend<SkillPackPayload>(
      `/skills/releases/pack?${query}`,
      this.getAccessToken,
    )
    validatePack(pack, expectedChecksum || null)
    writeManagedPack(pack)
    refreshSkillRegistry()
    const status = this.getStatus()
    return {
      status,
      installedVersion: pack.skill_pack_version,
      installedChecksum: pack.skill_pack_checksum,
    }
  }
}

export function validatePack(
  pack: SkillPackPayload,
  expectedChecksum: string | null,
  publicKeyBase64 = TRUSTED_SKILL_PACK_PUBLIC_KEY_BASE64,
  trustedKeyId = TRUSTED_SKILL_PACK_SIGNING_KEY_ID,
) {
  if (!pack || typeof pack !== 'object') {
    throw new Error('skill 包格式错误。')
  }
  if (pack.pack_format_version !== 1) {
    throw new Error(`不支持的 skill 包格式版本：${pack.pack_format_version}`)
  }
  if (!Array.isArray(pack.skills) || pack.skills.length === 0) {
    throw new Error('skill 包中没有可安装的 skill。')
  }
  if (pack.skills.length > MAX_REMOTE_SKILLS) {
    throw new Error(`skill 包最多允许 ${MAX_REMOTE_SKILLS} 个 skill。`)
  }
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(pack.release_channel)) {
    throw new Error(`非法 release channel：${pack.release_channel}`)
  }
  const calculatedPackChecksum = calculatePackChecksum(pack)
  if (calculatedPackChecksum !== pack.skill_pack_checksum) {
    throw new Error('skill 包 checksum 校验失败。')
  }
  if (expectedChecksum && expectedChecksum !== pack.skill_pack_checksum) {
    throw new Error('下载到的 skill 包与检查结果不一致。')
  }
  verifySkillPackSignature(pack, publicKeyBase64, trustedKeyId)

  const seen = new Set<string>()
  let totalChars = 0
  for (const skill of pack.skills) {
    if (!SKILL_SLUG_PATTERN.test(skill.slug)) {
      throw new Error(`非法 skill slug：${skill.slug}`)
    }
    if (!SKILL_DOMAIN_PATTERN.test(skill.domain)) {
      throw new Error(`非法 skill domain：${skill.domain}`)
    }
    if (typeof skill.name !== 'string' || !skill.name.trim() || skill.name.length > 120) {
      throw new Error(`skill ${skill.slug} 的展示名称非法。`)
    }
    if (typeof skill.description !== 'string' || !skill.description.trim() || skill.description.length > 1024) {
      throw new Error(`skill ${skill.slug} 的描述非法。`)
    }
    if (seen.has(skill.slug)) {
      throw new Error(`重复 skill slug：${skill.slug}`)
    }
    seen.add(skill.slug)
    if (!Array.isArray(skill.files) || !skill.files.some((file) => file.path === 'SKILL.md')) {
      throw new Error(`skill ${skill.slug} 缺少 SKILL.md。`)
    }
    if (skill.files.length > MAX_REMOTE_FILES_PER_SKILL) {
      throw new Error(`skill ${skill.slug} 文件过多。`)
    }
    const filePaths = new Set<string>()
    for (const file of skill.files) {
      if (typeof file.path !== 'string' || typeof file.content !== 'string' || typeof file.checksum !== 'string') {
        throw new Error(`skill ${skill.slug} 包含格式错误的文件。`)
      }
      const normalizedPath = file.path.replace(/\\/g, '/')
      if (normalizedPath !== file.path || !ALLOWED_REMOTE_FILE_PATTERN.test(normalizedPath)) {
        throw new Error(`skill ${skill.slug} 包含不允许的文件：${file.path}`)
      }
      if (filePaths.has(normalizedPath)) {
        throw new Error(`skill ${skill.slug} 包含重复文件：${file.path}`)
      }
      filePaths.add(normalizedPath)
      if (file.content.length > MAX_REMOTE_FILE_CHARS) {
        throw new Error(`skill ${skill.slug} 文件过大：${file.path}`)
      }
      totalChars += file.content.length
      if (totalChars > MAX_REMOTE_PACK_CHARS) {
        throw new Error('skill 包内容过大。')
      }
      if (sha256Text(file.content) !== file.checksum) {
        throw new Error(`skill ${skill.slug} 文件 checksum 校验失败：${file.path}`)
      }
    }
    if (calculateSkillChecksum(skill.files) !== skill.checksum) {
      throw new Error(`skill ${skill.slug} checksum 校验失败。`)
    }
    const skillMarkdown = skill.files.find((file) => file.path === 'SKILL.md')!.content
    verifyDeclaredSkillMetadata({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      content: skillMarkdown,
    })
  }
}

function writeManagedPack(pack: SkillPackPayload) {
  const root = getManagedSkillsRoot()
  const parent = path.dirname(root)
  const tmpRoot = path.join(parent, `.managed-${Date.now()}`)
  const backupRoot = path.join(parent, `.managed-backup-${Date.now()}`)
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  fs.mkdirSync(tmpRoot, { recursive: true })

  for (const skill of pack.skills) {
    const skillRoot = path.join(tmpRoot, skill.domain, skill.slug)
    fs.mkdirSync(skillRoot, { recursive: true })
    for (const file of skill.files) {
      const target = path.join(skillRoot, file.path)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, file.content, 'utf-8')
    }
  }

  const manifest: ManagedSkillManifest = {
    pack_format_version: pack.pack_format_version,
    release_channel: pack.release_channel,
    skill_pack_version: pack.skill_pack_version,
    skill_pack_checksum: pack.skill_pack_checksum,
    installed_at: new Date().toISOString(),
    skills: pack.skills.map((skill) => {
      const skillMarkdown = skill.files.find((file) => file.path === 'SKILL.md')!.content
      const trustedMetadata = readTrustedSkillMetadata(skill.slug, skillMarkdown)
      return {
        slug: skill.slug,
        domain: skill.domain,
        name: trustedMetadata.name,
        description: trustedMetadata.description,
        version: skill.version,
        checksum: skill.checksum,
        updated_at: skill.updated_at,
        source: 'managed',
      }
    }),
  }
  fs.writeFileSync(path.join(tmpRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')

  fs.mkdirSync(parent, { recursive: true })
  try {
    if (fs.existsSync(root)) {
      fs.renameSync(root, backupRoot)
    }
    fs.renameSync(tmpRoot, root)
    fs.rmSync(backupRoot, { recursive: true, force: true })
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true })
    if (fs.existsSync(backupRoot)) {
      fs.renameSync(backupRoot, root)
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    throw error
  }
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

export async function requestBackend<T>(
  pathName: string,
  getAccessToken: AccessTokenProvider,
): Promise<T> {
  const accessToken = (await getAccessToken())?.trim()
  if (!accessToken) {
    throw new Error('请先登录后再检查或安装 skill 更新。')
  }
  const response = await fetch(`${getBackendBaseUrl()}${pathName}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const payload = (await response.json()) as ApiResponse<T>
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || payload.message || `请求失败 (${response.status})`)
  }
  return payload.data
}

function getBackendBaseUrl() {
  return (
    process.env.XIAOLIANG_BACKEND_BASE_URL?.trim()
    || process.env.VITE_BACKEND_BASE_URL?.trim()
    || FALLBACK_BACKEND_BASE_URL
  ).replace(/\/+$/, '')
}

function normalizeReleaseChannel(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(normalized)) {
    throw new Error(`非法 skill release channel：${value}`)
  }
  return normalized
}
