import {
  type ConversationSummary,
  type FeishuConnectionStatus,
  type ProjectSummary,
} from '../../../src/shared/local-agent'
import {
  thinkingModeLabel,
  type ThinkingMode,
} from '../../../src/shared/billing-domain'

export interface FeishuSlashCommand {
  name: string
  args: string
  raw: string
}

export interface FeishuSlashCommandRuntime {
  getStatus(): FeishuConnectionStatus
  getCurrentConversation(): ConversationSummary | null
  createConversationInProject(projectId: string): Promise<ConversationSummary>
  bindConversation(conversation: ConversationSummary): void
  resetConversation(conversationId: string): Promise<void>
  setConversationThinkingMode(
    conversationId: string,
    mode: ThinkingMode,
  ): { appliedAt: 'now' | 'next_turn' }
  listProjects(): ProjectSummary[]
  getDefaultProject(): ProjectSummary
}

export function parseFeishuSlashCommand(text: string): FeishuSlashCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  const match = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
  if (!match) return null

  return {
    name: match[1].trim().toLowerCase(),
    args: (match[2] ?? '').trim(),
    raw: trimmed,
  }
}

export async function handleFeishuSlashCommand(
  command: FeishuSlashCommand,
  runtime: FeishuSlashCommandRuntime,
): Promise<string> {
  if (isCommand(command, ['help', 'h', '?', '帮助'])) {
    return formatHelp()
  }

  if (isCommand(command, ['status', '状态'])) {
    return formatStatus(runtime)
  }

  if (isCommand(command, ['thinking', 'mode', '思考', '模型'])) {
    return handleThinkingCommand(command, runtime)
  }

  if (isCommand(command, ['models', '模型列表'])) {
    return [
      '桌面端已托管模型，不再提供本地模型列表。',
      '可用思考档位：极速 / 专家',
      '切换：/thinking 极速 或 /thinking 专家',
    ].join('\n')
  }

  if (isCommand(command, ['model'])) {
    return handleThinkingCommand(command, runtime)
  }

  if (isCommand(command, ['projects', '项目列表'])) {
    return formatProjects(runtime)
  }

  if (isCommand(command, ['project', '项目'])) {
    return handleProjectCommand(command, runtime)
  }

  if (isCommand(command, ['new', '新会话'])) {
    return handleNewConversationCommand(command, runtime)
  }

  if (isCommand(command, ['reset', 'clear', '重置'])) {
    const conversation = runtime.getCurrentConversation()
    if (!conversation) {
      return '当前还没有飞书会话，发送 /new 开启。'
    }
    await runtime.resetConversation(conversation.id)
    return '已重置当前飞书会话。'
  }

  return [
    `未知命令：/${command.name}`,
    '',
    '发送 /help 查看可用命令。',
  ].join('\n')
}

function isCommand(command: FeishuSlashCommand, names: string[]) {
  return names.includes(command.name)
}

function formatHelp() {
  return [
    '可用命令：',
    '/status - 查看飞书通道、当前项目、会话和思考档位',
    '/thinking - 查看当前思考档位（极速 / 专家）',
    '/thinking 极速|专家 - 切换当前飞书会话思考档位',
    '/projects - 列出项目',
    '/project <项目名或ID> - 切换到项目并开启新会话',
    '/new [项目名或ID] - 开启新会话',
    '/reset - 清空当前飞书会话上下文',
  ].join('\n')
}

function formatStatus(runtime: FeishuSlashCommandRuntime) {
  const status = runtime.getStatus()
  const conversation = runtime.getCurrentConversation()
  const thinking = thinkingModeLabel(conversation?.preferredThinkingMode ?? 'fast')
  const projectName = conversation?.projectName || conversation?.projectId || '未绑定'

  return [
    `飞书通道：${status.running ? '运行中' : '未运行'} (${status.phase})`,
    `状态：${status.message}`,
    `项目：${projectName}`,
    `会话：${conversation ? conversation.title : '尚未创建'}`,
    `思考：${thinking}`,
  ].join('\n')
}

async function handleThinkingCommand(
  command: FeishuSlashCommand,
  runtime: FeishuSlashCommandRuntime,
) {
  const arg = command.args.trim()
  if (!arg || isOneOf(arg, ['status', 'current', '当前'])) {
    const conversation = runtime.getCurrentConversation()
    return `当前思考档位：${thinkingModeLabel(conversation?.preferredThinkingMode ?? 'fast')}`
  }

  const mode = parseThinkingArg(arg)
  if (!mode) {
    return [
      `无法识别思考档位：${arg}`,
      '可用：极速 / 专家（或 fast / deep）',
    ].join('\n')
  }

  const conversation = runtime.getCurrentConversation()
  if (!conversation) {
    return '当前还没有飞书会话，发送 /new 开启后再切换思考档位。'
  }

  const result = runtime.setConversationThinkingMode(conversation.id, mode)
  const confirmation = `已切换当前飞书会话思考档位：${thinkingModeLabel(mode)}`
  return result.appliedAt === 'next_turn'
    ? `${confirmation}；当前回合结束后生效。`
    : confirmation
}

function parseThinkingArg(raw: string): ThinkingMode | null {
  const normalized = raw.trim().toLowerCase()
  if (isOneOf(normalized, ['fast', '极速', '快速', 'speed'])) return 'fast'
  if (isOneOf(normalized, ['deep', '专家', '深度', '思考', 'thinking'])) return 'deep'
  return null
}

function formatProjects(runtime: FeishuSlashCommandRuntime) {
  const currentProjectId = runtime.getCurrentConversation()?.projectId
  const projects = runtime.listProjects()
  if (projects.length === 0) {
    return '暂无项目。'
  }
  return [
    '项目：',
    ...projects.slice(0, 20).map((project) => {
      const marker = project.id === currentProjectId ? '* ' : '- '
      return `${marker}${project.name} (${shortId(project.id)})`
    }),
    projects.length > 20 ? `... 还有 ${projects.length - 20} 个项目` : '',
    '',
    '切换：/project <项目名或ID>',
  ].filter(Boolean).join('\n')
}

async function handleProjectCommand(
  command: FeishuSlashCommand,
  runtime: FeishuSlashCommandRuntime,
) {
  const arg = command.args.trim()
  if (!arg) {
    return formatProjects(runtime)
  }

  const match = resolveProject(runtime.listProjects(), arg)
  if (match.kind === 'none') {
    return `未找到项目：${arg}`
  }
  if (match.kind === 'ambiguous') {
    return [
      `项目匹配不唯一：${arg}`,
      ...match.projects.slice(0, 5).map((candidate) => `- ${candidate.name} (${shortId(candidate.id)})`),
      '请使用完整项目名或项目 ID。',
    ].join('\n')
  }

  const conversation = await runtime.createConversationInProject(match.project.id)
  runtime.bindConversation(conversation)
  return [
    '已切换到项目并开启新会话。',
    `项目：${match.project.name}`,
    `会话：${conversation.title}`,
  ].join('\n')
}

async function handleNewConversationCommand(
  command: FeishuSlashCommand,
  runtime: FeishuSlashCommandRuntime,
) {
  const arg = command.args.trim()
  let project = currentProject(runtime)

  if (arg) {
    const match = resolveProject(runtime.listProjects(), arg)
    if (match.kind === 'none') {
      return `未找到项目：${arg}`
    }
    if (match.kind === 'ambiguous') {
      return [
        `项目匹配不唯一：${arg}`,
        ...match.projects.slice(0, 5).map((candidate) => `- ${candidate.name} (${shortId(candidate.id)})`),
        '请使用完整项目名或项目 ID。',
      ].join('\n')
    }
    project = match.project
  }

  const conversation = await runtime.createConversationInProject(project.id)
  runtime.bindConversation(conversation)
  return [
    '已开启新的飞书会话。',
    `项目：${project.name}`,
    `会话：${conversation.title}`,
  ].join('\n')
}

function currentProject(runtime: FeishuSlashCommandRuntime) {
  const currentProjectId = runtime.getCurrentConversation()?.projectId
  const project = currentProjectId
    ? runtime.listProjects().find((candidate) => candidate.id === currentProjectId)
    : null
  return project ?? runtime.getDefaultProject()
}

function resolveProject(projects: ProjectSummary[], raw: string) {
  const query = raw.trim()
  const lower = query.toLowerCase()
  const exactId = projects.find((project) => project.id.toLowerCase() === lower)
  if (exactId) return { kind: 'one' as const, project: exactId }

  const exactName = projects.filter((project) => project.name.trim().toLowerCase() === lower)
  if (exactName.length === 1) return { kind: 'one' as const, project: exactName[0] }
  if (exactName.length > 1) return { kind: 'ambiguous' as const, projects: exactName }

  const partial = projects.filter(
    (project) =>
      project.id.toLowerCase().includes(lower) ||
      project.name.toLowerCase().includes(lower),
  )
  if (partial.length === 0) return { kind: 'none' as const }
  if (partial.length === 1) return { kind: 'one' as const, project: partial[0] }
  return { kind: 'ambiguous' as const, projects: partial }
}

function isOneOf(value: string, choices: string[]) {
  const normalized = value.trim().toLowerCase()
  return choices.some((choice) => choice.toLowerCase() === normalized)
}

function shortId(id: string) {
  return id.length <= 8 ? id : id.slice(0, 8)
}
