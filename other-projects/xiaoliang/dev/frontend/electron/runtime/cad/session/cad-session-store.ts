import type { CadSessionDiff } from '../contracts/cad-dto'

function nowIso() {
  return new Date().toISOString()
}

export class CadSessionStore {
  private snapshot: CadSessionDiff | null = null

  getSnapshot() {
    return this.snapshot ? { ...this.snapshot } : null
  }

  merge(diff: Partial<CadSessionDiff>) {
    const previous = this.snapshot ?? { updatedAt: nowIso() }
    this.snapshot = {
      ...previous,
      ...diff,
      updatedAt: nowIso(),
    }
    return this.getSnapshot()
  }

  clear() {
    this.snapshot = null
  }
}
