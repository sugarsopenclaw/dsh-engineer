import type { ContextProvider } from '../context-assembler'

export type CadSessionState =
  | 'ready'
  | 'not_running'
  | 'unsupported'
  | 'no_document'
  | 'unavailable'

export interface CadSessionSnapshot {
  state: CadSessionState
  activeDocument: {
    name: string
    projectRelativePath: string | null
  } | null
  documentCount: number
  updatedAt: string
}

function stateLabel(state: CadSessionState) {
  if (state === 'ready') return '已连接'
  if (state === 'not_running') return 'AutoCAD 未运行'
  if (state === 'unsupported') return '当前 AutoCAD 不受支持'
  if (state === 'no_document') return '没有活动图纸'
  return '状态不可用'
}

export function formatCadSessionDelegateContext(snapshot: CadSessionSnapshot): string {
  const active = snapshot.activeDocument
  // 只传状态；图纸选择优先级与兜底规则以 child definition 为唯一权威。
  return [
    '[host_cad_session]',
    'source: 宿主只读会话摘要，不包含实体或 COM 能力',
    `autocad_state: ${snapshot.state}`,
    `active_document_name: ${active?.name || '未知'}`,
    `project_relative_path: ${active?.projectRelativePath || '未映射'}`,
    `updated_at: ${snapshot.updatedAt}`,
    '[/host_cad_session]',
  ].join('\n')
}

export function buildCadSessionProvider(
  resolveSnapshot: (conversationId: string) => CadSessionSnapshot | null,
): ContextProvider {
  return {
    key: 'cad_session',
    provide: ({ conversationId }) => {
      const snapshot = resolveSnapshot(conversationId)
      if (!snapshot) return null

      const active = snapshot.activeDocument
      // 只报状态；委派与选图规则的唯一权威在 system prompt 的 [任务路由]。
      return [
        '来源：宿主只读 CAD 会话摘要；不包含实体、选择集或 COM 能力。',
        `AutoCAD 状态：${stateLabel(snapshot.state)}`,
        `当前打开：${active?.name || '未知'}`,
        `项目相对路径：${active?.projectRelativePath || '未映射'}`,
      ].join('\n')
    },
  }
}
