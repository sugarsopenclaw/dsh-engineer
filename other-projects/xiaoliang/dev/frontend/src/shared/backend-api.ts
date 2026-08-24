export interface OrganizationView {
  id: string
  name: string
  slug: string
  plan_tier?: string
}

export interface UserView {
  id: string
  email: string
  display_name: string | null
}

export interface QuotaSummaryData {
  plan_tier: string
  credits_remaining: number
  credits_total: number
  credits_expiring_at: string | null
  low_balance_threshold: number
  /** @deprecated alias of credits_remaining, kept for pre-credits builds */
  quota_remaining?: number
  /** @deprecated alias of credits_total, kept for pre-credits builds */
  quota_limit?: number
  /** @deprecated alias of credits_expiring_at, kept for pre-credits builds */
  quota_period_ends_at?: string | null
  /** @deprecated the daily free allowance was replaced by a one-time grant */
  free_daily_used?: number
  /** @deprecated the daily free allowance was replaced by a one-time grant */
  free_daily_limit?: number
}

export interface CurrentUserData {
  user: UserView
  organization: OrganizationView
  role: string
  quota?: QuotaSummaryData | null
}

export interface AuthSessionData {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user: UserView
  organization: OrganizationView
  role: string
  quota?: QuotaSummaryData | null
}

export interface BillingProductView {
  id: string
  plan_tier: string
  name: string
  description: string
  amount_fen: number
  credits: number
  duration_days: number
  unit_price_rmb: number
  /** Savings per credit versus the cheapest pack. */
  discount_percent: number
}

export interface ModelCreditRatesView {
  uncached_input_micro: number
  cached_input_micro: number
  cache_write_micro: number
  output_micro: number
}

export interface CreditPricingView {
  pricing_version: string
  credit_unit_price_rmb: number
  micro_per_credit: number
  models: Record<string, ModelCreditRatesView>
}

export interface WeChatNativeOrderView {
  order_id: string
  product_id: string
  plan_tier: string
  status: string
  out_trade_no: string
  amount_fen: number
  code_url: string | null
  expires_at: string
  paid_at: string | null
  poll_after_seconds: number
  quota?: QuotaSummaryData | null
}

export interface BillingOrderStatusView {
  order_id: string
  product_id: string
  plan_tier: string
  status: string
  out_trade_no: string
  amount_fen: number
  expires_at: string
  paid_at: string | null
  quota: QuotaSummaryData
}

export type AgentRunSource =
  | 'desktop_chat'
  | 'desktop_visual_index'
  | 'subagent_completion'
  | 'message_channel'
  | 'unknown'
export type AgentRunFinishStatus = 'completed' | 'stopped' | 'failed'

export interface AgentUsageRunStartRequest {
  client_run_id: string
  source?: AgentRunSource
  local_conversation_id?: string | null
  task_preview?: string | null
  original_question?: string | null
  started_at?: string | null
}

export interface AgentUsageRunFinishRequest {
  status: AgentRunFinishStatus
  final_answer?: string | null
  error_message?: string | null
  ended_at?: string | null
}

export interface AgentUsageRunView {
  id: string
  organization_id: string
  user_id: string
  client_run_id: string
  source: string
  status: string
  local_conversation_id?: string | null
  task_preview?: string | null
  original_question?: string | null
  final_answer?: string | null
  started_at: string
  ended_at?: string | null
  duration_ms?: number | null
  error_message?: string | null
}

export interface AgentUsageTokenTotals {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  image_count: number
}

export interface AgentUsageCallView extends AgentUsageTokenTotals {
  id: string
  child_run_id?: string | null
  call_purpose: string
  model_alias: string
  provider_model: string
  status: 'started' | 'completed' | 'stopped' | 'failed'
  started_at: string
  ended_at?: string | null
  duration_ms?: number | null
  error_code?: string | null
}

export interface AgentUsageBreakdownView extends AgentUsageTokenTotals {
  call_purpose: string
  child_run_id?: string | null
  call_count: number
}

export interface AgentUsageRunDetailView {
  run: AgentUsageRunView
  call_count: number
  totals: AgentUsageTokenTotals
  credits_charged: number
  breakdown: AgentUsageBreakdownView[]
  calls: AgentUsageCallView[]
  truncated: boolean
}

export interface ManagedAgentModelView {
  id: string
  object: 'model'
  kind: 'default' | 'vision' | 'expert'
  provider_model: string
  owned_by: string
  input_modalities: Array<'text' | 'image'>
  context_window: number
  max_output_tokens: number
  purpose_max_output_tokens: Record<string, number>
  supports_reasoning_effort: boolean
  reasoning_efforts: Array<'low' | 'medium' | 'xhigh'>
}

export interface ManagedAgentModelCatalogView {
  object: 'list'
  catalog_version: string
  data: ManagedAgentModelView[]
}

export interface RegisterRequest {
  organization_name: string
  email: string
  password: string
  display_name?: string
}

export interface LoginRequest {
  email: string
  password: string
}

/** 请求发送登录邮箱验证码（与后端路径 `/auth/email-otp/send` 对齐，可按实际 API 调整字段名） */
export interface SendEmailCodeRequest {
  email: string
}

/** 发码成功时可选返回再次发送前的冷却秒数 */
export interface SendEmailCodeResponse {
  cooldown_seconds?: number
}

/** 邮箱验证码登录（与后端路径 `/auth/email-otp/login` 对齐） */
export interface LoginWithEmailCodeRequest {
  email: string
  code: string
}

export interface SpeechTranscriptionData {
  text: string
  model: string
  content_type?: string | null
  original_content_type?: string | null
  detected_format?: string | null
  size_bytes: number
}

export interface WebSource {
  title?: string | null
  url: string
  snippet?: string | null
  site_name?: string | null
  published_at?: string | null
  /** @deprecated Wire compatibility only; generic search never assigns an authority tier. */
  source_tier?: 'tier1' | 'tier2' | null
}

export interface WebSearchRequest {
  query: string
  limit?: number
  region?: string
  freshness?: 'noLimit' | 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear'
  allowed_domains?: string[]
  blocked_domains?: string[]
}

export interface WebFetchRequest {
  url: string
  prompt: string
  region?: string
}

export type WebToolStatus = 'ok' | 'partial' | 'empty' | 'error'

export interface WebGroundedData {
  query_or_url: string
  model: string
  answer: string
  sources: WebSource[]
  elapsed_ms: number
  warning?: string | null
  /** Which upstream produced the hits; `qwen` means the Bocha route was unavailable. */
  provider?: string | null
  /** Why the preferred provider was not used, when a fallback happened. */
  fallback_reason?: string | null
  status?: WebToolStatus
  /** Extracted page body for `/web/fetch`; `answer` is the compatibility fallback. */
  content?: string | null
  final_url?: string | null
  content_type?: string | null
  truncated?: boolean
}

export type SkillReleaseCheckStatus =
  | 'up_to_date'
  | 'update_available'
  | 'unsupported_client'

export interface SkillReleaseCheckData {
  status: SkillReleaseCheckStatus
  latest_skill_pack_version: string | null
  latest_skill_pack_checksum: string | null
  skill_count: number
  release_notes: string | null
  required_electron_version: string | null
}

export interface SkillPackFileData {
  path: string
  content: string
  checksum: string
}

export interface SkillPackSkillData {
  slug: string
  domain: string
  name: string
  description: string
  version: string
  checksum: string
  updated_at: string
  files: SkillPackFileData[]
}

export interface SkillPackData {
  pack_format_version: number
  release_channel: string
  skill_pack_version: string
  skill_pack_checksum: string
  built_at: string
  skills: SkillPackSkillData[]
  metadata: Record<string, unknown>
}

export interface SkillPackMetadata {
  skill_pack_version: string
  skill_pack_checksum: string
  built_at: string
}

export type AgentFeedbackVote = 'up' | 'down'

export type AgentFeedbackOutcome = 'success' | 'partial' | 'failure'

export type AgentFeedbackIssueCode =
  | 'cad_understanding'
  | 'tool_strategy'
  | 'incorrect_answer'
  | 'missed_instruction'
  | 'incomplete'
  | 'interaction'
  | 'other'

export interface AgentMessageFeedbackUpsertInput {
  local_conversation_id: string
  local_message_id: string
  client_run_id?: string | null
  pi_session_id?: string | null
  pi_entry_id?: string | null
  vote?: AgentFeedbackVote | null
  outcome?: AgentFeedbackOutcome | null
  issue_codes?: AgentFeedbackIssueCode[]
  comment?: string | null
  app_version?: string | null
}

export interface AgentMessageFeedbackDeleteInput {
  local_conversation_id: string
  local_message_id: string
}

export interface AgentMessageFeedbackView {
  id: string
  local_conversation_id: string
  local_message_id: string
  client_run_id: string | null
  pi_session_id: string | null
  pi_entry_id: string | null
  vote: AgentFeedbackVote | null
  outcome: AgentFeedbackOutcome | null
  issue_codes: AgentFeedbackIssueCode[]
  comment: string | null
  app_version: string | null
  feedback_schema_version: number
  created_at: string
  updated_at: string
}

export interface PromptTemplateWriteInput {
  title: string
  description?: string | null
  content: string
}

export interface PromptTemplateView {
  id: string
  title: string
  description: string | null
  content: string
  created_at: string
  updated_at: string
}
