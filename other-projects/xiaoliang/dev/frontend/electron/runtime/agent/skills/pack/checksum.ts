import crypto from 'node:crypto'
import type { SkillPackPayload, SkillPackSkill } from './types'

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

export function sha256Text(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

export function calculateSkillChecksum(files: SkillPackSkill['files']) {
  const hash = crypto.createHash('sha256')
  for (const file of [...files].sort((a, b) => compareLexical(a.path, b.path))) {
    hash.update(file.path, 'utf8')
    hash.update('\0')
    hash.update(file.content, 'utf8')
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function calculatePackChecksum(pack: SkillPackPayload) {
  const payload = {
    pack_format_version: Number(pack.pack_format_version),
    release_channel: String(pack.release_channel),
    skill_pack_version: String(pack.skill_pack_version),
    skills: [...pack.skills]
      .sort((a, b) => compareLexical(a.slug, b.slug))
      .map((skill) => ({
        slug: skill.slug,
        domain: skill.domain,
        version: skill.version,
        checksum: skill.checksum,
      })),
  }
  return crypto.createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')
}

function compareLexical(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
