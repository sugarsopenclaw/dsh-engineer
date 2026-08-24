import {
  formatComputerRegionFallback,
  type SystemPromptContext,
} from '../system/prompt-context'

function formatLocalTime(context: SystemPromptContext) {
  try {
    return new Intl.DateTimeFormat(context.systemLocale || undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: context.timeZone || undefined,
    }).format(context.now)
  } catch {
    return context.now.toISOString()
  }
}

export function buildRuntimeReminder(context: SystemPromptContext) {
  return [
    `当前时间：${formatLocalTime(context)}`,
    `电脑环境：region=${context.computerRegionCode || 'unknown'}；locale=${context.systemLocale || 'unknown'}；timezone=${context.timeZone || 'unknown'}`,
    `联网 region 国家级兜底：${formatComputerRegionFallback(context.computerRegionCode)}`,
    '电脑区域只表示 OS 国家/地区，不是项目所在地；不得根据 timezone 推断项目省市（例如 Asia/Shanghai 不代表上海市）。',
    `当前模型：${context.provider}/${context.modelId}`,
    `当前会话：${context.conversationTitle || '新对话'}`,
    `本轮输入图片数：${context.imageCount}`,
    ...(context.activeCadEvidenceTask && context.toolNames.includes('delegate_cad_drafter')
      ? ['当前有 AutoCAD 取证任务进行中；AutoCAD 通道同时只跑一个，新的读图问题走文件通道 delegate_cad_drafter，不要再派第二个 delegate_cad。']
      : []),
  ].join('\n')
}
