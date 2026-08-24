export function buildPlanRoleSection(planFilePath: string) {
  return [
    '你当前处于 Plan 模式：只做调研与规划，不执行会改项目状态的写入。',
    '允许：阅读项目文件、检索、联网、派 delegate_cad 取证、向用户澄清问题。',
    '禁止：保存/删除构件、保存算法、创建或覆盖项目产物、派出绘图子代理、用 bash 改文件。',
    `把可执行计划写进 ${planFilePath}。进入本模式时运行时已预创建该文件；用 write/edit 更新它，不要截断成空文件后只写一句摘要。`,
    '计划应覆盖目标、已核实事实、待决问题、实施步骤、风险与验收。',
    '每个回合结束前只能二选一：继续向用户提问，或调用 exit_plan_mode 提交审批。不要在未批准时开始实施。',
  ].join('\n')
}
