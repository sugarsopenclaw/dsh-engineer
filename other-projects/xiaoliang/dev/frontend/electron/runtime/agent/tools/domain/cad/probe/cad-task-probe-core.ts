/**
 * cad_task_probe 纯逻辑核心（无 CAD I/O、无 Node 依赖，可单测）。
 *
 * 这是从 new-dev 已验证、已修复的 Python 编排（cad_task_probe.py + cad_component_probe.py）
 * 移植过来的"前半段"：自然语言任务 -> 构件别名识别 -> 候选检索词（含无编号兜底）
 * -> 候选打分 -> 补充证据分类/打分 -> 证据需求清单。
 *
 * CAD I/O（findTextPlus / extractWindow / plotRegion）由 AgentSessionManager.probeCadTask 负责，
 * 复用 dev/frontend 已有的 CadRuntimeService 与几何/出图/摘要 helper。
 */

export interface ProbeComponent {
  kind: string
  label: string
  terms: string[]
  prefixes: string[]
  evidenceTerms: string[]
  layerTerms: string[]
  matchedTerms: string[]
}


interface ComponentAliasConfig {
  kind: string
  label: string
  terms: string[]
  prefixes: string[]
  evidenceTerms: string[]
  layerTerms: string[]
}

export const COMPONENT_ALIASES: ComponentAliasConfig[] = [
  {
    kind: 'independent_foundation',
    label: '独立基础',
    terms: ['独立基础', '独基', '独立柱基', '柱下独立基础', '基础'],
    prefixes: ['DJP', 'DJ', 'J'],
    evidenceTerms: ['独立基础', '独基', '基础详图', '基础表', '基础说明', '基础大样'],
    layerTerms: ['独立基础', '独基', '基础'],
  },
  {
    kind: 'pile_cap',
    label: '承台',
    terms: ['承台', '桩承台'],
    prefixes: ['CT', 'CTA', 'ZCT'],
    evidenceTerms: ['承台', '承台详图', '承台表', '桩基说明'],
    layerTerms: ['承台', '桩'],
  },
  {
    kind: 'column',
    label: '柱',
    terms: ['框架柱', '结构柱', '柱'],
    prefixes: ['KZ', 'XZ', 'GZ', 'Z'],
    evidenceTerms: ['柱表', '柱详图', '柱说明'],
    layerTerms: ['柱'],
  },
  {
    kind: 'beam',
    label: '梁',
    terms: ['框架梁', '梁'],
    prefixes: ['KL', 'WKL', 'L', 'XL'],
    evidenceTerms: ['梁表', '梁详图', '梁说明'],
    layerTerms: ['梁'],
  },
  {
    kind: 'wall',
    label: '墙',
    terms: ['剪力墙', '墙'],
    prefixes: ['Q', 'WQ', 'DQ'],
    evidenceTerms: ['墙表', '墙详图', '墙说明'],
    layerTerms: ['墙'],
  },
]


export function normalizeProbeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase()
}


export function detectComponent(task: string): ProbeComponent | null {
  const normalized = normalizeProbeText(task)
  let best: ProbeComponent | null = null
  for (const config of COMPONENT_ALIASES) {
    const hitTerms = config.terms.filter((term) => normalized.includes(normalizeProbeText(term)))
    if (hitTerms.length === 0) continue
    const longest = (terms: string[]) => terms.reduce((max, term) => Math.max(max, term.length), 0)
    if (best == null || longest(hitTerms) > longest(best.matchedTerms)) {
      best = { ...config, matchedTerms: hitTerms }
    }
  }
  return best
}

