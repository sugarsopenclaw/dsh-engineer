import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Boxes,
  Check,
  CheckCheck,
  ChevronRight,
  FileJson,
  Image as ImageIcon,
  Loader2,
  PencilLine,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { ConfirmDeleteDialog } from '@/components/common/confirm-delete-dialog'
import { Button } from '@/components/ui/button'
import { electronBridge } from '@/services/electron-bridge'
import type {
  ProjectComponentPatch,
  ProjectComponentRecord,
  ProjectComponentStatus,
  ProjectComponentSummary,
} from '@/shared/local-agent'

interface ProjectComponentsPanelProps {
  projectId: string
  active: boolean
}

interface CommonEditForm {
  semanticName: string
  componentType: string
  componentSubtype: string
  discipline: string
  description: string
  unit: string
}

type ComponentStatusFilter = ProjectComponentStatus | 'all'
type EditMode = 'form' | 'json' | null

function displayName(component: ProjectComponentSummary | ProjectComponentRecord) {
  if ('identity' in component) {
    return component.identity.semantic_name
      || component.identity.component_subtype
      || component.identity.component_type
  }
  return component.semantic_name || component.component_subtype || component.component_type
}

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').trim()
    || '操作失败，请稍后重试。'
}

function formFromRecord(record: ProjectComponentRecord): CommonEditForm {
  return {
    semanticName: record.identity.semantic_name ?? '',
    componentType: record.identity.component_type,
    componentSubtype: record.identity.component_subtype ?? '',
    discipline: record.identity.discipline ?? '',
    description: record.semantics.description,
    unit: record.quantities.unit ?? '',
  }
}

function editablePatchFromRecord(record: ProjectComponentRecord): ProjectComponentPatch {
  return {
    identity: record.identity,
    anchors: record.anchors,
    quantities: record.quantities,
    semantics: record.semantics,
    evidence: record.evidence,
    ...(record.relations ? { relations: record.relations } : {}),
  }
}

export function ProjectComponentsPanel({ projectId, active }: ProjectComponentsPanelProps) {
  const [components, setComponents] = useState<ProjectComponentSummary[]>([])
  const [keyword, setKeyword] = useState('')
  const [componentType, setComponentType] = useState('')
  const [statusFilter, setStatusFilter] = useState<ComponentStatusFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProjectComponentRecord | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [imageResults, setImageResults] = useState<Record<string, { dataUrl?: string; error?: string }>>({})
  const [editMode, setEditMode] = useState<EditMode>(null)
  const [editForm, setEditForm] = useState<CommonEditForm | null>(null)
  const [editJson, setEditJson] = useState('')
  const [editJsonError, setEditJsonError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectComponentSummary | ProjectComponentRecord | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const listRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const drawerRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const refreshComponents = useCallback(async () => {
    const requestId = ++listRequestRef.current
    const nextComponents = await electronBridge.listProjectComponents(projectId, {
      keyword: keyword.trim() || undefined,
      component_type: componentType.trim() || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
    })
    if (requestId !== listRequestRef.current) return nextComponents
    setComponents(nextComponents)
    const visibleIds = new Set(nextComponents.map((component) => component.component_id))
    setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))))
    return nextComponents
  }, [componentType, keyword, projectId, statusFilter])

  const loadDetail = useCallback(async (componentId: string) => {
    const requestId = ++detailRequestRef.current
    setDetailLoading(true)
    setImageResults({})
    try {
      const record = await electronBridge.getProjectComponent(projectId, componentId)
      if (requestId !== detailRequestRef.current) return record
      setDetail(record)

      const images = record.evidence.images ?? []
      if (images.length > 0) {
        const loadedImages = await Promise.all(images.map(async (image) => {
          try {
            const result = await electronBridge.readProjectImage(projectId, image.path)
            return [image.path, { dataUrl: result.data_url }] as const
          } catch (error) {
            return [image.path, { error: getErrorMessage(error) }] as const
          }
        }))
        if (requestId === detailRequestRef.current) {
          setImageResults(Object.fromEntries(loadedImages))
        }
      }
      return record
    } finally {
      if (requestId === detailRequestRef.current) {
        setDetailLoading(false)
      }
    }
  }, [projectId])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void refreshComponents().catch((error) => {
        if (!cancelled) setErrorText(getErrorMessage(error))
      })
    }, keyword.trim() || componentType.trim() ? 160 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, componentType, keyword, refreshComponents, statusFilter])

  useEffect(() => {
    detailRequestRef.current += 1
    setSelectedComponentId(null)
    setDetail(null)
    setImageResults({})
    setEditMode(null)
    setEditForm(null)
    setEditJson('')
    setEditJsonError(null)
  }, [active, projectId])

  useEffect(() => {
    if (!selectedComponentId) return
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedComponentId(null)
        return
      }
      if (event.key !== 'Tab' || !drawerRef.current) return
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
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
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [selectedComponentId])

  const draftSelectedIds = useMemo(() => {
    const draftIds = new Set(
      components
        .filter((component) => component.status === 'draft')
        .map((component) => component.component_id),
    )
    return [...selectedIds].filter((id) => draftIds.has(id))
  }, [components, selectedIds])

  const allVisibleSelected = components.length > 0
    && components.every((component) => selectedIds.has(component.component_id))

  function closeDetail() {
    detailRequestRef.current += 1
    setSelectedComponentId(null)
    setDetail(null)
    setImageResults({})
    setEditMode(null)
    setEditForm(null)
    setEditJson('')
    setEditJsonError(null)
  }

  async function openDetail(componentId: string) {
    setSelectedComponentId(componentId)
    setDetail(null)
    setEditMode(null)
    setErrorText(null)
    try {
      await loadDetail(componentId)
    } catch (error) {
      setErrorText(getErrorMessage(error))
    }
  }

  function toggleSelected(componentId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(componentId)) next.delete(componentId)
      else next.add(componentId)
      return next
    })
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) {
        components.forEach((component) => next.delete(component.component_id))
      } else {
        components.forEach((component) => next.add(component.component_id))
      }
      return next
    })
  }

  async function confirmComponents(componentIds: string[]) {
    if (componentIds.length === 0) return
    setBusyAction('confirm')
    setErrorText(null)
    try {
      await electronBridge.confirmProjectComponents(projectId, componentIds)
      await Promise.all([
        refreshComponents(),
        selectedComponentId && componentIds.includes(selectedComponentId)
          ? loadDetail(selectedComponentId)
          : Promise.resolve(null),
      ])
      setSelectedIds((current) => {
        const next = new Set(current)
        componentIds.forEach((id) => next.delete(id))
        return next
      })
      setStatusText(`已确认 ${componentIds.length} 个构件。`)
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  function beginEdit(mode: Exclude<EditMode, null>) {
    if (!detail) return
    setEditMode(mode)
    setEditJsonError(null)
    if (mode === 'form') {
      setEditForm(formFromRecord(detail))
    } else {
      setEditJson(JSON.stringify(editablePatchFromRecord(detail), null, 2))
    }
  }

  async function saveEdit() {
    if (!detail || !editMode) return
    let patch: ProjectComponentPatch
    if (editMode === 'form') {
      if (!editForm?.componentType.trim() || !editForm.description.trim()) return
      patch = {
        identity: {
          semantic_name: editForm.semanticName,
          component_type: editForm.componentType,
          component_subtype: editForm.componentSubtype,
          discipline: editForm.discipline,
        },
        semantics: { description: editForm.description },
        quantities: { ...detail.quantities, unit: editForm.unit },
      }
    } else {
      try {
        const parsed = JSON.parse(editJson) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('JSON patch 必须是对象。')
        }
        patch = parsed as ProjectComponentPatch
        setEditJsonError(null)
      } catch (error) {
        setEditJsonError(getErrorMessage(error))
        return
      }
    }

    setBusyAction('update')
    setErrorText(null)
    try {
      await electronBridge.updateProjectComponent(projectId, detail.component_id, patch)
      await Promise.all([
        refreshComponents(),
        loadDetail(detail.component_id),
      ])
      setEditMode(null)
      setStatusText('构件已更新。')
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  async function deleteComponent(target: ProjectComponentSummary | ProjectComponentRecord) {
    setBusyAction('delete')
    setErrorText(null)
    try {
      await electronBridge.deleteProjectComponent(projectId, target.component_id)
      if (selectedComponentId === target.component_id) closeDetail()
      setDeleteTarget(null)
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(target.component_id)
        return next
      })
      await refreshComponents()
      setStatusText(`已删除构件“${displayName(target)}”。`)
    } catch (error) {
      setErrorText(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <section aria-labelledby="project-components-title" className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 bg-white/70 px-3 py-2">
        <div className="min-w-0">
          <h2 id="project-components-title" className="truncate text-xs font-semibold text-slate-800">
            构件数据
          </h2>
          <p className="mt-0.5 truncate text-[10px] text-slate-400">{components.length} 条匹配记录</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={busyAction !== null}
            aria-label="刷新构件数据"
            onClick={() => void refreshComponents().catch((error) => setErrorText(getErrorMessage(error)))}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={draftSelectedIds.length === 0 || busyAction !== null}
            onClick={() => void confirmComponents(draftSelectedIds)}
          >
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            确认{draftSelectedIds.length > 0 ? ` ${draftSelectedIds.length}` : ''}
          </Button>
        </div>
      </header>

      <div className="shrink-0 space-y-2 border-b border-slate-200/70 px-2.5 py-2">
        <label className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="sr-only">搜索构件</span>
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="名称、handle、描述"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="sr-only">构件类型</span>
            <input
              type="text"
              value={componentType}
              onChange={(event) => setComponentType(event.target.value)}
              placeholder="精确类型"
              className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400"
            />
          </label>
          <label>
            <span className="sr-only">构件状态</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ComponentStatusFilter)}
              className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none focus:border-slate-400"
            >
              <option value="all">全部状态</option>
              <option value="draft">草稿</option>
              <option value="confirmed">已确认</option>
            </select>
          </label>
        </div>
        <div aria-live="polite" aria-atomic="true">
          {statusText ? <p className="text-[11px] text-emerald-600">{statusText}</p> : null}
          {errorText ? <p role="alert" className="text-[11px] text-rose-600">{errorText}</p> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {components.length === 0 ? (
          <div className="px-3 py-14 text-center text-slate-500">
            <Boxes className="mx-auto mb-3 h-11 w-11 opacity-25" aria-hidden="true" />
            <p className="text-sm">暂无匹配构件。</p>
            <p className="mt-1 text-xs text-slate-400">识图确认后，Agent 会把构件保存到这里。</p>
          </div>
        ) : (
          <div>
            <div className="sticky top-0 grid grid-cols-[32px_minmax(0,1fr)_28px] items-center border-b border-slate-100 bg-slate-50/90 px-3 py-2 text-[11px] font-medium text-slate-500">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                aria-label="选择当前列表全部构件"
                className="h-4 w-4 rounded border-slate-300"
              />
              <span>名称 / 类型 / 图纸 / 状态</span>
              <span className="sr-only">详情</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {components.map((component) => (
                <li
                  key={component.component_id}
                  className="grid grid-cols-[32px_minmax(0,1fr)_28px] items-center px-3 py-3 hover:bg-slate-50"
                  style={{ contentVisibility: 'auto', containIntrinsicSize: '0 88px' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(component.component_id)}
                    onChange={() => toggleSelected(component.component_id)}
                    aria-label={`选择构件 ${displayName(component)}`}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <button
                    type="button"
                    className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                    onClick={() => void openDetail(component.component_id)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">{displayName(component)}</span>
                      <span className={component.status === 'draft'
                        ? 'shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700'
                        : 'shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700'}
                      >
                        {component.status === 'draft' ? '草稿' : '已确认'}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-600">
                      {component.component_type}
                      {component.component_subtype ? ` / ${component.component_subtype}` : ''}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                      {component.drawing_relpath}{component.layout_name ? ` · ${component.layout_name}` : ''}
                      {' · '}{formatUpdatedAt(component.updated_at)}
                    </p>
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                    onClick={() => void openDetail(component.component_id)}
                    aria-label={`查看构件 ${displayName(component)} 详情`}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {selectedComponentId ? (
        <div
          className="fixed inset-x-0 bottom-0 top-[var(--window-titlebar-height)] z-40 flex justify-end bg-slate-900/30"
          onMouseDown={closeDetail}
        >
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="component-detail-title"
            className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">项目构件</p>
                <h3 id="component-detail-title" className="mt-0.5 truncate text-lg font-semibold text-slate-900">
                  {detail ? displayName(detail) : '读取中'}
                </h3>
                {detail ? <p className="mt-1 break-all text-[11px] text-slate-400">{detail.component_id}</p> : null}
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                onClick={closeDetail}
                aria-label="关闭构件详情"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {detailLoading && !detail ? (
                <div className="flex items-center justify-center py-20 text-sm text-slate-500" aria-live="polite">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  读取构件详情…
                </div>
              ) : detail ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={detail.status === 'draft'
                      ? 'rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700'
                      : 'rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700'}
                    >
                      {detail.status === 'draft' ? '草稿' : '已确认'}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {detail.identity.component_type}
                    </span>
                    {detail.identity.discipline ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                        {detail.identity.discipline}
                      </span>
                    ) : null}
                  </div>

                  {editMode ? (
                    <section aria-labelledby="component-edit-title" className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 id="component-edit-title" className="text-sm font-semibold text-slate-900">编辑构件</h4>
                        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
                          <button
                            type="button"
                            className={editMode === 'form'
                              ? 'rounded-md bg-slate-900 px-2.5 py-1 text-xs text-white'
                              : 'rounded-md px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50'}
                            onClick={() => beginEdit('form')}
                          >
                            常用字段
                          </button>
                          <button
                            type="button"
                            className={editMode === 'json'
                              ? 'rounded-md bg-slate-900 px-2.5 py-1 text-xs text-white'
                              : 'rounded-md px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50'}
                            onClick={() => beginEdit('json')}
                          >
                            原始 JSON
                          </button>
                        </div>
                      </div>

                      {editMode === 'form' && editForm ? (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <label className="text-xs text-slate-600">
                            语义名称
                            <input
                              value={editForm.semanticName}
                              onChange={(event) => setEditForm((current) => current
                                ? { ...current, semanticName: event.target.value }
                                : current)}
                              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-slate-400"
                            />
                          </label>
                          <label className="text-xs text-slate-600">
                            构件类型 *
                            <input
                              required
                              value={editForm.componentType}
                              onChange={(event) => setEditForm((current) => current
                                ? { ...current, componentType: event.target.value }
                                : current)}
                              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-slate-400"
                            />
                          </label>
                          <label className="text-xs text-slate-600">
                            子类型
                            <input
                              value={editForm.componentSubtype}
                              onChange={(event) => setEditForm((current) => current
                                ? { ...current, componentSubtype: event.target.value }
                                : current)}
                              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-slate-400"
                            />
                          </label>
                          <label className="text-xs text-slate-600">
                            专业
                            <input
                              value={editForm.discipline}
                              onChange={(event) => setEditForm((current) => current
                                ? { ...current, discipline: event.target.value }
                                : current)}
                              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-slate-400"
                            />
                          </label>
                          <label className="text-xs text-slate-600">
                            默认单位
                            <input
                              value={editForm.unit}
                              onChange={(event) => setEditForm((current) => current
                                ? { ...current, unit: event.target.value }
                                : current)}
                              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-slate-400"
                            />
                          </label>
                          <label className="text-xs text-slate-600 sm:col-span-2">
                            语义描述 *
                            <textarea
                              required
                              value={editForm.description}
                              onChange={(event) => setEditForm((current) => current
                                ? { ...current, description: event.target.value }
                                : current)}
                              rows={4}
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
                            />
                          </label>
                        </div>
                      ) : null}

                      {editMode === 'json' ? (
                        <div className="mt-4">
                          <p className="mb-2 text-xs text-slate-500">
                            可编辑 identity、anchors、quantities、semantics、evidence、relations；ID、状态和 provenance 由服务维护。
                          </p>
                          <textarea
                            value={editJson}
                            onChange={(event) => {
                              setEditJson(event.target.value)
                              setEditJsonError(null)
                            }}
                            rows={20}
                            spellCheck={false}
                            aria-label="构件 JSON patch"
                            aria-invalid={Boolean(editJsonError)}
                            className="w-full rounded-lg border border-slate-200 bg-slate-950 px-3 py-2 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-slate-400"
                          />
                          {editJsonError ? <p role="alert" className="mt-2 text-xs text-rose-600">{editJsonError}</p> : null}
                        </div>
                      ) : null}

                      <div className="mt-4 flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyAction === 'update'}
                          onClick={() => setEditMode(null)}
                        >
                          取消
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busyAction === 'update'
                            || (editMode === 'form' && (!editForm?.componentType.trim() || !editForm.description.trim()))}
                          onClick={() => void saveEdit()}
                        >
                          {busyAction === 'update' ? '保存中' : '保存修改'}
                        </Button>
                      </div>
                    </section>
                  ) : null}

                  <section aria-labelledby="component-anchor-title">
                    <h4 id="component-anchor-title" className="text-sm font-semibold text-slate-900">定位与语义</h4>
                    <dl className="mt-2 grid gap-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-slate-400">图纸</dt>
                        <dd className="mt-0.5 break-all text-slate-700">{detail.anchors.drawing_relpath}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">布局</dt>
                        <dd className="mt-0.5 text-slate-700">{detail.anchors.layout_name || '未填写'}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-slate-400">source handles</dt>
                        <dd className="mt-1 flex flex-wrap gap-1">
                          {detail.anchors.source_handles.map((item) => (
                            <span key={`${item.handle}:${item.role || ''}`} className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200">
                              {item.handle}{item.role ? ` · ${item.role}` : ''}
                            </span>
                          ))}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-slate-400">描述</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">{detail.semantics.description}</dd>
                      </div>
                    </dl>
                  </section>

                  <section aria-labelledby="component-quantity-title">
                    <h4 id="component-quantity-title" className="text-sm font-semibold text-slate-900">量化数据</h4>
                    {detail.quantities.dimensions && Object.keys(detail.quantities.dimensions).length > 0 ? (
                      <div className="mt-2 overflow-hidden rounded-xl border border-slate-200">
                        <table className="w-full text-left text-xs">
                          <caption className="sr-only">构件尺寸</caption>
                          <tbody className="divide-y divide-slate-100">
                            {Object.entries(detail.quantities.dimensions).map(([name, value]) => (
                              <tr key={name}>
                                <th scope="row" className="w-2/5 bg-slate-50 px-3 py-2 font-medium text-slate-600">{name}</th>
                                <td className="px-3 py-2 text-slate-800">{String(value)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="mt-2 text-xs text-slate-400">未记录尺寸字段。</p>}

                    {detail.quantities.items && detail.quantities.items.length > 0 ? (
                      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                        <table className="min-w-full text-left text-xs">
                          <caption className="sr-only">构件工程量条目</caption>
                          <thead className="bg-slate-50 text-slate-500">
                            <tr>
                              <th className="px-3 py-2 font-medium">名称</th>
                              <th className="px-3 py-2 font-medium">数值</th>
                              <th className="px-3 py-2 font-medium">依据</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {detail.quantities.items.map((item, index) => (
                              <tr key={`${item.name}:${index}`}>
                                <td className="px-3 py-2 text-slate-700">{item.name}</td>
                                <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">{item.value} {item.unit}</td>
                                <td className="px-3 py-2 text-slate-500">{item.formula || item.basis || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="mt-2 text-xs text-slate-400">未记录工程量条目。</p>}
                  </section>

                  <section aria-labelledby="component-evidence-title">
                    <h4 id="component-evidence-title" className="text-sm font-semibold text-slate-900">证据</h4>
                    {detail.evidence.evidence_pack ? (
                      <button
                        type="button"
                        className="mt-2 flex w-full items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                        onClick={() => void electronBridge.openProjectRootDirectory(projectId).catch((error) => setErrorText(getErrorMessage(error)))}
                      >
                        <FileJson className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-slate-700">Evidence pack</span>
                          <span className="mt-0.5 block break-all text-[11px] text-slate-500">{detail.evidence.evidence_pack}</span>
                          <span className="mt-1 block text-[10px] text-slate-400">点击打开项目目录</span>
                        </span>
                      </button>
                    ) : null}

                    {detail.evidence.images && detail.evidence.images.length > 0 ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {detail.evidence.images.map((image) => {
                          const loaded = imageResults[image.path]
                          return (
                            <figure key={image.path} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                              {loaded?.dataUrl ? (
                                <img src={loaded.dataUrl} alt={image.note || `构件证据图 ${image.path}`} className="max-h-72 w-full object-contain" />
                              ) : loaded?.error ? (
                                <div className="flex min-h-28 items-center justify-center p-3 text-center text-xs text-rose-600">{loaded.error}</div>
                              ) : (
                                <div className="flex min-h-28 items-center justify-center text-slate-400">
                                  <ImageIcon className="h-5 w-5" aria-label="证据图读取中" />
                                </div>
                              )}
                              <figcaption className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
                                <span className="block break-all">{image.path}</span>
                                {image.note ? <span className="mt-1 block text-slate-600">{image.note}</span> : null}
                              </figcaption>
                            </figure>
                          )
                        })}
                      </div>
                    ) : <p className="mt-2 text-xs text-slate-400">未记录证据图。</p>}
                  </section>
                </div>
              ) : (
                <p role="alert" className="py-20 text-center text-sm text-rose-600">构件详情读取失败。</p>
              )}
            </div>

            {detail ? (
              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busyAction !== null}
                  onClick={() => setDeleteTarget(detail)}
                >
                  <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                  删除
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyAction !== null || editMode !== null}
                    onClick={() => beginEdit('form')}
                  >
                    <PencilLine className="mr-1 h-4 w-4" aria-hidden="true" />
                    编辑
                  </Button>
                  {detail.status === 'draft' ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyAction !== null}
                      onClick={() => void confirmComponents([detail.component_id])}
                    >
                      <Check className="mr-1 h-4 w-4" aria-hidden="true" />
                      确认构件
                    </Button>
                  ) : null}
                </div>
              </footer>
            ) : null}
          </aside>
        </div>
      ) : null}

      <ConfirmDeleteDialog
        open={Boolean(deleteTarget)}
        title="确认删除构件"
        description={deleteTarget
          ? `确定永久删除构件“${displayName(deleteTarget)}”吗？记录文件将从项目构件库中移除，此操作不可撤销。`
          : ''}
        confirmLabel={busyAction === 'delete' ? '删除中' : '删除构件'}
        onOpenChange={(open) => {
          if (!open && busyAction !== 'delete') setDeleteTarget(null)
        }}
        onConfirm={async () => {
          if (deleteTarget) await deleteComponent(deleteTarget)
        }}
      />
    </section>
  )
}
