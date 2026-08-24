import path from 'node:path'

import { RESEARCH_ANALYST_AGENT_TYPE, type SubagentType } from './contracts'

const DATA_URI_PATTERN = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/iu
const LONG_BASE64_PATTERN = /(?:[A-Za-z0-9+/]{4}){512,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/u
const WINDOWS_ABSOLUTE_PATH_PATTERN = /(?:^|[\s`"'(:：])(?:[A-Za-z]:[\\/]|\\\\)/mu
const POSIX_ABSOLUTE_PATH_PATTERN = /(?:^|[\s`"'(:：])\/(?!\/)[A-Za-z0-9._~-]+(?:\/[^\s`"'<>)]*)?/mu
const FILE_URI_PATTERN = /file:\/\//iu
const AUTHORIZATION_PATTERN = /authorization\s*:\s*bearer\s+\S+/iu
const SECRET_ASSIGNMENT_PATTERN = /(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/iu

export const CAD_ARTIFACT_ROOT = '.xiaoliang/cad'
export const RESEARCH_ARTIFACT_ROOT = '.xiaoliang/research'

/** Every project-relative root a subagent may publish artifacts under. */
export const SUBAGENT_ARTIFACT_ROOTS: readonly string[] = Object.freeze([
  CAD_ARTIFACT_ROOT,
  RESEARCH_ARTIFACT_ROOT,
])

/**
 * Each child publishes under exactly one root. Checking against the type rather than the
 * union keeps a CAD child from claiming a research path and vice versa.
 */
export function artifactRootForSubagentType(type: SubagentType): string {
  return type === RESEARCH_ANALYST_AGENT_TYPE ? RESEARCH_ARTIFACT_ROOT : CAD_ARTIFACT_ROOT
}

/**
 * Only the per-run evidence pack (<root>/evidence/<runId>/evidence.md) proves a run's
 * result; other published refs (shared research pages, salvage files) carry no run identity.
 */
export const CANONICAL_EVIDENCE_PACK_REF_PATTERN = /\/evidence\/[^/]+\/evidence\.md$/u

export function containsEmbeddedBinary(value: string): boolean {
  return DATA_URI_PATTERN.test(value) || LONG_BASE64_PATTERN.test(value)
}

export function containsSensitiveMaterial(value: string): boolean {
  return describeSensitiveMaterial(value) !== null
}

/**
 * Names what tripped the check. The caller is a model that has to rewrite the text, and a
 * delegation rejected with only "contains sensitive material" gets retried unchanged or,
 * worse, abandoned while the agent claims the child was dispatched.
 */
function describeSensitiveMaterial(value: string, allowHostPaths = false): string | null {
  if (containsEmbeddedBinary(value)) {
    return '内联了二进制或 base64 数据，请改为引用项目相对路径下的文件'
  }
  if (
    !allowHostPaths
    && (
      WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
      || POSIX_ABSOLUTE_PATH_PATTERN.test(value)
      || FILE_URI_PATTERN.test(value)
    )
  ) {
    return '含有绝对路径或 file:// 链接，请改写成项目相对路径（例如 xiaoliang-outputs/foo.blend）后重新委派'
  }
  if (AUTHORIZATION_PATTERN.test(value) || SECRET_ASSIGNMENT_PATTERN.test(value)) {
    return '含有凭证或密钥字样，请删除后重新委派'
  }
  return null
}

export function assertSafeSubagentText(label: string, value: string): void {
  const reason = describeSensitiveMaterial(value)
  if (reason) {
    throw new Error(`${label} ${reason}。子代理未启动。`)
  }
}

/** A completed Blender report may echo host paths returned by its tools. */
export function assertSafeCompletedBlenderReportText(label: string, value: string): void {
  const reason = describeSensitiveMaterial(value, true)
  if (reason) throw new Error(`${label} ${reason}。`)
}

export function normalizeProjectArtifactRef(
  rawValue: string,
  allowedRoots: readonly string[] = SUBAGENT_ARTIFACT_ROOTS,
): string {
  const value = rawValue.trim().replace(/\\/g, '/')
  if (!value || value.includes('\0') || value.includes('?') || value.includes('#')) {
    throw new Error('artifact ref 不能为空，也不能包含查询参数或片段。')
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new Error('artifact ref 必须是项目相对路径。')
  }

  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('artifact ref 包含非法路径片段。')
  }

  const normalized = segments.join('/')
  const insideAllowedRoot = allowedRoots.some((root) => (
    normalized === root || normalized.startsWith(`${root}/`)
  ))
  if (!insideAllowedRoot) {
    throw new Error(`artifact ref 必须位于 ${allowedRoots.map((root) => `${root}/`).join(' 或 ')}。`)
  }
  assertSafeSubagentText('artifact ref', normalized)
  return normalized
}

export function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}
