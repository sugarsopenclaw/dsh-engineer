import { powerSaveBlocker } from 'electron'

let blockerId: number | null = null

function blockerIsActive(): boolean {
  if (blockerId === null) return false
  try {
    return powerSaveBlocker.isStarted(blockerId)
  } catch {
    return false
  }
}

export function syncPowerSaveBlocker(enabled: boolean): void {
  if (enabled) {
    if (blockerIsActive()) return
    blockerId = powerSaveBlocker.start('prevent-app-suspension')
    return
  }

  if (blockerId !== null && blockerIsActive()) {
    powerSaveBlocker.stop(blockerId)
  }
  blockerId = null
}
