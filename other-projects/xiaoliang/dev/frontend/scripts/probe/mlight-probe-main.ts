import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

import { MLightCadSessionService } from '../../electron/runtime/cad/mlight/mlight-session-service'

interface Timing {
  step: string
  durationMs: number
  detail: string
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`
  const match = process.argv.find((argument) => argument.startsWith(prefix))
  return match?.slice(prefix.length)
}

function requireArg(name: string): string {
  const value = readArg(name)
  if (!value) throw new Error(`probe requires --${name}=<value>`)
  return value
}

async function measure<T>(
  timings: Timing[],
  step: string,
  run: () => Promise<T>,
  describe: (value: T) => string,
): Promise<T> {
  const started = performance.now()
  const value = await run()
  timings.push({
    step,
    durationMs: Math.round(performance.now() - started),
    detail: describe(value),
  })
  return value
}

function writePng(outputDir: string, name: string, base64: string): number {
  const bytes = Buffer.from(base64, 'base64')
  fs.writeFileSync(path.join(outputDir, name), bytes)
  return bytes.length
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

async function main(): Promise<void> {
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

  const timings: Timing[] = []
  const notes: string[] = []
  try {
    const info = await measure(
      timings,
      'document_info (cold: window boot + font chain + parse)',
      () => service.documentInfo({ projectRoot, sourceRelativePath: drawing }),
      (value) => `${value.entityCount} entities, ${value.layerCount} layers, `
        + `extents ${value.extents ? JSON.stringify(value.extents) : 'none'}`,
    )
    if (info.fontsNotFound.length > 0) {
      notes.push(`Fonts reported missing: ${info.fontsNotFound.join(', ')}`)
    }

    await measure(
      timings,
      'document_info (warm: same session reused)',
      () => service.documentInfo({ projectRoot, sourceRelativePath: drawing }),
      (value) => `${value.entityCount} entities`,
    )

    const layers = await measure(
      timings,
      'layers',
      () => service.layers({ projectRoot, sourceRelativePath: drawing }),
      (value) => value.layers.map((layer) => `${layer.name}(${layer.entityCount})`).join(', '),
    )

    const fullRender = await measure(
      timings,
      'render full extents @2048',
      () => service.render({ projectRoot, sourceRelativePath: drawing, longSide: 2_048 }),
      (value) => `${value.width}x${value.height}`,
    )
    const fullBytes = writePng(outputDir, 'render-full-2048.png', fullRender.pngBase64)
    timings[timings.length - 1].detail += `, ${formatBytes(fullBytes)}`

    if (info.extents) {
      const [minX, minY] = info.extents.min
      const [maxX, maxY] = info.extents.max
      const quadrant = {
        min: [minX, minY] as [number, number],
        max: [minX + (maxX - minX) / 2, minY + (maxY - minY) / 2] as [number, number],
      }
      const windowed = await measure(
        timings,
        'render lower-left quadrant @1536',
        () => service.render({
          projectRoot,
          sourceRelativePath: drawing,
          longSide: 1_536,
          window: quadrant,
        }),
        (value) => `${value.width}x${value.height}`,
      )
      const windowedBytes = writePng(outputDir, 'render-quadrant-1536.png', windowed.pngBase64)
      timings[timings.length - 1].detail += `, ${formatBytes(windowedBytes)}`
    }

    const textLayer = layers.layers.find((layer) => layer.entityCount > 0 && layer.name !== '0')
    if (textLayer) {
      const isolated = await measure(
        timings,
        `render layer isolation (${textLayer.name}) @1536`,
        () => service.render({
          projectRoot,
          sourceRelativePath: drawing,
          longSide: 1_536,
          isolateLayers: [textLayer.name],
        }),
        (value) => `${value.width}x${value.height}, warnings=${value.warnings.length}`,
      )
      writePng(outputDir, `render-layer-${textLayer.name}.png`, isolated.pngBase64)
    }

    const extraction = await measure(
      timings,
      'extract (separate font-free session)',
      () => service.extract({
        projectRoot,
        sourceRelativePath: drawing,
        artifactRunId: `run-${crypto.randomUUID()}`,
        filters: { includeGeometry: true },
      }),
      (value) => `${JSON.stringify(value.summary.indexed_entity_count)} indexed entities`,
    )

    const handles = fs
      .readFileSync(path.join(projectRoot, ...extraction.rawPath.split('/')), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((row) => JSON.parse(row) as { handle?: string; type?: string; layer?: string })
    const previewGroups = [
      {
        id: 'all-circles',
        handles: handles.filter((row) => row.type === 'circle').map((row) => row.handle ?? ''),
      },
      {
        id: 'all-text',
        handles: handles
          .filter((row) => row.type === 'text' || row.type === 'mtext')
          .map((row) => row.handle ?? ''),
      },
    ].filter((group) => group.handles.length > 0)

    if (previewGroups.length > 0) {
      const previews = await measure(
        timings,
        `entity_preview (${previewGroups.length} groups, ${previewGroups.reduce((sum, group) => sum + group.handles.length, 0)} handles) @1024`,
        () => service.entityPreview({
          projectRoot,
          sourceRelativePath: drawing,
          groups: previewGroups,
          longSide: 1_024,
        }),
        (value) => `${value.images.length} images, ${value.missingGroupIds.length} missing`,
      )
      for (const image of previews.images) {
        writePng(outputDir, `preview-${image.id}.png`, image.pngBase64)
      }
      if (previews.warnings.length > 0) notes.push(...previews.warnings)
    } else {
      notes.push('No previewable entity groups were found in the extraction output.')
    }

    const exported = await measure(
      timings,
      'export_dxf',
      () => service.exportDxf({ projectRoot, sourceRelativePath: drawing }),
      (value) => formatBytes(value.byteLength),
    )
    const exportedBytes = Buffer.from(exported.dxfBase64, 'base64')
    fs.writeFileSync(path.join(outputDir, 'export.dxf'), exportedBytes)

    const roundTripName = 'roundtrip.dxf'
    fs.writeFileSync(path.join(projectRoot, roundTripName), exportedBytes)
    const roundTrip = await measure(
      timings,
      'round-trip: reopen exported DXF',
      () => service.documentInfo({ projectRoot, sourceRelativePath: roundTripName }),
      (value) => `${value.entityCount} entities, ${value.layerCount} layers, `
        + `extents ${value.extents ? JSON.stringify(value.extents) : 'none'}`,
    )
    if (roundTrip.entityCount !== info.entityCount) {
      notes.push(
        `Round-trip entity count drifted: ${info.entityCount} in, ${roundTrip.entityCount} out.`,
      )
    }
    if (JSON.stringify(roundTrip.extents) !== JSON.stringify(info.extents)) {
      notes.push(
        `Round-trip extents drifted: ${JSON.stringify(info.extents)} in, `
        + `${JSON.stringify(roundTrip.extents)} out.`,
      )
    }
    const roundTripRender = await service.render({
      projectRoot,
      sourceRelativePath: roundTripName,
      longSide: 2_048,
    })
    writePng(outputDir, 'roundtrip-full-2048.png', roundTripRender.pngBase64)

    fs.writeFileSync(
      path.join(outputDir, 'report.json'),
      `${JSON.stringify({
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        drawing,
        timings,
        notes,
        layers: layers.layers,
        documentInfo: info,
      }, null, 2)}\n`,
      'utf8',
    )
    process.stdout.write(`${JSON.stringify({ ok: true, timings, notes }, null, 2)}\n`)
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
