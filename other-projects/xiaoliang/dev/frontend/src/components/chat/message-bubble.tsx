import { memo, useState } from 'react'
import { Check, Copy, GitBranch, GitFork, Image as ImageIcon, LoaderCircle } from 'lucide-react'
import type { AgentMessageFeedbackDraft } from '@/hooks/use-agent-message-feedback'
import { stripInlineImageReferences } from '@/lib/strip-inline-image-references'
import { cn } from '@/lib/utils'
import type { AgentMessageFeedbackView } from '@/shared/backend-api'
import type { AgentMessageRecord } from '@/shared/local-agent'
import { AgentMessageFeedback } from './agent-message-feedback'
import { HostNoticeRow } from './host-notice-row'
import { MarkdownRender } from './markdown-render'
import { MessageImages } from './message-images'
import { ThinkingBlock } from './thinking-block'
import { ToolCallBlock } from './tool-call-block'

function getCopyableAssistantText(message: AgentMessageRecord): string {
  const attachments = message.attachments ?? []
  const textParts = (message.parts ?? [])
    .flatMap((part) => (
      part.type === 'text'
        ? [stripInlineImageReferences(part.content, attachments).trim()]
        : []
    ))
    .filter(Boolean)
  if (textParts.length > 0) return textParts.join('\n\n')
  return stripInlineImageReferences(message.content, attachments).trim()
}

interface MessageBubbleProps {
  message: AgentMessageRecord
  feedback?: AgentMessageFeedbackView
  feedbackLoading?: boolean
  feedbackUnavailable?: boolean
  branchActionsDisabled?: boolean
  branchActionPending?: boolean
  onForkBefore?: (message: AgentMessageRecord) => Promise<void> | void
  onCloneAt?: (message: AgentMessageRecord) => Promise<void> | void
  onSaveFeedback: (
    message: AgentMessageRecord,
    draft: AgentMessageFeedbackDraft,
  ) => Promise<AgentMessageFeedbackView>
  onDeleteFeedback: (message: AgentMessageRecord) => Promise<void>
}

export const MessageBubble = memo(function MessageBubble({
  message,
  feedback,
  feedbackLoading,
  feedbackUnavailable,
  branchActionsDisabled = false,
  branchActionPending = false,
  onForkBefore,
  onCloneAt,
  onSaveFeedback,
  onDeleteFeedback,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  const attachments = message.attachments ?? []
  const parts = message.parts ?? []
  const assistantContent = attachments.length > 0 && !isUser
    ? stripInlineImageReferences(message.content, attachments)
    : message.content
  const canForkBefore = Boolean(message.piEntryId && onForkBefore)
  const canCloneAt = Boolean(message.piEntryId && onCloneAt)
  const [copied, setCopied] = useState(false)
  const copyableText = isTool
    ? ''
    : isUser
      ? message.content.trim()
      : getCopyableAssistantText(message)
  const showUserActions = isUser && (Boolean(copyableText) || canForkBefore)

  async function handleCopyText() {
    if (!copyableText) return
    try {
      await navigator.clipboard.writeText(copyableText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  if (message.hostNotice) {
    return <HostNoticeRow notice={message.hostNotice} />
  }

  if (isTool) {
    return (
      <div className="flex justify-start">
        <div className="w-full min-w-0">
          <ToolCallBlock
            name={message.toolName || '工具调用'}
            args={message.toolArgs || undefined}
            result={message.toolResult || message.content || undefined}
            status="done"
          />
          <MessageImages attachments={attachments} className="mt-3" />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex w-full flex-col', isUser ? 'items-end' : 'items-stretch')}>
      <article
        className={cn(
          'w-full min-w-0 rounded-[24px] px-4 py-3 shadow-sm',
          isUser
            ? 'ml-auto max-w-[min(86%,760px)] border border-slate-900/10 bg-slate-900 text-white'
            : 'border border-white/65 bg-white/86 text-slate-900',
        )}
      >
        {isUser ? (
          <MessageImages attachments={attachments} tone="user" className="mb-3" />
        ) : null}

        {!isUser && parts.length > 0 ? (
          <div className="space-y-3">
            {parts.map((part, index) => {
              if (part.type === 'thinking') {
                return <ThinkingBlock key={`thinking-${index}`} content={part.content} fullBleed />
              }
              if (part.type === 'tool') {
                return (
                  <ToolCallBlock
                    key={part.toolCallId || `tool-${index}`}
                    name={part.name || '工具调用'}
                    args={part.args || undefined}
                    result={part.result || undefined}
                    status="done"
                  />
                )
              }
              const content = attachments.length > 0
                ? stripInlineImageReferences(part.content, attachments)
                : part.content
              if (!content) return null
              return (
                <MarkdownRender
                  key={`text-${index}`}
                  content={content}
                  className="text-inherit [&_a]:text-sky-600"
                />
              )
            })}
          </div>
        ) : isUser ? (
          message.content ? (
            <div className="whitespace-pre-wrap break-words text-sm leading-7">{message.content}</div>
          ) : attachments.length > 0 ? (
            <div className="flex items-center gap-2 text-sm text-white/70">
              <ImageIcon className="h-4 w-4" />
              <span>已发送 {attachments.length} 张图片</span>
            </div>
          ) : null
        ) : (
          <>
            {message.thinking ? <ThinkingBlock content={message.thinking} fullBleed /> : null}
            {assistantContent ? (
              <MarkdownRender
                content={assistantContent}
                className="text-inherit [&_a]:text-sky-600"
              />
            ) : null}
          </>
        )}

        {!isUser ? (
          <MessageImages attachments={attachments} className="mt-3" />
        ) : null}
      </article>
      {showUserActions ? (
        <div className="mt-1.5 flex w-full max-w-[min(86%,760px)] items-center justify-end gap-1 px-2 text-slate-500">
          <button
            type="button"
            title={copied ? '已复制' : '复制'}
            aria-label={copied ? '已复制消息' : '复制消息'}
            disabled={!copyableText}
            onClick={() => void handleCopyText()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          </button>
          {canForkBefore ? (
            <button
              type="button"
              title="编辑并分叉"
              aria-label="编辑并分叉"
              disabled={branchActionsDisabled}
              onClick={() => void onForkBefore?.(message)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {branchActionPending ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <GitFork className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          ) : null}
        </div>
      ) : null}
      {!isUser ? (
        <AgentMessageFeedback
          message={message}
          feedback={feedback}
          loading={feedbackLoading}
          unavailable={feedbackUnavailable}
          onSave={onSaveFeedback}
          onDelete={onDeleteFeedback}
          leadingControls={(
            <>
              <button
                type="button"
                title={copied ? '已复制' : '复制'}
                aria-label={copied ? '已复制回答' : '复制回答'}
                disabled={!copyableText}
                onClick={() => void handleCopyText()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              </button>
              {canCloneAt ? (
                <button
                  type="button"
                  title="从此处分支"
                  aria-label="从此处分支"
                  disabled={branchActionsDisabled}
                  onClick={() => void onCloneAt?.(message)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {branchActionPending ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <GitBranch className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              ) : null}
            </>
          )}
        />
      ) : null}
    </div>
  )
})
