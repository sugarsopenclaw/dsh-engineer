import type { PlanReminderKind } from './plan-mode'

export function buildPlanReminder(kind: PlanReminderKind, planFilePath: string): string {
  if (kind === 'exit') {
    return [
      '[plan_mode_exit]',
      '计划模式已结束。按已批准的 plan 文件实施，不要再调用 exit_plan_mode。',
      `计划文件：${planFilePath}`,
    ].join('\n')
  }

  if (kind === 'sparse') {
    return [
      '[plan_mode_sparse]',
      '仍处于 Plan 模式：只读调研，计划只写进 plan 文件。本回合以提问或 exit_plan_mode 收尾。',
      `计划文件：${planFilePath}`,
    ].join('\n')
  }

  return [
    '[plan_mode_full]',
    '当前是 Plan 模式，不是执行模式。',
    '只做只读调研：读资料、检索、派 CAD 取证都可以，但不要保存构件、不要改项目产物、不要画图落地。',
    `把完整计划写进 ${planFilePath}，不要把长计划只写在对话里。`,
    '本回合只能以向用户提问、或调用 exit_plan_mode 收尾。exit_plan_mode 不要传正文，运行时会读取该计划文件并弹出审批。',
    '用户批准后才会切回执行模式并开工。',
  ].join('\n')
}
