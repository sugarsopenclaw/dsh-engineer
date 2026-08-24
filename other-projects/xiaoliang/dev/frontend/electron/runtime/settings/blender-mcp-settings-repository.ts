import { getDB } from '../db'
import {
  getDefaultBlenderMcpSettingsView,
  type BlenderMcpSettingsInput,
  type BlenderMcpSettingsView,
} from '../../../src/shared/local-agent'

interface BlenderMcpSettingsRow {
  enabled: number
  host: string
  port: number
  command: string
  args_json: string
  updated_at: string
}

function normalizeHost(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeCommand(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizePort(value: unknown, fallback: number) {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 65535) {
    return fallback
  }
  return numeric
}

function normalizeArgs(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback
  }
  const args = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
  return args.length > 0 ? args : fallback
}

function parseArgsJson(value: string, fallback: string[]) {
  try {
    return normalizeArgs(JSON.parse(value), fallback)
  } catch {
    return fallback
  }
}

function rowToView(row: BlenderMcpSettingsRow | undefined): BlenderMcpSettingsView {
  const fallback = getDefaultBlenderMcpSettingsView()
  if (!row) {
    return fallback
  }

  return {
    enabled: row.enabled !== 0,
    host: normalizeHost(row.host, fallback.host),
    port: normalizePort(row.port, fallback.port),
    command: normalizeCommand(row.command, fallback.command),
    args: parseArgsJson(row.args_json, fallback.args),
    updatedAt: row.updated_at ?? '',
  }
}

export function getBlenderMcpSettingsView(): BlenderMcpSettingsView {
  const row = getDB()
    .prepare(
      'SELECT enabled, host, port, command, args_json, updated_at FROM blender_mcp_settings WHERE id = 1',
    )
    .get() as BlenderMcpSettingsRow | undefined

  return rowToView(row)
}

export function saveBlenderMcpSettings(input: BlenderMcpSettingsInput): BlenderMcpSettingsView {
  const current = getBlenderMcpSettingsView()
  const next: BlenderMcpSettingsView = {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
    host: normalizeHost(input.host, current.host),
    port: normalizePort(input.port, current.port),
    command: normalizeCommand(input.command, current.command),
    args: normalizeArgs(input.args, current.args),
    updatedAt: current.updatedAt,
  }

  getDB()
    .prepare(
      `INSERT INTO blender_mcp_settings (
        id, enabled, host, port, command, args_json, updated_at
      )
      VALUES (1, ?, ?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        host = excluded.host,
        port = excluded.port,
        command = excluded.command,
        args_json = excluded.args_json,
        updated_at = excluded.updated_at`,
    )
    .run(next.enabled ? 1 : 0, next.host, next.port, next.command, JSON.stringify(next.args))

  return getBlenderMcpSettingsView()
}
