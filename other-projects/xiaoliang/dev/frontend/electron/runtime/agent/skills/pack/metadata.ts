export interface TrustedSkillMetadata {
  name: string
  description: string
}

/**
 * Derives installable display metadata only from SKILL.md, whose path and content are
 * already covered by the per-skill checksum. Pack-level display fields are untrusted hints.
 */
export function readTrustedSkillMetadata(
  slug: string,
  content: string,
): TrustedSkillMetadata {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) throw new Error(`skill ${slug} 的 SKILL.md 缺少 YAML frontmatter。`)
  const metadata = new Map<string, string>()
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!field) continue
    metadata.set(field[1], field[2].trim().replace(/^['"]+|['"]+$/g, ''))
  }
  if (metadata.get('name') !== slug) {
    throw new Error(`skill ${slug} 的 frontmatter name 必须与 slug 一致。`)
  }
  const description = metadata.get('description') || ''
  if (!description || description.length > 1024) {
    throw new Error(`skill ${slug} 的 frontmatter description 非法。`)
  }
  const body = match[2]
  if (!body.trim()) throw new Error(`skill ${slug} 的 SKILL.md 正文为空。`)
  if (body.split(/\r?\n/).length > 500) {
    throw new Error(`skill ${slug} 的 SKILL.md 正文超过 500 行。`)
  }
  const name = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || slug
  if (name.length > 120) {
    throw new Error(`skill ${slug} 的展示名称非法。`)
  }
  return { name, description }
}

export function verifyDeclaredSkillMetadata(input: {
  slug: string
  name: string
  description: string
  content: string
}): TrustedSkillMetadata {
  const trusted = readTrustedSkillMetadata(input.slug, input.content)
  if (input.name !== trusted.name) {
    throw new Error(`skill ${input.slug} 的展示名称与 SKILL.md 不一致。`)
  }
  if (input.description !== trusted.description) {
    throw new Error(`skill ${input.slug} 的描述与 SKILL.md 不一致。`)
  }
  return trusted
}
