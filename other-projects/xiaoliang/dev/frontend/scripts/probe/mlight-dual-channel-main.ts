import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

import { MLightCadSessionService } from '../../electron/runtime/cad/mlight/mlight-session-service'

const SCHEMA_VERSION = 1
const ROOT_SCOPE = 'database_authored_entities'
const GRAPH_SCOPE = 'drawing_file_graph_authored_entities'

type EntityRecord = Record<string, unknown>

interface XrefSpec {
  alias: string
  sourcePath: string
  hostBlockHandle: string
  autocadDeclaredEntityCount: number
  provenancePath: string
  available: boolean
  workspaceRelativePath: string | null
  sha256: string | null
  sizeBytes: number | null
}

interface ExtractionCapture {
  records: EntityRecord[]
  summary: Record<string, unknown>
  warnings: string[]
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

function requireArg(name: string): string {
  const value = readArg(name)
  if (!value) throw new Error(`MLightCAD dual-channel extractor requires --${name}=<value>`)
  return value
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function atomicWrite(filePath: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}-${crypto.randomUUID()}`)
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true })
    fs.renameSync(temporary, filePath)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

function gitRevision(workspaceRoot: string): string | null {
  try {
    const gitDirectory = path.join(workspaceRoot, '.git')
    if (!fs.existsSync(gitDirectory)) return null
    const head = fs.readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim()
    if (!head.startsWith('ref: ')) return head || null
    const referencePath = path.join(gitDirectory, ...head.slice(5).split('/'))
    return fs.existsSync(referencePath) ? fs.readFileSync(referencePath, 'utf8').trim() || null : null
  } catch {
    return null
  }
}

function readJsonl(filePath: string): EntityRecord[] {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((row) => JSON.parse(row) as EntityRecord)
}

function numberFrom(summary: Record<string, unknown>, key: string): number {
  const value = Number(summary[key] ?? 0)
  return Number.isFinite(value) ? value : 0
}

function sortedCounter(records: readonly EntityRecord[], field: string): Record<string, number> {
  const counts = new Map<string, number>()
  for (const record of records) {
    const key = String(record[field] ?? '(empty)')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Object.fromEntries(
    [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  )
}

function markdownCell(value: unknown): string {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function counterTable(counts: Record<string, number>): string[] {
  return Object.entries(counts).map(([key, count]) => `| ${markdownCell(key)} | ${count} |`)
}

function renderReadable(
  drawingName: string,
  records: readonly EntityRecord[],
  summary: Record<string, unknown>,
  xrefs: readonly Record<string, unknown>[],
): string {
  const typeCounts = summary.type_counts as Record<string, number>
  const layerCounts = summary.layer_counts as Record<string, number>
  const ownerCounts = summary.owner_scope_counts as Record<string, number>
  const lines = [
    '# MLightCAD Drawing-Graph Entity Capture',
    '',
    `- drawing: \`${markdownCell(drawingName)}\``,
    `- scope: \`${markdownCell(summary.capture_scope)}\``,
    `- source entities: ${summary.source_entity_count}`,
    `- serialized entities: ${summary.indexed_entity_count}`,
    `- failed entities: ${summary.failed_entity_count}`,
    '- semantics: authored entities from the root drawing plus separately parsed and host-namespaced xrefs; block references are not recursively expanded',
    '',
    '## External reference graph',
    '',
    '| alias | status | entities | source |',
    '| --- | --- | ---: | --- |',
    ...xrefs.map((xref) => (
      `| ${markdownCell(xref.alias)} | ${markdownCell(xref.status)} | `
      + `${markdownCell(xref.indexed_entity_count)} | ${markdownCell(xref.source_path)} |`
    )),
    '',
    '## Owner scopes',
    '',
    '| scope | count |',
    '| --- | ---: |',
    ...counterTable(ownerCounts),
    '',
    '## Entity types',
    '',
    '| type | count |',
    '| --- | ---: |',
    ...counterTable(typeCounts),
    '',
    '## Layers (top 300)',
    '',
    '| layer | count |',
    '| --- | ---: |',
    ...counterTable(Object.fromEntries(Object.entries(layerCounts).slice(0, 300))),
    '',
    '## Entity samples (top 200)',
    '',
    '| entity key | type | layer | owner scope | source role | bbox |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const record of records.slice(0, 200)) {
    lines.push(
      `| ${markdownCell(record.entity_key)} | ${markdownCell(record.type)} | `
      + `${markdownCell(record.layer)} | ${markdownCell(record.owner_scope)} | `
      + `${markdownCell(record.source_file_role)} | `
      + `${markdownCell(JSON.stringify(record.bbox ?? null))} |`,
    )
  }
  return `${lines.join('\n')}\n`
}

function namespaceXrefRecord(
  record: EntityRecord,
  spec: XrefSpec,
  localBlockNames: ReadonlySet<string>,
): EntityRecord | null {
  const originalScope = String(record.owner_scope ?? '')
  if (originalScope === 'paper_space') return null
  const originalOwnerName = String(record.owner_block_name ?? '')
  const ownerBlockName = originalScope === 'model_space'
    ? spec.alias
    : `${spec.alias}|${originalOwnerName}`
  const result: EntityRecord = {
    ...record,
    capture_scope: GRAPH_SCOPE,
    owner_scope: 'block_definition',
    owner_block_name: ownerBlockName,
    owner_block_id: originalScope === 'model_space'
      ? spec.hostBlockHandle || record.owner_block_id
      : record.owner_block_id,
    owner_layout_id: null,
    owner_is_xref: originalScope === 'model_space',
    owner_is_unresolved_xref: false,
    owner_xref_path: spec.sourcePath,
    xref_parent_alias: spec.alias,
    xref_original_owner_scope: originalScope,
    xref_original_owner_block_name: originalOwnerName,
    source_file_role: 'external_reference',
    source_file_path: spec.sourcePath,
    source_file_sha256: spec.sha256,
  }
  const layer = String(result.layer ?? '')
  if (layer && layer !== '0') result.layer = `${spec.alias}|${layer}`
  if (result.type === 'block_reference') {
    const name = String(result.name ?? '')
    if (localBlockNames.has(name)) result.name = `${spec.alias}|${name}`
  }
  result.entity_key = `${ownerBlockName}::${String(result.handle ?? '').toUpperCase()}`
  return result
}

function mergeBlockInventory(
  rootInventory: readonly EntityRecord[],
  external: readonly { spec: XrefSpec; capture: ExtractionCapture }[],
): EntityRecord[] {
  const result = rootInventory.map((record) => ({ ...record }))
  for (const { spec, capture } of external) {
    const inventory = Array.isArray(capture.summary.block_inventory)
      ? capture.summary.block_inventory as EntityRecord[]
      : []
    const model = inventory.find((record) => record.owner_scope === 'model_space')
    const host = result.find(
      (record) => String(record.owner_block_name ?? '').toLowerCase() === spec.alias.toLowerCase(),
    )
    if (host && model) {
      Object.assign(host, {
        declared_entity_count: model.declared_entity_count,
        serialized_entity_count: model.serialized_entity_count,
        failed_entity_count: model.failed_entity_count,
        native_owner_is_unresolved_xref: host.owner_is_unresolved_xref,
        owner_is_unresolved_xref: false,
        owner_xref_path: spec.sourcePath,
        graph_resolution_status: 'parsed_separately',
        source_file_sha256: spec.sha256,
      })
    }
    for (const block of inventory.filter((record) => record.owner_scope === 'block_definition')) {
      result.push({
        ...block,
        owner_block_name: `${spec.alias}|${String(block.owner_block_name ?? '')}`,
        owner_xref_path: spec.sourcePath,
        xref_parent_alias: spec.alias,
        graph_resolution_status: 'parsed_separately',
        source_file_sha256: spec.sha256,
      })
    }
  }
  return result
}

async function main(): Promise<void> {
  const temporaryProjectRoot = requireArg('project-root')
  const drawing = requireArg('drawing')
  const sourcePath = requireArg('source-path')
  const sourceSha256 = requireArg('source-sha256')
  const outputDir = requireArg('output-dir')
  const cadDataRoot = requireArg('cad-data-root')
  const frontendRoot = requireArg('frontend-root')
  const xrefMap = JSON.parse(fs.readFileSync(requireArg('xref-map'), 'utf8')) as XrefSpec[]
  const workspaceRoot = path.resolve(frontendRoot, '..', '..')
  const sourceStat = fs.statSync(sourcePath)
  const startedAt = new Date().toISOString()
  const started = performance.now()

  const service = new MLightCadSessionService({
    preloadPath: path.join(frontendRoot, 'dist-electron', 'runtime', 'cad', 'mlight', 'preload.js'),
    rendererHtmlPath: path.join(frontendRoot, 'dist', 'mlight-runtime.html'),
    cadDataRoot,
    timeoutMs: 5 * 60 * 1_000,
    maxSessions: 3,
  })

  const extractOne = async (sourceRelativePath: string): Promise<ExtractionCapture> => {
    const extraction = await service.extract({
      projectRoot: temporaryProjectRoot,
      sourceRelativePath,
      artifactRunId: `run-${crypto.randomUUID()}`,
      filters: {
        includeGeometry: true,
        scope: 'database',
        includeInvisible: true,
        includeDefpoints: true,
      },
    })
    return {
      records: readJsonl(path.join(temporaryProjectRoot, ...extraction.rawPath.split('/'))),
      summary: extraction.summary,
      warnings: extraction.warnings,
    }
  }

  try {
    const rootCapture = await extractOne(drawing)
    const records = rootCapture.records.map((record) => ({
      ...record,
      capture_scope: xrefMap.length > 0 ? GRAPH_SCOPE : ROOT_SCOPE,
      source_file_role: 'root_drawing',
      source_file_path: sourcePath,
      source_file_sha256: sourceSha256,
    }))
    const external: { spec: XrefSpec; capture: ExtractionCapture }[] = []
    const xrefResults: Record<string, unknown>[] = []
    const warnings = [...rootCapture.warnings]
    for (const spec of xrefMap) {
      if (!spec.available || !spec.workspaceRelativePath || !spec.sha256) {
        warnings.push(`external reference ${spec.alias} is unavailable at ${spec.sourcePath}`)
        xrefResults.push({
          alias: spec.alias,
          status: 'missing',
          source_path: spec.sourcePath,
          source_sha256: null,
          indexed_entity_count: 0,
        })
        continue
      }
      const capture = await extractOne(spec.workspaceRelativePath)
      external.push({ spec, capture })
      const inventory = Array.isArray(capture.summary.block_inventory)
        ? capture.summary.block_inventory as EntityRecord[]
        : []
      const localBlockNames = new Set(
        inventory
          .filter((record) => record.owner_scope === 'block_definition')
          .map((record) => String(record.owner_block_name ?? '')),
      )
      const mapped = capture.records
        .map((record) => namespaceXrefRecord(record, spec, localBlockNames))
        .filter((record): record is EntityRecord => record !== null)
      records.push(...mapped)
      warnings.push(...capture.warnings)
      xrefResults.push({
        alias: spec.alias,
        status: 'parsed_separately_and_host_namespaced',
        source_path: spec.sourcePath,
        source_sha256: spec.sha256,
        source_size_bytes: spec.sizeBytes,
        indexed_entity_count: mapped.length,
        autocad_declared_entity_count: spec.autocadDeclaredEntityCount,
        native_mlightcad_summary: capture.summary,
      })
    }

    const rootInventory = Array.isArray(rootCapture.summary.block_inventory)
      ? rootCapture.summary.block_inventory as EntityRecord[]
      : []
    const blockInventory = mergeBlockInventory(rootInventory, external)
    const failedCount = numberFrom(rootCapture.summary, 'failed_entity_count')
      + external.reduce((sum, item) => sum + numberFrom(item.capture.summary, 'failed_entity_count'), 0)
    const omittedGeometryCount = numberFrom(rootCapture.summary, 'omitted_geometry_count')
      + external.reduce((sum, item) => sum + numberFrom(item.capture.summary, 'omitted_geometry_count'), 0)
    const typeCounts = sortedCounter(records, 'type')
    const layerCounts = sortedCounter(records, 'layer')
    const ownerScopeCounts = sortedCounter(records, 'owner_scope')
    const ownerBlockCounts = sortedCounter(records, 'owner_block_name')
    const uniqueWarnings = [...new Set([
      ...warnings,
      ...(external.length > 0
        ? ['MLightCAD does not bind xrefs natively; available xref files were parsed separately and projected into the host namespace.']
        : []),
    ])]
    const summary: Record<string, unknown> = {
      schema_version: SCHEMA_VERSION,
      channel: 'mlightcad',
      capture_scope: xrefMap.length > 0 ? GRAPH_SCOPE : ROOT_SCOPE,
      capture_semantics: xrefMap.length > 0
        ? 'authored entities from the root drawing plus separately parsed and host-namespaced xrefs; block references are not recursively expanded'
        : 'authored database entities; block references are not recursively expanded',
      source_entity_count: records.length + failedCount,
      indexed_entity_count: records.length,
      omitted_geometry_count: omittedGeometryCount,
      failed_entity_count: failedCount,
      root_drawing_indexed_entity_count: rootCapture.records.length,
      external_reference_indexed_entity_count: records.length - rootCapture.records.length,
      block_record_count: blockInventory.length,
      block_inventory: blockInventory,
      owner_scope_counts: ownerScopeCounts,
      owner_block_counts: ownerBlockCounts,
      type_counts: typeCounts,
      layer_counts: layerCounts,
      layer_count: Object.keys(layerCounts).length,
      parse_duration_ms: numberFrom(rootCapture.summary, 'parse_duration_ms')
        + external.reduce((sum, item) => sum + numberFrom(item.capture.summary, 'parse_duration_ms'), 0),
      extract_duration_ms: numberFrom(rootCapture.summary, 'extract_duration_ms')
        + external.reduce((sum, item) => sum + numberFrom(item.capture.summary, 'extract_duration_ms'), 0),
      root_drawing_bytes: sourceStat.size,
      source_graph_bytes: sourceStat.size
        + xrefMap.reduce((sum, item) => sum + Number(item.sizeBytes ?? 0), 0),
      elapsed_ms: Math.round((performance.now() - started) * 10) / 10,
      external_references: xrefResults,
      warnings: uniqueWarnings,
    }
    const packageJson = JSON.parse(fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const sourceGraph = [
      {
        role: 'root_drawing',
        path: sourcePath,
        sha256: sourceSha256,
        size_bytes: sourceStat.size,
        parsed_from_verified_disk_copy: true,
      },
      ...xrefMap.map((spec) => ({
        role: 'external_reference',
        alias: spec.alias,
        path: spec.sourcePath,
        sha256: spec.sha256,
        size_bytes: spec.sizeBytes,
        available: spec.available,
        parsed_from_verified_disk_copy: spec.available,
        host_namespace_projection: spec.available
          ? 'model space -> xref block definition; dependent block/layer names prefixed with alias|'
          : null,
      })),
    ]
    const provenance = {
      schema_version: SCHEMA_VERSION,
      channel: 'mlightcad',
      capture_scope: summary.capture_scope,
      capture_semantics: summary.capture_semantics,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      source: {
        path: sourcePath,
        sha256: sourceSha256,
        size_bytes: sourceStat.size,
        mtime_utc: sourceStat.mtime.toISOString(),
        temporary_copy_sha256: sha256File(path.join(temporaryProjectRoot, drawing)),
        parsed_from_verified_disk_copy: true,
      },
      source_graph: sourceGraph,
      producer: {
        application: 'MLightCAD Electron runtime',
        data_model_version: packageJson.dependencies?.['@mlightcad/data-model'] ?? null,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
        extractor_source: path.join(frontendRoot, 'src', 'mlight-runtime', 'extract.ts'),
        extractor_source_sha256: sha256File(path.join(frontendRoot, 'src', 'mlight-runtime', 'extract.ts')),
        graph_driver_source: path.join(frontendRoot, 'scripts', 'probe', 'mlight-dual-channel-main.ts'),
        graph_driver_source_sha256: sha256File(
          path.join(frontendRoot, 'scripts', 'probe', 'mlight-dual-channel-main.ts'),
        ),
        capture_wrapper_source: path.join(frontendRoot, 'scripts', 'mlight-dual-channel-extract.mjs'),
        capture_wrapper_source_sha256: sha256File(
          path.join(frontendRoot, 'scripts', 'mlight-dual-channel-extract.mjs'),
        ),
        git_revision: gitRevision(workspaceRoot),
      },
      warnings: uniqueWarnings,
    }
    const raw = records.length > 0
      ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
      : ''
    atomicWrite(path.join(outputDir, 'entities.raw.jsonl'), raw)
    atomicWrite(path.join(outputDir, 'entities.readable.md'), renderReadable(drawing, records, summary, xrefResults))
    atomicWrite(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
    atomicWrite(path.join(outputDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({
      ok: true,
      output: outputDir,
      source_entity_count: summary.source_entity_count,
      indexed_entity_count: summary.indexed_entity_count,
      failed_entity_count: summary.failed_entity_count,
      external_references: xrefResults.map((item) => ({
        alias: item.alias,
        status: item.status,
        indexed_entity_count: item.indexed_entity_count,
      })),
    }, null, 2)}\n`)
  } finally {
    await service.dispose()
  }
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    app.exit(1)
  },
)
