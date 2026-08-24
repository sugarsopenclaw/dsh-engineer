import type { CadBridgeDrawing } from '../../../../cad/drivers/autocad-http/cad-application-facade'
import { resolveTrustedProjectRoot } from '../cad-subagent/artifact-store'
import { drawingFromProjectPath } from '../cad-subagent/entity-index'
import { DrafterWorkspace } from './workspace'

/**
 * Per-child state shared by the drafter's tools.
 *
 * MLightCAD has no notion of an open document — sessions are keyed by drawing inside the
 * pool — so "the current drawing" only exists here, as the last target the child named.
 * It saves the model from repeating the path on every call without granting any handle
 * that could outlive the run.
 */
export class DrafterSession {
  readonly projectRoot: string
  readonly workspace: DrafterWorkspace
  private activeDrawingPath: string | null = null

  constructor(projectRootInput: string, childRunId: string) {
    this.projectRoot = resolveTrustedProjectRoot(projectRootInput)
    this.workspace = new DrafterWorkspace(this.projectRoot, childRunId)
  }

  get activeDrawing(): string | null {
    return this.activeDrawingPath
  }

  /** Resolves an explicit path, falling back to the drawing selected by `cad_open`. */
  resolveDrawing(candidate: string | undefined, toolName: string): CadBridgeDrawing {
    const requested = candidate ?? this.activeDrawingPath
    if (!requested) {
      throw new Error(`${toolName} requires path, or call cad_open first to select a drawing.`)
    }
    return drawingFromProjectPath(this.projectRoot, requested)
  }

  select(relativePath: string): void {
    this.activeDrawingPath = relativePath
  }
}
