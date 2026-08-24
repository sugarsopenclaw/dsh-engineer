import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export function getManagedSkillsRoot() {
  const override = process.env.XIAOLIANG_SKILLS_USER_DATA_DIR?.trim()
  const userData = override || app.getPath('userData')
  return path.join(userData, 'skills', 'managed')
}

export function getManagedManifestPath() {
  return path.join(getManagedSkillsRoot(), 'manifest.json')
}

export function getBundledCadSkillsRoot() {
  const candidates = [
    path.resolve(__dirname, 'runtime', 'agent', 'skills', 'library', 'cad'),
    path.resolve(__dirname, 'library', 'cad'),
    path.resolve(__dirname, '..', 'library', 'cad'),
    path.resolve(process.cwd(), 'electron', 'runtime', 'agent', 'skills', 'library', 'cad'),
  ]
  return candidates.find((candidate) => candidate && pathExists(candidate)) ?? candidates[0]
}

function pathExists(filePath: string) {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}
