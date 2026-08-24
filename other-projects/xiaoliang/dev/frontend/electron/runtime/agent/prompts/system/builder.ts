import { buildProjectDocumentSkillsPromptSection } from '../../document-skills/registry'
import {
  buildSkillsPolicyPromptSection,
  buildSkillsPromptSection,
} from '../../skills/injection/build-skills-prompt-section'
import { buildUserSkillsPromptSection } from '../../user-skills/service'
import type { SystemPromptContext } from './prompt-context'
import { buildDelegationSection } from './sections/delegation'
import { buildCoreRoleSection } from './sections/core-role'
import { buildPlanRoleSection } from './sections/plan-role'
import { buildResponseStyleSection } from './sections/response-style'
import { buildToolingSection } from './sections/tooling'

function formatSection(title: string, content: string) {
  const body = content.trim()
  if (!body) return ''
  return [`[${title}]`, body].join('\n')
}

function joinSections(sections: string[]) {
  return sections
    .map((section) => section.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function buildSystemPrompt(context: SystemPromptContext) {
  const planActive = context.mode === 'plan' && Boolean(context.planFilePath)
  return joinSections([
    formatSection('角色', buildCoreRoleSection(context.toolNames)),
    planActive
      ? formatSection('计划模式', buildPlanRoleSection(context.planFilePath!))
      : '',
    formatSection('任务路由', buildDelegationSection(context.toolNames)),
    formatSection('输出风格', buildResponseStyleSection(context.toolNames)),
    formatSection('工具边界', buildToolingSection(context.toolNames)),
    formatSection(
      'skills 边界',
      context.piResourcesEnabled ? buildSkillsPolicyPromptSection() : buildSkillsPromptSection(),
    ),
    context.piResourcesEnabled ? '' : formatSection('通用 skills', buildProjectDocumentSkillsPromptSection()),
    formatSection('用户 skills', buildUserSkillsPromptSection()),
    // 运行时提醒（时间、区域兜底、会话状态等易变字段）改由 transformContext 以
    // [runtime_reminder] 层每轮注入，保持 system prompt 字节稳定以命中前缀缓存。
  ])
}
