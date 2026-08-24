import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileJson,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  Minus,
  PenTool,
  Plus,
  RefreshCw,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { electronBridge } from '@/services/electron-bridge'
import type {
  ProjectFilePreviewResult,
  ProjectPreviewDirectoryResult,
  ProjectPreviewEntry,
  ProjectSpreadsheetPreviewResult,
  ProjectSummary,
  ProjectTextPreviewResult,
} from '@/shared/local-agent'

const ProjectMarkdownPreview = lazy(() => import('./project-markdown-preview').then((module) => ({
  default: module.ProjectMarkdownPreview,
})))
const ProjectDocxPreview = lazy(() => import('./project-docx-preview').then((module) => ({
  default: module.ProjectDocxPreview,
})))
const ProjectCadPreview = lazy(() => import('./project-cad-preview').then((module) => ({
  default: module.ProjectCadPreview,
})))

const MAX_ACCUMULATED_TEXT_CHARACTERS = 4 * 1024 * 1024
const HEAVY_PREVIEW_MODES = new Set(['image', 'pdf', 'spreadsheet', 'docx', 'cad'])
const SOFT_REFRESH_DEBOUNCE_MS = 200

type DirectoryState =
  | { status: 'loading' }
  | { status: 'ready'; result: ProjectPreviewDirectoryResult }
  | { status: 'error'; message: string }

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; result: ProjectFilePreviewResult }
  | { status: 'error'; message: string }

function errorText(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message : '文件预览失败。'
}

function boundTextPreviewResult(result: ProjectFilePreviewResult): ProjectFilePreviewResult {
  if (
    (result.mode !== 'text' && result.mode !== 'markdown')
    || result.content.length <= MAX_ACCUMULATED_TEXT_CHARACTERS
  ) return result
  return {
    ...result,
    content: result.content.slice(0, MAX_ACCUMULATED_TEXT_CHARACTERS),
    nextOffset: null,
    truncated: true,
    limitReached: true,
  }
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1_024) return `${sizeBytes} B`
  if (sizeBytes < 1_024 * 1_024) return `${(sizeBytes / 1_024).toFixed(1)} KB`
  return `${(sizeBytes / 1_024 / 1_024).toFixed(1)} MB`
}

function formatModifiedAt(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function FileKindIcon({ entry }: { entry: ProjectPreviewEntry }) {
  if (entry.type === 'directory') return <Folder className="h-4 w-4 text-amber-500" />
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.css', '.html'].includes(entry.extension)) {
    return <FileCode2 className="h-4 w-4 text-cyan-600" />
  }
  if (entry.kind === 'markdown' || entry.kind === 'text') return <FileText className="h-4 w-4 text-slate-500" />
  if (entry.kind === 'json') return <FileJson className="h-4 w-4 text-amber-600" />
  if (entry.kind === 'csv' || entry.kind === 'xlsx') return <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
  if (entry.kind === 'image') return <FileImage className="h-4 w-4 text-violet-600" />
  if (entry.kind === 'pdf' || entry.kind === 'docx') return <FileText className="h-4 w-4 text-sky-600" />
  if (entry.kind === 'cad') return <PenTool className="h-4 w-4 text-indigo-600" />
  return entry.supported
    ? <File className="h-4 w-4 text-slate-500" />
    : <FileQuestion className="h-4 w-4 text-slate-400" />
}

function columnLabel(index: number) {
  let value = index + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function useBinaryObjectUrl(dataBase64: string, mimeType: string) {
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    const binary = window.atob(dataBase64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
    setSource(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [dataBase64, mimeType])
  return source
}

function SpreadsheetPreview({ preview }: { preview: ProjectSpreadsheetPreviewResult }) {
  const [selectedName, setSelectedName] = useState(preview.sheets[0]?.name ?? '')

  useEffect(() => {
    setSelectedName(preview.sheets[0]?.name ?? '')
  }, [preview.path, preview.sheets])

  const selectedSheet = preview.sheets.find((sheet) => sheet.name === selectedName)
    ?? preview.sheets[0]
  const columnCount = selectedSheet?.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0) ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-1.5" aria-label="工作表">
        {preview.sheets.map((sheet) => (
          <button
            key={sheet.name}
            type="button"
            aria-pressed={sheet.name === selectedSheet?.name}
            className={cn(
              'shrink-0 rounded px-2 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
              sheet.name === selectedSheet?.name
                ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-500 hover:bg-white/70 hover:text-slate-700',
            )}
            onClick={() => setSelectedName(sheet.name)}
          >
            {sheet.name}
          </button>
        ))}
      </div>
      {!selectedSheet || selectedSheet.rows.length === 0 ? (
        <p className="m-auto px-4 text-center text-xs text-slate-400">该工作表没有可显示的单元格。</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="border-separate border-spacing-0 text-[10px] text-slate-700">
            <thead className="sticky top-0 z-20 bg-slate-100">
              <tr>
                <th className="sticky left-0 z-30 h-7 min-w-10 border-b border-r border-slate-200 bg-slate-100 px-1" />
                {Array.from({ length: columnCount }, (_, index) => (
                  <th key={index} className="h-7 min-w-24 border-b border-r border-slate-200 px-2 text-center font-medium text-slate-500">
                    {columnLabel(index)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selectedSheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="[content-visibility:auto] [contain-intrinsic-size:28px]">
                  <th className="sticky left-0 z-10 h-7 border-b border-r border-slate-200 bg-slate-100 px-1 text-center font-medium text-slate-400">
                    {rowIndex + 1}
                  </th>
                  {Array.from({ length: columnCount }, (_, columnIndex) => {
                    const value = row[columnIndex] ?? ''
                    return (
                      <td
                        key={columnIndex}
                        title={value}
                        className="h-7 max-w-64 overflow-hidden border-b border-r border-slate-200 bg-white px-2 align-middle whitespace-nowrap text-ellipsis"
                      >
                        {value}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectedSheet?.truncated || preview.truncated ? (
        <p className="shrink-0 border-t border-amber-100 bg-amber-50 px-2.5 py-1.5 text-[10px] leading-4 text-amber-700">
          为保证界面流畅，仅显示部分工作表与单元格；原文件未被修改。
        </p>
      ) : null}
    </div>
  )
}

function ImagePreview({ preview }: { preview: Extract<ProjectFilePreviewResult, { mode: 'image' }> }) {
  const [zoom, setZoom] = useState(1)
  const source = useBinaryObjectUrl(preview.dataBase64, preview.mimeType)
  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100/70">
      <div className="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-slate-200 bg-white/80 px-2">
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="缩小图片" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <button type="button" className="min-w-12 rounded px-1 py-1 text-[10px] text-slate-500 hover:bg-slate-100" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="放大图片" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="flex min-h-full min-w-full items-center justify-center">
          {source ? (
            <img
              src={source}
              alt={preview.name}
              draggable={false}
              className="max-w-full origin-center rounded-sm shadow-sm"
              style={{ transform: `scale(${zoom})` }}
            />
          ) : <LoaderCircle className="h-5 w-5 animate-spin text-slate-400" aria-label="加载图片" />}
        </div>
      </div>
    </div>
  )
}

function PdfPreview({ preview }: { preview: Extract<ProjectFilePreviewResult, { mode: 'pdf' }> }) {
  const source = useBinaryObjectUrl(preview.dataBase64, preview.mimeType)
  if (!source) {
    return <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-400" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />加载 PDF…</div>
  }
  return (
    <object
      data={source}
      type={preview.mimeType}
      aria-label={`${preview.name} PDF 预览`}
      className="h-full w-full bg-white"
    >
      <p className="p-4 text-xs leading-5 text-slate-500">当前运行环境无法内嵌显示该 PDF。</p>
    </object>
  )
}

function TextPreview({
  preview,
  loadingMore,
  onLoadMore,
}: {
  preview: ProjectTextPreviewResult
  loadingMore: boolean
  onLoadMore: () => void
}) {
  const [markdownView, setMarkdownView] = useState<'rendered' | 'source'>('rendered')
  const displayContent = useMemo(() => {
    if (preview.kind !== 'json' || preview.truncated) return preview.content
    try {
      return JSON.stringify(JSON.parse(preview.content), null, 2)
    } catch {
      return preview.content
    }
  }, [preview.content, preview.kind, preview.truncated])

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {preview.mode === 'markdown' ? (
        <div className="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-slate-200 bg-slate-50 px-2">
          <button type="button" aria-pressed={markdownView === 'rendered'} className={cn('rounded px-2 py-1 text-[10px] font-medium', markdownView === 'rendered' ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-500')} onClick={() => setMarkdownView('rendered')}>渲染</button>
          <button type="button" aria-pressed={markdownView === 'source'} className={cn('rounded px-2 py-1 text-[10px] font-medium', markdownView === 'source' ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-500')} onClick={() => setMarkdownView('source')}>源码</button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {preview.mode === 'markdown' && markdownView === 'rendered' ? (
          <Suspense fallback={<div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400"><LoaderCircle className="h-4 w-4 animate-spin" />加载 Markdown 渲染器…</div>}>
            <ProjectMarkdownPreview content={preview.content} />
          </Suspense>
        ) : (
          <pre className="min-h-full whitespace-pre-wrap break-words px-3 py-3 font-mono text-[11px] leading-5 text-slate-700">{displayContent}</pre>
        )}
      </div>
      {preview.limitReached ? (
        <p className="shrink-0 border-t border-amber-100 bg-amber-50 px-2.5 py-2 text-[10px] leading-4 text-amber-700" role="status">
          已达到 4 MB 文本预览上限；原文件未被修改。
        </p>
      ) : preview.nextOffset !== null ? (
        <div className="shrink-0 border-t border-slate-200 bg-white p-2">
          <Button type="button" variant="outline" size="sm" className="h-8 w-full text-xs" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            加载更多内容
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function PreviewContent({
  state,
  loadingMore,
  onLoadMore,
  onReload,
}: {
  state: PreviewState
  loadingMore: boolean
  onLoadMore: () => void
  onReload: () => void
}) {
  if (state.status === 'loading') {
    return <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-400" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />读取文件…</div>
  }
  if (state.status === 'error') {
    return <div className="m-3 rounded-md bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700" role="alert">{state.message}</div>
  }
  const preview = state.result
  if (preview.mode === 'text' || preview.mode === 'markdown') {
    return <TextPreview key={preview.path} preview={preview} loadingMore={loadingMore} onLoadMore={onLoadMore} />
  }
  if (preview.mode === 'image') return <ImagePreview key={preview.path} preview={preview} />
  if (preview.mode === 'pdf') return <PdfPreview key={preview.path} preview={preview} />
  if (preview.mode === 'spreadsheet') return <SpreadsheetPreview key={preview.path} preview={preview} />
  if (preview.mode === 'docx') {
    return (
      <div className="h-full overflow-auto">
        <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-xs text-slate-400"><LoaderCircle className="h-4 w-4 animate-spin" />加载 Word 渲染器…</div>}>
          <ProjectDocxPreview dataBase64={preview.dataBase64} />
        </Suspense>
      </div>
    )
  }
  if (preview.mode === 'cad') {
    return (
      <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-xs text-slate-400"><LoaderCircle className="h-4 w-4 animate-spin" />加载 CAD 渲染器…</div>}>
        <ProjectCadPreview key={preview.path} preview={preview} onRetry={onReload} />
      </Suspense>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center px-5 text-center">
      <FileQuestion className="mb-2 h-7 w-7 text-slate-300" />
      <p className="text-xs font-medium text-slate-600">暂不支持预览</p>
      <p className="mt-1 text-[11px] leading-5 text-slate-400">{preview.reason}</p>
    </div>
  )
}

function DirectoryEntries({
  relativePath,
  depth,
  directories,
  expanded,
  onToggleDirectory,
  onSelectFile,
}: {
  relativePath: string
  depth: number
  directories: Record<string, DirectoryState>
  expanded: ReadonlySet<string>
  onToggleDirectory: (entry: ProjectPreviewEntry) => void
  onSelectFile: (entry: ProjectPreviewEntry) => void
}) {
  const state = directories[relativePath]
  if (!state || state.status === 'loading') {
    return <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-slate-400" style={{ paddingLeft: 12 + depth * 14 }}><LoaderCircle className="h-3.5 w-3.5 animate-spin" />读取目录…</div>
  }
  if (state.status === 'error') {
    return <p className="mx-2 my-2 rounded-md bg-rose-50 px-2 py-1.5 text-[11px] leading-5 text-rose-700" role="alert">{state.message}</p>
  }
  if (!state.result.rootExists) {
    return <p className="px-4 py-8 text-center text-xs leading-5 text-slate-400">{state.result.warning || '项目目录不可访问。'}</p>
  }
  if (state.result.entries.length === 0) {
    return <p className="px-4 py-5 text-center text-[11px] text-slate-400">{depth === 0 ? '项目目录为空。' : '此文件夹为空。'}</p>
  }
  return (
    <ul aria-label={depth === 0 ? '项目文件' : undefined} className={depth === 0 ? 'py-1' : undefined}>
      {state.result.entries.map((entry) => {
        const isDirectory = entry.type === 'directory'
        const isExpanded = isDirectory && expanded.has(entry.path)
        return (
          <li key={entry.path} className="[content-visibility:auto] [contain-intrinsic-size:38px]">
            <button
              type="button"
              aria-expanded={isDirectory ? isExpanded : undefined}
              className="group flex min-h-9 w-full items-center gap-1.5 pr-2 text-left transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
              style={{ paddingLeft: 7 + depth * 14 }}
              onClick={() => (isDirectory ? onToggleDirectory(entry) : onSelectFile(entry))}
            >
              <span className="flex h-5 w-4 shrink-0 items-center justify-center text-slate-400">
                {isDirectory ? (isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
              </span>
              {isDirectory
                ? isExpanded ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" /> : <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                : <span className="shrink-0"><FileKindIcon entry={entry} /></span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium text-slate-700">{entry.name}</span>
                {!isDirectory ? (
                  <span className="mt-0.5 flex items-center gap-1.5 text-[9px] text-slate-400">
                    <span>{formatFileSize(entry.sizeBytes)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatModifiedAt(entry.modifiedAt)}</span>
                  </span>
                ) : null}
              </span>
            </button>
            {isDirectory && isExpanded ? (
              <DirectoryEntries
                relativePath={entry.path}
                depth={depth + 1}
                directories={directories}
                expanded={expanded}
                onToggleDirectory={onToggleDirectory}
                onSelectFile={onSelectFile}
              />
            ) : null}
          </li>
        )
      })}
      {state.result.warning ? <li className="mx-2 my-2 rounded-md bg-amber-50 px-2 py-1.5 text-[10px] leading-4 text-amber-700">{state.result.warning}</li> : null}
    </ul>
  )
}

export function ProjectFilePreviewPanel({
  project,
  active = true,
}: {
  project: ProjectSummary | null
  active?: boolean
}) {
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selectedFile, setSelectedFile] = useState<ProjectPreviewEntry | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>({ status: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const projectGenerationRef = useRef(0)
  const previewGenerationRef = useRef(0)
  const directoryRequestRef = useRef(new Map<string, number>())
  const loadMoreInFlightRef = useRef(false)
  const loadMoreRequestRef = useRef(0)
  const reloadHeavyPreviewRef = useRef(false)
  const wasActiveRef = useRef(active)
  const activeRef = useRef(active)
  const directoriesRef = useRef(directories)
  const selectedFileRef = useRef(selectedFile)
  const previewStateRef = useRef(previewState)
  const softRefreshTimerRef = useRef<number | null>(null)

  directoriesRef.current = directories
  selectedFileRef.current = selectedFile
  previewStateRef.current = previewState
  activeRef.current = active

  const clearSoftRefreshTimer = useCallback(() => {
    if (softRefreshTimerRef.current === null) return
    window.clearTimeout(softRefreshTimerRef.current)
    softRefreshTimerRef.current = null
  }, [])

  const loadDirectory = useCallback(async (relativePath: string, options?: { silent?: boolean }) => {
    const projectId = project?.id
    if (!projectId) return
    const projectGeneration = projectGenerationRef.current
    const requestGeneration = (directoryRequestRef.current.get(relativePath) ?? 0) + 1
    directoryRequestRef.current.set(relativePath, requestGeneration)
    if (!options?.silent) {
      setDirectories((current) => ({ ...current, [relativePath]: { status: 'loading' } }))
    }
    try {
      const result = await electronBridge.listProjectPreviewDirectory(projectId, relativePath)
      if (
        projectGenerationRef.current !== projectGeneration
        || directoryRequestRef.current.get(relativePath) !== requestGeneration
      ) return
      setDirectories((current) => ({ ...current, [relativePath]: { status: 'ready', result } }))
    } catch (error) {
      if (
        projectGenerationRef.current !== projectGeneration
        || directoryRequestRef.current.get(relativePath) !== requestGeneration
      ) return
      if (options?.silent) return
      setDirectories((current) => ({
        ...current,
        [relativePath]: { status: 'error', message: errorText(error) },
      }))
    }
  }, [project?.id])

  useEffect(() => {
    clearSoftRefreshTimer()
    projectGenerationRef.current += 1
    previewGenerationRef.current += 1
    loadMoreRequestRef.current += 1
    loadMoreInFlightRef.current = false
    reloadHeavyPreviewRef.current = false
    directoryRequestRef.current.clear()
    setDirectories({})
    setExpanded(new Set())
    setSelectedFile(null)
    setPreviewState({ status: 'loading' })
    setLoadingMore(false)
    if (project?.id) void loadDirectory('')
  }, [clearSoftRefreshTimer, loadDirectory, project?.id, project?.rootPathUpdatedAt])

  const toggleDirectory = useCallback((entry: ProjectPreviewEntry) => {
    if (entry.type !== 'directory') return
    const opening = !expanded.has(entry.path)
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(entry.path)) {
        next.delete(entry.path)
      } else {
        next.add(entry.path)
      }
      return next
    })
    if (opening && (!directories[entry.path] || directories[entry.path].status === 'error')) {
      void loadDirectory(entry.path)
    }
  }, [directories, expanded, loadDirectory])

  const selectFile = useCallback(async (entry: ProjectPreviewEntry, options?: { silent?: boolean }) => {
    if (!project?.id || entry.type !== 'file') return
    const generation = ++previewGenerationRef.current
    loadMoreRequestRef.current += 1
    loadMoreInFlightRef.current = false
    reloadHeavyPreviewRef.current = false
    setSelectedFile(entry)
    if (!options?.silent) {
      setPreviewState({ status: 'loading' })
    }
    setLoadingMore(false)
    try {
      const result = await electronBridge.readProjectFilePreview(project.id, entry.path)
      if (previewGenerationRef.current !== generation) return
      setPreviewState({ status: 'ready', result: boundTextPreviewResult(result) })
    } catch (error) {
      if (previewGenerationRef.current !== generation) return
      if (options?.silent) return
      setPreviewState({ status: 'error', message: errorText(error) })
    }
  }, [project?.id])

  const softRefresh = useCallback(() => {
    if (!project?.id) return
    const cachedPaths = Object.keys(directoriesRef.current)
    const targets = cachedPaths.length > 0 ? cachedPaths : ['']
    for (const relativePath of targets) {
      if (directoriesRef.current[relativePath]?.status === 'ready') {
        void loadDirectory(relativePath, { silent: true })
      } else {
        void loadDirectory(relativePath)
      }
    }
    const file = selectedFileRef.current
    if (!file) return
    void selectFile(file, { silent: previewStateRef.current.status === 'ready' })
  }, [loadDirectory, project?.id, selectFile])

  const scheduleSoftRefresh = useCallback(() => {
    clearSoftRefreshTimer()
    softRefreshTimerRef.current = window.setTimeout(() => {
      softRefreshTimerRef.current = null
      softRefresh()
    }, SOFT_REFRESH_DEBOUNCE_MS)
  }, [clearSoftRefreshTimer, softRefresh])

  const closePreview = useCallback(() => {
    previewGenerationRef.current += 1
    loadMoreRequestRef.current += 1
    loadMoreInFlightRef.current = false
    reloadHeavyPreviewRef.current = false
    setSelectedFile(null)
    setPreviewState({ status: 'loading' })
    setLoadingMore(false)
  }, [])

  const loadMore = useCallback(async () => {
    if (
      !project?.id
      || previewState.status !== 'ready'
      || (previewState.result.mode !== 'text' && previewState.result.mode !== 'markdown')
      || previewState.result.nextOffset === null
      || loadMoreInFlightRef.current
    ) return
    const current = previewState.result
    const nextOffset = current.nextOffset
    if (nextOffset === null) return
    const generation = previewGenerationRef.current
    const request = ++loadMoreRequestRef.current
    loadMoreInFlightRef.current = true
    setLoadingMore(true)
    try {
      const next = await electronBridge.readProjectFilePreview(project.id, current.path, nextOffset)
      if (
        previewGenerationRef.current !== generation
        || loadMoreRequestRef.current !== request
      ) return
      if (
        (next.mode !== 'text' && next.mode !== 'markdown')
        || next.path !== current.path
      ) {
        throw new Error('文件预览响应类型不一致。')
      }
      if (next.sizeBytes !== current.sizeBytes || next.modifiedAt !== current.modifiedAt) {
        throw new Error('文件在分段预览期间发生变化，请刷新后重试。')
      }
      const combinedContent = `${current.content}${next.content}`
      const clientLimitReached = combinedContent.length > MAX_ACCUMULATED_TEXT_CHARACTERS
      setPreviewState({
        status: 'ready',
        result: {
          ...next,
          content: clientLimitReached
            ? combinedContent.slice(0, MAX_ACCUMULATED_TEXT_CHARACTERS)
            : combinedContent,
          offset: 0,
          nextOffset: clientLimitReached ? null : next.nextOffset,
          truncated: next.truncated || clientLimitReached,
          limitReached: next.limitReached || clientLimitReached,
        },
      })
    } catch (error) {
      if (
        previewGenerationRef.current === generation
        && loadMoreRequestRef.current === request
      ) {
        setPreviewState({ status: 'error', message: errorText(error) })
      }
    } finally {
      if (
        previewGenerationRef.current === generation
        && loadMoreRequestRef.current === request
      ) {
        loadMoreInFlightRef.current = false
        setLoadingMore(false)
      }
    }
  }, [previewState, project?.id])

  useEffect(() => {
    const becameActive = active && !wasActiveRef.current
    wasActiveRef.current = active
    const heavyPreviewSelected = selectedFile?.previewMode
      ? HEAVY_PREVIEW_MODES.has(selectedFile.previewMode)
      : false
    if (!active && selectedFile && heavyPreviewSelected) {
      if (reloadHeavyPreviewRef.current) return
      previewGenerationRef.current += 1
      loadMoreRequestRef.current += 1
      loadMoreInFlightRef.current = false
      reloadHeavyPreviewRef.current = true
      setPreviewState({ status: 'loading' })
      setLoadingMore(false)
      return
    }
    if (becameActive) {
      reloadHeavyPreviewRef.current = false
      scheduleSoftRefresh()
    }
  }, [active, scheduleSoftRefresh, selectedFile])

  useEffect(() => {
    const unsubscribe = electronBridge.onAgentEvent((event) => {
      if (
        event.type !== 'agent_settled'
        && event.type !== 'error'
        && !(event.type === 'messages_updated' && event.promptSettled === true)
      ) return
      if (!project?.id || event.projectId !== project.id) return
      if (!activeRef.current) return
      scheduleSoftRefresh()
    })
    return () => {
      unsubscribe?.()
    }
  }, [project?.id, scheduleSoftRefresh])

  useEffect(() => () => {
    if (softRefreshTimerRef.current !== null) {
      window.clearTimeout(softRefreshTimerRef.current)
    }
  }, [])

  const refresh = useCallback(() => {
    clearSoftRefreshTimer()
    projectGenerationRef.current += 1
    previewGenerationRef.current += 1
    loadMoreRequestRef.current += 1
    loadMoreInFlightRef.current = false
    reloadHeavyPreviewRef.current = false
    directoryRequestRef.current.clear()
    setDirectories({})
    setExpanded(new Set())
    setSelectedFile(null)
    setPreviewState({ status: 'loading' })
    setLoadingMore(false)
    if (project?.id) void loadDirectory('')
  }, [clearSoftRefreshTimer, loadDirectory, project?.id])

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-5 text-center">
        <Folder className="mb-2 h-7 w-7 text-slate-300" />
        <p className="text-xs font-medium text-slate-600">尚未选择项目</p>
        <p className="mt-1 text-[11px] leading-5 text-slate-400">从左侧选择项目后，可浏览并预览项目目录中的文件。</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('min-h-0 flex-1 flex-col', selectedFile ? 'hidden' : 'flex')}>
        <header className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 bg-white/70 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-slate-800">{project.name}</p>
            <p className="mt-0.5 truncate text-[10px] text-slate-400">项目文件</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="刷新项目文件" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-white/35">
          <DirectoryEntries
            relativePath=""
            depth={0}
            directories={directories}
            expanded={expanded}
            onToggleDirectory={toggleDirectory}
            onSelectFile={(entry) => void selectFile(entry)}
          />
        </div>
      </div>

      <div className={cn('min-h-0 flex-1 flex-col', selectedFile ? 'flex' : 'hidden')}>
        <header className="shrink-0 border-b border-slate-200/70 bg-white/80 px-2.5 py-2">
          <div className="flex items-start gap-2">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="返回项目文件列表" onClick={closePreview}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-900">{selectedFile?.name}</p>
              <p className="mt-0.5 truncate text-[10px] text-slate-400" title={selectedFile?.path}>{selectedFile?.path}</p>
            </div>
            {selectedFile ? <span className="shrink-0 text-[9px] text-slate-400">{formatFileSize(selectedFile.sizeBytes)}</span> : null}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <PreviewContent
            state={previewState}
            loadingMore={loadingMore}
            onLoadMore={() => void loadMore()}
            onReload={() => {
              if (selectedFile) void selectFile(selectedFile)
            }}
          />
        </div>
      </div>
    </div>
  )
}
