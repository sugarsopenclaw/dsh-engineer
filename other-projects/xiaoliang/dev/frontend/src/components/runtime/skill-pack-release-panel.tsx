import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { electronBridge } from '@/services/electron-bridge'
import type {
  LocalSkillSummary,
  LocalUserSkillSummary,
  SkillRuntimeStatus,
  SkillUpdateCheckResult,
  UserSkillReadResult,
  UserSkillReferenceInput,
} from '@/shared/local-agent'

interface SkillPackReleasePanelProps {
  visible?: boolean
}

type SkillCategory = 'built-in' | 'market' | 'custom'

interface SkillEditorState {
  slug: string
  name: string
  description: string
  instructions: string
  enabled: boolean
  references: UserSkillReferenceInput[]
}

const EMPTY_PRODUCT_SKILLS: LocalSkillSummary[] = []
const EMPTY_USER_SKILLS: LocalUserSkillSummary[] = []

function createEmptyEditor(): SkillEditorState {
  return {
    slug: '',
    name: '',
    description: '',
    instructions: '',
    enabled: true,
    references: [],
  }
}

function createEditorFromSkill(skill: UserSkillReadResult): SkillEditorState {
  return {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    enabled: skill.enabled,
    references: skill.references,
  }
}

function normalizeSlugDraft(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
}

function userSkillBadge(skill: LocalUserSkillSummary) {
  if (skill.validationStatus === 'invalid') {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }
  if (skill.enabled) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }
  return 'border-slate-200 bg-slate-50 text-slate-500'
}

function userSkillStatus(skill: LocalUserSkillSummary) {
  if (skill.validationStatus === 'invalid') return '无效'
  return skill.enabled ? '已启用' : '已禁用'
}

function marketCheckText(check: SkillUpdateCheckResult | null) {
  if (!check) return '尚未检查市场版本'
  if (check.status === 'update_available') return `发现 ${check.latestSkillPackVersion || '新'} 版本`
  if (check.status === 'unsupported_client') return '需要先升级客户端'
  return '当前已是最新版本'
}

export function SkillPackReleasePanel({ visible = true }: SkillPackReleasePanelProps) {
  const [category, setCategory] = useState<SkillCategory>('built-in')
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [saving, setSaving] = useState(false)
  const [openingFolder, setOpeningFolder] = useState(false)
  const [checkingMarket, setCheckingMarket] = useState(false)
  const [installingMarket, setInstallingMarket] = useState(false)
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null)
  const [togglingSlug, setTogglingSlug] = useState<string | null>(null)
  const [status, setStatus] = useState<SkillRuntimeStatus | null>(null)
  const [marketCheck, setMarketCheck] = useState<SkillUpdateCheckResult | null>(null)
  const [editor, setEditor] = useState<SkillEditorState | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const builtInSkills = status?.documentSkills ?? EMPTY_PRODUCT_SKILLS
  const marketSkills = status?.skills ?? EMPTY_PRODUCT_SKILLS
  const userSkills = status?.userSkills ?? EMPTY_USER_SKILLS

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const nextStatus = await electronBridge.getSkillStatus()
      setStatus(nextStatus)
      return nextStatus
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setLoadingStatus(true)
    electronBridge.getSkillStatus()
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus)
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setLoadingStatus(false)
      })
    return () => {
      cancelled = true
    }
  }, [visible])

  function startCreate() {
    setEditingSlug(null)
    setEditor(createEmptyEditor())
    setErrorMessage(null)
  }

  async function startEdit(slug: string) {
    setErrorMessage(null)
    try {
      const skill = await electronBridge.readUserSkill(slug)
      setEditingSlug(slug)
      setEditor(createEditorFromSkill(skill))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleSave() {
    if (!editor) return
    setSaving(true)
    setErrorMessage(null)
    try {
      const result = await electronBridge.upsertUserSkill({
        slug: normalizeSlugDraft(editor.slug).replace(/-+$/, ''),
        name: editor.name.trim(),
        description: editor.description.trim(),
        instructions: editor.instructions.trim(),
        references: editor.references.length > 0 ? editor.references : undefined,
        enabled: editor.enabled,
        overwrite: Boolean(editingSlug),
      })
      setStatus(result.status)
      setEditor(null)
      setEditingSlug(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(skill: LocalUserSkillSummary) {
    setTogglingSlug(skill.slug)
    setErrorMessage(null)
    try {
      const result = await electronBridge.setUserSkillEnabled({ slug: skill.slug, enabled: !skill.enabled })
      setStatus(result.status)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setTogglingSlug(null)
    }
  }

  async function handleDelete(skill: LocalUserSkillSummary) {
    if (!window.confirm(`删除自制 skill “${skill.slug}”？此操作会删除本地文件夹。`)) return
    setDeletingSlug(skill.slug)
    setErrorMessage(null)
    try {
      const result = await electronBridge.deleteUserSkill({ slug: skill.slug, deleteConfirmed: true })
      setStatus(result.status)
      if (editingSlug === skill.slug) {
        setEditor(null)
        setEditingSlug(null)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setDeletingSlug(null)
    }
  }

  async function handleOpenFolder() {
    setOpeningFolder(true)
    setErrorMessage(null)
    try {
      await electronBridge.openUserSkillsDirectory()
      await refreshStatus()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOpeningFolder(false)
    }
  }

  async function handleOpenFile(slug: string) {
    setErrorMessage(null)
    try {
      await electronBridge.openUserSkillFile(slug)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleCheckMarket() {
    setCheckingMarket(true)
    setErrorMessage(null)
    try {
      setMarketCheck(await electronBridge.checkSkillUpdates('stable'))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setCheckingMarket(false)
    }
  }

  async function handleInstallMarket() {
    if (!marketCheck || marketCheck.status !== 'update_available') return
    setInstallingMarket(true)
    setErrorMessage(null)
    try {
      const result = await electronBridge.installSkillUpdate({
        releaseChannel: marketCheck.releaseChannel,
        skillPackVersion: marketCheck.latestSkillPackVersion,
        expectedChecksum: marketCheck.latestSkillPackChecksum,
      })
      setStatus(result.status)
      setMarketCheck(await electronBridge.checkSkillUpdates(marketCheck.releaseChannel))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setInstallingMarket(false)
    }
  }

  return (
    <section className="min-w-0 overflow-x-hidden rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Skills</h2>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void refreshStatus().catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)))}
          disabled={loadingStatus}
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-3 rounded-xl bg-slate-100 p-1">
        {([
          ['built-in', `内置 ${builtInSkills.length}`],
          ['market', `市场 ${marketSkills.length}`],
          ['custom', `自制 ${userSkills.length}`],
        ] as Array<[SkillCategory, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`min-w-0 rounded-lg px-1 py-2 text-xs font-medium leading-tight transition ${category === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            onClick={() => setCategory(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {category === 'built-in' ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            {builtInSkills.map((skill) => (
              <div key={skill.slug} className="rounded-xl border border-slate-200/80 bg-white px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{skill.name}</p>
                  <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700">内置</span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-slate-400">{skill.slug}</p>
              </div>
            ))}
          </div>
          {!loadingStatus && builtInSkills.length === 0 ? <EmptyState title="未发现内置 skills" detail="请检查客户端资源是否完整。" /> : null}
        </div>
      ) : null}

      {category === 'market' ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3">
            <div>
              <p className="text-xs font-medium text-slate-700">稳定通道 · {status?.skillPackVersion || '-'}</p>
              <p className="mt-1 text-[11px] text-slate-500">{marketCheckText(marketCheck)}</p>
              {marketCheck?.releaseNotes ? <p className="mt-1 text-[11px] text-slate-500">{marketCheck.releaseNotes}</p> : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => void handleCheckMarket()} disabled={checkingMarket || installingMarket}>
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${checkingMarket ? 'animate-spin' : ''}`} />
                检查更新
              </Button>
              {marketCheck?.status === 'update_available' ? (
                <Button type="button" size="sm" onClick={() => void handleInstallMarket()} disabled={installingMarket}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {installingMarket ? '安装中...' : '安装更新'}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            {marketSkills.map((skill) => (
              <div key={`${skill.domain}/${skill.slug}`} className="rounded-xl border border-slate-200/80 bg-white px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{skill.name}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">{skill.domain}/{skill.slug}</p>
                  </div>
                  <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700">
                    {skill.source === 'managed' ? '市场' : '预装'}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {!loadingStatus && marketSkills.length === 0 ? <EmptyState title="暂无市场 skills" detail="检查后端稳定通道是否已有发布包。" /> : null}
        </div>
      ) : null}

      {category === 'custom' ? (
        <div className="mt-4 space-y-3">
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => void handleOpenFolder()} disabled={openingFolder}>
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />文件夹
            </Button>
            <Button type="button" size="sm" onClick={startCreate}>
              <FilePlus2 className="mr-1.5 h-3.5 w-3.5" />新建
            </Button>
          </div>

          {status?.userSkillWarning ? <InlineWarning text={status.userSkillWarning} /> : null}

          {editor ? (
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">{editingSlug ? '编辑自制 skill' : '新建自制 skill'}</p>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditor(null); setEditingSlug(null) }} aria-label="关闭" title="关闭">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-600">
                  slug
                  <input
                    className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                    value={editor.slug}
                    disabled={Boolean(editingSlug)}
                    maxLength={64}
                    onChange={(event) => setEditor({ ...editor, slug: normalizeSlugDraft(event.target.value) })}
                    placeholder="my-skill"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  展示名称
                  <input
                    className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                    value={editor.name}
                    maxLength={120}
                    onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                    placeholder="我的复核流程"
                  />
                </label>
              </div>
              <label className="mt-3 block text-xs font-medium text-slate-600">
                触发描述
                <textarea
                  className="mt-1 min-h-20 w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  value={editor.description}
                  maxLength={1024}
                  onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                  placeholder="说明这个 skill 做什么，以及什么时候应该使用。"
                />
              </label>
              <label className="mt-3 block text-xs font-medium text-slate-600">
                指令正文
                <textarea
                  className="mt-1 min-h-56 w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs leading-5 text-slate-900 outline-none focus:border-slate-400"
                  value={editor.instructions}
                  onChange={(event) => setEditor({ ...editor, instructions: event.target.value })}
                  placeholder="# 工作流&#10;&#10;1. 明确输入...&#10;2. 执行...&#10;3. 校验输出..."
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={editor.enabled} onChange={(event) => setEditor({ ...editor, enabled: event.target.checked })} />
                  保存后启用
                </label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => { setEditor(null); setEditingSlug(null) }}>取消</Button>
                  <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                    <Save className="mr-1.5 h-3.5 w-3.5" />{saving ? '保存中...' : '保存'}
                  </Button>
                </div>
              </div>
              {editor.references.length > 0 ? <p className="mt-2 text-[11px] text-slate-400">将保留 {editor.references.length} 个 reference 文件。</p> : null}
            </div>
          ) : null}

          <div className="space-y-2">
            {userSkills.map((skill) => (
              <div
                key={skill.slug}
                className={`rounded-xl border px-3 py-2.5 ${editingSlug === skill.slug ? 'border-slate-400 bg-slate-50/80' : 'border-slate-200/80 bg-white'}`}
              >
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{skill.interface.displayName || skill.name || skill.slug}</p>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${userSkillBadge(skill)}`}>{userSkillStatus(skill)}</span>
                    </div>
                    {skill.validationMessage ? <p className="mt-1.5 text-xs text-rose-700">{skill.validationMessage}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleToggle(skill)} disabled={togglingSlug === skill.slug || skill.validationStatus === 'invalid'}>
                      {skill.enabled ? '禁用' : '启用'}
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => void startEdit(skill.slug)} aria-label="编辑" title="编辑"><Pencil className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => void handleOpenFile(skill.slug)} aria-label="打开 SKILL.md" title="打开 SKILL.md"><ExternalLink className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => void handleDelete(skill)} disabled={deletingSlug === skill.slug} aria-label="删除" title="删除"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                  </div>
                </div>
              </div>
            ))}
            {!loadingStatus && userSkills.length === 0 ? <EmptyState title="暂无自制 skill" /> : null}
          </div>
        </div>
      ) : null}

      {errorMessage ? <p className="mt-3 text-xs text-rose-600">操作失败：{errorMessage}</p> : null}
      {loadingStatus && !status ? <p className="mt-3 text-xs text-slate-400">正在读取 skills...</p> : null}
    </section>
  )
}

function InlineWarning({ text }: { text: string }) {
  return (
    <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  )
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-6 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {detail ? <p className="mt-1 text-xs text-slate-400">{detail}</p> : null}
    </div>
  )
}
