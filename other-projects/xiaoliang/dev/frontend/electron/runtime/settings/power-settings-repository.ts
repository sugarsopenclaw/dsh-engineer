import { getDB } from '../db'
import {
  getDefaultPowerSettingsView,
  type PowerSettingsInput,
  type PowerSettingsView,
} from '../../../src/shared/local-agent'

interface PowerSettingsRow {
  prevent_sleep: number
  updated_at: string
}

export function getPowerSettings(): PowerSettingsView {
  const row = getDB()
    .prepare('SELECT prevent_sleep, updated_at FROM power_settings WHERE id = 1')
    .get() as PowerSettingsRow | undefined

  if (!row) return getDefaultPowerSettingsView()
  return {
    preventSleep: row.prevent_sleep !== 0,
    updatedAt: row.updated_at ?? '',
  }
}

export function savePowerSettings(input: PowerSettingsInput = {}): PowerSettingsView {
  const current = getPowerSettings()
  const preventSleep = typeof input.preventSleep === 'boolean'
    ? input.preventSleep
    : current.preventSleep

  getDB()
    .prepare(
      `INSERT INTO power_settings (id, prevent_sleep, updated_at)
       VALUES (1, ?, datetime('now','localtime'))
       ON CONFLICT(id) DO UPDATE SET
         prevent_sleep = excluded.prevent_sleep,
         updated_at = excluded.updated_at`,
    )
    .run(preventSleep ? 1 : 0)

  return getPowerSettings()
}
