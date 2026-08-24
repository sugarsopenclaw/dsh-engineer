import { SKILL_PACK_METADATA } from '../../../../../src/shared/skill-pack-metadata'
import { getSkillRegistry } from '../registry'

export function buildSkillsPolicyPromptSection() {
  return [
    '仅当用户明确进入构件算法/算量任务时才使用 CAD skill 与算法工具；普通图纸问答不要读取 skill 或生成算法。',
    '构件工作流必须先通过 [cad_evidence_preflight]；命中已确认算法时 source=saved 执行，未命中且用户需要算法/算量时才进入草稿算法确认链路。',
    '市场 skill 是只读算量流程，不接受投稿；已确认算法以本地 calculator.py 资产保存，不上传后端。',
  ].join('\n')
}

export function buildSkillsPromptSection() {
  const registry = getSkillRegistry()
  const skills = registry.listSkills()
  const managedCount = skills.filter((skill) => skill.source === 'managed').length

  return [
    `本地 skill 包版本：${SKILL_PACK_METADATA.skill_pack_version}（checksum: ${SKILL_PACK_METADATA.skill_pack_checksum.slice(0, 12)}...）`,
    skills.length > 0
      ? `当前已加载 ${skills.length} 个市场 CAD skills，其中后端更新安装 ${managedCount} 个，其余为客户端离线回退副本。`
      : '当前未发现已加载的 CAD skills。',
    registry.buildAvailableSkillsPrompt(),
    buildSkillsPolicyPromptSection(),
  ].filter(Boolean).join('\n')
}
