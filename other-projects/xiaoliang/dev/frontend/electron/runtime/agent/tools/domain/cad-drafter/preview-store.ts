import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  CAD_PREVIEWS_ROOT,
  drawingArtifactKey,
  resolveProjectFile,
} from '../cad-subagent/artifact-store'
import { CAD_VISUAL_MAX_IMAGE_BYTES } from '../cad-subagent/visual-contract'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function slug(value: string | undefined, fallback: string): string {
  const normalized = (value ?? '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return normalized.slice(0, 48) || fallback
}

/**
 * Writes a render into the drawing's preview tree and returns its project-relative path.
 *
 * Previews live beside the COM plots under `.xiaoliang/cad/previews/` so the evidence
 * image allowlist and `cad_artifacts` see them without special-casing the engine, but in
 * their own `mlight/` subdirectory so a reviewer can tell which engine drew them.
 */
export async function writePreviewPng(input: {
  projectRoot: string
  drawingName: string
  drawingPath: string
  fileNamePrefix: string
  pngBase64: string
}): Promise<{ relativePath: string; byteLength: number }> {
  const bytes = Buffer.from(input.pngBase64, 'base64')
  if (bytes.byteLength === 0) throw new Error('The renderer returned an empty image.')
  if (bytes.byteLength > CAD_VISUAL_MAX_IMAGE_BYTES) {
    throw new Error('The renderer returned an image larger than the supported limit.')
  }
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('The renderer returned a file that is not a PNG.')
  }
  const artifactKey = drawingArtifactKey(input.drawingName, input.drawingPath)
  const fileName = `${slug(input.fileNamePrefix, 'image')}-${randomUUID().slice(0, 8)}.png`
  const relativePath = `${CAD_PREVIEWS_ROOT}/${artifactKey}/mlight/${fileName}`
  const target = resolveProjectFile(input.projectRoot, relativePath, { mustExist: false })
  await fs.promises.mkdir(path.dirname(target.absolutePath), { recursive: true })
  const temporaryPath = `${target.absolutePath}.${randomUUID()}.part`
  try {
    await fs.promises.writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 })
    await fs.promises.rename(temporaryPath, target.absolutePath)
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
  return { relativePath: target.relativePath, byteLength: bytes.byteLength }
}
