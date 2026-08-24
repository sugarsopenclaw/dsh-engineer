import { memo, useMemo } from 'react'
import MarkstreamMarkdownRender from 'markstream-react'
import { cn } from '@/lib/utils'

interface MarkdownRenderProps {
  content: string
  className?: string
  final?: boolean
}

function normalizeMarkdownContent(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\n\s*[•·]\s+/g, '\n- ')
    .replace(/\n{3,}/g, '\n\n')
}

export const MarkdownRender = memo(function MarkdownRender({
  content,
  className,
  final = true,
}: MarkdownRenderProps) {
  const normalizedContent = useMemo(
    () => normalizeMarkdownContent(content),
    [content],
  )

  return (
    <div
      className={cn(
        'chat-markdown min-w-0 max-w-none break-words text-sm leading-7 text-slate-800',
        className,
      )}
    >
      {/* markstream 默认只立即渲染前 40 个顶层节点，其余等可见性回调唤醒，
          而该回调只写 ref 不触发重渲染：已完成的消息不再重渲染，正文会永久停在第 40 个节点。 */}
      <MarkstreamMarkdownRender
        batchRendering={false}
        content={normalizedContent}
        deferNodesUntilVisible={false}
        fade={false}
        final={final}
        renderCodeBlocksAsPre
        smoothStreaming={false}
        typewriter={false}
      />
    </div>
  )
})
