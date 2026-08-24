export interface PdfExtraction {
  title: string
  markdown: string
  pageCount: number
  extractedPages: number
}

const MAX_PDF_PAGES = 400

interface PdfTextItem {
  str?: unknown
  transform?: unknown
  hasEOL?: unknown
}

function itemText(item: PdfTextItem): string {
  return typeof item.str === 'string' ? item.str : ''
}

function itemY(item: PdfTextItem): number | null {
  const transform = item.transform
  if (!Array.isArray(transform) || transform.length < 6) return null
  const value = transform[5]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Rebuilds visual lines from positioned glyph runs.
 *
 * pdf.js hands back text in drawing order with no line structure, so a clause table read
 * naively comes out as one run-on paragraph. Grouping by baseline keeps rows apart, which
 * is the difference between a readable clause and an unreadable smear.
 */
function itemsToLines(items: PdfTextItem[]): string[] {
  const lines: string[] = []
  let currentY: number | null = null
  let buffer = ''

  const flush = (): void => {
    const text = buffer.replace(/[ \t]{2,}/gu, '  ').trimEnd()
    if (text.trim()) lines.push(text)
    buffer = ''
  }

  for (const item of items) {
    const text = itemText(item)
    const y = itemY(item)
    if (currentY !== null && y !== null && Math.abs(y - currentY) > 1.5) {
      flush()
    }
    if (y !== null) currentY = y
    buffer += text
    if (item.hasEOL === true) flush()
  }
  flush()
  return lines
}

let loaderPromise: Promise<any> | null = null

async function loadPdfjs(): Promise<any> {
  if (!loaderPromise) {
    // The legacy build is the one that runs outside a browser worker; the modern entry
    // assumes DOM APIs that the Electron main process does not provide.
    loaderPromise = import('pdfjs-dist/legacy/build/pdf.mjs').catch((error) => {
      loaderPromise = null
      throw error
    })
  }
  return loaderPromise
}

export async function extractPdfDocument(
  data: Buffer,
  options: { maxPages?: number } = {},
): Promise<PdfExtraction> {
  const pdfjs = await loadPdfjs()
  const maxPages = Math.max(1, Math.min(options.maxPages ?? MAX_PDF_PAGES, MAX_PDF_PAGES))
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  })

  let document: any
  try {
    document = await task.promise
  } catch (error) {
    throw new Error(`PDF 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const pageCount = Number(document.numPages) || 0
    const extractedPages = Math.min(pageCount, maxPages)
    const sections: string[] = []
    for (let pageNumber = 1; pageNumber <= extractedPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const lines = itemsToLines(Array.isArray(content?.items) ? content.items : [])
        sections.push([`## 第 ${pageNumber} 页`, '', ...lines].join('\n'))
      } finally {
        page.cleanup?.()
      }
    }

    let title = ''
    try {
      const metadata = await document.getMetadata()
      const raw = metadata?.info?.Title
      if (typeof raw === 'string') title = raw.trim().slice(0, 300)
    } catch {
      // Metadata is optional; the stored front-matter falls back to the URL.
    }

    const truncationNotice = pageCount > extractedPages
      ? [`\n> 该 PDF 共 ${pageCount} 页，本次只提取了前 ${extractedPages} 页。`]
      : []

    return {
      title,
      markdown: [...sections, ...truncationNotice].join('\n\n').trim(),
      pageCount,
      extractedPages,
    }
  } finally {
    await document.destroy?.().catch?.(() => undefined)
  }
}
