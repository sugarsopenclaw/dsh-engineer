export interface ParsedPiSessionArchive {
  jsonlSchemaVersion: number
  parentSessionFile: string | null
  currentLeafEntryId: string | null
  entryCount: number
}

export function parsePiSessionArchiveJsonl(
  data: Buffer,
  expectedSessionId: string,
): ParsedPiSessionArchive {
  if (data.byteLength === 0 || data[data.byteLength - 1] !== 0x0a) {
    throw new Error('Pi Session JSONL 尚未完成一行写入，将在下一次同步重试。')
  }
  const rawLines = data.toString('utf8').split('\n')
  if (rawLines.at(-1) === '') rawLines.pop()
  if (rawLines.length === 0) throw new Error('Pi Session JSONL 缺少 header。')
  const records = rawLines.map((line, index) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('record is not an object')
      }
      return parsed
    } catch (error) {
      throw new Error(
        `Pi Session JSONL 第 ${index + 1} 行无效: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
  const header = records[0]
  if (header.type !== 'session' || header.id !== expectedSessionId) {
    throw new Error('Pi Session JSONL header 与本地会话绑定不一致。')
  }
  const entries = records.slice(1)
  const currentLeafEntryId = entries.toReversed().find(
    (entry) => typeof entry.id === 'string' && entry.id.trim(),
  )?.id
  return {
    jsonlSchemaVersion: typeof header.version === 'number' && Number.isInteger(header.version)
      ? Math.max(1, header.version)
      : 1,
    parentSessionFile: typeof header.parentSession === 'string' && header.parentSession.trim()
      ? header.parentSession
      : null,
    currentLeafEntryId: typeof currentLeafEntryId === 'string' ? currentLeafEntryId : null,
    entryCount: entries.length,
  }
}
