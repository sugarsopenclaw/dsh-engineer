import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  getShellConfig,
} from '@earendil-works/pi-coding-agent'

export interface PiCodingToolsOptions {
  /** 工具解析相对路径的根目录;主会话为当前项目根目录。 */
  cwd: string
  /** bash 依赖可用的 bash.exe(晓量托管 MinGit 或系统 Git Bash);探测失败时不注册。 */
  includeBash: boolean
  /** 显式 bash 路径(晓量托管运行时);null/undefined 走 SDK 默认探测。 */
  bashShellPath?: string | null
  /** bash spawn 时 prepend 到 PATH 的目录(托管 MinGit 的 usr/bin,提供 sed/awk/coreutils)。 */
  bashBinDir?: string | null
}

export const PI_CODING_TOOL_NAMES = Object.freeze([
  'read',
  'grep',
  'find',
  'ls',
  'edit',
  'write',
  'bash',
] as const)

const RESEARCH_ROOT_SEGMENTS = ['.xiaoliang', 'research'] as const
const RESEARCH_PAGES_SEGMENTS = [...RESEARCH_ROOT_SEGMENTS, 'pages'] as const

function isInsidePath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveToolPath(cwd: string, rawValue: unknown): string {
  const raw = typeof rawValue === 'string' && rawValue.trim() ? rawValue.trim() : '.'
  const withoutAt = raw.startsWith('@') ? raw.slice(1) : raw
  const expanded = withoutAt === '~'
    ? os.homedir()
    : withoutAt.startsWith('~/') || withoutAt.startsWith('~\\')
      ? path.join(os.homedir(), withoutAt.slice(2))
      : withoutAt
  const lexical = path.resolve(cwd, expanded)
  try {
    return fs.realpathSync(lexical)
  } catch {
    // write may target a file that does not exist yet. Resolve its nearest existing
    // ancestor so a junction/symlink alias cannot hide that the new file lands inside the
    // protected legacy research archive.
    let ancestor = lexical
    const missingSegments: string[] = []
    while (true) {
      try {
        const resolvedAncestor = fs.realpathSync(ancestor)
        return path.resolve(resolvedAncestor, ...missingSegments)
      } catch {
        const parent = path.dirname(ancestor)
        if (parent === ancestor) return lexical
        missingSegments.unshift(path.basename(ancestor))
        ancestor = parent
      }
    }
  }
}

function protectedRoots(cwd: string): { researchRoot: string; pagesRoot: string } {
  return {
    researchRoot: path.resolve(cwd, ...RESEARCH_ROOT_SEGMENTS),
    pagesRoot: path.resolve(cwd, ...RESEARCH_PAGES_SEGMENTS),
  }
}

function redactProtectedSearchOutput(
  result: any,
  searchRoot: string,
  pagesRoot: string,
  toolName: string,
): any {
  if (!result || !Array.isArray(result.content) || !isInsidePath(searchRoot, pagesRoot)) return result
  const relativePrefix = path.relative(searchRoot, pagesRoot).replace(/\\/gu, '/').replace(/\/$/u, '')
  const absolutePrefix = pagesRoot.replace(/\\/gu, '/')
  let removed = false
  const content = result.content.map((block: any) => {
    if (!block || block.type !== 'text' || typeof block.text !== 'string') return block
    const kept = block.text.split('\n').filter((line: string) => {
      const normalized = line.replace(/\\/gu, '/')
      const hidden = toolName === 'ls'
        ? path.resolve(searchRoot) === path.dirname(path.resolve(pagesRoot)) && /^pages\/?$/iu.test(normalized.trim())
        : normalized.startsWith(`${relativePrefix}/`)
          || normalized.startsWith(`${absolutePrefix}/`)
      if (hidden) removed = true
      return !hidden
    })
    return {
      ...block,
      text: kept.join('\n').trim() || 'No results outside protected research pages.',
    }
  })
  return removed ? { ...result, content } : result
}

/**
 * Retired research runs may still have raw pages and published evidence packs on disk.
 * Keep their original trust boundary: the parent may read a published pack, but generic
 * project tools cannot open the raw page store or mutate the historical archive.
 */
function protectResearchArtifacts(tool: AgentTool<any>, cwd: string): AgentTool<any> {
  const protectedToolNames = new Set(['read', 'grep', 'find', 'ls', 'edit', 'write'])
  if (!protectedToolNames.has(tool.name)) return tool
  return {
    ...tool,
    description: `${tool.description}\n历史调研归档：主 Agent 不能读取 .xiaoliang/research/pages，也不能修改 .xiaoliang/research。`,
    execute: async (...args: Parameters<typeof tool.execute>) => {
      const [, raw] = args
      const input = (raw ?? {}) as { path?: unknown }
      const target = resolveToolPath(cwd, input.path)
      const { researchRoot, pagesRoot } = protectedRoots(cwd)
      if ((tool.name === 'edit' || tool.name === 'write') && isInsidePath(researchRoot, target)) {
        throw new Error('历史调研归档由宿主管理，主 Agent 不能修改。')
      }
      if (isInsidePath(pagesRoot, target)) {
        throw new Error('历史调研网页原文保持封存；主 Agent 只能读取已发布的 evidence pack。')
      }
      const result = await tool.execute(...args)
      if (tool.name !== 'grep' && tool.name !== 'find' && tool.name !== 'ls') return result
      return redactProtectedSearchOutput(result, target, pagesRoot, tool.name)
    },
  }
}

/**
 * 系统 bash 探测原语:Windows 上只认 Git Bash / PATH 中的 bash.exe(不回退
 * cmd/PowerShell),找不到时 getShellConfig 抛错。结果按进程生命周期缓存;
 * 托管运行时准备完成后经 resetPiBashRuntimeCache(pi-bash-runtime)统一重置。
 */
let cachedBashAvailability: boolean | null = null

export function isPiBashAvailable(): boolean {
  if (cachedBashAvailability === null) {
    try {
      getShellConfig()
      cachedBashAvailability = true
    } catch {
      cachedBashAvailability = false
    }
  }
  return cachedBashAvailability
}

/** 仅用于测试隔离。 */
export function resetPiBashAvailabilityCache(): void {
  cachedBashAvailability = null
}

/**
 * Pi SDK 七个通用编程工具(read/grep/find/ls/edit/write/bash)。
 * LLM 对这些工具经过训练,承接项目文件的浏览、检索、读取与写入;
 * 富文档解析(doc_parse)与正式产物写入(project_artifact_create)仍走晓量自定义工具。
 */
export function buildPiCodingTools(options: PiCodingToolsOptions): AgentTool<any>[] {
  const tools: AgentTool<any>[] = [
    createReadTool(options.cwd),
    createGrepTool(options.cwd),
    createFindTool(options.cwd),
    createLsTool(options.cwd),
    createEditTool(options.cwd),
    createWriteTool(options.cwd),
  ]
  if (options.includeBash) {
    tools.push(createBashTool(options.cwd, buildBashToolOptions(options)))
  }
  return tools.map((tool) => protectResearchArtifacts(tool, options.cwd))
}

/**
 * 托管 MinGit 场景的 bash 工具配置:shellPath 指向托管 bash.exe;spawnHook 把
 * 托管 usr/bin prepend 到 PATH——直接 spawn MSYS bash 时 PATH 不含 /usr/bin,
 * 不注入的话 ls/sed/awk 等 coreutils 找不到。系统 Git Bash 场景返回 undefined,
 * 走 SDK 默认行为。
 */
export function buildBashToolOptions(
  options: Pick<PiCodingToolsOptions, 'bashShellPath' | 'bashBinDir'>,
): { shellPath?: string; spawnHook?: (context: BashSpawnContext) => BashSpawnContext } | undefined {
  const shellPath = options.bashShellPath?.trim()
  if (!shellPath) return undefined
  const binDir = options.bashBinDir?.trim()
  return {
    shellPath,
    ...(binDir
      ? {
        spawnHook: (context: BashSpawnContext) => {
          const pathKey = Object.keys(context.env)
            .find((key) => key.toLowerCase() === 'path') ?? 'PATH'
          const currentPath = context.env[pathKey] ?? ''
          if (currentPath.split(path.delimiter).includes(binDir)) return context
          return {
            ...context,
            env: {
              ...context.env,
              [pathKey]: `${binDir}${path.delimiter}${currentPath}`,
            },
          }
        },
      }
      : {}),
  }
}

interface BashSpawnContext {
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
}
