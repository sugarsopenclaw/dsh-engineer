import fs from 'node:fs'
import path from 'node:path'
import { getBundledCadSkillsRoot } from '../paths'

export interface BundledSkillSummary {
  slug: string
  path: string
}

function getCadSkillsRoot() {
  return getBundledCadSkillsRoot()
}

export function listBundledCadSkills(): BundledSkillSummary[] {
  const root = getCadSkillsRoot()
  if (!fs.existsSync(root)) return []

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      slug: entry.name,
      path: path.join(root, entry.name, 'SKILL.md'),
    }))
    .filter((entry) => fs.existsSync(entry.path))
    .sort((a, b) => a.slug.localeCompare(b.slug))
}
