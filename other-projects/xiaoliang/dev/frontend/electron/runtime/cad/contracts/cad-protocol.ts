export const CAD_PROTOCOL_VERSION = '1.0.0'

export type CadProtocolMethod =
  | 'cad.session.connect'
  | 'cad.session.status'
  | 'cad.document.getActive'
  | 'cad.document.list'
  | 'cad.document.open'
  | 'cad.document.switch'
  | 'cad.selection.readCurrent'
  | 'cad.selection.selectWindow'
  | 'cad.selection.selectByHandle'
  | 'cad.selection.clear'
  | 'cad.selection.nearby'
  | 'cad.selection.nearest'
  | 'cad.view.zoomWindow'
  | 'cad.view.zoomExtents'
  | 'cad.view.zoomCenter'
  | 'cad.view.pan'
  | 'cad.view.getCurrent'
  | 'cad.view.regen'
  | 'cad.view.ensureVisible'
  | 'cad.view.ensureModelSpace'
  | 'cad.view.screenshot'
  | 'cad.view.screenshotRegion'
  | 'cad.view.plotRegion'
  | 'cad.document.plotLayoutToPdf'
  | 'cad.entities.extractSelection'
  | 'cad.entities.extractWindow'
  | 'cad.entities.getByHandle'
  | 'cad.entities.readText'
  | 'cad.entities.readByFilter'
  | 'cad.entities.readReadableIndex'
  | 'cad.entities.readByPolygon'
  | 'cad.annotations.readAllText'
  | 'cad.annotations.readAllDimensions'
  | 'cad.annotations.readAllTables'
  | 'cad.annotations.findText'
  | 'cad.annotations.findTextPlus'
  | 'cad.geometry.distancePointPoint'
  | 'cad.geometry.areaByHandle'
  | 'cad.geometry.lengthByHandle'
  | 'cad.geometry.boundingBoxByHandles'
  | 'cad.composite.scanDrawing'
  | 'cad.composite.regionExtract'
  | 'cad.composite.batchRead'
  | 'cad.capture.hint'
  | 'cad.collections.listLayers'
  | 'cad.collections.listLayouts'
  | 'cad.collections.listBlocks'
  | 'cad.variables.get'
  | 'cad.variables.set'
  | 'cad.commands.send'
  | 'cad.editing.updateEntity'
  | 'cad.events.subscribe'

export interface CadRpcRequest {
  id: number
  protocolVersion: string
  method: CadProtocolMethod
  params: Record<string, unknown>
}

export interface CadRpcProgress {
  scanned: number
  total: number
  matched?: number
  failed?: number
  phase?: string
  message?: string
}

export interface CadRpcResponse {
  id: number
  result?: Record<string, unknown>
  error?: {
    code: number
    message: string
  }
  progress?: CadRpcProgress
}
