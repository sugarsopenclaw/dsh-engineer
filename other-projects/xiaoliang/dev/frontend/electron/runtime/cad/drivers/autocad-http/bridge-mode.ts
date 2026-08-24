export type CadBridgeMode = 'stdio' | 'http'

export const DEFAULT_CAD_BRIDGE_MODE: CadBridgeMode = 'stdio'

export function getCadBridgeMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CadBridgeMode {
  const value = environment.XIAOLIANG_CAD_BRIDGE?.trim().toLowerCase()
  return value === 'http' ? 'http' : DEFAULT_CAD_BRIDGE_MODE
}
