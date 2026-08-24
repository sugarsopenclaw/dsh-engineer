import {
  AcDb2dPolyline,
  AcDb3dPolyline,
  AcDbArc,
  AcDbAttribute,
  AcDbBlockReference,
  type AcDbBlockTableRecord,
  AcDbCircle,
  type AcDbDatabase,
  AcDbDimension,
  AcDbEllipse,
  type AcDbEntity,
  AcDbHatch,
  AcDbLeader,
  AcDbLine,
  AcDbMLeader,
  AcDbMText,
  AcDbPolyline,
  AcDbSpline,
  AcDbTable,
  AcDbText,
} from '@mlightcad/data-model'

import type {
  MLightCadExtractionFilters,
  MLightCadExtractionRuntimeResult,
} from '../shared/mlight-cad-runtime'

const TEXT_FREQUENCY_LIMIT = 2_500
const SPATIAL_ANCHOR_LIMIT = 1_200
const ENTITY_SAMPLE_LIMIT = 400
const LAYER_LIMIT = 300
const GEOMETRY_SAMPLE_LIMIT = 80
const MAX_GEOMETRY_POINTS = 20_000
const MAX_TEXT_LENGTH = 16_384
const GEOMETRY_TYPES = new Set([
  'line',
  'lwpolyline',
  '2d_polyline',
  '3d_polyline',
  'circle',
  'arc',
  'ellipse',
  'spline',
])
/**
 * Types that reach the index as an outline and nothing else.
 *
 * They are read from the file and carry a handle, layer and bbox, but the parser cannot
 * open what is inside them: an OLE frame wraps an embedded spreadsheet, a proxy entity
 * stands in for a custom object whose owning application is absent. A reader that only
 * sees the type counts would assume the region was covered.
 */
const OPAQUE_TYPES = new Set(['ole2frame', 'proxyentity', 'acad_proxy_entity', 'acad_proxy_object'])
/** Report proxy density once it can hide a meaningful part of the sheet. */
const OPAQUE_DENSITY_RATIO = 0.1

type EntityRecord = Record<string, unknown>

interface ExtractedRecords {
  records: EntityRecord[]
  typeCounts: Map<string, number>
  layerCounts: Map<string, number>
  ownerScopeCounts: Map<string, number>
  ownerBlockCounts: Map<string, number>
  blockInventory: EntityRecord[]
  blockRecordCount: number
  captureScope: 'model_space_authored_entities' | 'database_authored_entities'
  sourceEntityCount: number
  omittedGeometryCount: number
  failedCount: number
  warnings: string[]
}

interface ExtractionOwner {
  blockRecord: AcDbBlockTableRecord
  context: EntityRecord
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value)
}

function boundedText(value: unknown, maximum = MAX_TEXT_LENGTH): string {
  return String(value ?? '').slice(0, maximum)
}

function finiteNumber(value: unknown, digits = 6): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return null
  const scale = 10 ** digits
  return Math.round((number + Number.EPSILON) * scale) / scale
}

function point3(value: unknown): number[] | null {
  if (!isObject(value)) return null
  const x = finiteNumber(Reflect.get(value, 'x'))
  const y = finiteNumber(Reflect.get(value, 'y'))
  const z = finiteNumber(Reflect.get(value, 'z'))
  if (x === null || y === null) return null
  return z === null ? [x, y] : [x, y, z]
}

function entityBbox(entity: AcDbEntity): { min: number[]; max: number[] } | null {
  try {
    const box = entity.geometricExtents
    if (box.isEmpty()) return null
    const min = point3(box.min)
    const max = point3(box.max)
    return min && max ? { min, max } : null
  } catch {
    return null
  }
}

function objectType(entity: AcDbEntity): { objectName: string; typeName: string } {
  const rawType = entity.type || 'Unknown'
  const objectName = rawType.startsWith('AcDb') ? rawType : `AcDb${rawType}`
  if (entity instanceof AcDbLine) return { objectName: 'AcDbLine', typeName: 'line' }
  if (entity instanceof AcDbCircle) return { objectName: 'AcDbCircle', typeName: 'circle' }
  if (entity instanceof AcDbArc) return { objectName: 'AcDbArc', typeName: 'arc' }
  if (entity instanceof AcDbEllipse) return { objectName: 'AcDbEllipse', typeName: 'ellipse' }
  if (entity instanceof AcDbSpline) return { objectName: 'AcDbSpline', typeName: 'spline' }
  if (entity instanceof AcDbPolyline) return { objectName: 'AcDbPolyline', typeName: 'lwpolyline' }
  if (entity instanceof AcDb2dPolyline) return { objectName: 'AcDb2dPolyline', typeName: '2d_polyline' }
  if (entity instanceof AcDb3dPolyline) return { objectName: 'AcDb3dPolyline', typeName: '3d_polyline' }
  if (entity instanceof AcDbAttribute) return { objectName: 'AcDbAttribute', typeName: 'attribute' }
  if (entity instanceof AcDbText) return { objectName: 'AcDbText', typeName: 'text' }
  if (entity instanceof AcDbMText) return { objectName: 'AcDbMText', typeName: 'mtext' }
  if (entity instanceof AcDbDimension) return { objectName, typeName: 'dimension' }
  if (entity instanceof AcDbTable) return { objectName: 'AcDbTable', typeName: 'table' }
  if (entity instanceof AcDbBlockReference) {
    return { objectName: 'AcDbBlockReference', typeName: 'block_reference' }
  }
  if (entity instanceof AcDbLeader) return { objectName: 'AcDbLeader', typeName: 'leader' }
  if (entity instanceof AcDbMLeader) return { objectName: 'AcDbMLeader', typeName: 'mleader' }
  if (entity instanceof AcDbHatch) return { objectName: 'AcDbHatch', typeName: 'hatch' }
  return {
    objectName,
    typeName: objectName.startsWith('AcDb') ? objectName.slice(4).toLowerCase() : objectName.toLowerCase(),
  }
}

function baseCommon(entity: AcDbEntity): EntityRecord {
  const { objectName, typeName } = objectType(entity)
  return {
    handle: boundedText(entity.objectId, 64),
    type: typeName,
    object_name: objectName,
    layer: boundedText(entity.layer, 1_024),
    visible: Boolean(entity.visibility),
    bbox: entityBbox(entity),
  }
}

function entityProperty(entity: AcDbEntity, name: string): unknown {
  try {
    for (const group of entity.properties.groups) {
      const property = group.properties.find(
        (candidate: { name: string; accessor: { get(): unknown } }) => candidate.name === name,
      )
      if (property) return property.accessor.get()
    }
  } catch {
    return undefined
  }
  return undefined
}

function normalizeMTextSource(value: string): string {
  return value.replace(/\\U\+0084/giu, '%%132').replace(/\\U\+0085/giu, '%%133')
}

function cleanMText(value: string): string {
  return normalizeMTextSource(value)
    .replaceAll('%%132', 'φ')
    .replaceAll('%%133', 'φ')
    .replaceAll('\\P', '\n')
    .replaceAll('\\~', ' ')
    .replace(/\\[A-Za-z][^;{}]*;/gu, '')
    .replace(/[{}]/gu, '')
    .split(/\s+/u)
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_TEXT_LENGTH)
}

function serializeText(entity: AcDbText | AcDbMText, result: EntityRecord): void {
  if (entity instanceof AcDbMText) {
    const content = boundedText(normalizeMTextSource(entity.contents ?? ''))
    Object.assign(result, {
      content,
      content_clean: cleanMText(content),
      position: point3(entity.location),
      height: finiteNumber(entity.height),
      rotation: finiteNumber(entity.rotation),
      style: boundedText(entity.styleName, 1_024),
    })
    return
  }
  const content = boundedText(normalizeMTextSource(entity.textString ?? ''))
  Object.assign(result, {
    content,
    content_clean: content,
    position: point3(entity.position) ?? point3(entity.alignmentPoint),
    height: finiteNumber(entity.height),
    rotation: finiteNumber(entity.rotation),
    style: boundedText(entity.styleName, 1_024),
  })
}

function dimensionPoint(entity: AcDbDimension, names: readonly string[]): number[] | null {
  for (const name of names) {
    const point = point3(Reflect.get(entity, name))
    if (point) return point
  }
  return null
}

function serializeDimension(entity: AcDbDimension, result: EntityRecord): void {
  const objectName = String(result.object_name ?? 'AcDbDimension')
  Object.assign(result, {
    dimension_type: objectName.replace(/^AcDb/u, ''),
    measurement: finiteNumber(entity.measurement, 4),
    text_override: boundedText(entity.dimensionText),
    text_position: point3(entity.textPosition),
    point1: dimensionPoint(entity, [
      'extLine1Point', 'xLine1Point', 'center', 'centerPoint', 'origin', 'definingPoint',
    ]),
    point2: dimensionPoint(entity, ['extLine2Point', 'xLine2Point', 'chordPoint', 'leaderEndPoint']),
  })
}

function serializeBlock(entity: AcDbBlockReference, result: EntityRecord): void {
  const attributes: Record<string, string> = {}
  for (const attribute of entity.attributeIterator().toArray().slice(0, 500)) {
    const tag = boundedText(attribute.tag, 1_024)
    if (tag) attributes[tag] = boundedText(normalizeMTextSource(attribute.textString ?? ''))
  }
  const scale = point3(entity.scaleFactors) ?? [1, 1, 1]
  Object.assign(result, {
    name: boundedText(entity.blockName, 1_024),
    insert_point: point3(entity.position),
    rotation: finiteNumber(entity.rotation),
    scale: scale.map((value) => finiteNumber(value) ?? 1),
    attributes,
  })
}

function serializeTable(entity: AcDbTable, result: EntityRecord): void {
  const rows = entity.numRows
  const columns = entity.numColumns
  const cells: string[][] = []
  for (let rowIndex = 0; rowIndex < Math.min(rows, 500); rowIndex += 1) {
    const row: string[] = []
    for (let columnIndex = 0; columnIndex < Math.min(columns, 100); columnIndex += 1) {
      try {
        row.push(boundedText(normalizeMTextSource(entity.textString(rowIndex, columnIndex) ?? ''), 4_096))
      } catch {
        row.push('')
      }
    }
    cells.push(row)
  }
  Object.assign(result, {
    rows,
    columns,
    cells,
    insert_point: point3(entity.position),
    cells_truncated: rows > 500 || columns > 100,
  })
}

function polylineVertices(entity: AcDbPolyline | AcDb2dPolyline | AcDb3dPolyline): number[][] {
  const vertices: number[][] = []
  const count = Math.min(entity.numberOfVertices, MAX_GEOMETRY_POINTS)
  for (let index = 0; index < count; index += 1) {
    const value = entity instanceof AcDbPolyline ? entity.getPoint3dAt(index) : entity.getPointAt(index)
    const point = point3(value)
    if (point) vertices.push(point.slice(0, 2))
  }
  return vertices
}

function reflectedArray(entity: AcDbEntity, name: string): unknown[] {
  const geometry = Reflect.get(entity, '_geo')
  if (!isObject(geometry)) return []
  const value = Reflect.get(geometry, name)
  return Array.isArray(value) ? value.slice(0, MAX_GEOMETRY_POINTS) : []
}

function reflectedGeometryProperty(entity: AcDbEntity, name: string): unknown {
  const geometry = Reflect.get(entity, '_geo')
  return isObject(geometry) ? Reflect.get(geometry, name) : undefined
}

function serializeGeometry(entity: AcDbEntity, result: EntityRecord): void {
  if (entity instanceof AcDbLine) {
    Object.assign(result, {
      start: point3(entity.startPoint),
      end: point3(entity.endPoint),
      length: finiteNumber(entityProperty(entity, 'length')),
    })
    return
  }
  if (entity instanceof AcDbPolyline || entity instanceof AcDb2dPolyline || entity instanceof AcDb3dPolyline) {
    Object.assign(result, {
      vertices: polylineVertices(entity),
      vertices_truncated: entity.numberOfVertices > MAX_GEOMETRY_POINTS,
      closed: entity.closed,
      area: finiteNumber(entity.area),
      length: finiteNumber(entityProperty(entity, 'length')),
    })
    return
  }
  if (entity instanceof AcDbCircle) {
    const radius = finiteNumber(entity.radius)
    Object.assign(result, {
      center: point3(entity.center),
      radius,
      area: finiteNumber(entity.area),
      length: radius === null ? null : finiteNumber(2 * Math.PI * radius),
    })
    return
  }
  if (entity instanceof AcDbArc) {
    Object.assign(result, {
      center: point3(entity.center),
      radius: finiteNumber(entity.radius),
      start_angle: finiteNumber(entity.startAngle),
      end_angle: finiteNumber(entity.endAngle),
      length: finiteNumber(entityProperty(entity, 'arcLength')),
    })
    return
  }
  if (entity instanceof AcDbEllipse) {
    const majorRadius = finiteNumber(entity.majorAxisRadius)
    const minorRadius = finiteNumber(entity.minorAxisRadius)
    Object.assign(result, {
      center: point3(entity.center),
      major_axis: point3(entity.majorAxis),
      radius_ratio: majorRadius === null || minorRadius === null || majorRadius === 0
        ? null
        : finiteNumber(minorRadius / majorRadius),
      start_angle: finiteNumber(entity.startAngle),
      end_angle: finiteNumber(entity.endAngle),
      area: finiteNumber(entity.area),
    })
    return
  }
  if (entity instanceof AcDbSpline) {
    Object.assign(result, {
      control_points: reflectedArray(entity, 'controlPoints')
        .map(point3)
        .filter((point): point is number[] => point !== null)
        .map((point) => point.slice(0, 2)),
      fit_points: reflectedArray(entity, 'fitPoints')
        .map(point3)
        .filter((point): point is number[] => point !== null)
        .map((point) => point.slice(0, 2)),
      degree: finiteNumber(reflectedGeometryProperty(entity, 'degree'), 0),
      closed: entity.closed,
    })
  }
}

function hatchLoopCount(entity: AcDbHatch): number | null {
  const geometry = Reflect.get(entity, '_geo')
  if (!isObject(geometry)) return null
  const loops = Reflect.get(geometry, 'loops')
  return Array.isArray(loops) ? loops.length : null
}

function serializeEntity(entity: AcDbEntity, includeGeometry: boolean): EntityRecord {
  const result = baseCommon(entity)
  const typeName = String(result.type)
  if (typeName === 'text' && entity instanceof AcDbText) serializeText(entity, result)
  else if (typeName === 'mtext' && entity instanceof AcDbMText) serializeText(entity, result)
  else if (typeName === 'dimension' && entity instanceof AcDbDimension) serializeDimension(entity, result)
  else if (typeName === 'table' && entity instanceof AcDbTable) serializeTable(entity, result)
  else if (typeName === 'block_reference' && entity instanceof AcDbBlockReference) serializeBlock(entity, result)
  else if (typeName === 'leader' && entity instanceof AcDbLeader) {
    result.vertices = entity.vertices
      .slice(0, MAX_GEOMETRY_POINTS)
      .map(point3)
      .filter((point: number[] | null): point is number[] => point !== null)
      .map((point: number[]) => point.slice(0, 2))
  } else if (typeName === 'mleader' && entity instanceof AcDbMLeader) {
    result.text_content = boundedText(normalizeMTextSource(entity.contents ?? ''))
  } else if (typeName === 'hatch' && entity instanceof AcDbHatch) {
    Object.assign(result, {
      pattern: boundedText(entity.patternName, 1_024),
      area: finiteNumber(entity.area),
      loops_count: hatchLoopCount(entity),
      is_solid: (entity.patternName ?? '').toUpperCase() === 'SOLID',
    })
  } else if (includeGeometry && GEOMETRY_TYPES.has(typeName)) serializeGeometry(entity, result)
  return result
}

function textFragments(record: EntityRecord): string[] {
  const fragments: string[] = []
  for (const key of ['content_clean', 'content', 'text_override', 'text_content', 'name']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) fragments.push(value.trim().replace(/\s+/gu, ' '))
  }
  if (isRecord(record.attributes)) {
    for (const value of Object.values(record.attributes)) {
      const text = String(value).trim()
      if (text) fragments.push(text)
    }
  }
  if (Array.isArray(record.cells)) {
    for (const row of record.cells) {
      if (!Array.isArray(row)) continue
      for (const value of row) {
        const text = String(value).trim()
        if (text) fragments.push(text)
      }
    }
  }
  if (typeof record.measurement === 'number') fragments.push(String(record.measurement))
  return fragments
}

function wildcardRegex(pattern: string): RegExp {
  let source = '^'
  for (const character of pattern) {
    if (character === '*') source += '.*'
    else if (character === '?') source += '.'
    else source += character.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')
  }
  return new RegExp(`${source}$`, 'iu')
}

function matchesPatterns(value: string, patterns: readonly string[] | undefined): boolean {
  return !patterns?.length || patterns.some((pattern) => wildcardRegex(pattern).test(value))
}

function isInsideWindow(bbox: unknown, window: MLightCadExtractionFilters['window']): boolean {
  if (!window || !isRecord(bbox) || !Array.isArray(bbox.min) || !Array.isArray(bbox.max)) return !window
  const [minX, minY] = bbox.min
  const [maxX, maxY] = bbox.max
  return (
    typeof minX === 'number'
    && typeof minY === 'number'
    && typeof maxX === 'number'
    && typeof maxY === 'number'
    && minX >= window.min[0]
    && minY >= window.min[1]
    && maxX <= window.max[0]
    && maxY <= window.max[1]
  )
}

function increment(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1)
}

function extractionOwners(database: AcDbDatabase, filters: MLightCadExtractionFilters): ExtractionOwner[] {
  const blockRecords = filters.scope === 'database'
    ? database.tables.blockTable.newIterator(true).toArray()
    : [database.tables.blockTable.modelSpace]
  return blockRecords.map((blockRecord) => {
    const ownerScope = blockRecord.isModelSapce
      ? 'model_space'
      : blockRecord.isPaperSapce
        ? 'paper_space'
        : 'block_definition'
    return {
      blockRecord,
      context: {
        owner_scope: ownerScope,
        owner_block_name: boundedText(blockRecord.name, 1_024),
        owner_block_id: boundedText(blockRecord.objectId, 64),
        owner_layout_id: boundedText(blockRecord.layoutId, 64) || null,
        owner_is_xref: blockRecord.isXref,
        owner_is_unresolved_xref: blockRecord.isUnresolvedXref,
        owner_xref_path: boundedText(blockRecord.pathName, 4_096) || null,
      },
    }
  })
}

function extractRecords(database: AcDbDatabase, filters: MLightCadExtractionFilters): ExtractedRecords {
  const records: EntityRecord[] = []
  const typeCounts = new Map<string, number>()
  const layerCounts = new Map<string, number>()
  const ownerScopeCounts = new Map<string, number>()
  const ownerBlockCounts = new Map<string, number>()
  const blockInventory: EntityRecord[] = []
  const warnings: string[] = []
  const owners = extractionOwners(database, filters)
  const captureScope = filters.scope === 'database'
    ? 'database_authored_entities'
    : 'model_space_authored_entities'
  let sourceEntityCount = 0
  let omittedGeometryCount = 0
  let failedCount = 0
  let geometrySamples = 0
  for (const owner of owners) {
    let entities: AcDbEntity[]
    let serializedInBlock = 0
    let failedInBlock = 0
    try {
      entities = owner.blockRecord.newIterator().toArray()
    } catch (error) {
      blockInventory.push({
        ...owner.context,
        declared_entity_count: null,
        serialized_entity_count: 0,
        failed_entity_count: null,
        iteration_failed: true,
      })
      if (warnings.length < 200) {
        warnings.push(
          `block ${String(owner.context.owner_block_name)} could not be iterated: `
          + `${error instanceof Error ? error.name : 'Error'}`,
        )
      }
      continue
    }
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index]
      try {
        if (filters.window && !isInsideWindow(entityBbox(entity), filters.window)) continue
        sourceEntityCount += 1
        if (!filters.includeInvisible && !entity.visibility) continue
        const layer = boundedText(entity.layer, 1_024)
        if (
          (!filters.includeDefpoints && layer.toLowerCase() === 'defpoints')
          || !matchesPatterns(layer, filters.layers)
        ) continue
        const { typeName } = objectType(entity)
        if (!matchesPatterns(typeName, filters.types)) continue
        const isGeometry = GEOMETRY_TYPES.has(typeName)
        const includeFullGeometry = filters.includeGeometry || !isGeometry
        const record = serializeEntity(entity, includeFullGeometry)
        Object.assign(record, owner.context, {
          capture_scope: captureScope,
          owner_entity_index: index,
          entity_key: `${String(owner.context.owner_block_name)}::${String(record.handle).toUpperCase()}`,
        })
        const entityText = textFragments(record).join(' ')
        if (filters.textPattern && !wildcardRegex(filters.textPattern).test(entityText)) continue
        increment(typeCounts, typeName)
        increment(layerCounts, layer || '(empty)')
        increment(ownerScopeCounts, String(owner.context.owner_scope))
        increment(ownerBlockCounts, String(owner.context.owner_block_name))
        if (isGeometry && !filters.includeGeometry) {
          omittedGeometryCount += 1
          if (geometrySamples >= GEOMETRY_SAMPLE_LIMIT) continue
          geometrySamples += 1
          record.geometry_sample = true
        }
        records.push(record)
        serializedInBlock += 1
      } catch (error) {
        failedCount += 1
        failedInBlock += 1
        if (warnings.length < 200) {
          warnings.push(
            `entity ${index + 1} in block ${String(owner.context.owner_block_name)} could not be serialized: `
            + `${error instanceof Error ? error.name : 'Error'}`,
          )
        }
      }
    }
    blockInventory.push({
      ...owner.context,
      declared_entity_count: entities.length,
      serialized_entity_count: serializedInBlock,
      failed_entity_count: failedInBlock,
      iteration_failed: false,
    })
  }
  return {
    records,
    typeCounts,
    layerCounts,
    ownerScopeCounts,
    ownerBlockCounts,
    blockInventory,
    blockRecordCount: owners.length,
    captureScope,
    sourceEntityCount,
    omittedGeometryCount,
    failedCount,
    warnings,
  }
}

function markdownValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (Array.isArray(value)) return `[${value.map(markdownValue).join(', ')}]`
  if (isRecord(value)) return JSON.stringify(value)
  return String(value)
}

function markdownCell(value: unknown): string {
  return markdownValue(value).replaceAll('|', '\\|').split(/\s+/u).filter(Boolean).join(' ')
}

function markdownTable(headers: readonly string[], rows: readonly (readonly unknown[])[]): string[] {
  return [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`),
  ]
}

function recordPoint(record: EntityRecord): unknown {
  for (const key of ['position', 'text_position', 'insert_point', 'center', 'start', 'point1', 'point2']) {
    if (record[key] !== null && record[key] !== undefined) return record[key]
  }
  return ''
}

function sortedCounts(counter: Map<string, number>, limit?: number): [string, number][] {
  const rows = [...counter.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )
  return limit === undefined ? rows : rows.slice(0, limit)
}

/** Counts of indexed entities whose interior the parser cannot reach, by type. */
function opaqueTypeCounts(typeCounts: Map<string, number>): [string, number][] {
  return [...typeCounts.entries()]
    .filter(([type]) => OPAQUE_TYPES.has(type))
    .sort((left, right) => right[1] - left[1])
}

function describeOpaqueContent(extracted: ExtractedRecords): string[] {
  const opaque = opaqueTypeCounts(extracted.typeCounts)
  if (opaque.length === 0) return []
  const total = opaque.reduce((sum, [, count]) => sum + count, 0)
  const breakdown = opaque.map(([type, count]) => `${type}×${count}`).join(', ')
  const notes = [
    `This drawing contains ${total} entities this engine can only see the outline of `
    + `(${breakdown}). Their handles, layers and bounding boxes are in the index, but their `
    + 'content is not: an OLE frame hides an embedded spreadsheet, a proxy entity hides a '
    + 'custom object. Rendering one produces a blank block. Anything inside them needs '
    + 'AutoCAD; do not report their region as read or as empty.',
  ]
  const indexed = extracted.records.length
  if (indexed > 0 && total / indexed >= OPAQUE_DENSITY_RATIO) {
    notes.push(
      `Those entities are ${Math.round((total / indexed) * 100)}% of the index, so a large `
      + 'share of this sheet is unreadable through this engine. Check coverage before drawing '
      + 'conclusions from what did come through.',
    )
  }
  return notes
}

function renderReadableMarkdown(drawingName: string, extracted: ExtractedRecords): string {
  const textCounts = new Map<string, number>()
  const anchors: unknown[][] = []
  for (const record of extracted.records) {
    const fragments = textFragments(record)
    for (const fragment of fragments) increment(textCounts, fragment)
    if (fragments.length || record.bbox || recordPoint(record)) {
      anchors.push([
        fragments.join(' / '),
        record.handle ?? '',
        record.type ?? '',
        record.layer ?? '',
        recordPoint(record),
        record.bbox ?? '',
      ])
    }
  }
  const samples = extracted.records.slice(0, ENTITY_SAMPLE_LIMIT)
  const opaqueNotes = describeOpaqueContent(extracted)
  const lines = [
    '# CAD Entity Index',
    '',
    ...(opaqueNotes.length > 0
      ? ['## Unreadable Content', ...opaqueNotes.map((note) => `- ${note}`), '']
      : []),
    'schema_version: 1',
    `drawing_name: ${markdownCell(drawingName)}`,
    `capture_scope: ${extracted.captureScope}`,
    'capture_semantics: authored database entities; block references are not recursively expanded',
    `block_record_count: ${extracted.blockRecordCount}`,
    `source_entity_count: ${extracted.sourceEntityCount}`,
    `indexed_entity_count: ${extracted.records.length}`,
    `omitted_geometry_count: ${extracted.omittedGeometryCount}`,
    `failed_entity_count: ${extracted.failedCount}`,
    `exported_at: ${new Date().toISOString()}`,
    '',
    '## Owner Scope Counts',
    ...markdownTable(['scope', 'count'], sortedCounts(extracted.ownerScopeCounts)),
    '',
    '## Owner Block Counts',
    ...markdownTable(['block', 'count'], sortedCounts(extracted.ownerBlockCounts, LAYER_LIMIT)),
    '',
    '## Entity Type Counts',
    ...markdownTable(['type', 'count'], sortedCounts(extracted.typeCounts)),
    '',
    '## Layer Counts',
    ...markdownTable(['layer', 'count'], sortedCounts(extracted.layerCounts, LAYER_LIMIT)),
    '',
    '## Text Frequency (selected)',
    ...markdownTable(['text', 'count'], sortedCounts(textCounts, TEXT_FREQUENCY_LIMIT)),
    '',
    '## Text And Spatial Anchors',
    ...markdownTable(
      ['text', 'handle', 'type', 'layer', 'point', 'bbox'],
      anchors.slice(0, SPATIAL_ANCHOR_LIMIT),
    ),
    '',
    `## Entity Samples (top ${ENTITY_SAMPLE_LIMIT})`,
    ...markdownTable(
      ['index', 'handle', 'type', 'layer', 'text', 'point', 'bbox'],
      samples.map((record, index) => [
        index + 1,
        record.handle ?? '',
        record.type ?? '',
        record.layer ?? '',
        textFragments(record).join(' / '),
        recordPoint(record),
        record.bbox ?? '',
      ]),
    ),
  ]
  return `${lines.join('\n')}\n`
}

export function createMLightCadArtifacts(
  database: AcDbDatabase,
  drawingName: string,
  filters: MLightCadExtractionFilters,
  parseDurationMs: number,
): MLightCadExtractionRuntimeResult {
  const extractStarted = performance.now()
  const extracted = extractRecords(database, filters)
  const rawJsonl = extracted.records.length
    ? `${extracted.records.map((record) => JSON.stringify(record)).join('\n')}\n`
    : ''
  const readableMarkdown = renderReadableMarkdown(drawingName, extracted)
  const extractDurationMs = Math.round((performance.now() - extractStarted) * 10) / 10
  return {
    kind: 'extract',
    rawJsonl,
    readableMarkdown,
    summary: {
      source_entity_count: extracted.sourceEntityCount,
      indexed_entity_count: extracted.records.length,
      omitted_geometry_count: extracted.omittedGeometryCount,
      failed_entity_count: extracted.failedCount,
      capture_scope: extracted.captureScope,
      capture_semantics: 'authored database entities; block references are not recursively expanded',
      block_references_expanded: false,
      block_record_count: extracted.blockRecordCount,
      owner_scope_counts: Object.fromEntries(extracted.ownerScopeCounts),
      owner_block_counts: Object.fromEntries(extracted.ownerBlockCounts),
      block_inventory: extracted.blockInventory,
      type_counts: Object.fromEntries(extracted.typeCounts),
      opaque_entity_counts: Object.fromEntries(opaqueTypeCounts(extracted.typeCounts)),
      layer_count: extracted.layerCounts.size,
      parse_duration_ms: parseDurationMs,
      extract_duration_ms: extractDurationMs,
    },
    warnings: [
      ...extracted.warnings,
      ...describeOpaqueContent(extracted),
      'MLightCAD produced the fast index; use cad_extract action=read for authoritative COM fields.',
    ],
  }
}
