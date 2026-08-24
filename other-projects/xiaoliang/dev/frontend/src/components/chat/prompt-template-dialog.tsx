import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FileText,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSessionRuntimeResources } from '@/hooks/use-session-runtime-resources'
import { useUserPromptTemplates } from '@/hooks/use-user-prompt-templates'
import { cn } from '@/lib/utils'
import type { PromptTemplateView } from '@/shared/backend-api'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface TemplateDraft {
  title: string
  description: string
  content: string
}

const EMPTY_DRAFT: TemplateDraft = {
  title: '',
  description: '',
  content: '',
}

export interface PromptTemplateDialogProps {
  conversationId: string | null
  onInsertTemplate: (content: string) => void
}

function draftFromTemplate(template: PromptTemplateView): TemplateDraft {
  return {
    title: template.title,
    description: template.description ?? '',
    content: template.content,
  }
}

export function PromptTemplateDialog({
  conversationId,
  onInsertTemplate,
}: PromptTemplateDialogProps) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const {
    authenticated,
    templates,
    loading,
    error,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    clearError,
  } = useUserPromptTemplates({
    enabled: open,
    refreshOnEnable: true,
  })
  const {
    resources: runtimeResources,
    loading: runtimeLoading,
    error: runtimeError,
  } = useSessionRuntimeResources(conversationId, {
    enabled: open && Boolean(conversationId),
    refreshOnEnable: true,
  })

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus()
    }
  }, [open])

  function resetEditor() {
    setEditorOpen(false)
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setFormError(null)
  }

  function closeDialog() {
    setOpen(false)
    resetEditor()
  }

  function beginCreate() {
    clearError()
    setNotice(null)
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setFormError(null)
    setEditorOpen(true)
  }

  function beginEdit(template: PromptTemplateView) {
    clearError()
    setNotice(null)
    setEditingId(template.id)
    setDraft(draftFromTemplate(template))
    setFormError(null)
    setEditorOpen(true)
  }

  function insert(content: string) {
    onInsertTemplate(content)
    closeDialog()
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const title = draft.title.trim()
    const description = draft.description.trim()
    const content = draft.content.trim()
    if (!title) {
      setFormError('请输入模板名称。')
      return
    }
    if (!content) {
      setFormError('请输入模板内容。')
      return
    }

    setSaving(true)
    setFormError(null)
    setNotice(null)
    try {
      const payload = {
        title,
        description: description || null,
        content,
      }
      if (editingId) {
        await updateTemplate(editingId, payload)
        setNotice('模板已更新并同步到云端。')
      } else {
        await createTemplate(payload)
        setNotice('模板已创建并同步到云端。')
      }
      resetEditor()
    } catch (saveError) {
      console.warn('[prompt-templates] unable to save template', saveError)
      setFormError('模板保存失败，请检查名称是否重复后重试。')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(template: PromptTemplateView) {
    if (deletingId || !window.confirm(`确定删除提示词模板“${template.title}”吗？`)) return
    setDeletingId(template.id)
    setNotice(null)
    try {
      await deleteTemplate(template.id)
      if (editingId === template.id) resetEditor()
      setNotice('模板已删除。')
    } catch (deleteError) {
      console.warn('[prompt-templates] unable to delete template', deleteError)
    } finally {
      setDeletingId(null)
    }
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDialog()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (!focusable?.length) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const trigger = (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="管理提示词模板"
      title="管理提示词模板"
      onClick={() => setOpen(true)}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition hover:border-violet-200 hover:bg-violet-50/70 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      提示词模板
    </button>
  )

  if (!open) return trigger

  const builtInTemplates = runtimeResources?.promptTemplates ?? []

  return (
    <>
      {trigger}
      {createPortal(
        <div
          ref={overlayRef}
          className="fixed inset-0 z-[10020] flex items-center justify-center bg-slate-950/38 px-3 py-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === overlayRef.current) closeDialog()
          }}
        >
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/80 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)] outline-none"
          >
            <header className="flex items-start gap-3 border-b border-slate-200/80 px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                <Sparkles className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-sm font-semibold text-slate-900">提示词模板</h2>
                <p id={descriptionId} className="mt-1 text-xs leading-5 text-slate-500">
                  创建常用提示词，点击即可插入当前输入框。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭提示词模板"
                onClick={closeDialog}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>

            <div className="overflow-y-auto px-5 py-4">
              {notice ? (
                <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  {notice}
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  模板同步失败：{error}
                </p>
              ) : null}

              <section aria-labelledby={`${titleId}-mine`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 id={`${titleId}-mine`} className="text-xs font-semibold text-slate-800">我的模板</h3>
                    <p className="mt-1 text-[11px] text-slate-500">最多保存 100 个账号级模板。</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!authenticated || saving}
                    onClick={beginCreate}
                    className="h-8 gap-1.5 rounded-lg bg-violet-600 px-3 text-xs hover:bg-violet-700"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    新建模板
                  </Button>
                </div>

                {editorOpen ? (
                  <form
                    onSubmit={handleSave}
                    className="mb-4 rounded-xl border border-violet-200 bg-violet-50/35 p-3"
                    data-prompt-template-editor
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-medium text-slate-700">
                        模板名称
                        <input
                          autoFocus
                          required
                          maxLength={80}
                          value={draft.title}
                          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                          className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                          placeholder="例如：检查施工图问题"
                        />
                      </label>
                      <label className="text-xs font-medium text-slate-700">
                        说明（可选）
                        <input
                          maxLength={500}
                          value={draft.description}
                          onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                          className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                          placeholder="说明这个模板适合什么场景"
                        />
                      </label>
                    </div>
                    <label className="mt-3 block text-xs font-medium text-slate-700">
                      提示词内容
                      <textarea
                        required
                        maxLength={20_000}
                        rows={6}
                        value={draft.content}
                        onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                        className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                        placeholder="输入需要重复使用的完整提示词…"
                      />
                    </label>
                    {formError ? <p role="alert" className="mt-2 text-xs text-rose-700">{formError}</p> : null}
                    <div className="mt-3 flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={resetEditor} className="h-8 text-xs">
                        取消
                      </Button>
                      <Button type="submit" size="sm" disabled={saving} className="h-8 min-w-20 bg-violet-600 text-xs hover:bg-violet-700">
                        {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                        {editingId ? '保存修改' : '创建模板'}
                      </Button>
                    </div>
                  </form>
                ) : null}

                {!authenticated ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">
                    登录后即可创建和同步个人提示词模板。
                  </p>
                ) : loading && templates.length === 0 ? (
                  <div role="status" className="flex items-center justify-center gap-2 rounded-xl bg-slate-50 px-3 py-5 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    正在同步个人模板…
                  </div>
                ) : templates.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">
                    还没有个人模板，创建后可在任意会话中使用。
                  </p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2" data-user-prompt-templates>
                    {templates.map((template) => (
                      <li key={template.id} className="flex min-w-0 items-stretch rounded-xl border border-slate-200/90 bg-white shadow-sm transition hover:border-violet-200">
                        <button
                          type="button"
                          onClick={() => insert(template.content)}
                          className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400"
                          title={`插入“${template.title}”`}
                        >
                          <span className="block truncate text-xs font-semibold text-slate-800">{template.title}</span>
                          <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-slate-500">
                            {template.description || template.content}
                          </span>
                        </button>
                        <div className="flex shrink-0 flex-col justify-center border-l border-slate-100 px-1">
                          <button
                            type="button"
                            aria-label={`编辑模板 ${template.title}`}
                            onClick={() => beginEdit(template)}
                            className="rounded-md p-1.5 text-slate-400 transition hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label={`删除模板 ${template.title}`}
                            disabled={deletingId === template.id}
                            onClick={() => void handleDelete(template)}
                            className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-50"
                          >
                            {deletingId === template.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {conversationId ? (
                <section className="mt-5 border-t border-slate-200/80 pt-4" aria-labelledby={`${titleId}-builtin`}>
                  <div className="mb-3">
                    <h3 id={`${titleId}-builtin`} className="text-xs font-semibold text-slate-800">当前会话模板</h3>
                    <p className="mt-1 text-[11px] text-slate-500">由应用或项目提供，资源变化时会自动刷新。</p>
                  </div>
                  {runtimeLoading && !runtimeResources ? (
                    <div role="status" className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      正在读取会话模板…
                    </div>
                  ) : runtimeError ? (
                    <p role="alert" className="rounded-xl bg-rose-50 px-3 py-3 text-xs text-rose-700">会话模板暂时不可用。</p>
                  ) : builtInTemplates.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">当前会话没有额外模板。</p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2" data-runtime-prompt-templates>
                      {builtInTemplates.map((template) => (
                        <li key={`${template.source}:${template.name}`}>
                          <button
                            type="button"
                            onClick={() => insert(`/${template.name} `)}
                            className={cn(
                              'flex w-full items-start gap-2.5 rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 text-left shadow-sm transition',
                              'hover:border-violet-200 hover:bg-violet-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
                            )}
                          >
                            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-mono text-xs font-semibold text-violet-700">/{template.name}</span>
                              <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-slate-500">
                                {template.description || '点击插入此模板'}
                              </span>
                              {template.argumentHint ? (
                                <span className="mt-1 block truncate text-[10px] text-slate-400">{template.argumentHint}</span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  )
}
