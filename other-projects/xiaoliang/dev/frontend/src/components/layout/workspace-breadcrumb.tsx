import { ChevronRight, Home } from 'lucide-react'
import type { DrawingSummary, ProjectSummary } from '@/shared/local-agent'

interface WorkspaceBreadcrumbProps {
  project: ProjectSummary | null
  drawing: DrawingSummary | null
  settingsOpen: boolean
  onGoHome: () => void
  onGoProject: () => void
}

export function WorkspaceBreadcrumb({
  project,
  drawing,
  settingsOpen,
  onGoHome,
  onGoProject,
}: WorkspaceBreadcrumbProps) {
  return (
    <nav className="flex min-w-0 items-center gap-1 overflow-hidden text-xs text-slate-500">
      <button
        type="button"
        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-slate-100 hover:text-slate-900"
        onClick={onGoHome}
      >
        <Home className="h-4 w-4" />
        <span>项目</span>
      </button>

      {project ? (
        <>
          <ChevronRight className="h-3 w-3 shrink-0" />
          <button
            type="button"
            className="max-w-[180px] truncate rounded-md px-1.5 py-1 transition-colors hover:bg-slate-100 hover:text-slate-900"
            onClick={onGoProject}
            title={project.name}
          >
            {project.name}
          </button>
        </>
      ) : null}

      {drawing ? (
        <>
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span className="max-w-[180px] truncate rounded-md px-1.5 py-1 text-slate-900" title={drawing.name}>
            {drawing.name}
          </span>
        </>
      ) : null}

      {settingsOpen ? (
        <>
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span className="shrink-0 rounded-md px-1.5 py-1 text-slate-900">设置</span>
        </>
      ) : null}
    </nav>
  )
}
