import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

export const EXIT_PLAN_MODE_TOOL_NAME = 'exit_plan_mode'

export interface ExitPlanModeExecutor {
  (): Promise<string>
}

export function buildPlanTools(deps: {
  loadApprovedPlanMessage: ExitPlanModeExecutor
}): AgentTool<any, any>[] {
  return [
    {
      name: EXIT_PLAN_MODE_TOOL_NAME,
      label: 'Exit Plan Mode',
      description: [
        '结束 Plan 模式并提交当前 plan.md 供用户审批。',
        '不要传入计划正文；运行时会读取计划文件。',
        '仅在 Plan 模式且计划已写好时调用。',
      ].join(''),
      parameters: Type.Object({}),
      execute: async () => {
        const text = await deps.loadApprovedPlanMessage()
        return {
          content: [{ type: 'text' as const, text }],
          details: { approved: true },
        }
      },
    },
  ]
}
