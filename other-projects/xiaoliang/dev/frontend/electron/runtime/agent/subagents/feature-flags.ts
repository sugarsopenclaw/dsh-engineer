export type CadSubagentMode = 'off' | 'canary' | 'on'
export type CadDrafterMode = 'off' | 'on'
export type SubagentBackgroundMode = 'off' | 'on'
export type SubagentInteractiveMode = 'off' | 'on'
export type MainWebFetchMode = 'off' | 'on'
export type WebRenderMode = 'off' | 'on'

// Production defaults. The CAD `off` switch pauses CAD automation and never
// restores direct parent tools; the background `off` switch only restores the
// foreground delegate await path. Drafter runs the file channel in parallel with
// the AutoCAD channel, so it defaults on and is only disabled for debugging.
export const DEFAULT_CAD_SUBAGENT_MODE: CadSubagentMode = 'on'
export const DEFAULT_CAD_DRAFTER_MODE: CadDrafterMode = 'on'
export const DEFAULT_SUBAGENT_BACKGROUND_MODE: SubagentBackgroundMode = 'on'
// Governs whether delegation hands the main conversation back to the user:
// prompts default to ending the turn, stop keeps background children alive, and
// idle wakes wait out a grace period. `off` restores the blocking-wait behaviour.
export const DEFAULT_SUBAGENT_INTERACTIVE_MODE: SubagentInteractiveMode = 'on'
export const DEFAULT_MAIN_WEB_FETCH_MODE: MainWebFetchMode = 'on'
// Hidden Chromium cannot pin every subresource connection to a pre-validated DNS answer.
// Keep arbitrary page JavaScript opt-in; dynamic shells safely fall back to Qwen by default.
export const DEFAULT_WEB_RENDER_MODE: WebRenderMode = 'off'

function parseOnOff<T extends 'off' | 'on'>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === '0' || normalized === 'false' || normalized === 'off') return 'off' as T
  if (normalized === '1' || normalized === 'true' || normalized === 'on') return 'on' as T
  return fallback
}

export function parseSubagentBackgroundMode(value: unknown): SubagentBackgroundMode {
  return parseOnOff(value, DEFAULT_SUBAGENT_BACKGROUND_MODE)
}

export function getSubagentBackgroundMode(
  environment: { XIAOLIANG_SUBAGENT_BACKGROUND?: string } = process.env,
): SubagentBackgroundMode {
  return parseSubagentBackgroundMode(environment.XIAOLIANG_SUBAGENT_BACKGROUND)
}

export function parseSubagentInteractiveMode(value: unknown): SubagentInteractiveMode {
  return parseOnOff(value, DEFAULT_SUBAGENT_INTERACTIVE_MODE)
}

export function getSubagentInteractiveMode(
  environment: { XIAOLIANG_SUBAGENT_INTERACTIVE?: string } = process.env,
): SubagentInteractiveMode {
  return parseSubagentInteractiveMode(environment.XIAOLIANG_SUBAGENT_INTERACTIVE)
}

export function isSubagentInteractiveEnabled(
  environment: { XIAOLIANG_SUBAGENT_INTERACTIVE?: string } = process.env,
): boolean {
  return getSubagentInteractiveMode(environment) === 'on'
}

export function parseMainWebFetchMode(value: unknown): MainWebFetchMode {
  return parseOnOff(value, DEFAULT_MAIN_WEB_FETCH_MODE)
}

export function getMainWebFetchMode(
  environment: { XIAOLIANG_MAIN_WEB_FETCH?: string } = process.env,
): MainWebFetchMode {
  return parseMainWebFetchMode(environment.XIAOLIANG_MAIN_WEB_FETCH)
}

export function isMainWebFetchEnabled(
  environment: { XIAOLIANG_MAIN_WEB_FETCH?: string } = process.env,
): boolean {
  return getMainWebFetchMode(environment) === 'on'
}

export function parseWebRenderMode(value: unknown): WebRenderMode {
  return parseOnOff(value, DEFAULT_WEB_RENDER_MODE)
}

export function getWebRenderMode(
  environment: { XIAOLIANG_WEB_RENDER?: string } = process.env,
): WebRenderMode {
  return parseWebRenderMode(environment.XIAOLIANG_WEB_RENDER)
}

export function isWebRenderEnabled(
  environment: { XIAOLIANG_WEB_RENDER?: string } = process.env,
): boolean {
  return getWebRenderMode(environment) === 'on'
}

export function parseCadSubagentMode(value: unknown): CadSubagentMode {
  if (typeof value !== 'string') return DEFAULT_CAD_SUBAGENT_MODE
  const normalized = value.trim().toLowerCase()
  if (normalized === 'off' || normalized === 'canary' || normalized === 'on') {
    return normalized
  }
  return DEFAULT_CAD_SUBAGENT_MODE
}

export function getCadSubagentMode(
  environment: { XIAOLIANG_CAD_SUBAGENT?: string } = process.env,
): CadSubagentMode {
  return parseCadSubagentMode(environment.XIAOLIANG_CAD_SUBAGENT)
}

export function parseCadSubagentCanaryProjectIds(value: unknown): ReadonlySet<string> {
  if (typeof value !== 'string') return new Set()
  return new Set(
    value
      .split(/[;,\r\n]+/u)
      .map((projectId) => projectId.trim())
      .filter((projectId) => projectId.length > 0 && projectId.length <= 128),
  )
}

export function getCadSubagentCanaryProjectIds(
  environment: { XIAOLIANG_CAD_SUBAGENT_CANARY_PROJECT_IDS?: string } = process.env,
): ReadonlySet<string> {
  return parseCadSubagentCanaryProjectIds(
    environment.XIAOLIANG_CAD_SUBAGENT_CANARY_PROJECT_IDS,
  )
}

export function isCadSubagentEnabled(input: {
  mode: CadSubagentMode
  projectId?: string | null
  canaryProjectIds?: ReadonlySet<string>
}): boolean {
  if (input.mode === 'on') return true
  if (input.mode === 'off') return false
  const projectId = input.projectId?.trim() || ''
  return Boolean(projectId && input.canaryProjectIds?.has(projectId))
}

export function parseCadDrafterMode(value: unknown): CadDrafterMode {
  return parseOnOff(value, DEFAULT_CAD_DRAFTER_MODE)
}

export function getCadDrafterMode(
  environment: { XIAOLIANG_CAD_DRAFTER?: string } = process.env,
): CadDrafterMode {
  return parseCadDrafterMode(environment.XIAOLIANG_CAD_DRAFTER)
}

export function isCadDrafterEnabled(input: {
  cadEnabled: boolean
  drafterMode: CadDrafterMode
}): boolean {
  return input.cadEnabled && input.drafterMode === 'on'
}

/** Absolute ceiling on parallel drafter children, whatever the window budget says. */
const MAX_CAD_DRAFTER_CONCURRENT = 8

/**
 * How many drafter children may run at once.
 *
 * Every drafter tool call needs a window from the MLightCAD pool, so the ceiling follows
 * that budget rather than being an independent number: one slot is left over for a
 * concurrent analyst extraction, which also draws from the pool. The explicit override
 * exists for machines whose budget was raised after measuring real memory use.
 */
export function getCadDrafterMaxConcurrent(
  environment: {
    XIAOLIANG_CAD_DRAFTER_MAX_CONCURRENT?: string
    XIAOLIANG_MLIGHT_MAX_SESSIONS?: string
  } = process.env,
  windowBudget?: number,
): number {
  const clamp = (value: number): number => Math.min(
    MAX_CAD_DRAFTER_CONCURRENT,
    Math.max(1, Math.floor(value)),
  )
  const explicit = environment.XIAOLIANG_CAD_DRAFTER_MAX_CONCURRENT?.trim()
  if (explicit) {
    const parsed = Number.parseInt(explicit, 10)
    if (!Number.isNaN(parsed)) return clamp(parsed)
  }
  const budget = windowBudget ?? Number.parseInt(
    environment.XIAOLIANG_MLIGHT_MAX_SESSIONS?.trim() || '3',
    10,
  )
  return clamp((Number.isNaN(budget) ? 3 : budget) - 1)
}

export function getCadSubagentDeveloperToolsEnabled(
  environment: {
    NODE_ENV?: string
    XIAOLIANG_CAD_DEVELOPER_TOOLS?: string
  } = process.env,
): boolean {
  const explicit = environment.XIAOLIANG_CAD_DEVELOPER_TOOLS?.trim().toLowerCase()
  if (explicit === '1' || explicit === 'true' || explicit === 'on') return true
  if (explicit === '0' || explicit === 'false' || explicit === 'off') return false
  return environment.NODE_ENV === 'development'
}
