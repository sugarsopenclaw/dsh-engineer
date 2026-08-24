export const SUBAGENT_TRACE_SCHEMA_VERSION = 2 as const

export type SubagentTraceRunStatus =
  | 'queued'
  | 'initializing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type SubagentTraceUploadStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'disabled'

export type SubagentTraceJsonValue =
  | null
  | boolean
  | number
  | string
  | SubagentTraceJsonValue[]
  | { [key: string]: SubagentTraceJsonValue }

export interface SubagentTraceUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost: number
}

export interface SubagentTraceBlobRef {
  type: 'blob_ref'
  sha256: string
  mimeType: string
  sizeBytes: number
  localRef: string
}

interface SubagentTraceEventBase {
  schemaVersion: typeof SUBAGENT_TRACE_SCHEMA_VERSION
  sequence: number
  childRunId: string
  conversationId: string
  at: string
}

export type SubagentTraceEvent =
  | (SubagentTraceEventBase & {
      type: 'run_started'
      agentType: string
      description: string
      task: string
      model: string
      thinkingMode: 'fast' | 'deep'
    })
  | (SubagentTraceEventBase & { type: 'agent_start' | 'agent_end' })
  | (SubagentTraceEventBase & {
      type: 'turn_start' | 'turn_end'
      turnCount: number
      toolCallCount: number
    })
  | (SubagentTraceEventBase & {
      type: 'assistant_delta'
      kind: 'text' | 'thinking' | 'tool_call'
      contentIndex: number
      delta: string
    })
  | (SubagentTraceEventBase & {
      type: 'assistant_message'
      content: SubagentTraceJsonValue
      stopReason?: string
      usage?: SubagentTraceUsage
    })
  | (SubagentTraceEventBase & {
      type: 'tool_start'
      toolCallId: string
      toolName: string
      args: SubagentTraceJsonValue
    })
  | (SubagentTraceEventBase & {
      type: 'tool_update'
      toolCallId: string
      toolName: string
      partialResult: SubagentTraceJsonValue
    })
  | (SubagentTraceEventBase & {
      type: 'tool_end'
      toolCallId: string
      toolName: string
      result: SubagentTraceJsonValue
      isError: boolean
    })
  | (SubagentTraceEventBase & {
      type: 'run_finished'
      status: Extract<SubagentTraceRunStatus, 'completed' | 'failed' | 'cancelled'>
      errorCode: string | null
    })

type SubagentTraceEventEnvelopeKeys = keyof SubagentTraceEventBase

export type SubagentTraceEventDraft = SubagentTraceEvent extends infer Event
  ? Event extends SubagentTraceEvent
    ? Omit<Event, SubagentTraceEventEnvelopeKeys>
    : never
  : never

export interface SubagentTraceEventBatch {
  conversationId: string
  childRunId: string
  events: SubagentTraceEvent[]
}

export interface SubagentTraceRunSummary {
  childRunId: string
  agentType: string
  description: string
  taskPreview: string
  conversationId: string
  parentPromptId: string
  clientRunId: string
  projectId: string
  model: string
  status: SubagentTraceRunStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number
  usage: SubagentTraceUsage
  toolCallCount: number
  artifactRefs: string[]
  errorCode: string | null
  errorMessage: string | null
  eventCount: number
  lastSequence: number
  traceAvailable: boolean
  traceCompressed: boolean
  traceSha256: string | null
  traceSizeBytes: number
  uploadStatus: SubagentTraceUploadStatus
  remoteStorageKey: string | null
  uploadedAt: string | null
  uploadError: string | null
}

export interface SubagentTracePage {
  childRunId: string
  events: SubagentTraceEvent[]
  nextSequence: number
  hasMore: boolean
}

export interface SubagentTraceBlobData {
  sha256: string
  mimeType: string
  sizeBytes: number
  data: string
}
