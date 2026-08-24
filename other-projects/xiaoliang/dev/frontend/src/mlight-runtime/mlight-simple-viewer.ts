import * as MLightSimpleViewer from '@mlightcad/cad-simple-viewer'
import type { AcDbDatabase } from '@mlightcad/data-model'

export interface MLightVector2 {
  x: number
  y: number
}

export interface MLightBox2d {
  min: MLightVector2
  max: MLightVector2
  isEmpty(): boolean
}

export interface MLightLayerRecord {
  name: string
  isOff: boolean
  isFrozen: boolean
  isLocked: boolean
  color?: unknown
}

export interface MLightView {
  readonly width: number
  readonly height: number
  isDirty: boolean
  zoomTo(box: MLightBox2d, margin?: number): void
  /** Propagates a layer record mutation into the scene graph and materials. */
  updateLayer(layer: MLightLayerRecord, changes: { isOff?: boolean; isFrozen?: boolean }): void
  /** Builds geometry for entities skipped while their layer was off or frozen. */
  convertMissingEntitiesOnLayer(layerName: string): Promise<void>
}

export interface MLightDocument {
  readonly database: AcDbDatabase
  readonly fileName?: string
  readonly docTitle?: string
}

/**
 * The database write surface, which upstream types only as loose symbol tables.
 *
 * Narrowing it here keeps the entity-authoring code honest about the handful of calls it
 * is allowed to make against a parsed drawing.
 */
export interface MLightWritableDatabase {
  tables: {
    layerTable: {
      has(name: string): boolean
      add(record: unknown): void
    }
    blockTable: {
      modelSpace: {
        appendEntity(entity: unknown): void
      }
    }
  }
  beginEventBatch(): void
  endEventBatch(): void
}

export interface MLightDocumentManager {
  readonly curDocument: MLightDocument
  readonly curView: MLightView
  destroy(): Promise<void>
  loadDefaultFonts(fonts?: string[]): Promise<void>
  openDocument(
    fileName: string,
    content: ArrayBuffer,
    options: MLightOpenOptions,
  ): Promise<boolean>
}

interface MLightOpenOptions {
  mode: number
  openViewMode: string
  drawNoPlotLayers: boolean
  progressiveRendering: boolean
}

export interface MLightPngConvertor {
  /** Resolves only after the scene reaches idle and the canvas has been handed off. */
  convert(bounds?: MLightBox2d, longSide?: number): Promise<void>
}

export type MLightEntityPreviewCapture =
  | { ok: true; dataUrl: string; exportedCount: number; skippedCount: number }
  | { ok: false; reason: string }

export interface MLightEntityPreviewConvertor {
  capture(entityIds: string[], longSide: number): MLightEntityPreviewCapture
}

interface MLightSimpleViewerRuntime {
  AcApDocManager: {
    createInstance(options: {
      container: HTMLElement
      width?: number
      height?: number
      autoResize: boolean
      baseUrl: string
      useMainThreadDraw: boolean
      preloadDefaultFonts: boolean
      builtinOpenFileDialog: boolean
      webworkerFileUrls: { dwgParser: URL; mtextRender: URL }
    }): MLightDocumentManager | undefined
    readonly instance: MLightDocumentManager
  }
  AcApOpenViewMode: { Saved: string }
  AcEdOpenMode: { Read: number; Write: number }
  AcApPngConvertor: new () => MLightPngConvertor
  AcApEntityPreviewConvertor: new () => MLightEntityPreviewConvertor
  eventBus: {
    on(event: string, listener: (payload: unknown) => void): void
    off(event: string, listener: (payload: unknown) => void): void
  }
}

const runtime = MLightSimpleViewer as unknown as MLightSimpleViewerRuntime

export const AcApDocManager = runtime.AcApDocManager
export const AcApOpenViewMode = runtime.AcApOpenViewMode
export const AcEdOpenMode = runtime.AcEdOpenMode
export const AcApPngConvertor = runtime.AcApPngConvertor
export const AcApEntityPreviewConvertor = runtime.AcApEntityPreviewConvertor
export const eventBus = runtime.eventBus
