import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

import type {
  MLightCadDraftEntity,
  MLightCadExportDxfRuntimeResult,
  MLightCadMutateRuntimeResult,
  MLightCadRenderRuntimeResult,
} from '../../src/shared/mlight-cad-runtime'
import { MLightCadSessionService } from '../../electron/runtime/cad/mlight/mlight-session-service'
import { buildCadDrafterDraftTools } from '../../electron/runtime/agent/tools/domain/cad-drafter/draft-tools'
import { DrafterSession } from '../../electron/runtime/agent/tools/domain/cad-drafter/drafter-session'

interface Check {
  name: string
  ok: boolean
  detail: string
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

function requireArg(name: string): string {
  const value = readArg(name)
  if (!value) throw new Error(`probe requires --${name}=<value>`)
  return value
}

const DRAFT_LAYER = 'XL-PROBE'

/** Placement of the drafted block, in drawing units. */
interface Anchor {
  origin: [number, number]
  scale: number
}

const FIXTURE_ANCHOR: Anchor = { origin: [1_000, 2_000], scale: 1 }

/**
 * One of every shape the drafter can author, laid out in a 400x320 block so the same
 * geometry can be dropped onto any drawing at a size that suits it.
 *
 * On a real sheet a fixed 400-unit block is either a speck or entirely off-page, and a
 * self-check image of geometry floating in empty space proves nothing about whether
 * markup lands where it should.
 */
function draftEntitiesAt(anchor: Anchor): MLightCadDraftEntity[] {
  const at = (x: number, y: number): [number, number] => [
    anchor.origin[0] + x * anchor.scale,
    anchor.origin[1] + y * anchor.scale,
  ]
  const size = (value: number): number => value * anchor.scale
  return [
    { layer: DRAFT_LAYER, shape: { type: 'line', from: at(0, 0), to: at(400, 300) } },
    {
      layer: DRAFT_LAYER,
      shape: { type: 'polyline', points: [at(0, 0), at(400, 0), at(400, 300)], closed: true },
    },
    { layer: DRAFT_LAYER, shape: { type: 'circle', center: at(200, 150), radius: size(80) } },
    {
      layer: DRAFT_LAYER,
      shape: { type: 'arc', center: at(200, 150), radius: size(140), startAngle: 0, endAngle: Math.PI / 2 },
    },
    {
      layer: DRAFT_LAYER,
      shape: { type: 'text', position: at(20, 320), contents: '晓量 XL probe', height: size(35) },
    },
  ]
}

function padExtents(
  extents: { min: [number, number]; max: [number, number] },
  ratio: number,
): { min: [number, number]; max: [number, number] } {
  const padX = (extents.max[0] - extents.min[0]) * ratio
  const padY = (extents.max[1] - extents.min[1]) * ratio
  return {
    min: [extents.min[0] - padX, extents.min[1] - padY],
    max: [extents.max[0] + padX, extents.max[1] + padY],
  }
}

/**
 * Centres the drafted block on the drawing at about a fifth of its short side, which is
 * big enough to read in the self-check image and small enough to sit inside the sheet.
 */
function anchorFromExtents(extents: { min: number[]; max: number[] } | null): Anchor {
  if (!extents) return FIXTURE_ANCHOR
  const width = extents.max[0] - extents.min[0]
  const height = extents.max[1] - extents.min[1]
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return FIXTURE_ANCHOR
  const scale = Math.min(width, height) / 5 / 400
  return {
    origin: [
      extents.min[0] + width / 2 - (400 * scale) / 2,
      extents.min[1] + height / 2 - (300 * scale) / 2,
    ],
    scale,
  }
}

async function run(): Promise<{ checks: Check[]; notes: string[] }> {
  const projectRoot = requireArg('project-root')
  const drawing = requireArg('drawing')
  const outputDir = requireArg('output-dir')
  const cadDataRoot = requireArg('cad-data-root')
  const appPath = path.resolve(__dirname, '..', '..')
  fs.mkdirSync(outputDir, { recursive: true })

  const service = new MLightCadSessionService({
    preloadPath: path.join(appPath, 'dist-electron', 'runtime', 'cad', 'mlight', 'preload.js'),
    rendererHtmlPath: path.join(appPath, 'dist', 'mlight-runtime.html'),
    cadDataRoot,
    timeoutMs: 5 * 60 * 1_000,
  })

  const checks: Check[] = []
  const notes: string[] = []
  const record = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail })
  }

  try {
    const before = await service.documentInfo({ projectRoot, sourceRelativePath: drawing })
    // Anchoring on raw extents would park the drafted block in the empty space between the
    // sheet and whatever stray entity stretched the bounds.
    const frame = before.contentExtents ?? before.extents
    const anchor = anchorFromExtents(frame)
    const draftEntities = draftEntitiesAt(anchor)
    notes.push(
      `drawing has ${before.entityCount} entities on ${before.layerCount} layers, extents `
      + `${JSON.stringify(before.extents)}, content extents ${JSON.stringify(before.contentExtents)}`
      + `; drafting at ${JSON.stringify(anchor)}`,
    )
    if (before.fontsNotFound.length > 0) {
      notes.push(`fonts not found: ${before.fontsNotFound.join(', ')}`)
    }

    // Saved for every run: without it there is no way to tell an empty self-check window
    // apart from a drawing that failed to parse into anything visible.
    const overview = await service.render({ projectRoot, sourceRelativePath: drawing, longSide: 2_048 })
    fs.writeFileSync(path.join(outputDir, 'full-extents.png'), Buffer.from(overview.pngBase64, 'base64'))

    const { mutation, render, exported } = await service.withPrivateSession(
      { projectRoot, sourceRelativePath: drawing },
      async (session) => {
        const mutateStarted = performance.now()
        const mutation = await session.send({
          kind: 'mutate',
          layers: [{ name: DRAFT_LAYER, colorIndex: 1 }],
          entities: draftEntities,
        }) as MLightCadMutateRuntimeResult
        notes.push(`mutate took ${Math.round(performance.now() - mutateStarted)} ms`)

        // Renders read the scene graph, not the database, so this is the check that the
        // appended entities actually reached the renderer. The window is widened well past
        // the markup so the surrounding drawing is visible and misplacement is obvious.
        const render = await session.send({
          kind: 'render',
          longSide: 1_536,
          ...(mutation.addedExtents ? { window: padExtents(mutation.addedExtents, 1.5) } : {}),
        }) as MLightCadRenderRuntimeResult

        const exported = await session.send({ kind: 'export_dxf' }) as MLightCadExportDxfRuntimeResult
        return { mutation, render, exported }
      },
    )

    record(
      'mutate reports one new layer and one handle per entity',
      mutation.createdLayers.length === 1
        && mutation.createdHandles.length === draftEntities.length
        && new Set(mutation.createdHandles).size === draftEntities.length,
      `layers=${JSON.stringify(mutation.createdLayers)}, handles=${JSON.stringify(mutation.createdHandles)}`,
    )
    record(
      'mutate measures the extents of what it added',
      mutation.addedExtents !== null,
      JSON.stringify(mutation.addedExtents),
    )
    fs.writeFileSync(path.join(outputDir, 'draft-selfcheck.png'), Buffer.from(render.pngBase64, 'base64'))
    record(
      'the added entities render (they reached the scene graph)',
      render.width > 0 && render.height > 0,
      `${render.width}x${render.height}, see draft-selfcheck.png`,
    )

    const exportedBytes = Buffer.from(exported.dxfBase64, 'base64')
    const exportName = 'drafted.dxf'
    fs.writeFileSync(path.join(outputDir, exportName), exportedBytes)
    fs.writeFileSync(path.join(projectRoot, exportName), exportedBytes)

    const after = await service.documentInfo({ projectRoot, sourceRelativePath: exportName })
    // A raw entity count is the wrong assertion: exporting a drawing with paper-space
    // layouts materialises viewport records that the DWG parse never surfaced, so the
    // total legitimately moves. What must hold is that no drawing content changed and the
    // drafted shapes arrived, which is a per-type comparison.
    const drift = await typeCountDrift(service, projectRoot, drawing, exportName)
    const expected = expectedDrift(draftEntities)
    const mismatched = [...new Set([...Object.keys(drift), ...Object.keys(expected)])]
      .filter((type) => type !== 'viewport' && (drift[type] ?? 0) !== (expected[type] ?? 0))
    record(
      'the export preserves every original entity and adds exactly the drafted ones',
      mismatched.length === 0,
      `${before.entityCount} before, ${after.entityCount} after; per-type change ${JSON.stringify(drift)}`
      + (mismatched.length ? `; unaccounted for: ${mismatched.join(', ')}` : ''),
    )

    const layers = await service.layers({ projectRoot, sourceRelativePath: exportName })
    const draftLayer = layers.layers.find((layer) => layer.name === DRAFT_LAYER)
    record(
      'the drafted layer survives the round trip with its entities on it',
      draftLayer?.entityCount === draftEntities.length,
      draftLayer ? `${DRAFT_LAYER} carries ${draftLayer.entityCount} entities` : `${DRAFT_LAYER} is missing`,
    )

    const extraction = await service.extract({
      projectRoot,
      sourceRelativePath: exportName,
      artifactRunId: `run-${crypto.randomUUID()}`,
      filters: { includeGeometry: true, layers: [DRAFT_LAYER] },
    })
    const rows = fs
      .readFileSync(path.join(projectRoot, ...extraction.rawPath.split('/')), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((row) => JSON.parse(row) as Record<string, unknown>)
    fs.writeFileSync(
      path.join(outputDir, 'drafted-entities.json'),
      `${JSON.stringify(rows, null, 2)}\n`,
      'utf8',
    )
    const types = rows.map((row) => String(row.type)).sort()
    record(
      'every drafted shape is readable back as its own entity type',
      rows.length === draftEntities.length,
      `types=${JSON.stringify(types)}`,
    )
    // Tolerance scales with the drawing: on a metre-scale sheet the block is small, and
    // absolute micron equality would be testing float formatting rather than fidelity.
    const tolerance = Math.max(1e-6, anchor.scale * 1e-3)
    const expectedCircle = draftEntitiesAt(anchor)[2]?.shape as { center: [number, number]; radius: number }
    const expectedText = draftEntitiesAt(anchor)[4]?.shape as { height: number }
    const circle = rows.find((row) => row.type === 'circle')
    const circleRadius = circle?.radius
    const circleCenter = circle?.center as number[] | undefined
    record(
      'geometry survives with usable precision',
      typeof circleRadius === 'number'
        && Math.abs(circleRadius - expectedCircle.radius) < tolerance
        && Math.abs((circleCenter?.[0] ?? 0) - expectedCircle.center[0]) < tolerance
        && Math.abs((circleCenter?.[1] ?? 0) - expectedCircle.center[1]) < tolerance,
      `circle read back at ${JSON.stringify(circleCenter)} r=${String(circleRadius)}`
      + ` (drew ${JSON.stringify(expectedCircle.center)} r=${expectedCircle.radius})`,
    )
    const text = rows.find((row) => row.type === 'mtext' || row.type === 'text')
    record(
      'non-ASCII annotation text survives the round trip',
      typeof text?.content === 'string'
        && text.content === '晓量 XL probe'
        && typeof text.height === 'number'
        && Math.abs(text.height - expectedText.height) < tolerance,
      `text read back as ${JSON.stringify(text?.content ?? null)} at height ${String(text?.height)}`,
    )

    // The point of the private session: the source file on disk is untouched.
    const sourceInfo = await service.documentInfo({ projectRoot, sourceRelativePath: drawing })
    record(
      'the source drawing is unchanged after drafting against it',
      sourceInfo.entityCount === before.entityCount && sourceInfo.layerCount === before.layerCount,
      `${sourceInfo.entityCount} entities, ${sourceInfo.layerCount} layers`,
    )

    // Everything above exercised the runtime protocol. The rest drives the drafter's own
    // tools against the same service, which is the path a child agent actually takes.
    const toolResults = await runDraftTools({
      projectRoot,
      drawing,
      service,
      record,
      draftEntities,
      expectedEntityCount: after.entityCount,
    })

    fs.writeFileSync(
      path.join(outputDir, 'write-report.json'),
      `${JSON.stringify({
        electron: process.versions.electron,
        drawing,
        checks,
        notes,
        exportedBytes: exportedBytes.length,
        mutation,
        tools: toolResults,
      }, null, 2)}\n`,
      'utf8',
    )
    return { checks, notes }
  } finally {
    await service.dispose()
  }
}

/** The entity types each drafted shape should add, as the extractor names them. */
const DRAFT_SHAPE_TYPES: Record<MLightCadDraftEntity['shape']['type'], string> = {
  line: 'line',
  polyline: 'lwpolyline',
  circle: 'circle',
  arc: 'arc',
  text: 'mtext',
}

function expectedDrift(draftEntities: readonly MLightCadDraftEntity[]): Record<string, number> {
  const added: Record<string, number> = {}
  for (const entity of draftEntities) {
    const type = DRAFT_SHAPE_TYPES[entity.shape.type]
    added[type] = (added[type] ?? 0) + 1
  }
  return added
}

/** Per-type entity count change across the DWG-parse to DXF-write round trip. */
async function typeCountDrift(
  service: MLightCadSessionService,
  projectRoot: string,
  sourceRelativePath: string,
  exportRelativePath: string,
): Promise<Record<string, number>> {
  const counts = async (target: string): Promise<Record<string, number>> => (
    await service.extract({
      projectRoot,
      sourceRelativePath: target,
      artifactRunId: `run-${crypto.randomUUID()}`,
      filters: { includeGeometry: false },
    })
  ).summary.type_counts
  const [sourceCounts, exportCounts] = await Promise.all([counts(sourceRelativePath), counts(exportRelativePath)])
  const drift: Record<string, number> = {}
  for (const type of new Set([...Object.keys(sourceCounts), ...Object.keys(exportCounts)])) {
    const delta = (exportCounts[type] ?? 0) - (sourceCounts[type] ?? 0)
    if (delta !== 0) drift[type] = delta
  }
  return drift
}

/**
 * Runs `cad_draft` twice through the real tool surface: once over the fixture drawing, and
 * once with no base at all, which is the only exercise of the bundled blank template.
 */
async function runDraftTools(input: {
  projectRoot: string
  drawing: string
  service: MLightCadSessionService
  record: (name: string, ok: boolean, detail: string) => void
  draftEntities: MLightCadDraftEntity[]
  expectedEntityCount: number
}): Promise<Record<string, unknown>> {
  const { projectRoot, drawing, service, record, draftEntities, expectedEntityCount } = input
  const session = new DrafterSession(projectRoot, 'child-probe-0000abcd')
  const tools = buildCadDrafterDraftTools({ session, drafter: service })
  const cadDraft = tools.find((tool) => tool.name === 'cad_draft')
  if (!cadDraft) throw new Error('cad_draft is missing from the drafter tool set')

  const readData = async (toolCallId: string, parameters: Record<string, unknown>) => {
    const result = await cadDraft.execute(toolCallId, parameters)
    return JSON.parse(result.content[0]?.text ?? '{}').data as Record<string, any>
  }

  const markup = await readData('probe-markup', {
    name: 'probe-markup',
    base_path: drawing,
    layers: [{ name: 'XL-TOOL', color_index: 3 }],
    entities: draftEntities.map((entity) => ({
      layer: 'XL-TOOL',
      shape: toToolShape(entity.shape),
    })),
  })
  const markupInfo = await service.documentInfo({
    projectRoot,
    sourceRelativePath: markup.output_path as string,
  })
  record(
    'cad_draft writes a markup file to the output root that matches the runtime export',
    typeof markup.output_path === 'string'
      && markup.output_path.startsWith('xiaoliang-outputs/cad/')
      && markupInfo.entityCount === expectedEntityCount,
    `${markup.output_path} holds ${markupInfo.entityCount} entities (runtime export held ${expectedEntityCount})`,
  )
  record(
    'cad_draft returns a self-check image on disk',
    typeof markup.image_path === 'string'
      && fs.existsSync(path.join(projectRoot, ...(markup.image_path as string).split('/'))),
    String(markup.image_path),
  )

  const scratch = await readData('probe-scratch', {
    name: 'probe-scratch',
    layers: [{ name: 'XL-TOOL', color_index: 5 }],
    entities: draftEntities.map((entity) => ({
      layer: 'XL-TOOL',
      shape: toToolShape(entity.shape),
    })),
  })
  const scratchInfo = await service.documentInfo({
    projectRoot,
    sourceRelativePath: scratch.output_path as string,
  })
  record(
    'cad_draft authors a drawing from the bundled blank template',
    scratchInfo.entityCount === draftEntities.length,
    `${scratch.output_path} holds ${scratchInfo.entityCount} entities (drew ${draftEntities.length})`,
  )

  return { markup, scratch }
}

/** The runtime uses camelCase; the tool schema the model sees uses snake_case. */
function toToolShape(shape: MLightCadDraftEntity['shape']): Record<string, unknown> {
  if (shape.type === 'arc') {
    return {
      type: 'arc',
      center: shape.center,
      radius: shape.radius,
      start_angle: shape.startAngle,
      end_angle: shape.endAngle,
    }
  }
  return { ...shape }
}

app.whenReady().then(run).then(
  ({ checks, notes }) => {
    process.stdout.write(`${JSON.stringify({ checks, notes }, null, 2)}\n`)
    app.exit(checks.every((check) => check.ok) ? 0 : 2)
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    app.exit(1)
  },
)
