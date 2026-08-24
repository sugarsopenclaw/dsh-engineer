import type { MLightCadExportDxfRuntimeResult } from '../../../../src/shared/mlight-cad-runtime'

const DXF_2007_VERSION = 'AC1021'
const ACADVER_PATTERN = /(\r?\n9\r?\n\$ACADVER\r?\n1\r?\n)(AC\d{4})(?=\r?\n)/u

function decodeBase64(result: MLightCadExportDxfRuntimeResult): Buffer {
  const bytes = Buffer.from(result.dxfBase64, 'base64')
  if (bytes.byteLength === 0 || bytes.byteLength !== result.byteLength) {
    throw new Error('MLightCAD returned an invalid DXF byte length.')
  }
  return bytes
}

/**
 * MLightCAD's `dxfOut` returns a JavaScript string. TextEncoder therefore emits UTF-8,
 * but old source drawings can retain a pre-2007 `$ACADVER`; DXF readers then decode the
 * same bytes as an ANSI code page and can manufacture unpaired surrogate characters.
 *
 * Advertising AC1021 is the DXF-defined way to state that text is UTF-8. Entity tags are
 * unchanged, and ASCII-only exports remain byte-for-byte identical.
 */
export function normalizeMlightDxfEncoding(
  result: MLightCadExportDxfRuntimeResult,
): MLightCadExportDxfRuntimeResult {
  const bytes = decodeBase64(result)
  if (!bytes.some((value) => value > 0x7f)) return result

  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('MLightCAD exported non-ASCII DXF bytes that are not valid UTF-8.')
  }
  const match = ACADVER_PATTERN.exec(content)
  if (!match) {
    throw new Error('MLightCAD exported Unicode DXF text without a valid $ACADVER header.')
  }
  const sourceVersion = match[2]
  if (sourceVersion >= DXF_2007_VERSION) return result

  const normalized = content.replace(
    ACADVER_PATTERN,
    `$1${DXF_2007_VERSION}`,
  )
  const normalizedBytes = Buffer.from(normalized, 'utf8')
  return {
    ...result,
    dxfBase64: normalizedBytes.toString('base64'),
    byteLength: normalizedBytes.byteLength,
    warnings: [
      ...result.warnings,
      `MLightCAD emitted UTF-8 text with ${sourceVersion}; advertised ${DXF_2007_VERSION} so downstream DXF readers decode Unicode deterministically.`,
    ],
  }
}
