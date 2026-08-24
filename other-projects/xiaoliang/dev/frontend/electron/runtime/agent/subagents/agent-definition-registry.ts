import fs from 'node:fs'
import path from 'node:path'

import {
  ACTIVE_SUBAGENT_TYPES,
  BLENDER_MODELER_AGENT_TYPE,
  CAD_ANALYST_AGENT_TYPE,
  CAD_DRAFTER_AGENT_TYPE,
  type SubagentType,
} from './contracts'
import { isPathInsideRoot } from './security'

export const SUBAGENT_MODEL = 'xiaoliang-backend/qwen3.8-max'
export const CAD_ANALYST_MODEL = SUBAGENT_MODEL
export const CAD_DRAFTER_MODEL = SUBAGENT_MODEL
export const BLENDER_MODELER_MODEL = SUBAGENT_MODEL

export const CAD_ANALYST_TOOL_CEILING = Object.freeze([
  'read',
  'grep',
  'cad_search',
  'find',
  'ls',
  'cad_app',
  'cad_artifacts',
  'cad_extract',
  'cad_query',
  'cad_capture',
  'cad_detail',
  'cad_doctor',
] as const)

/**
 * The drafter's ceiling grows with its tool surface: `resolveAgentTools` and
 * `validateChildTools` require the definition frontmatter, this list, and the tool
 * factory output to agree exactly, so a tool cannot be declared before it exists.
 */
export const CAD_DRAFTER_TOOL_CEILING = Object.freeze([
  'read',
  'grep',
  'cad_search',
  'find',
  'ls',
  'cad_open',
  'cad_layers',
  'cad_extract',
  'cad_measure',
  'cad_capture',
  'cad_detail',
  'cad_query',
] as const)

export const BLENDER_MODELER_TOOL_CEILING = Object.freeze([
  'blender_mcp_status',
  'blender_mcp_get_scene_info',
  'blender_mcp_get_object_info',
  'blender_mcp_get_viewport_screenshot',
  'blender_mcp_execute_blender_code',
] as const)

export type AgentDefinitionThinking = 'inherit' | 'off' | 'low' | 'medium' | 'xhigh'

export interface AgentDefinition {
  name: SubagentType
  description: string
  model: string
  thinking: AgentDefinitionThinking
  contextInheritance: 'none'
  maxSubagentDepth: number
  tools: string[]
  systemPrompt: string
  sourcePath: string
}

export interface AgentDefinitionRegistryOptions {
  definitionsDir: string
  runtimeToolCeilings?: Partial<Record<SubagentType, readonly string[]>>
}

type ParsedFrontmatter = Record<string, string | string[]>

const REGISTERED_DEFINITIONS: Readonly<Partial<Record<SubagentType, string>>> = Object.freeze({
  [CAD_ANALYST_AGENT_TYPE]: 'cad-analyst.md',
  [CAD_DRAFTER_AGENT_TYPE]: 'cad-drafter.md',
  [BLENDER_MODELER_AGENT_TYPE]: 'blender-modeler.md',
})

export const REGISTERED_SUBAGENT_TYPES: readonly SubagentType[] = ACTIVE_SUBAGENT_TYPES

const ALLOWED_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'model',
  'thinking',
  'contextInheritance',
  'maxSubagentDepth',
  'tools',
])

const VALID_THINKING = new Set<AgentDefinitionThinking>([
  'inherit',
  'off',
  'low',
  'medium',
  'xhigh',
])

function unquoteScalar(rawValue: string): string {
  const value = rawValue.trim()
  if (!value) return ''
  const first = value[0]
  const last = value[value.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1)
  }
  if (first === '"' || first === "'" || last === '"' || last === "'") {
    throw new Error('Agent frontmatter contains an unterminated quoted scalar.')
  }
  return value
}

function parseFrontmatter(content: string): { frontmatter: ParsedFrontmatter; body: string } {
  const normalized = content.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '---') {
    throw new Error('Agent definition must start with YAML frontmatter.')
  }

  const endIndex = lines.indexOf('---', 1)
  if (endIndex < 0) {
    throw new Error('Agent definition has unterminated YAML frontmatter.')
  }

  const frontmatter: ParsedFrontmatter = Object.create(null) as ParsedFrontmatter
  let listKey: string | null = null

  for (const line of lines.slice(1, endIndex)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue

    const listMatch = /^\s{2}-\s+(.+)$/.exec(line)
    if (listMatch) {
      if (!listKey) throw new Error('Agent frontmatter list item has no owning key.')
      const current = frontmatter[listKey]
      if (!Array.isArray(current)) throw new Error(`Agent frontmatter field "${listKey}" is not a list.`)
      const item = unquoteScalar(listMatch[1])
      if (!item) throw new Error(`Agent frontmatter field "${listKey}" contains an empty item.`)
      current.push(item)
      continue
    }

    if (/^\s/.test(line)) {
      throw new Error('Agent frontmatter only supports top-level scalars and two-space lists.')
    }

    const fieldMatch = /^([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))$/.exec(line)
    if (!fieldMatch) throw new Error(`Invalid agent frontmatter line: ${line}`)
    const [, key, rawValue] = fieldMatch
    if (!ALLOWED_FRONTMATTER_KEYS.has(key)) {
      throw new Error(`Unknown agent frontmatter field "${key}".`)
    }
    if (Object.hasOwn(frontmatter, key)) {
      throw new Error(`Duplicate agent frontmatter field "${key}".`)
    }

    const scalar = unquoteScalar(rawValue)
    if (scalar) {
      frontmatter[key] = scalar
      listKey = null
    } else {
      frontmatter[key] = []
      listKey = key
    }
  }

  const body = lines.slice(endIndex + 1).join('\n').trim()
  return { frontmatter, body }
}

function requireScalar(frontmatter: ParsedFrontmatter, key: string): string {
  const value = frontmatter[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Agent frontmatter field "${key}" must be a non-empty scalar.`)
  }
  return value.trim()
}

function requireStringList(frontmatter: ParsedFrontmatter, key: string): string[] {
  const value = frontmatter[key]
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Agent frontmatter field "${key}" must be a non-empty list.`)
  }
  const normalized = value.map((item) => item.trim())
  if (normalized.some((item) => !item)) {
    throw new Error(`Agent frontmatter field "${key}" contains an empty item.`)
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Agent frontmatter field "${key}" contains duplicate items.`)
  }
  return normalized
}

/**
 * The definition that is actually read lives in the build output, which can lag its source.
 * Naming the file keeps a stale bundled copy from reading as a mistake in the ceiling.
 */
function describeDefinitionSource(sourcePath: string | undefined): string {
  if (!sourcePath) return ''
  return ` Declared in ${sourcePath}; a bundled copy that lags its source is the usual cause.`
}

export function resolveAgentTools(
  configuredTools: readonly string[],
  runtimeCeiling: readonly string[],
  sourcePath?: string,
): string[] {
  const ceiling = new Set(runtimeCeiling)
  const denied = configuredTools.filter((tool) => !ceiling.has(tool))
  if (denied.length > 0) {
    throw new Error(
      `Agent definition requests tools outside the runtime ceiling: ${denied.join(', ')}.`
      + ` The runtime allows: ${runtimeCeiling.join(', ')}.`
      + describeDefinitionSource(sourcePath),
    )
  }
  return configuredTools.filter((tool) => ceiling.has(tool))
}

function assertExactToolSet(
  name: SubagentType,
  tools: readonly string[],
  expectedTools: readonly string[],
  sourcePath?: string,
): void {
  const configured = new Set(tools)
  const missing = expectedTools.filter((tool) => !configured.has(tool))
  if (missing.length > 0 || configured.size !== expectedTools.length) {
    throw new Error(
      `${name} tools must exactly match its fixed tool set; missing: ${missing.join(', ') || 'none'}.`
      + describeDefinitionSource(sourcePath),
    )
  }
}

export function parseAgentDefinition(input: {
  expectedName: SubagentType
  sourcePath: string
  content: string
  runtimeToolCeiling: readonly string[]
}): AgentDefinition {
  if (Buffer.byteLength(input.content, 'utf8') > 128 * 1024) {
    throw new Error('Agent definition exceeds the 128 KiB size limit.')
  }

  const { frontmatter, body } = parseFrontmatter(input.content)
  const name = requireScalar(frontmatter, 'name')
  if (name !== input.expectedName) {
    throw new Error(`Agent definition must declare name "${input.expectedName}".`)
  }
  if (!body) throw new Error('Agent definition must have a non-empty system prompt body.')

  const description = requireScalar(frontmatter, 'description')
  if (description.length > 500) throw new Error('Agent description exceeds 500 characters.')

  const model = requireScalar(frontmatter, 'model')
  if (model !== SUBAGENT_MODEL) {
    throw new Error(`${input.expectedName} model must be "${SUBAGENT_MODEL}".`)
  }

  const thinking = requireScalar(frontmatter, 'thinking')
  if (!VALID_THINKING.has(thinking as AgentDefinitionThinking)) {
    throw new Error(`Unsupported agent thinking mode "${thinking}".`)
  }

  const contextInheritance = requireScalar(frontmatter, 'contextInheritance')
  if (contextInheritance !== 'none') {
    throw new Error('Subagent contextInheritance must be "none".')
  }

  const rawDepth = requireScalar(frontmatter, 'maxSubagentDepth')
  if (!/^\d+$/.test(rawDepth)) throw new Error('maxSubagentDepth must be a non-negative integer.')
  const maxSubagentDepth = Number(rawDepth)
  if (maxSubagentDepth !== 0) throw new Error(`${input.expectedName} maxSubagentDepth must be 0.`)

  const tools = resolveAgentTools(
    requireStringList(frontmatter, 'tools'),
    input.runtimeToolCeiling,
    input.sourcePath,
  )
  assertExactToolSet(input.expectedName, tools, input.runtimeToolCeiling, input.sourcePath)

  return {
    name: input.expectedName,
    description,
    model,
    thinking: thinking as AgentDefinitionThinking,
    contextInheritance: 'none',
    maxSubagentDepth,
    tools,
    systemPrompt: body,
    sourcePath: input.sourcePath,
  }
}

export class AgentDefinitionRegistry {
  private readonly definitionsRoot: string
  private readonly runtimeToolCeilings: Partial<Record<SubagentType, readonly string[]>>

  constructor(options: AgentDefinitionRegistryOptions) {
    if (!path.isAbsolute(options.definitionsDir)) {
      throw new Error('Agent definitionsDir must be an absolute trusted application path.')
    }
    this.definitionsRoot = fs.realpathSync(options.definitionsDir)
    this.runtimeToolCeilings = {
      [CAD_ANALYST_AGENT_TYPE]: options.runtimeToolCeilings?.[CAD_ANALYST_AGENT_TYPE]
        ?? CAD_ANALYST_TOOL_CEILING,
      [CAD_DRAFTER_AGENT_TYPE]: options.runtimeToolCeilings?.[CAD_DRAFTER_AGENT_TYPE]
        ?? CAD_DRAFTER_TOOL_CEILING,
      [BLENDER_MODELER_AGENT_TYPE]: options.runtimeToolCeilings?.[BLENDER_MODELER_AGENT_TYPE]
        ?? BLENDER_MODELER_TOOL_CEILING,
    }
  }

  load(name: string): AgentDefinition {
    if (!REGISTERED_SUBAGENT_TYPES.includes(name as SubagentType)) {
      throw new Error(`Unknown subagent definition "${name}".`)
    }
    const registeredName = name as SubagentType
    const filename = REGISTERED_DEFINITIONS[registeredName]
    const runtimeToolCeiling = this.runtimeToolCeilings[registeredName]
    if (!filename || !runtimeToolCeiling) {
      throw new Error(`Unknown subagent definition "${name}".`)
    }
    const candidate = path.resolve(this.definitionsRoot, filename)
    const sourcePath = fs.realpathSync(candidate)
    if (!isPathInsideRoot(this.definitionsRoot, sourcePath) || sourcePath === this.definitionsRoot) {
      throw new Error(`Agent definition "${name}" resolves outside the trusted application directory.`)
    }
    if (path.basename(sourcePath) !== filename) {
      throw new Error(`Agent definition "${name}" does not match its registered filename.`)
    }

    return parseAgentDefinition({
      expectedName: registeredName,
      sourcePath,
      content: fs.readFileSync(sourcePath, 'utf8'),
      runtimeToolCeiling,
    })
  }
}
