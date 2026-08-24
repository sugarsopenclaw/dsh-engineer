export interface SkillPackFile {
  path: string
  content: string
  checksum: string
}

export interface SkillPackSkill {
  slug: string
  domain: string
  name: string
  description: string
  version: string
  checksum: string
  updated_at: string
  files: SkillPackFile[]
}

export interface SkillPackSignature {
  algorithm: 'Ed25519'
  key_id: string
  value: string
}

export interface SkillPackPayload {
  pack_format_version: number
  release_channel: string
  skill_pack_version: string
  skill_pack_checksum: string
  built_at: string
  skills: SkillPackSkill[]
  signature?: SkillPackSignature
  metadata?: Record<string, unknown>
}

export interface ManagedSkillManifest {
  pack_format_version: number
  release_channel: string
  skill_pack_version: string
  skill_pack_checksum: string
  installed_at: string
  skills: Array<{
    slug: string
    domain: string
    name: string
    description: string
    version: string
    checksum: string
    updated_at: string
    source: 'managed'
  }>
}
