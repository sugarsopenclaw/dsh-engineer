import type { AgentWorkspaceFileStatus } from '../../../../../src/shared/local-agent'
import type { ContextProvider } from '../context-assembler'
import type { AgentWorkspaceService } from '../../workspace/agent-workspace-service'

function renderCoreFile(file: AgentWorkspaceFileStatus) {
  if (!file.loadedInContext || !file.exists || !file.content?.trim()) {
    return []
  }
  const lines = [
    '',
    `${file.name}：`,
    '```markdown',
    file.content.trim(),
    '```',
  ]
  if (file.warning) {
    lines.push(`${file.name} 提示：${file.warning}`)
  }
  return lines
}

export function buildAgentWorkspaceProvider(
  agentWorkspaceService: AgentWorkspaceService,
): ContextProvider {
  return {
    key: 'agent_workspace',
    provide: async () => {
      const status = await agentWorkspaceService.ensureFreshIndex().catch(() =>
        agentWorkspaceService.getStatus({ includeContextContent: true }),
      )
      if (!status.rootPath) {
        return null
      }

      const rootStatus = status.rootExists ? '可访问' : '不可访问'
      const lines = [
        `Agent workspace：${status.rootPath}（${rootStatus}${status.initialized ? '' : '；未完整初始化'}）`,
        '这里是全局工作手册和项目历史索引，不是项目资料证据；当前项目资料目录由 project_context 提供。冲突时遵循：用户本轮明确要求 > 当前项目 AGENTS.md（仅项目范围） > agent workspace 工作约定。',
      ]

      if (status.indexMarkdownPath) {
        lines.push(`项目历史索引：${status.indexedProjectCount} 个项目；完整索引见 .xiaoliang/WORKSPACE_PROJECTS.md。`)
      }

      if (status.projectEntries.length > 0) {
        lines.push('')
        lines.push('最近项目：')
        for (const project of status.projectEntries.slice(0, 8)) {
          const root = project.rootPath
            ? `${project.rootPath}${project.rootPathExists ? '' : '（不可访问）'}`
            : '未绑定项目资料目录'
          lines.push(
            `- ${project.name}：${root}；对话 ${project.conversationCount}，图纸 ${project.drawingCount}，更新 ${project.updatedAt}`,
          )
        }
      }

      for (const file of status.coreFiles) {
        lines.push(...renderCoreFile(file))
      }

      if (status.warning) {
        lines.push(`Agent workspace 提示：${status.warning}`)
      }

      return lines.join('\n')
    },
  }
}
