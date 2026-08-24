const DEFAULT_MAX_NOTIFIED_SUBAGENT_TASKS = 256

/**
 * Correlates a visible subagent-completion notification with the synthetic wake
 * that the same task may start. Entries are consumed exactly once and bounded
 * so completions handled via follow-up or an explicit wait cannot grow memory.
 */
export class AgentNotificationDeduplicator {
  private readonly notifiedSubagentTaskIds = new Map<string, true>()

  constructor(
    private readonly maxEntries = DEFAULT_MAX_NOTIFIED_SUBAGENT_TASKS,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error('maxEntries must be a positive safe integer.')
    }
  }

  markSubagentCompletionNotified(taskId: string): void {
    const normalizedTaskId = taskId.trim()
    if (!normalizedTaskId) return

    // Refresh insertion order if the same terminal snapshot is emitted again.
    this.notifiedSubagentTaskIds.delete(normalizedTaskId)
    this.notifiedSubagentTaskIds.set(normalizedTaskId, true)

    while (this.notifiedSubagentTaskIds.size > this.maxEntries) {
      const oldestTaskId = this.notifiedSubagentTaskIds.keys().next().value
      if (typeof oldestTaskId !== 'string') break
      this.notifiedSubagentTaskIds.delete(oldestTaskId)
    }
  }

  consumeSubagentWakeDuplicate(taskId?: string): boolean {
    const normalizedTaskId = taskId?.trim() || ''
    return normalizedTaskId
      ? this.notifiedSubagentTaskIds.delete(normalizedTaskId)
      : false
  }
}
