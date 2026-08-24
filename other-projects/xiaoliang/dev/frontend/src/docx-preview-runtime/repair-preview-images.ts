const MAX_REPAIR_BYTES = 12 * 1024 * 1024
const SAFE_RASTER_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
])

export function sniffRasterImageMime(bytes: Uint8Array) {
  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 6
    && bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39)
    && bytes[5] === 0x61
  ) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp'
  }
  return null
}

export function isSafeRasterImageDataUrl(value: string) {
  const match = value.trim().match(/^data:(image\/[a-z0-9.+-]+);base64,/i)
  if (!match) return false
  return SAFE_RASTER_MIME.has(match[1].toLowerCase())
}

export function repairImageDataUrl(value: string) {
  const trimmed = value.trim()
  const match = trimmed.match(/^data:([^;,]*?)((?:;[^,]*)*),([\s\S]*)$/i)
  if (!match || !/;base64/i.test(match[2] || '')) return null
  const payload = match[3].replace(/\s+/g, '')
  if (!payload) return null
  let binary: string
  try {
    binary = atob(payload)
  } catch {
    return null
  }
  if (binary.length === 0 || binary.length > MAX_REPAIR_BYTES) return null
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  const mime = sniffRasterImageMime(bytes)
  if (!mime) return null
  return `data:${mime};base64,${payload}`
}

export function repairCssImageDataUrls(css: string) {
  return css.replace(/url\(\s*(['"]?)(data:[\s\S]*?)\1\s*\)/gi, (full, quote: string, url: string) => {
    const repaired = repairImageDataUrl(url)
    return repaired ? `url(${quote}${repaired}${quote})` : full
  })
}

function isEmbeddedImageElement(node: Element) {
  return node instanceof HTMLImageElement || node.localName === 'image'
}

export function repairPreviewImages(container: HTMLElement) {
  container.querySelectorAll('style').forEach((style) => {
    const next = repairCssImageDataUrls(style.textContent || '')
    if (next !== style.textContent) style.textContent = next
  })

  container.querySelectorAll('*').forEach((node) => {
    const style = node.getAttribute('style')
    if (style) {
      const next = repairCssImageDataUrls(style)
      if (next !== style) node.setAttribute('style', next)
    }
    if (!isEmbeddedImageElement(node)) return
    for (const name of ['src', 'href', 'xlink:href']) {
      const current = node.getAttribute(name)
      if (!current) continue
      const repaired = repairImageDataUrl(current)
      if (repaired) node.setAttribute(name, repaired)
    }
  })
}

export function cssHasUnsafeReference(value: string) {
  if (/@import|expression\s*\(|behavior\s*:|-moz-binding/i.test(value)) return true
  for (const match of value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!/^data:/i.test(match[2].trim())) return true
  }
  return false
}

export function replaceMissingImages(container: HTMLElement) {
  container.querySelectorAll('img, image').forEach((node) => {
    const src = node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('xlink:href') || ''
    if (isSafeRasterImageDataUrl(src)) return
    const placeholder = container.ownerDocument.createElement('span')
    placeholder.className = 'docx-image-missing'
    placeholder.setAttribute('role', 'img')
    placeholder.setAttribute('aria-label', '文档未嵌入该图片')
    placeholder.textContent = '图片未嵌入'
    node.replaceWith(placeholder)
  })
}

export function sanitizeRenderedDocument(container: HTMLElement) {
  container.querySelectorAll([
    'script',
    'iframe',
    'frame',
    'object',
    'embed',
    'link',
    'meta',
    'base',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'video',
    'audio',
    'source',
    'foreignObject',
  ].join(',')).forEach((node) => node.remove())

  container.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (/^on/i.test(name) || ['srcset', 'action', 'formaction', 'target'].includes(name)) {
        node.removeAttribute(attribute.name)
        continue
      }
      if (['src', 'href', 'xlink:href'].includes(name)) {
        const safeFragment = value.startsWith('#')
        const safeRasterImage = isEmbeddedImageElement(node) && isSafeRasterImageDataUrl(value)
        if (!(safeFragment || safeRasterImage)) {
          node.removeAttribute(attribute.name)
        }
        continue
      }
      if (name === 'style' && cssHasUnsafeReference(value)) {
        node.removeAttribute(attribute.name)
      }
    }
    if (node instanceof HTMLAnchorElement) node.removeAttribute('href')
  })

  container.querySelectorAll('style').forEach((style) => {
    if (cssHasUnsafeReference(style.textContent || '')) style.remove()
  })
}
