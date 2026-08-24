export const PI_FEATURE_FLAG_KEYS = [
  'pi_runtime_v2',
  'pi_session_jsonl',
  'pi_branching',
  'pi_extensions',
  'pi_coding_tools',
] as const

export type PiFeatureFlag = (typeof PI_FEATURE_FLAG_KEYS)[number]

export const PI_FEATURE_FLAG_ENV = {
  pi_runtime_v2: 'XIAOLIANG_PI_RUNTIME_V2',
  pi_session_jsonl: 'XIAOLIANG_PI_SESSION_JSONL',
  pi_branching: 'XIAOLIANG_PI_BRANCHING',
  pi_extensions: 'XIAOLIANG_PI_EXTENSIONS',
  pi_coding_tools: 'XIAOLIANG_PI_CODING_TOOLS',
} as const satisfies Record<PiFeatureFlag, string>

export type PiFeatureFlags = Readonly<Record<PiFeatureFlag, boolean>>

export const DEFAULT_PI_FEATURE_FLAGS: PiFeatureFlags = Object.freeze({
  pi_runtime_v2: true,
  pi_session_jsonl: true,
  pi_branching: true,
  pi_extensions: true,
  pi_coding_tools: true,
})

const ENABLED_VALUES = new Set(['1', 'true', 'on'])
const DISABLED_VALUES = new Set(['0', 'false', 'off'])

export function parsePiFeatureFlag(value: unknown, fallback = false): boolean {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (ENABLED_VALUES.has(normalized)) return true
  if (DISABLED_VALUES.has(normalized)) return false
  return fallback
}

export function getPiFeatureFlags(
  environment: NodeJS.ProcessEnv = process.env,
): PiFeatureFlags {
  return Object.freeze(Object.fromEntries(
    PI_FEATURE_FLAG_KEYS.map((flag) => {
      const configuredValue = environment[PI_FEATURE_FLAG_ENV[flag]]
      return [
        flag,
        configuredValue === undefined
          ? DEFAULT_PI_FEATURE_FLAGS[flag]
          : parsePiFeatureFlag(configuredValue),
      ]
    }),
  )) as PiFeatureFlags
}

export function isPiFeatureEnabled(
  flag: PiFeatureFlag,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const configuredValue = environment[PI_FEATURE_FLAG_ENV[flag]]
  return configuredValue === undefined
    ? DEFAULT_PI_FEATURE_FLAGS[flag]
    : parsePiFeatureFlag(configuredValue)
}
