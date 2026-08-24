import type { SubagentCompletionNotice } from './subagent-completion'

export type LlmProvider = 'openai-compatible'
export type LlmApiMode = 'openai-completions'
export type LlmProfileId =
  | 'aliyun-bailian'
  | 'aliyun-coding-plan'
  | 'moonshot-kimi'
  | 'kimi-coding'
export type LlmModelInput = 'text' | 'image'
export type LlmReasoningLevel = 'off' | 'low' | 'medium' | 'high'
export type LlmReasoningMode = 'toggle' | 'budget'

type LlmReasoningEnabledLevel = Exclude<LlmReasoningLevel, 'off'>

export interface LlmModelReasoningSupport {
  mode: LlmReasoningMode
  defaultLevel: LlmReasoningEnabledLevel
  budgetByLevel?: Partial<Record<LlmReasoningEnabledLevel, number>>
  supportsPreserveThinking?: boolean
  note?: string
}

export interface LlmModelOption {
  id: string
  label: string
  input: LlmModelInput[]
  contextWindow: number
  maxInput?: number
  reasoning?: LlmModelReasoningSupport
  capabilities?: string[]
  summary?: string
}

export interface LlmProviderProfileCatalog {
  id: LlmProfileId
  vendor: string
  title: string
  description: string
  baseUrl: string
  provider: LlmProvider
  apiMode: LlmApiMode
  runtimeProvider: string
  defaultModel: string
  models: LlmModelOption[]
}

export interface LlmProfileSettingsView {
  profileId: LlmProfileId
  vendor: string
  title: string
  description: string
  baseUrl: string
  model: string
  reasoningLevel: LlmReasoningLevel
  hasApiKey: boolean
  updatedAt: string
  isActive: boolean
}

export interface LlmSettingsView {
  activeProfileId: LlmProfileId
  profiles: LlmProfileSettingsView[]
}

export interface LlmProfileSettingsInput {
  profileId: LlmProfileId
  model: string
  reasoningLevel?: LlmReasoningLevel
  makeActive?: boolean
}

export interface BlenderMcpSettingsView {
  enabled: boolean
  host: string
  port: number
  command: string
  args: string[]
  updatedAt: string
}

export interface BlenderMcpSettingsInput {
  enabled?: boolean
  host?: string
  port?: number
  command?: string
  args?: string[]
}

export interface PowerSettingsView {
  preventSleep: boolean
  updatedAt: string
}

export interface PowerSettingsInput {
  preventSleep?: boolean
}

export interface BlenderMcpConnectionTestResult {
  success: boolean
  enabled: boolean
  running: boolean
  latencyMs: number
  host: string
  port: number
  command: string
  args: string[]
  toolCount: number
  tools: string[]
  error?: string
}

export type FeishuDomain = 'feishu' | 'lark'
export type FeishuGroupSessionScope =
  | 'group'
  | 'group_sender'
  | 'group_topic'
  | 'group_topic_sender'

export interface FeishuSettingsView {
  enabled: boolean
  configured: boolean
  appId: string
  hasAppSecret: boolean
  domain: FeishuDomain
  allowFrom: string[]
  groupAllowFrom: string[]
  requireMention: boolean
  groupSessionScope: FeishuGroupSessionScope
  streaming: boolean
  updatedAt: string
}

export interface FeishuSettingsInput {
  enabled?: boolean
  appId?: string
  appSecret?: string
  domain?: FeishuDomain
  allowFrom?: string[]
  groupAllowFrom?: string[]
  requireMention?: boolean
  groupSessionScope?: FeishuGroupSessionScope
  streaming?: boolean
}

export interface FeishuConnectionStatus {
  enabled: boolean
  configured: boolean
  running: boolean
  phase: 'stopped' | 'starting' | 'running' | 'error'
  message: string
  updatedAt: string
  lastEventAt: string | null
  error?: string | null
}

export interface FeishuConnectionTestResult {
  success: boolean
  latencyMs: number
  appId: string
  botName?: string | null
  botOpenId?: string | null
  error?: string
}

export const LLM_REASONING_LEVEL_LABELS: Record<LlmReasoningLevel, string> = {
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

const QWEN_REASONING_BUDGETS: Record<LlmReasoningEnabledLevel, number> = {
  low: 1_024,
  medium: 4_096,
  high: 12_288,
}

const KIMI_REASONING_BUDGETS: Record<LlmReasoningEnabledLevel, number> = {
  low: 1_024,
  medium: 4_096,
  high: 12_288,
}

const KIMI_K27_CODE_MODEL: LlmModelOption = {
  id: 'kimi-k2.7-code',
  label: 'Kimi K2.7 Code',
  input: ['text', 'image'],
  contextWindow: 262_144,
  capabilities: ['图文输入', '视频输入', '上下文缓存', '仅思考模式', '编程优化'],
  summary: 'Kimi 最强编程模型，支持文本、图片、视频和 256K 上下文，仅支持思考模式。',
}

const KIMI_K27_CODE_HIGHSPEED_MODEL: LlmModelOption = {
  id: 'kimi-k2.7-code-highspeed',
  label: 'Kimi K2.7 Code HighSpeed',
  input: ['text', 'image'],
  contextWindow: 262_144,
  capabilities: ['图文输入', '视频输入', '上下文缓存', '仅思考模式', '高速输出'],
  summary: 'Kimi K2.7 Code 高速版，适合响应速度要求更高的编程任务。',
}

const SHARED_MULTIMODAL_MODELS: LlmModelOption[] = [
  {
    id: 'qwen3.8-max',
    label: 'Qwen 3.8 Max',
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    reasoning: {
      mode: 'budget',
      defaultLevel: 'medium',
      budgetByLevel: QWEN_REASONING_BUDGETS,
      supportsPreserveThinking: true,
      note: '混合思考默认开启；托管极速=reasoning_effort low，深度=xhigh；勿与 thinking_budget 同时设置。',
    },
    capabilities: ['图文输入', '推理力度', '保留思维链', '1M 上下文'],
    summary: '百炼旗舰 Max 模型，原生多模态与长程 Agent 能力，托管默认模型。',
  },
  {
    id: 'qwen3.7-plus',
    label: 'Qwen 3.7 Plus',
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    reasoning: {
      mode: 'budget',
      defaultLevel: 'medium',
      budgetByLevel: QWEN_REASONING_BUDGETS,
      supportsPreserveThinking: true,
      note: '支持 enable_thinking、thinking_budget，且可保留思维链。',
    },
    capabilities: ['图文输入', '思考预算', '保留思维链'],
    summary: '百炼 Plus 模型，多模态与智能体能力均衡。',
  },
  {
    id: 'qwen3.6-plus',
    label: 'Qwen 3.6 Plus',
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    reasoning: {
      mode: 'budget',
      defaultLevel: 'medium',
      budgetByLevel: QWEN_REASONING_BUDGETS,
      supportsPreserveThinking: true,
      note: '支持 enable_thinking 与 thinking_budget。',
    },
    capabilities: ['图文输入', '思考预算', '保留思维链'],
    summary: '百炼标准版优先，多模态通用能力更强。',
  },
  {
    id: 'qwen3.5-plus',
    label: 'Qwen 3.5 Plus',
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    reasoning: {
      mode: 'budget',
      defaultLevel: 'medium',
      budgetByLevel: QWEN_REASONING_BUDGETS,
      note: '支持 enable_thinking 与 thinking_budget。',
    },
    capabilities: ['图文输入', '思考预算'],
    summary: '默认的图文理解入口，稳定性更高。',
  },
  KIMI_K27_CODE_MODEL,
  {
    id: 'kimi-k2.5',
    label: 'Kimi K2.5',
    input: ['text', 'image'],
    contextWindow: 262_144,
    reasoning: {
      mode: 'budget',
      defaultLevel: 'medium',
      budgetByLevel: KIMI_REASONING_BUDGETS,
      note: '默认关闭推理，支持 enable_thinking 与 thinking_budget。',
    },
    capabilities: ['图文输入', '视频输入', '上下文缓存'],
    summary: '适合长上下文和图文混合输入。',
  },
  {
    id: 'kimi-k2.6',
    label: 'Kimi K2.6',
    input: ['text', 'image'],
    contextWindow: 262_144,
    reasoning: {
      mode: 'budget',
      defaultLevel: 'medium',
      budgetByLevel: KIMI_REASONING_BUDGETS,
      note: '支持 enable_thinking 与 thinking_budget。',
    },
    capabilities: ['图文输入', '视频输入', '上下文缓存'],
    summary: 'Kimi 新版多模态，适合图文问答与复杂理解。',
  },
]

const MOONSHOT_MULTIMODAL_MODELS: LlmModelOption[] = [
  KIMI_K27_CODE_MODEL,
  KIMI_K27_CODE_HIGHSPEED_MODEL,
  {
    id: 'kimi-k2.6',
    label: 'Kimi K2.6',
    input: ['text', 'image'],
    contextWindow: 262_144,
    capabilities: ['图文输入', '长上下文'],
    summary: 'Kimi 官方主推模型，适合图文问答与复杂理解。',
  },
  {
    id: 'kimi-k2.5',
    label: 'Kimi K2.5',
    input: ['text', 'image'],
    contextWindow: 262_144,
    capabilities: ['图文输入', '长上下文'],
    summary: '上一代稳定版本，适合长文本与图文混合输入。',
  },
]

const ALIYUN_CODING_PLAN_MODEL_IDS = new Set([
  'qwen3.8-max',
  'qwen3.7-plus',
  'qwen3.6-plus',
  'qwen3.5-plus',
  'kimi-k2.5',
])

const ALIYUN_CODING_PLAN_MODELS: LlmModelOption[] = SHARED_MULTIMODAL_MODELS.filter((model) =>
  ALIYUN_CODING_PLAN_MODEL_IDS.has(model.id),
)

const KIMI_CODING_MODELS: LlmModelOption[] = [
  KIMI_K27_CODE_MODEL,
  KIMI_K27_CODE_HIGHSPEED_MODEL,
]

export const DEFAULT_LLM_PROFILE_ID: LlmProfileId = 'aliyun-bailian'
export const LLM_CONFIG_UPDATED_EVENT = 'billnova:llm-config-updated'

export const LLM_PROVIDER_PROFILES: readonly LlmProviderProfileCatalog[] = [
  {
    id: 'aliyun-bailian',
    vendor: '阿里云',
    title: '阿里云百炼大模型',
    description: '标准 DashScope / 百炼入口，适合通用图文能力。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    provider: 'openai-compatible',
    apiMode: 'openai-completions',
    runtimeProvider: 'qwen',
    defaultModel: 'qwen3.8-max',
    models: SHARED_MULTIMODAL_MODELS,
  },
  {
    id: 'aliyun-coding-plan',
    vendor: '阿里云',
    title: '阿里云 Coding Plan Model Studio',
    description: '订阅制 Coding Plan 入口，模型可用性会随套餐和区域变化。',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    provider: 'openai-compatible',
    apiMode: 'openai-completions',
    runtimeProvider: 'qwen',
    defaultModel: 'qwen3.6-plus',
    models: ALIYUN_CODING_PLAN_MODELS,
  },
  {
    id: 'moonshot-kimi',
    vendor: '月之暗面',
    title: '月之暗面 Kimi',
    description: 'Kimi 官方 OpenAI 兼容入口，支持 K2.7 Code / K2.6 / K2.5。',
    baseUrl: 'https://api.moonshot.cn/v1',
    provider: 'openai-compatible',
    apiMode: 'openai-completions',
    runtimeProvider: 'moonshot',
    defaultModel: 'kimi-k2.7-code',
    models: MOONSHOT_MULTIMODAL_MODELS,
  },
  {
    id: 'kimi-coding',
    vendor: '月之暗面',
    title: '月之暗面 Kimi Coding',
    description: 'Kimi K2.7 Code 编程模型入口，适合工程代码生成与重构。',
    baseUrl: 'https://api.moonshot.cn/v1',
    provider: 'openai-compatible',
    apiMode: 'openai-completions',
    runtimeProvider: 'moonshot',
    defaultModel: 'kimi-k2.7-code',
    models: KIMI_CODING_MODELS,
  },
] as const

export function getLlmProfileCatalogEntry(profileId: LlmProfileId): LlmProviderProfileCatalog {
  const entry = LLM_PROVIDER_PROFILES.find((profile) => profile.id === profileId)
  if (!entry) {
    throw new Error(`未知的模型配置分组: ${profileId}`)
  }
  return entry
}

export function getLlmModelOption(profileId: LlmProfileId, modelId: string): LlmModelOption | undefined {
  const normalized = modelId.trim().toLowerCase()
  return getLlmProfileCatalogEntry(profileId).models.find(
    (model) => model.id.toLowerCase() === normalized,
  )
}

export function isLlmReasoningLevel(value: unknown): value is LlmReasoningLevel {
  return value === 'off' || value === 'low' || value === 'medium' || value === 'high'
}

export function getLlmModelReasoningSupport(
  profileId: LlmProfileId,
  modelId: string,
): LlmModelReasoningSupport | undefined {
  return getLlmModelOption(profileId, modelId)?.reasoning
}

export function getLlmReasoningChoices(reasoning?: LlmModelReasoningSupport): LlmReasoningLevel[] {
  if (!reasoning) {
    return ['off']
  }

  if (reasoning.mode === 'toggle') {
    return ['off', reasoning.defaultLevel]
  }

  return ['off', 'low', 'medium', 'high']
}

export function getDefaultLlmSettingsView(): LlmSettingsView {
  return {
    activeProfileId: DEFAULT_LLM_PROFILE_ID,
    profiles: LLM_PROVIDER_PROFILES.map((profile) => ({
      profileId: profile.id,
      vendor: profile.vendor,
      title: profile.title,
      description: profile.description,
      baseUrl: profile.baseUrl,
      model: profile.defaultModel,
      reasoningLevel: 'off',
      hasApiKey: false,
      updatedAt: '',
      isActive: profile.id === DEFAULT_LLM_PROFILE_ID,
    })),
  }
}

export function getDefaultBlenderMcpSettingsView(): BlenderMcpSettingsView {
  return {
    enabled: true,
    host: 'localhost',
    port: 9876,
    command: 'uvx',
    args: ['blender-mcp'],
    updatedAt: '',
  }
}

export function getDefaultPowerSettingsView(): PowerSettingsView {
  return {
    preventSleep: false,
    updatedAt: '',
  }
}

export function getDefaultFeishuSettingsView(): FeishuSettingsView {
  return {
    enabled: false,
    configured: false,
    appId: '',
    hasAppSecret: false,
    domain: 'feishu',
    allowFrom: [],
    groupAllowFrom: [],
    requireMention: true,
    groupSessionScope: 'group_topic',
    streaming: false,
    updatedAt: '',
  }
}

export type LocalSkillSource = 'managed' | 'bundled'

export interface LocalSkillSummary {
  slug: string
  domain: string
  name: string
  description: string
  version: string
  source: LocalSkillSource
  checksum?: string
  updatedAt?: string
}

export type SkillReleaseCheckStatus =
  | 'up_to_date'
  | 'update_available'
  | 'unsupported_client'

export interface SkillUpdateCheckResult {
  status: SkillReleaseCheckStatus
  releaseChannel: string
  currentSkillPackVersion: string
  currentSkillPackChecksum: string
  latestSkillPackVersion: string | null
  latestSkillPackChecksum: string | null
  skillCount: number
  releaseNotes: string | null
  requiredElectronVersion: string | null
}

export interface SkillRuntimeStatus {
  releaseChannel: string
  skillPackVersion: string
  skillPackChecksum: string
  builtAt: string | null
  installedAt: string | null
  source: LocalSkillSource
  /** 正式加载并参与运行时路由的 skills（managed/bundled）。 */
  skills: LocalSkillSummary[]
  /** 项目资料、文档、表格、agent 自我改进等通用内置 skills。 */
  documentSkills: LocalSkillSummary[]
  /** 用户自定义 skills，存放在晓量全局 agent workspace 中，可由用户和 agent 管理。 */
  userSkills: LocalUserSkillSummary[]
  /** 用户自定义 skills 的本地目录。 */
  userSkillRootPath: string | null
  /** 用户自定义 skills 目录读取或校验提示。 */
  userSkillWarning: string | null
  /** 教学流程确认后的本地算法资产，未来算量模式只读调用。 */
  algorithms: LocalAlgorithmSummary[]
}

export interface SkillInstallUpdateInput {
  releaseChannel?: string
  skillPackVersion?: string | null
  expectedChecksum?: string | null
}

export interface SkillInstallUpdateResult {
  status: SkillRuntimeStatus
  installedVersion: string
  installedChecksum: string
}

export type AgentWorkspaceCoreFileName =
  | 'AGENTS.md'
  | 'SOUL.md'
  | 'IDENTITY.md'
  | 'USER.md'
  | 'TOOLS.md'
  | 'BOOTSTRAP.md'

export interface AgentWorkspaceFileStatus {
  name: AgentWorkspaceCoreFileName
  path: string | null
  exists: boolean
  loadedInContext: boolean
  sizeBytes: number | null
  modifiedAt: string | null
  truncated: boolean
  content?: string | null
  warning?: string | null
}

export interface AgentWorkspaceProjectIndexEntry {
  projectId: string
  name: string
  description: string
  rootPath: string | null
  rootPathExists: boolean
  rootPathUpdatedAt: string | null
  conversationCount: number
  drawingCount: number
  createdAt: string
  updatedAt: string
}

export interface AgentWorkspaceStatus {
  rootPath: string | null
  rootExists: boolean
  initialized: boolean
  coreFiles: AgentWorkspaceFileStatus[]
  indexJsonPath: string | null
  indexMarkdownPath: string | null
  projectEntries: AgentWorkspaceProjectIndexEntry[]
  indexedProjectCount: number
  lastIndexedAt: string | null
  warning?: string | null
}

export type UserSkillValidationStatus = 'valid' | 'invalid'

export interface UserSkillInterfaceMetadata {
  displayName: string | null
  shortDescription: string | null
  defaultPrompt: string | null
  iconSmall: string | null
  iconLarge: string | null
  brandColor: string | null
  allowImplicitInvocation: boolean
}

export interface UserSkillResourceCounts {
  references: number
  scripts: number
  assets: number
}

export interface LocalUserSkillSummary {
  slug: string
  name: string
  description: string
  interface: UserSkillInterfaceMetadata
  resources: UserSkillResourceCounts
  enabled: boolean
  validationStatus: UserSkillValidationStatus
  validationMessage: string | null
  path: string
  directoryPath: string
  openaiYamlPath: string | null
  createdAt: string
  updatedAt: string
}

export interface UserSkillReferenceInput {
  path: string
  content: string
}

export interface UserSkillUpsertInput {
  slug: string
  name: string
  description: string
  instructions: string
  references?: UserSkillReferenceInput[]
  enabled?: boolean
  overwrite?: boolean
}

export interface UserSkillReadResult {
  slug: string
  name: string
  description: string
  interface: UserSkillInterfaceMetadata
  resources: UserSkillResourceCounts
  enabled: boolean
  validationStatus: UserSkillValidationStatus
  validationMessage: string | null
  path: string
  directoryPath: string
  openaiYamlPath: string | null
  content: string
  instructions: string
  references: UserSkillReferenceInput[]
}

export interface UserSkillSetEnabledInput {
  slug: string
  enabled: boolean
}

export interface UserSkillDeleteInput {
  slug: string
  deleteConfirmed: boolean
}

export interface UserSkillMutationResult {
  status: SkillRuntimeStatus
  skill: LocalUserSkillSummary | null
}

export interface LocalAlgorithmSummary {
  slug: string
  domain: string
  componentType: string
  subtypeCode: string | null
  drawingName: string | null
  componentLabel: string | null
  version: string
  status: 'saved'
  path: string
  parameterFields: string[]
  sourceConversationId: string
  createdAt: string
  updatedAt: string
  confirmedAt: string | null
  calculatorChecksum: string
}

export interface ProjectSummary {
  id: string
  name: string
  description: string
  /** 本地项目资料目录；仅保存在 Electron 本地数据库中。 */
  rootPath: string | null
  rootPathUpdatedAt: string | null
  rootPathExists: boolean
  createdAt: string
  updatedAt: string
}

export type ProjectContextFileSource = 'user' | 'artifact'

export interface ProjectContextIndexEntry {
  path: string
  name: string
  extension: string
  kind: string
  supported: boolean
  sizeBytes: number
  modifiedAt: string
  title: string
  tags: string[]
  description: string
  source: ProjectContextFileSource
}

export interface ProjectAgentsStatus {
  exists: boolean
  path: string | null
  relativePath: 'AGENTS.md'
  sizeBytes: number | null
  modifiedAt: string | null
  truncated: boolean
  content: string | null
  warning?: string | null
}

export interface ProjectContextStatus {
  projectId: string
  rootPath: string | null
  rootExists: boolean
  agents: ProjectAgentsStatus
  indexJsonPath: string | null
  indexMarkdownPath: string | null
  indexedFileCount: number
  userFileCount: number
  artifactFileCount: number
  lastIndexedAt: string | null
  warning?: string | null
}

export type ProjectFileKind =
  | 'text'
  | 'markdown'
  | 'csv'
  | 'json'
  | 'image'
  | 'document'
  | 'docx'
  | 'pdf'
  | 'xlsx'
  | 'cad'
  | 'unsupported'

export interface ProjectFileEntry {
  path: string
  name: string
  extension: string
  kind: ProjectFileKind
  supported: boolean
  sizeBytes: number
  modifiedAt: string
  title?: string
  tags?: string[]
  description?: string
  source?: ProjectContextFileSource
}

export type ProjectFileSourceFilter = 'all' | 'user' | 'artifact'

export interface ProjectDirectoryEntry {
  path: string
  name: string
  source: ProjectContextFileSource
}

export interface ProjectFilesListResult {
  projectId: string
  rootPath: string | null
  rootExists: boolean
  scopePath: string
  depth: number
  source: ProjectFileSourceFilter
  directories: ProjectDirectoryEntry[]
  directoryCount: number
  files: ProjectFileEntry[]
  fileCount: number
  returnedCount: number
  nextCursor: string | null
  truncated: boolean
  ignoredCount: number
  warning?: string | null
}

export type ProjectPreviewMode =
  | 'text'
  | 'markdown'
  | 'image'
  | 'pdf'
  | 'spreadsheet'
  | 'docx'
  | 'cad'
  | 'unsupported'

export interface ProjectPreviewEntry {
  type: 'directory' | 'file'
  path: string
  name: string
  extension: string
  kind: ProjectFileKind | 'directory'
  previewMode: ProjectPreviewMode | null
  supported: boolean
  sizeBytes: number
  modifiedAt: string
}

export interface ProjectPreviewDirectoryResult {
  projectId: string
  rootExists: boolean
  path: string
  entries: ProjectPreviewEntry[]
  truncated: boolean
  ignoredCount: number
  warning?: string | null
}

interface ProjectFilePreviewBase {
  projectId: string
  path: string
  name: string
  extension: string
  kind: ProjectFileKind
  sizeBytes: number
  modifiedAt: string
}

interface ProjectTextPreviewBase extends ProjectFilePreviewBase {
  content: string
  offset: number
  nextOffset: number | null
  truncated: boolean
  limitReached: boolean
}

export interface ProjectPlainTextPreviewResult extends ProjectTextPreviewBase {
  mode: 'text'
}

export interface ProjectMarkdownPreviewResult extends ProjectTextPreviewBase {
  mode: 'markdown'
}

export type ProjectTextPreviewResult =
  | ProjectPlainTextPreviewResult
  | ProjectMarkdownPreviewResult

interface ProjectEncodedPreviewBase extends ProjectFilePreviewBase {
  mimeType: string
  dataBase64: string
}

export interface ProjectImagePreviewResult extends ProjectEncodedPreviewBase {
  mode: 'image'
}

export interface ProjectPdfPreviewResult extends ProjectEncodedPreviewBase {
  mode: 'pdf'
}

export interface ProjectDocxPreviewResult extends ProjectEncodedPreviewBase {
  mode: 'docx'
}

export type ProjectBinaryPreviewResult =
  | ProjectImagePreviewResult
  | ProjectPdfPreviewResult
  | ProjectDocxPreviewResult

export interface ProjectSpreadsheetPreviewSheet {
  name: string
  rows: string[][]
  totalRows: number
  totalColumns: number
  truncated: boolean
}

export interface ProjectSpreadsheetPreviewResult extends ProjectFilePreviewBase {
  mode: 'spreadsheet'
  sheets: ProjectSpreadsheetPreviewSheet[]
  sheetCount: number
  truncated: boolean
}

/**
 * Drawings are streamed from a loopback capability origin instead of being inlined
 * as base64: a DWG is routinely two orders of magnitude larger than a document, and
 * the viewer wants the bytes in its own frame anyway.
 */
export interface ProjectCadPreviewResult extends ProjectFilePreviewBase {
  mode: 'cad'
  /** Single-use, short-lived loopback URL for the drawing bytes. */
  sourceUrl: string
  /** Loopback base URL serving the self-hosted font and template corpus. */
  cadDataBaseUrl: string
}

export interface ProjectUnsupportedPreviewResult extends ProjectFilePreviewBase {
  mode: 'unsupported'
  reason: string
}

export type ProjectFilePreviewResult =
  | ProjectTextPreviewResult
  | ProjectBinaryPreviewResult
  | ProjectSpreadsheetPreviewResult
  | ProjectCadPreviewResult
  | ProjectUnsupportedPreviewResult

export interface ProjectFileReadResult {
  projectId: string
  rootPath: string | null
  path: string
  name: string
  extension: string
  kind: ProjectFileKind
  supported: boolean
  sizeBytes: number
  modifiedAt: string
  content: string
  truncated: boolean
  sheets?: string[]
  pageCount?: number
  parser?: string
  metadata?: Record<string, unknown>
  warning?: string | null
}

export interface ProjectFileSearchMatch {
  path: string
  name: string
  kind: ProjectFileKind
  supported: boolean
  score: number
  snippets: string[]
  title?: string
  tags?: string[]
  description?: string
  source?: ProjectContextFileSource
  warning?: string | null
}

export interface ProjectFilesSearchResult {
  projectId: string
  rootPath: string | null
  rootExists: boolean
  query: string
  scopePath: string
  source: ProjectFileSourceFilter
  glob: string | null
  matches: ProjectFileSearchMatch[]
  matchCount: number
  searchedFileCount: number
  truncated: boolean
  warning?: string | null
}

export type ProjectArtifactKind =
  | 'text'
  | 'markdown'
  | 'json'
  | 'csv'
  | 'excel'
  | 'docx'
  | 'pptx'
  | 'algorithm'
  | 'other'

export type ProjectTextArtifactKind = 'text' | 'markdown' | 'json' | 'csv'

export interface ProjectArtifactEntry {
  path: string
  name: string
  extension: string
  kind: ProjectArtifactKind
  sizeBytes: number
  modifiedAt: string
}

export interface ProjectArtifactsListResult {
  projectId: string
  rootPath: string | null
  outputRootPath: string | null
  rootExists: boolean
  artifacts: ProjectArtifactEntry[]
  artifactCount: number
  truncated: boolean
  warning?: string | null
}

export interface ProjectArtifactWriteResult {
  projectId: string
  rootPath: string | null
  outputRootPath: string | null
  path: string
  absolutePath: string
  kind: ProjectArtifactKind
  created: boolean
  overwritten: boolean
  sizeBytes: number
  opened?: boolean
  openError?: string | null
  warning?: string | null
}

export interface ProjectTextArtifactInput {
  path: string
  content: string
  kind?: ProjectTextArtifactKind
  overwrite_confirmed?: boolean
}

export interface ProjectExcelSheetInput {
  name: string
  rows: Array<Record<string, unknown> | unknown[]>
}

export interface ProjectExcelArtifactInput {
  path: string
  sheets: ProjectExcelSheetInput[]
  metadata?: Record<string, unknown>
  open_after_write?: boolean
  overwrite_confirmed?: boolean
}

export type ProjectDocxBlockType =
  | 'heading'
  | 'paragraph'
  | 'bullets'
  | 'key_values'
  | 'table'
  | 'note'

export interface ProjectDocxBlockInput {
  type: ProjectDocxBlockType
  text?: string
  level?: 1 | 2 | 3
  tone?: 'note' | 'warning'
  items?: Array<string | { key: string; value: unknown }>
  columns?: string[]
  rows?: Array<Record<string, unknown>>
}

export interface ProjectDocxArtifactInput {
  path: string
  title: string
  subtitle?: string
  metadata?: Record<string, unknown>
  blocks: ProjectDocxBlockInput[]
  open_after_write?: boolean
  overwrite_confirmed?: boolean
}

export type ProjectPptxSlideType =
  | 'title'
  | 'section'
  | 'bullets'
  | 'content'
  | 'table'
  | 'closing'

export interface ProjectPptxSlideInput {
  type: ProjectPptxSlideType
  title: string
  subtitle?: string
  body?: string
  bullets?: string[]
  columns?: string[]
  rows?: Array<Record<string, unknown>>
  notes?: string
}

export interface ProjectPptxArtifactInput {
  path: string
  title: string
  subtitle?: string
  metadata?: Record<string, unknown>
  slides: ProjectPptxSlideInput[]
  open_after_write?: boolean
  overwrite_confirmed?: boolean
}

export type ProjectArtifactCreateInput =
  | ({ format: ProjectTextArtifactKind } & Omit<ProjectTextArtifactInput, 'kind'>)
  | ({ format: 'xlsx' } & ProjectExcelArtifactInput)
  | ({ format: 'docx' } & ProjectDocxArtifactInput)
  | ({ format: 'pptx' } & ProjectPptxArtifactInput)

export type ProjectComponentStatus = 'draft' | 'confirmed'

export interface ProjectComponentIdentity {
  component_type: string
  component_subtype?: string
  semantic_name?: string
  discipline?: string
  aliases?: string[]
}

export interface ProjectComponentSourceHandle {
  handle: string
  role?: string
}

export interface ProjectComponentAnchors {
  drawing_relpath: string
  layout_name?: string
  source_handles: ProjectComponentSourceHandle[]
  bbox?: number[]
}

export interface ProjectComponentQuantityItem {
  name: string
  value: number
  unit: string
  formula?: string
  basis?: string
}

export interface ProjectComponentQuantities {
  unit?: string
  dimensions?: Record<string, number | string>
  items?: ProjectComponentQuantityItem[]
}

export interface ProjectComponentSemantics {
  description: string
  notes?: string[]
}

export interface ProjectComponentEvidenceImage {
  path: string
  note?: string
}

export interface ProjectComponentEvidenceText {
  handle?: string
  text: string
  role?: string
}

export interface ProjectComponentEvidence {
  evidence_pack?: string
  images?: ProjectComponentEvidenceImage[]
  text?: ProjectComponentEvidenceText[]
}

export interface ProjectComponentRelation {
  type: string
  target_component_id?: string
  target_handle?: string
}

export interface ProjectComponentProvenance {
  created_by: 'agent' | 'user'
  run_id?: string
  confirmed_at?: string
  created_at: string
  updated_at: string
}

export interface ProjectComponentRecord {
  schema_version: 'xiaoliang-component-v1'
  component_id: string
  source_key: string
  status: ProjectComponentStatus
  identity: ProjectComponentIdentity
  anchors: ProjectComponentAnchors
  quantities: ProjectComponentQuantities
  semantics: ProjectComponentSemantics
  evidence: ProjectComponentEvidence
  relations?: ProjectComponentRelation[]
  provenance: ProjectComponentProvenance
}

export interface ProjectComponentSummary {
  component_id: string
  source_key: string
  status: ProjectComponentStatus
  component_type: string
  component_subtype?: string
  semantic_name?: string
  discipline?: string
  drawing_relpath: string
  layout_name?: string
  source_handle_count: number
  quantity_item_count: number
  updated_at: string
  confirmed_at?: string
}

export interface ProjectComponentFilter {
  keyword?: string
  component_type?: string
  drawing_relpath?: string
  status?: ProjectComponentStatus
}

export interface ProjectComponentSaveInput {
  identity: ProjectComponentIdentity
  anchors: ProjectComponentAnchors
  quantities?: ProjectComponentQuantities
  semantics: ProjectComponentSemantics
  evidence?: ProjectComponentEvidence
  relations?: ProjectComponentRelation[]
  provenance?: {
    created_by?: 'agent' | 'user'
    run_id?: string
  }
}

export interface ProjectComponentPatch {
  identity?: Partial<ProjectComponentIdentity>
  anchors?: Partial<ProjectComponentAnchors>
  quantities?: ProjectComponentQuantities
  semantics?: Partial<ProjectComponentSemantics>
  evidence?: ProjectComponentEvidence
  relations?: ProjectComponentRelation[]
}

export interface ProjectComponentSaveItemResult {
  action: 'created' | 'updated' | 'conflict'
  component: ProjectComponentSummary
  warning?: string
}

export interface ProjectComponentImageResult {
  path: string
  mime_type: 'image/png' | 'image/jpeg'
  size_bytes: number
  data_url: string
}

export interface ProjectAlgorithmExportInput {
  algorithm_slug: string
  source?: 'draft' | 'saved'
  target_dir?: string
  overwrite_confirmed?: boolean
}

export interface DrawingSummary {
  id: string
  projectId: string
  name: string
  createdAt: string
  updatedAt: string
}

export type ConversationCreationSource =
  | 'desktop_first_message'
  | 'desktop_new_button'
  | 'desktop_tree_branch'
  | 'feishu'
  | 'legacy_unknown'

export interface ConversationSummary {
  id: string
  title: string
  /** 创建入口，仅用于审计与数据质量分析。 */
  creationSource: ConversationCreationSource
  updatedAt: string
  isPinned: boolean
  /** @deprecated 托管模式下不再驱动对话模型；保留兼容旧数据。 */
  preferredModelId: string | null
  /** 会话级思考档位：极速 / 深度。 */
  preferredThinkingMode: 'fast' | 'deep'
  /** 用户选择的对话模式：执行 / 计划。 */
  preferredAgentMode: ConversationAgentMode
  /** Plan 模式运行时相位。 */
  planPhase: PlanPhase
  /** 该对话是否有待处理的计划审批或构件复核。 */
  hasPendingInteraction: boolean
  /** 所属项目（项目 -> 对话；图纸作为项目资源独立管理）。 */
  projectId: string | null
  projectName: string | null
  /** @deprecated 历史会话的旧图纸字段；新会话不再以图纸作为归属。 */
  drawingId: string | null
  drawingName: string | null
  /** 最近一次该会话的上下文用量快照。 */
  contextUsage: ContextUsageInfo | null
  /** Pi 分支对应的父晓量会话；Tree navigate 不会改变它。 */
  parentConversationId: string | null
  /** fork / clone 时在父 Pi session 中选中的 entry。 */
  forkedFromEntryId: string | null
  /** 直接子会话数量，用于会话列表展示 session family。 */
  childConversationCount: number
  /** 当前云归档只投影 Pi Tree 的活动路径。 */
  sessionSyncScope: 'active_path' | null
}

export type ConversationPiSessionMigrationStatus = 'migrating' | 'ready' | 'failed'

export interface ConversationPiSessionStats {
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalMessages: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: number
}

export interface ConversationPiSessionInfo {
  conversationId: string
  sessionId: string
  sessionFile: string
  name: string | null
  parentConversationId: string | null
  forkedFromEntryId: string | null
  runtimeVersion: number
  migrationStatus: ConversationPiSessionMigrationStatus
  migrationError: string | null
  modelProvider: string | null
  modelId: string | null
  thinkingLevel: string
  stats: ConversationPiSessionStats
}

export interface PiRuntimeResourceDiagnostic {
  level: 'warning' | 'error'
  code: string
  message: string
  path?: string
}

export interface PiRuntimeResourceItem {
  name: string
  description: string
  path: string
  source: string
  argumentHint?: string
}

export interface PiRuntimeToolStatus {
  name: string
  description: string
  source: string
  active: boolean
}

export interface PiRuntimeResourceStatus {
  enabled: boolean
  revision: string
  reloadedAt: string | null
  extensions: Array<{ name: string; path: string; source: string }>
  skills: PiRuntimeResourceItem[]
  promptTemplates: PiRuntimeResourceItem[]
  tools: PiRuntimeToolStatus[]
  diagnostics: PiRuntimeResourceDiagnostic[]
}

export type ConversationPiSessionExportFormat = 'jsonl' | 'html'

export interface ConversationPiSessionExportResult {
  cancelled: boolean
  format: ConversationPiSessionExportFormat
  outputPath: string | null
}

export interface ConversationPiSessionImportResult {
  cancelled: boolean
  conversationId: string
  sessionId: string | null
  sourcePath: string | null
}

export type ConversationTreeEntryType =
  | 'message'
  | 'thinking_level_change'
  | 'model_change'
  | 'compaction'
  | 'branch_summary'
  | 'custom'
  | 'custom_message'
  | 'label'
  | 'session_info'

export type ConversationTreeMessageRole = 'user' | 'assistant' | 'tool'

export interface ConversationTreeNode {
  id: string
  parentId: string | null
  type: ConversationTreeEntryType
  role: ConversationTreeMessageRole | null
  timestamp: string
  preview: string
  label: string | null
  depth: number
  childCount: number
  isActivePath: boolean
  isLeaf: boolean
  canForkBefore: boolean
  canCloneAt: boolean
  cloneToolResultCount: number
  forkedChildCount: number
}

export interface ConversationTreeSnapshot {
  conversationId: string
  sessionId: string
  parentSessionFile: string | null
  leafId: string | null
  nodes: ConversationTreeNode[]
  cloudSyncScope: 'active_path'
}

export interface ConversationTreeNavigateInput {
  conversationId: string
  targetEntryId: string
  summarize?: boolean
  customInstructions?: string
}

export interface ConversationTreeNavigateResult {
  cancelled: boolean
  stopped: boolean
  editorText: string | null
  summaryEntryId: string | null
  tree: ConversationTreeSnapshot
}

export interface ConversationTreeBranchResult {
  mode: 'fork_before' | 'clone_at'
  sourceConversationId: string
  targetEntryId: string
  clonedThroughEntryId: string | null
  clonedToolResultCount: number
  composerText: string
  conversation: ConversationSummary
}

export type AgentMessageRole = 'user' | 'assistant' | 'tool'

export type WorkspaceSearchMatchType = 'project' | 'title' | 'message' | 'thinking' | 'tool'

export interface WorkspaceSearchRequest {
  query: string
  limit?: number
}

export interface WorkspaceSearchResult {
  kind: 'project' | 'conversation'
  projectId: string
  projectName: string
  conversationId: string | null
  conversationTitle: string | null
  matchedMessageId: string | null
  matchedRole: AgentMessageRole | null
  matchType: WorkspaceSearchMatchType
  snippet: string
  updatedAt: string
  matchedAt: string | null
}

export interface ImageAttachment {
  id: string
  data: string
  mimeType: string
  name?: string
}

export type ImageAttachmentInput = ImageAttachment

export function normalizeImageAttachmentPayload(
  data: string,
  mimeType: string,
): Pick<ImageAttachment, 'data' | 'mimeType'> | null {
  const normalizedData = data.trim()
  const normalizedMimeType = mimeType.trim()
  if (!normalizedData || !normalizedMimeType) return null

  const dataUrlMatch = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/is.exec(normalizedData)
  if (dataUrlMatch) {
    const resolvedMimeType = dataUrlMatch[1].trim() || normalizedMimeType
    const resolvedData = dataUrlMatch[2].trim()
    if (!resolvedData || !resolvedMimeType.toLowerCase().startsWith('image/')) return null
    return {
      data: resolvedData,
      mimeType: resolvedMimeType,
    }
  }

  if (!normalizedMimeType.toLowerCase().startsWith('image/')) return null

  return {
    data: normalizedData,
    mimeType: normalizedMimeType,
  }
}

/** Append images while preserving order and suppressing repeated tool evidence. */
export function mergeImageAttachments(
  current: ImageAttachment[],
  incoming: readonly ImageAttachment[],
): ImageAttachment[] {
  if (incoming.length === 0) return current

  const seenIds = new Set(current.map((image) => image.id))
  const seenDataByMimeType = new Map<string, Set<string>>()
  for (const image of current) {
    const seenData = seenDataByMimeType.get(image.mimeType) ?? new Set<string>()
    seenData.add(image.data)
    seenDataByMimeType.set(image.mimeType, seenData)
  }

  let merged = current
  for (const image of incoming) {
    const seenData = seenDataByMimeType.get(image.mimeType) ?? new Set<string>()
    if (seenIds.has(image.id) || seenData.has(image.data)) continue

    if (merged === current) merged = [...current]
    merged.push(image)
    seenIds.add(image.id)
    seenData.add(image.data)
    seenDataByMimeType.set(image.mimeType, seenData)
  }

  return merged
}

export type AgentMessagePart =
  | {
      type: 'thinking' | 'text'
      content: string
    }
  | {
      type: 'tool'
      toolCallId: string
      name: string
      args: string
      result: string
    }

/**
 * Marks a transcript row the host authored on the agent's behalf. The UI renders these
 * as a compact notice instead of a chat bubble, because nobody typed them.
 */
export interface AgentMessageHostNotice extends SubagentCompletionNotice {
  kind: 'subagent_completion'
}

export interface AgentMessageRecord {
  id: string
  conversationId: string
  clientRunId?: string | null
  piSessionId?: string | null
  piEntryId?: string | null
  role: AgentMessageRole
  hostNotice?: AgentMessageHostNotice
  content: string
  toolName: string
  toolArgs: string
  toolResult: string
  thinking: string
  parts?: AgentMessagePart[]
  attachments?: ImageAttachment[]
  createdAt: string
}

export interface ContextUsageInfo {
  /** 最近一次带 usage 的 assistant 未命中缓存的 input token（pi-ai 已从 prompt_tokens 中扣除 cache） */
  inputTokens: number
  /** 最近一次带 usage 的 assistant 输出 token 数 */
  outputTokens: number
  /** 最近一次带 usage 的 assistant 命中/写入的缓存 token（cacheRead + cacheWrite）；旧快照可能缺失 */
  cacheTokens?: number
  /**
   * 当前预计占用：最近一次可信 usage 的 totalTokens 加上后续消息估算；
   * 压缩边界后若只有旧 usage，则对重建上下文整体做启发式估算。
   */
  usedTokens: number
  /** 模型上下文总量 */
  totalTokens: number
  /**
   * 与自动压缩配置一致的警戒线（contextWindow - reserveTokens），也是预计占用百分比的分母；
   * trailingTokens 尚未进入 Pi 的 provider usage，故越线不等于已经触发自动压缩。
   */
  compactAtTokens?: number
  /**
   * 尚未被可信 provider usage 覆盖的估算 token。通常是最后一次 usage 后的新增消息；
   * 压缩后第一次模型回复前，则是整个重建上下文的启发式估算。
   */
  trailingTokens?: number
  /** 预计占用百分比（0-100），相对 compactAtTokens（缺失时相对 totalTokens） */
  percent: number
  /** 模型 id */
  modelId: string
}

export interface CadConnectionInfo {
  connected: boolean
  docName?: string
  version?: string
  message?: string
  updatedAt: string
}

export interface CadSelectionInfo {
  ready: boolean
  connected?: boolean
  count: number
  handles: string[]
  docName?: string
  message?: string
  updatedAt: string
}

export type CadAutomationMode = 'disabled' | 'subagent'
export type CadAutomationFeatureFlag = 'off' | 'canary' | 'on'

export interface CadAutomationStatusRequest {
  conversationId?: string
  projectId?: string
}

export type CadAutomationBridgeState =
  | 'stopped'
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'restarting'
  | 'stopping'
  | 'disposed'

export type CadAutomationReadinessState =
  | 'ready'
  | 'bridge_unavailable'
  | 'autocad_not_installed'
  | 'autocad_com_unregistered'
  | 'autocad_not_running'
  | 'autocad_unsupported'
  | 'no_document'
  | 'drawing_outside_project'
  | 'operation_unavailable'
  | 'environment_unavailable'
  | 'busy'
  | 'error'

export interface CadAutomationDocumentDiagnostic {
  index: number
  name: string
  projectRelativePath: string | null
  active: boolean
  saved: boolean
  dbmod: number | null
}

export interface CadAutomationReadiness {
  ready: boolean
  state: CadAutomationReadinessState
  bridge: {
    state: CadAutomationBridgeState
    reachable: boolean
    adopted: boolean
    activeLeases: number
    consecutiveHealthFailures: number
    restartCount: number
    lastHealthAt: string | null
    lastHealthyAt: string | null
    lastError: { code: string; message: string; at: string } | null
  }
  autocad: {
    state: 'ready' | 'not_installed' | 'com_unregistered' | 'not_running' | 'unsupported' | 'no_document' | 'busy' | 'unavailable' | 'error'
    fullInstalled: boolean | null
    ltInstalled: boolean | null
    comRegistered: boolean | null
    running: boolean
    supported: boolean
    visible: boolean | null
    version: string | null
    documentCount: number
    documents: CadAutomationDocumentDiagnostic[]
    errorCode: string | null
    message: string
  }
  plot: {
    state: string
    ready: boolean
    operationAvailable: boolean
    activeDocument: CadAutomationDocumentDiagnostic | null
    dependencies: { pywin32: boolean | null; pillow: boolean | null; pdfium: boolean | null }
    configurations: { pdf: boolean | null; png: boolean | null }
    warnings: string[]
    message: string
  }
  updatedAt: string
}

/** Main-process-authoritative CAD automation capabilities for the active conversation. */
export interface CadAutomationStatus {
  mode: CadAutomationMode
  featureFlag: CadAutomationFeatureFlag
  projectId: string | null
  projectRootReady: boolean
  automaticEntityExtraction: boolean
  automaticVisualIndexing: boolean
  automaticPreciseReading: boolean
  requiresManualSelection: boolean
  manualPreprocessingVisible: boolean
  developerToolsAvailable: boolean
  activeRun: SubagentRunUpdate | null
  /** All active CAD children for this conversation, oldest first. */
  activeRuns: SubagentRunUpdate[]
  readiness: CadAutomationReadiness | null
  message: string
  updatedAt: string
}

export interface CadAutomationArtifactSetDiagnostic {
  drawingPath: string
  kind: 'entities' | 'visual' | 'unknown' | 'legacy'
  storageScope: 'project' | 'userdata_legacy'
  status: string
  manifestPath: string | null
  sourceSha256: string | null
  producerFingerprint: string | null
  reason: string | null
  generatedAt: string | null
  verifiedAt: string | null
}

export interface CadAutomationRunDiagnostic {
  childRunId: string
  clientRunId: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  model: string
  startedAt: string
  finishedAt: string | null
  toolCallCount: number
  totalTokens: number
  artifactCount: number
  errorCode: string | null
}

export interface CadAutomationBackendUsageDiagnostic {
  clientRunId: string
  status: string
  callCount: number
  totalTokens: number
  reasoningTokens: number
  imageCount: number
  truncated: boolean
  breakdown: Array<{
    callPurpose: string
    childRunId: string | null
    callCount: number
    totalTokens: number
    reasoningTokens: number
    imageCount: number
  }>
  calls: Array<{
    callId: string
    callPurpose: string
    childRunId: string | null
    providerModel: string
    status: string
    durationMs: number | null
    totalTokens: number
    reasoningTokens: number
    imageCount: number
    errorCode: string | null
  }>
}

export interface CadAutomationDiagnostics {
  projectId: string
  projectRootReady: boolean
  featureFlag: CadAutomationFeatureFlag
  bridge: 'http'
  extraction: 'mlight-first-com-fallback'
  readiness: CadAutomationReadiness
  artifacts: CadAutomationArtifactSetDiagnostic[]
  runs: CadAutomationRunDiagnostic[]
  backendUsage: CadAutomationBackendUsageDiagnostic[]
  backendUsageError: string | null
  inventoryTruncated: boolean
  updatedAt: string
}

export interface RestartCadAutomationBridgeRequest {
  conversationId?: string
  projectId?: string
}

export interface RestartCadAutomationBridgeResult {
  success: true
  readiness: CadAutomationReadiness
  message: string
  updatedAt: string
}

export interface InvalidateCadAutomationArtifactRequest {
  conversationId?: string
  projectId?: string
  drawingPath: string
  kind: 'entities' | 'visual'
}

export interface InvalidateCadAutomationArtifactResult {
  changed: boolean
  drawingPath: string
  kind: 'entities' | 'visual'
  manifestPath: string
  retainedPaths: string[]
  message: string
}

export interface CadConnectRequest {
  conversationId?: string
  drawingId?: string
  projectId?: string
}

export type CadDrawingExtractPhase =
  | 'idle'
  | 'reading'
  | 'uploading'
  | 'extracting'
  | 'ready'
  | 'failed'

export type CadDrawingVisualIndexPhase =
  | 'not_started'
  | 'planning'
  | 'capturing'
  | 'recognizing'
  | 'ready'
  | 'ready_degraded'
  | 'failed'
  | 'stale'

export interface CadDrawingArtifactStatus {
  drawingId: string
  drawingName: string
  docName: string | null
  docKey?: string | null
  entityCount: number
  sourceEntityCount: number
  indexedEntityCount: number
  omittedGeometryCount: number
  indexProfile: string | null
  extractPhase: CadDrawingExtractPhase
  artifactId: string | null
  knowledgeFileId: string | null
  extractSummary: string | null
  message: string | null
  readAt: string | null
  visualIndexPhase: CadDrawingVisualIndexPhase
  visualIndexSummary: string | null
  visualIndexPath: string | null
  visualRegionCount: number
  visualImageCount: number
  visualModel: string | null
  visualReadAt: string | null
  updatedAt: string
  hasLocalEntities: boolean
  hasVisualIndex: boolean
}

export interface ReadCadDrawingRequest {
  drawingId?: string
  projectId?: string
  conversationId?: string
  force?: boolean
}

export interface ExtractCadDrawingRequest {
  drawingId: string
}

export interface IndexCadDrawingVisualRequest {
  drawingId?: string
  projectId?: string
  conversationId?: string
  force?: boolean
}

export type CadToolProgressPhase =
  | 'prepare'
  | 'read_entities'
  | 'serialize'
  | 'upload_artifact'
  | 'extract'
  | 'visual_plan'
  | 'visual_capture'
  | 'visual_recognize'
  | 'completed'
  | 'failed'

export type CadPreExtractPhase = CadToolProgressPhase | 'skipped'

export interface CadPreExtractUpdate {
  phase: CadPreExtractPhase
  percent: number
  message: string
  at: string
  drawingId?: string
  drawingName?: string
  entityCount?: number
  sourceEntityCount?: number
  indexedEntityCount?: number
  omittedGeometryCount?: number
  artifactId?: string
}

export type SubagentRunStatus =
  | 'queued'
  | 'initializing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface SubagentRunUpdate {
  childRunId: string
  type: 'cad-analyst' | 'cad-drafter' | 'blender-modeler' | 'research-analyst'
  description: string
  status: SubagentRunStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number
  queuePosition: number | null
  progress: {
    phase?: string
    lastToolName?: string
    turnCount?: number
    toolCallCount?: number
    tokensUsed?: number
  }
  errorCode: string | null
}

export type AgentConversationRunStatus = 'running' | 'queued' | 'completed'

export interface AgentConversationRunSnapshot {
  conversationId: string
  status: AgentConversationRunStatus
  promptRunning: boolean
  supportsQueueing: boolean
  subagentRuns: SubagentRunUpdate[]
}

export type ConversationAgentMode = 'agent' | 'plan'

export type PlanPhase = 'inactive' | 'pending' | 'active' | 'exit_pending'

export type AgentInteractionKind =
  | 'confirmation'
  | 'single_choice'
  | 'multiple_choice'
  | 'form'
  | 'plan_approval'
  | 'component_review'

export const PERSISTENT_INTERACTION_KINDS = [
  'plan_approval',
  'component_review',
] as const satisfies readonly AgentInteractionKind[]

export function isPersistentInteractionKind(
  kind: AgentInteractionKind,
): kind is 'plan_approval' | 'component_review' {
  return kind === 'plan_approval' || kind === 'component_review'
}

export const INTERACTION_CONFIRM_ACTION = 'xiaoliang.interaction.confirm'
export const INTERACTION_CANCEL_ACTION = 'xiaoliang.interaction.cancel'
export const INTERACTION_PLAN_APPROVE_ACTION = 'xiaoliang.plan.approve'
export const INTERACTION_PLAN_REVISE_ACTION = 'xiaoliang.plan.revise'
export const INTERACTION_PLAN_ABANDON_ACTION = 'xiaoliang.plan.abandon'
export const INTERACTION_REVIEW_CONFIRM_ACTION = 'xiaoliang.review.confirm'
export const INTERACTION_REVIEW_SKIP_ACTION = 'xiaoliang.review.skip'
export const INTERACTION_REVIEW_REVISE_ACTION = 'xiaoliang.review.revise'

export type AgentInteractionRisk = 'low' | 'medium' | 'high'

export interface AgentInteractionDetail {
  label: string
  value: string
}

/**
 * 主进程发给渲染进程的声明式交互面。`a2uiMessages` 由固定 schema 生成，
 * 渲染进程只交给 A2UI renderer，不执行来自模型的代码。
 */
export interface PlanApprovalPayload {
  planContent: string
  planFilePath: string
  restored?: boolean
  openedManually?: boolean
}

export interface ComponentReviewItem {
  componentId: string
  name: string
  componentType: string
  dimensions: string
  drawing: string
  handles: string[]
  evidencePack?: string
  evidenceImages?: string[]
  status: ProjectComponentStatus
  wouldOverwriteConfirmed: boolean
}

export interface ComponentReviewPayload {
  projectId: string
  items: ComponentReviewItem[]
  source: 'draft_records' | 'extracted'
}

export interface AgentPendingInteraction {
  id: string
  conversationId: string
  surfaceId: string
  kind: AgentInteractionKind
  toolCallId: string
  toolName: string
  payloadHash: string
  title: string
  description: string
  risk: AgentInteractionRisk
  details: AgentInteractionDetail[]
  a2uiMessages: Array<Record<string, unknown>>
  createdAt: string
  expiresAt: string
  persistence?: 'ephemeral' | 'persistent'
  responseToken?: string
  payload?: PlanApprovalPayload | ComponentReviewPayload
}

export interface PlanDocumentSnapshot {
  path: string
  content: string
  exists: boolean
}

export interface AgentInteractionResponseInput {
  conversationId: string
  interactionId: string
  responseToken: string
  actionId: string
  data?: Record<string, unknown>
}

export type AgentInteractionResolutionStatus =
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'aborted'

export interface AgentInteractionResolution {
  interactionId: string
  conversationId: string
  toolCallId: string
  toolName: string
  payloadHash: string
  actionId: string
  status: AgentInteractionResolutionStatus
  resolvedAt: string
  kind?: AgentInteractionKind
  data?: Record<string, unknown>
}

export type AgentQueueKind = 'steer' | 'followUp'

export interface AgentQueuedMessage {
  id: string
  kind: AgentQueueKind
  text: string
  preview: string
  images: ImageAttachment[]
}

export interface AgentQueueState {
  steeringCount: number
  followUpCount: number
  items: AgentQueuedMessage[]
}

export interface AgentClearedQueue {
  steering: string[]
  followUp: string[]
}

/**
 * `main` stops only the parent turn and leaves delegated subagents running;
 * `all` is the explicit "stop everything" action.
 */
export type AgentStopScope = 'main' | 'all'

export type AgentRetrySource =
  | 'agent'
  | 'summarization'
  | 'compaction'
  | 'branch_summary'

export interface AgentRetryState {
  phase: 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled'
  source: AgentRetrySource
  attempt?: number
  maxAttempts?: number
  delayMs?: number
  scheduledAt?: number
}

export interface AgentCompactionState {
  phase: 'running' | 'completed' | 'failed' | 'cancelled'
  reason: 'manual' | 'threshold' | 'overflow'
  willRetry?: boolean
  tokensBefore?: number
  estimatedTokensAfter?: number
}

export type AgentUiEvent =
  | {
      type: 'agent_start'
      conversationId: string
      supportsQueueing: boolean
    }
  | {
      type: 'messages_updated'
      conversationId: string
      /** Added at the Electron boundary so project-scoped consumers can ignore other tasks. */
      projectId?: string | null
      /** True only when sendPrompt has completed persistence for an agent run. */
      promptSettled?: boolean
      /** Present only when this refresh completed a synthetic wake for a child task. */
      subagentTaskId?: string
    }
  | { type: 'conversation_updated'; conversationId: string }
  | {
      type: 'conversation_mode'
      conversationId: string
      mode: ConversationAgentMode
      phase: PlanPhase
      awaitingPlanApproval: boolean
    }
  | {
      /** A persisted display row that must appear before the final transcript refresh. */
      type: 'transcript_message'
      conversationId: string
      message: AgentMessageRecord
    }
  | {
      type: 'message_delta'
      conversationId: string
      kind: 'text' | 'thinking'
      contentIndex: number
      delta: string
    }
  | {
      type: 'tool_start'
      conversationId: string
      toolCallId: string
      toolName: string
      toolArgs: string
    }
  | {
      type: 'tool_update'
      conversationId: string
      toolCallId?: string
      toolName: string
      data: string
      stream: 'stdout' | 'stderr'
    }
  | {
      type: 'tool_end'
      conversationId: string
      toolCallId: string
      toolName: string
      toolResult: string
      attachments?: ImageAttachment[]
    }
  | { type: 'agent_end'; conversationId: string; willRetry: boolean }
  | {
      type: 'agent_settled'
      conversationId: string
      projectId?: string | null
    }
  | {
      type: 'retry_update'
      conversationId: string
      retry: AgentRetryState
    }
  | {
      type: 'compaction_update'
      conversationId: string
      compaction: AgentCompactionState
    }
  | {
      type: 'queue_update'
      conversationId: string
      queue: AgentQueueState
    }
  | {
      type: 'error'
      conversationId: string
      projectId?: string | null
      error: string
    }
  | {
      type: 'cad_preextract'
      conversationId: string
      update: CadPreExtractUpdate
    }
  | {
      type: 'subagent_run'
      conversationId: string
      update: SubagentRunUpdate
      /** Complete active/terminal snapshot set for the parent conversation. */
      updates?: SubagentRunUpdate[]
    }
  | {
      type: 'subagent_orphaned'
      conversationId: string
      taskIds: string[]
      message: string
    }
  | {
      type: 'interaction_requested'
      conversationId: string
      interaction: AgentPendingInteraction
    }
  | {
      type: 'interaction_resolved'
      conversationId: string
      resolution: AgentInteractionResolution
    }
  | { type: 'context_usage'; conversationId: string; usage: ContextUsageInfo | null }

export function imageAttachmentToDataUrl(attachment: ImageAttachment): string {
  return `data:${attachment.mimeType};base64,${attachment.data}`
}

/** Agent 环境检测与准备(设置页):bash 运行时与 rg/fd 检索组件状态。 */
export type AgentBashSource = 'managed' | 'system' | 'none'

export interface AgentBashEnvironmentStatus {
  /** managed=晓量托管 MinGit;system=系统 Git Bash;none=未就绪(bash 工具降级不注册)。 */
  source: AgentBashSource
  bashPath: string | null
  version: string | null
  preparing: boolean
}

export interface AgentBlenderMcpEnvironmentStatus {
  /** Blender MCP 设置开关;未启用也允许预热。 */
  enabled: boolean
  /** uv 可执行是否就绪(安装包预置或系统 PATH)。 */
  uvAvailable: boolean
  uvPath: string | null
  /** 启动命令不是 uv/uvx 家族时为 true,预热不适用。 */
  customCommand: boolean
  /** 预热目标包规格(默认 blender-mcp,随设置 args 变化)。 */
  packageSpec: string
  prepared: boolean
  preparedAt: string | null
  preparing: boolean
}

export interface AgentEnvironmentStatus {
  piCodingToolsEnabled: boolean
  bash: AgentBashEnvironmentStatus
  searchTools: { rg: boolean; fd: boolean }
  blenderMcp: AgentBlenderMcpEnvironmentStatus
}

export interface AgentBashPrepareProgress {
  phase: 'resolving' | 'downloading' | 'verifying' | 'extracting' | 'validating' | 'completed' | 'failed'
  receivedBytes?: number
  totalBytes?: number
  message?: string
}

export interface AgentBlenderMcpPrepareProgress {
  phase: 'resolving' | 'installing' | 'validating' | 'completed' | 'failed'
  message?: string
}

export function getDefaultAgentEnvironmentStatus(): AgentEnvironmentStatus {
  return {
    piCodingToolsEnabled: false,
    bash: { source: 'none', bashPath: null, version: null, preparing: false },
    searchTools: { rg: false, fd: false },
    blenderMcp: {
      enabled: false,
      uvAvailable: false,
      uvPath: null,
      customCommand: false,
      packageSpec: 'blender-mcp',
      prepared: false,
      preparedAt: null,
      preparing: false,
    },
  }
}
