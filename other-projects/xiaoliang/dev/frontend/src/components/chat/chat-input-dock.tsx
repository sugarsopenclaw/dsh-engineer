import { type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
  GitBranch,
  ListPlus,
  ListX,
  Loader2,
  Mic,
  Pencil,
  Plus,
  SendHorizontal,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { BorderBeam } from 'border-beam'
import { PromptTemplateDialog } from '@/components/chat/prompt-template-dialog'
import { Button } from '@/components/ui/button'
import { useSessionRuntimeResources } from '@/hooks/use-session-runtime-resources'
import { useUserPromptTemplates } from '@/hooks/use-user-prompt-templates'
import { cn } from '@/lib/utils'
import type { AgentQueueKind, AgentQueuedMessage, AgentQueueState, ImageAttachment } from '@/shared/local-agent'
import { imageAttachmentToDataUrl } from '@/shared/local-agent'
import type { ThinkingMode } from '@/shared/billing-domain'
import { thinkingModeLabel } from '@/shared/billing-domain'

export interface ConversationThinkingSelectProps {
  value: ThinkingMode
  disabled: boolean
  onChange: (mode: ThinkingMode) => void
}

export interface VoiceInputControlProps {
  supported: boolean
  recording: boolean
  transcribing: boolean
  durationSeconds: number
  statusMessage?: string | null
  disabled?: boolean
  onToggle: () => void | Promise<void>
}

export interface ConversationBranchControlProps {
  label: string
  childCount: number
  disabled: boolean
  onOpen: () => void
}

interface TemplateAutocompleteItem {
  key: string
  label: string
  description: string
  argumentHint?: string
  insertion: string
  source: 'user' | 'runtime'
}

interface ChatInputDockProps {
  conversationId: string | null
  input: string
  attachedImages: ImageAttachment[]
  isAgentRunning: boolean
  agentQueue: AgentQueueState
  canQueueAgentMessages: boolean
  queueMutationPending: boolean
  canSend: boolean
  contextUsageIndicator?: ReactNode
  cadConnectionIndicator?: ReactNode
  teachingModeHint?: ReactNode
  /** 输入框外底部的本轮用量 / 剩余算力小字。 */
  usageStatsLine?: ReactNode
  conversationBranchControl?: ConversationBranchControlProps
  onInputChange: (value: string) => void
  onSend: () => void
  onQueue: () => void
  onChangeQueueItemKind: (id: string, kind: AgentQueueKind) => void
  onClearQueue: () => void
  editingQueueItemId: string | null
  onEditQueueItem: (item: AgentQueuedMessage) => void
  onSaveQueueEdit: () => void
  onCancelQueueEdit: () => void
  onRemoveQueueItem: (id: string) => void
  onStop: () => void
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void | Promise<void>
  onDrop: (event: React.DragEvent<HTMLTextAreaElement>) => void | Promise<void>
  onAddImages: (files: File[]) => void | Promise<void>
  onRemoveImage: (id: string) => void
  conversationThinkingSelect?: ConversationThinkingSelectProps
  voiceInputControl?: VoiceInputControlProps
}

function formatDuration(seconds: number): string {
  const safeValue = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const mm = Math.floor(safeValue / 60)
  const ss = safeValue % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export function ChatInputDock({
  conversationId,
  input,
  attachedImages,
  isAgentRunning,
  agentQueue,
  canQueueAgentMessages,
  queueMutationPending,
  canSend,
  contextUsageIndicator,
  cadConnectionIndicator,
  teachingModeHint,
  usageStatsLine,
  conversationBranchControl,
  onInputChange,
  onSend,
  onQueue,
  onChangeQueueItemKind,
  onClearQueue,
  editingQueueItemId,
  onEditQueueItem,
  onSaveQueueEdit,
  onCancelQueueEdit,
  onRemoveQueueItem,
  onStop,
  onPaste,
  onDrop,
  onAddImages,
  onRemoveImage,
  conversationThinkingSelect,
  voiceInputControl,
}: ChatInputDockProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const templateListId = useId()
  const thinkingPickerTriggerRef = useRef<HTMLDivElement>(null)
  const thinkingPickerPopupRef = useRef<HTMLDivElement>(null)
  const [thinkingPickerOpen, setThinkingPickerOpen] = useState(false)
  const [thinkingPickerPosition, setThinkingPickerPosition] = useState<{
    left: number
    top?: number
    bottom?: number
  } | null>(null)
  const [templateAutocompleteDismissed, setTemplateAutocompleteDismissed] = useState(false)
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState(0)

  const templateMatch = /^\/([^\s]*)$/u.exec(input)
  const templateQuery = templateMatch?.[1]?.toLocaleLowerCase('zh-CN') ?? null
  const templateAutocompleteEligible = Boolean(
    templateQuery !== null
    && (!isAgentRunning || canQueueAgentMessages || editingQueueItemId),
  )
  const {
    resources: runtimeResources,
    loading: templatesLoading,
    error: templatesError,
  } = useSessionRuntimeResources(conversationId, {
    enabled: templateAutocompleteEligible && Boolean(conversationId),
  })
  const {
    templates: userTemplates,
    loading: userTemplatesLoading,
    error: userTemplatesError,
  } = useUserPromptTemplates({
    enabled: templateAutocompleteEligible,
  })
  const matchingTemplates = useMemo(() => {
    if (templateQuery === null) return []
    const personal: TemplateAutocompleteItem[] = userTemplates
      .filter((template) => template.title.toLocaleLowerCase('zh-CN').startsWith(templateQuery))
      .map((template) => ({
        key: `user:${template.id}`,
        label: template.title,
        description: template.description || template.content,
        insertion: template.content,
        source: 'user',
      }))
    const runtime: TemplateAutocompleteItem[] = (runtimeResources?.promptTemplates ?? [])
      .filter((template) => template.name.toLocaleLowerCase('zh-CN').startsWith(templateQuery))
      .map((template) => ({
        key: `runtime:${template.source}:${template.name}`,
        label: `/${template.name}`,
        description: template.description || '暂无说明',
        argumentHint: template.argumentHint,
        insertion: `/${template.name} `,
        source: 'runtime',
      }))
    return [...personal, ...runtime]
  }, [runtimeResources?.promptTemplates, templateQuery, userTemplates])
  const templateAutocompleteOpen = Boolean(
    templateAutocompleteEligible && !templateAutocompleteDismissed,
  )

  const thinkingOptions: Array<{ value: ThinkingMode; label: string }> = [
    { value: 'fast', label: thinkingModeLabel('fast') },
    { value: 'deep', label: thinkingModeLabel('deep') },
  ]

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = '0px'
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 48), 120)
    textarea.style.height = `${nextHeight}px`
  }, [input])

  useEffect(() => {
    setTemplateAutocompleteDismissed(false)
    setSelectedTemplateIndex(0)
  }, [input])

  useEffect(() => {
    setSelectedTemplateIndex((current) => (
      matchingTemplates.length === 0 ? 0 : Math.min(current, matchingTemplates.length - 1)
    ))
  }, [matchingTemplates.length])

  useEffect(() => {
    if (!thinkingPickerOpen) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (
        thinkingPickerTriggerRef.current?.contains(target) ||
        thinkingPickerPopupRef.current?.contains(target)
      ) {
        return
      }

      setThinkingPickerOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setThinkingPickerOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [thinkingPickerOpen])

  useEffect(() => {
    if (conversationThinkingSelect?.disabled) {
      setThinkingPickerOpen(false)
    }
  }, [conversationThinkingSelect?.disabled])

  useLayoutEffect(() => {
    if (!thinkingPickerOpen) {
      setThinkingPickerPosition(null)
      return
    }

    function updatePosition() {
      const rect = thinkingPickerTriggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const popupRect = thinkingPickerPopupRef.current?.getBoundingClientRect()
      const popupWidth = popupRect?.width || 104
      const popupHeight = popupRect?.height || 80
      const viewportGap = 8
      const maxLeft = Math.max(viewportGap, window.innerWidth - popupWidth - viewportGap)
      const left = Math.min(Math.max(rect.left, viewportGap), maxLeft)

      if (rect.top >= popupHeight + viewportGap) {
        setThinkingPickerPosition({
          left,
          bottom: window.innerHeight - rect.top + viewportGap,
        })
        return
      }

      setThinkingPickerPosition({
        left,
        top: rect.bottom + viewportGap,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    const resizeObserver = new ResizeObserver(updatePosition)
    const trigger = thinkingPickerTriggerRef.current
    if (trigger) resizeObserver.observe(trigger)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      resizeObserver.disconnect()
    }
  }, [thinkingPickerOpen])

  const voiceBusy = Boolean(voiceInputControl?.recording || voiceInputControl?.transcribing)
  const queuedItems = agentQueue.items ?? []
  const queuedMessageCount = queuedItems.length
  const editingQueueItem = editingQueueItemId
    ? queuedItems.find((item) => item.id === editingQueueItemId) ?? null
    : null
  const hasComposerDraft = Boolean(input.trim() || attachedImages.length)
  const canQueueDraft = Boolean(
    canQueueAgentMessages
    && !editingQueueItemId
    && hasComposerDraft
    && !queueMutationPending
    && !voiceBusy,
  )
  const canSaveQueueEdit = Boolean(
    editingQueueItemId
    && hasComposerDraft
    && !queueMutationPending
    && !voiceBusy,
  )
  const composerDisabled = Boolean(
    isAgentRunning && !canQueueAgentMessages && !editingQueueItemId,
  )

  const voiceStatusLabel =
    voiceInputControl?.recording
      ? '正在聆听，请继续说话'
      : voiceInputControl?.transcribing
        ? '语音识别中...'
        : voiceInputControl?.statusMessage?.trim() || ''

  function insertTemplate(template: TemplateAutocompleteItem) {
    onInputChange(template.insertion)
    setTemplateAutocompleteDismissed(true)
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    })
  }

  const thinkingPickerPopup =
    thinkingPickerOpen && conversationThinkingSelect
      ? createPortal(
          <div
            ref={thinkingPickerPopupRef}
            data-thinking-picker
            className="fixed z-[100] w-[6.5rem] overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.18)]"
            style={{
              left: thinkingPickerPosition?.left ?? 0,
              top: thinkingPickerPosition?.top,
              bottom: thinkingPickerPosition?.bottom,
              visibility: thinkingPickerPosition ? 'visible' : 'hidden',
            }}
          >
            <div className="p-1.5">
              {thinkingOptions.map((option) => {
                const active = option.value === conversationThinkingSelect.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-[12px] font-semibold leading-none transition',
                      active ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50',
                    )}
                    onClick={() => {
                      conversationThinkingSelect.onChange(option.value)
                      setThinkingPickerOpen(false)
                    }}
                  >
                    <span>{option.label}</span>
                    {active ? <Check className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : null}
                  </button>
                )
              })}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap justify-start gap-2" data-session-controls>
          {conversationBranchControl ? (
            <div data-conversation-branch-control>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`打开会话分支：${conversationBranchControl.label}`}
                title="打开会话分支"
                disabled={conversationBranchControl.disabled}
                onClick={conversationBranchControl.onOpen}
                className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/90 px-2.5 py-1 text-xs text-slate-600 shadow-sm transition hover:border-violet-200 hover:bg-violet-50/70 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate font-medium">{conversationBranchControl.label}</span>
                <span
                  className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                  aria-label={`${conversationBranchControl.childCount} 个子分支`}
                >
                  {conversationBranchControl.childCount}
                </span>
              </button>
            </div>
          ) : null}
          <PromptTemplateDialog
            conversationId={conversationId}
            onInsertTemplate={(content) => {
              onInputChange(content)
              window.requestAnimationFrame(() => {
                const textarea = textareaRef.current
                textarea?.focus()
                textarea?.setSelectionRange(content.length, content.length)
              })
            }}
          />
        </div>
      {attachedImages.length > 0 ? (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {attachedImages.map((image, index) => (
            <div
              key={image.id}
              className="relative shrink-0 overflow-hidden rounded-[18px] border border-slate-200/80 bg-slate-50/90 p-1.5 shadow-sm"
            >
              <img
                src={imageAttachmentToDataUrl(image)}
                alt={image.name || `附件 ${index + 1}`}
                className="h-16 w-16 rounded-[14px] object-cover"
              />
              <button
                type="button"
                aria-label={`移除附件 ${index + 1}`}
                className="absolute right-1.5 top-1.5 rounded-full bg-slate-950/78 p-1 text-white transition hover:bg-slate-950"
                onClick={() => onRemoveImage(image.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) {
            void onAddImages(files)
          }
          event.target.value = ''
        }}
      />

      <div className="relative">
        <BorderBeam
          active={isAgentRunning}
          size="pulse-inner"
          colorVariant="ocean"
          staticColors
          theme="light"
          strength={0.65}
          duration={2.8}
          borderRadius={12}
          aria-hidden="true"
          data-chat-input-beam
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          <div className="h-full w-full rounded-xl" />
        </BorderBeam>
        {templateAutocompleteOpen ? (
          <div
            id={templateListId}
            role="listbox"
            aria-label="提示模板"
            className="absolute bottom-full left-0 right-0 z-[90] mb-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200/90 bg-white p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.18)]"
            data-template-autocomplete
          >
            {(templatesLoading || userTemplatesLoading)
              && !runtimeResources
              && userTemplates.length === 0 ? (
              <div role="status" className="flex items-center gap-2 px-2.5 py-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                正在读取提示模板…
              </div>
            ) : matchingTemplates.length > 0 ? (
              matchingTemplates.map((template, index) => (
                <button
                  key={template.key}
                  id={`${templateListId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === selectedTemplateIndex}
                  onMouseEnter={() => setSelectedTemplateIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertTemplate(template)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
                    index === selectedTemplateIndex
                      ? 'bg-violet-50 text-violet-900'
                      : 'text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="block truncate font-mono text-xs font-semibold text-violet-700">{template.label}</span>
                      {template.source === 'user' ? (
                        <span className="shrink-0 rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700">我的模板</span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                      {template.description}
                    </span>
                  </span>
                  {template.argumentHint ? (
                    <span className="max-w-[45%] shrink-0 truncate pt-0.5 text-[10px] text-slate-400">
                      {template.argumentHint}
                    </span>
                  ) : null}
                </button>
              ))
            ) : templatesError || userTemplatesError ? (
              <p role="alert" className="px-2.5 py-2 text-xs text-rose-700">提示模板暂时不可用。</p>
            ) : (
              <p className="px-2.5 py-2 text-xs text-slate-500">没有匹配的提示模板。</p>
            )}
          </div>
        ) : null}
        <div className="relative overflow-visible rounded-xl border border-slate-200/70 bg-white/78 shadow-[0_10px_30px_-16px_rgba(15,23,42,0.35),0_2px_6px_-3px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        {queuedMessageCount > 0 ? (
          <div
            className="border-b border-sky-100 bg-sky-50/80 px-3 py-2 text-[11px] text-slate-600"
            data-agent-queue-preview
            aria-live="polite"
          >
            <div className="flex items-center gap-2">
              <ListPlus className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden="true" />
              <span className="min-w-0 flex-1 font-medium text-slate-700">
                已排队 {queuedMessageCount} 条
                {agentQueue.steeringCount > 0 ? ` · 立即引导 ${agentQueue.steeringCount}` : ''}
                {agentQueue.followUpCount > 0 ? ` · 下一轮 ${agentQueue.followUpCount}` : ''}
                {editingQueueItem ? ' · 正在编辑' : ''}
              </span>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-medium text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={onClearQueue}
                disabled={queueMutationPending}
                aria-label="删除全部排队消息"
              >
                <ListX className="h-3.5 w-3.5" aria-hidden="true" />
                删除
              </button>
            </div>
            <ol className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1" aria-label="排队消息">
              {queuedItems.map((item, index) => {
                const kindLabel = item.kind === 'steer' ? '立即引导' : '下一轮'
                const nextKind: AgentQueueKind = item.kind === 'steer' ? 'followUp' : 'steer'
                const kindActionLabel = item.kind === 'steer'
                  ? '改回下一轮（本轮结束后再处理）'
                  : '改为立即引导（下次模型调用前插入；等待子任务时会立刻让出）'
                const editing = item.id === editingQueueItemId
                return (
                  <li
                    key={item.id}
                    className={cn(
                      'flex items-start gap-1.5 rounded-lg px-2 py-1.5',
                      editing ? 'bg-sky-100/80 ring-1 ring-sky-200' : 'bg-white/70',
                    )}
                  >
                    <span className="w-4 shrink-0 pt-0.5 text-right font-mono text-[10px] text-slate-400">
                      {index + 1}.
                    </span>
                    <button
                      type="button"
                      className={cn(
                        'mt-0.5 inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-50',
                        item.kind === 'steer'
                          ? 'bg-sky-100 text-sky-700 hover:bg-sky-200/80'
                          : 'bg-violet-100 text-violet-700 hover:bg-violet-200/80',
                      )}
                      onClick={() => onChangeQueueItemKind(item.id, nextKind)}
                      disabled={queueMutationPending}
                      aria-label={kindActionLabel}
                      title={kindActionLabel}
                    >
                      {kindLabel}
                    </button>
                    <div className="min-w-0 flex-1">
                      <span className="break-words text-[11px] leading-4 text-slate-600">
                        {item.preview || (item.images.length > 0 ? `图片 ${item.images.length} 张` : '')}
                      </span>
                      {item.images.length > 0 ? (
                        <div className="mt-1.5 flex gap-1 overflow-x-auto">
                          {item.images.map((image, imageIndex) => (
                            <img
                              key={image.id}
                              src={imageAttachmentToDataUrl(image)}
                              alt={image.name || `附件 ${imageIndex + 1}`}
                              className="h-8 w-8 rounded-md object-cover ring-1 ring-slate-200"
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => onEditQueueItem(item)}
                        disabled={queueMutationPending}
                        aria-label={editing ? '正在编辑此条排队消息' : `编辑第 ${index + 1} 条排队消息`}
                        title="编辑"
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => onRemoveQueueItem(item.id)}
                        disabled={queueMutationPending}
                        aria-label={`删除第 ${index + 1} 条排队消息`}
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        ) : null}
        {teachingModeHint ? (
          <div className="border-b border-slate-200/70 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-600">
            {teachingModeHint}
          </div>
        ) : null}
        <div className="px-3 pb-1.5 pt-2.5">
          <textarea
            ref={textareaRef}
            className="min-h-[48px] max-h-[120px] w-full resize-none overflow-y-auto bg-transparent py-0.5 text-xs leading-5 text-slate-900 outline-none placeholder:text-slate-400"
            rows={2}
            placeholder={
              editingQueueItemId
                ? '正在编辑排队消息，Enter 保存，Esc 取消'
                : isAgentRunning
                  ? canQueueAgentMessages
                    ? '继续输入：Enter 排队到下一轮，可在队列中改为立即引导'
                    : '当前任务正在运行'
                  : 'Enter 发送，Shift+Enter 换行'
            }
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onPaste={(event) => {
              void onPaste(event)
            }}
            onDrop={(event) => {
              void onDrop(event)
            }}
            onDragOver={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (templateAutocompleteOpen) {
                if (event.key === 'ArrowDown' && matchingTemplates.length > 0) {
                  event.preventDefault()
                  setSelectedTemplateIndex((current) => (current + 1) % matchingTemplates.length)
                  return
                }
                if (event.key === 'ArrowUp' && matchingTemplates.length > 0) {
                  event.preventDefault()
                  setSelectedTemplateIndex((current) => (
                    (current - 1 + matchingTemplates.length) % matchingTemplates.length
                  ))
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setTemplateAutocompleteDismissed(true)
                  return
                }
                if (event.key === 'Enter' && !event.shiftKey && matchingTemplates.length > 0) {
                  event.preventDefault()
                  const selectedTemplate = matchingTemplates[selectedTemplateIndex]
                    ?? matchingTemplates[0]
                  if (selectedTemplate) insertTemplate(selectedTemplate)
                  return
                }
              }
              if (event.key === 'Escape' && editingQueueItemId) {
                event.preventDefault()
                onCancelQueueEdit()
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                if (voiceBusy) {
                  return
                }

                event.preventDefault()
                if (editingQueueItemId) {
                  if (canSaveQueueEdit) {
                    onSaveQueueEdit()
                  }
                  return
                }
                if (isAgentRunning) {
                  if (canQueueDraft) {
                    onQueue()
                  }
                  return
                }

                if (canSend) {
                  onSend()
                }
              }
            }}
            disabled={composerDisabled}
            aria-label="对话输入框"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={templateAutocompleteOpen}
            aria-controls={templateAutocompleteOpen ? templateListId : undefined}
            aria-activedescendant={
              templateAutocompleteOpen && matchingTemplates.length > 0
                ? `${templateListId}-option-${selectedTemplateIndex}`
                : undefined
            }
          />
        </div>

        {voiceInputControl && voiceStatusLabel ? (
          <div className="mx-2 mb-1 rounded-lg border border-slate-200/80 bg-slate-50/70 px-2.5 py-1.5 text-[11px] text-slate-600">
            <div className="flex items-center gap-2">
              {voiceInputControl.recording ? (
                <div className="flex items-end gap-0.5" aria-hidden>
                  <span className="h-2 w-0.5 rounded-full bg-rose-500/90 animate-pulse" style={{ animationDuration: '1s' }} />
                  <span className="h-3 w-0.5 rounded-full bg-rose-500/90 animate-pulse" style={{ animationDuration: '0.8s' }} />
                  <span className="h-2.5 w-0.5 rounded-full bg-rose-500/90 animate-pulse" style={{ animationDuration: '1.2s' }} />
                </div>
              ) : voiceInputControl.transcribing ? (
                <Loader2 className="h-3 w-3 animate-spin text-slate-500" />
              ) : (
                <Mic className="h-3 w-3 text-slate-500" />
              )}

              <span className="min-w-0 flex-1 truncate">{voiceStatusLabel}</span>

              {voiceInputControl.recording ? (
                <span className="shrink-0 font-mono text-slate-500">
                  {formatDuration(voiceInputControl.durationSeconds)}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

          <div className="flex min-h-[2.5rem] items-center gap-1.5 pl-1.5 pr-1 pb-1 pt-0.5">
          <div className="flex min-w-0 flex-1 items-center gap-0">
            <Button
              type="button"
              variant="ghost"
              className="!h-8 !min-h-0 !w-8 shrink-0 rounded-lg !p-0 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              onClick={() => fileInputRef.current?.click()}
              disabled={composerDisabled || voiceBusy}
              aria-label="上传图片"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            </Button>
            {conversationThinkingSelect ? (
              <div
                ref={thinkingPickerTriggerRef}
                className="relative min-w-0 shrink"
              >
                <button
                  type="button"
                  className={cn(
                    'flex h-8 min-w-0 items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-2.5 text-left shadow-sm transition',
                    conversationThinkingSelect.disabled
                      ? 'cursor-not-allowed text-slate-400'
                      : 'text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                  )}
                  disabled={conversationThinkingSelect.disabled}
                  onClick={() => {
                    setThinkingPickerOpen((current) => !current)
                  }}
                  aria-label="切换思考模式"
                  aria-expanded={thinkingPickerOpen}
                  title="极速：轻量推理；专家：最强推理"
                >
                  <div className="max-w-[5rem] truncate text-[11px] font-semibold leading-none">
                    {thinkingModeLabel(conversationThinkingSelect.value)}
                  </div>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-slate-400 transition',
                      thinkingPickerOpen && 'rotate-180',
                    )}
                  />
                </button>
                {thinkingPickerPopup}
              </div>
            ) : null}
            {contextUsageIndicator ? (
              <div className="ml-1 flex shrink-0 items-center justify-center">
                {contextUsageIndicator}
              </div>
            ) : null}
            {cadConnectionIndicator ? (
              <div className="ml-1 flex shrink-0 items-center justify-center">
                {cadConnectionIndicator}
              </div>
            ) : null}
          </div>
          <div className="ml-1 flex shrink-0 items-center gap-0.5">
            {voiceInputControl ? (
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  '!h-8 !min-h-0 !w-8 shrink-0 rounded-lg !p-0',
                  voiceInputControl.recording
                    ? 'text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                    : voiceInputControl.transcribing
                      ? 'text-slate-500'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
                )}
                onClick={() => {
                  void voiceInputControl.onToggle()
                }}
                disabled={
                  voiceInputControl.recording
                    ? false
                    : Boolean(voiceInputControl.disabled || voiceInputControl.transcribing)
                }
                aria-label={
                  !voiceInputControl.supported
                    ? '当前环境不支持语音输入'
                    : voiceInputControl.recording
                      ? '结束录音'
                      : '开始语音输入'
                }
                title={
                  !voiceInputControl.supported
                    ? '当前环境不支持语音输入'
                    : voiceInputControl.recording
                      ? '结束录音'
                      : '语音输入'
                }
              >
                {voiceInputControl.transcribing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : voiceInputControl.recording ? (
                  <Square className="h-3.5 w-3.5 fill-current stroke-[2.5]" />
                ) : (
                  <Mic className="h-3.5 w-3.5 stroke-[2.5]" />
                )}
              </Button>
            ) : null}
            {editingQueueItemId ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="!h-8 !min-h-0 shrink-0 gap-1 rounded-lg !px-2 text-[11px] text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                  onClick={onCancelQueueEdit}
                  disabled={queueMutationPending}
                  aria-label="取消编辑排队消息"
                >
                  取消
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="!h-8 !min-h-0 shrink-0 gap-1 rounded-lg !px-2 text-[11px] text-sky-600 hover:bg-sky-50 hover:text-sky-700"
                  onClick={onSaveQueueEdit}
                  disabled={!canSaveQueueEdit}
                  aria-label="保存排队消息"
                  title="保存到原队列位置（Enter）"
                >
                  <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                  保存
                </Button>
              </>
            ) : null}
            {isAgentRunning || !editingQueueItemId ? (
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  '!min-h-0 shrink-0 !p-0',
                  isAgentRunning
                    ? '!h-7 !w-7 rounded-full bg-[#ff3b30] text-white hover:bg-[#e0342b] hover:text-white'
                    : '!h-8 !w-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900',
                )}
                onClick={isAgentRunning ? onStop : onSend}
                disabled={!isAgentRunning && (!canSend || voiceBusy)}
                aria-label={isAgentRunning ? '停止生成' : '发送消息'}
              >
                {isAgentRunning ? (
                  <Square className="h-2.5 w-2.5 fill-white text-white" />
                ) : (
                  <SendHorizontal className="h-3.5 w-3.5 stroke-[2.5]" />
                )}
              </Button>
            ) : null}
          </div>
          </div>
        </div>
      </div>
      <div className="flex min-h-[14px] w-full items-center justify-center px-2 py-1">
        {usageStatsLine}
      </div>
    </div>
  )
}
