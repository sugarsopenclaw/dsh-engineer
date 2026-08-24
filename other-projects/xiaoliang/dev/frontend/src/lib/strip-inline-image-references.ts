import {
  normalizeImageAttachmentPayload,
  type ImageAttachment,
} from '@/shared/local-agent'

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)]*)\)/g
const HTML_IMAGE_PATTERN = /<img\b[^>]*>/gi
const HTML_IMAGE_SOURCE_PATTERN = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

function extractMarkdownImageSource(destination: string): string {
  const value = destination.trim()
  if (value.startsWith('<')) {
    const closingBracket = value.indexOf('>')
    if (closingBracket > 0) return value.slice(1, closingBracket)
  }
  return value.split(/\s+/, 1)[0] ?? ''
}

function matchesAttachmentDataUrl(
  source: string,
  attachments: readonly ImageAttachment[],
): boolean {
  if (!source.toLowerCase().startsWith('data:image/')) return false
  const payload = normalizeImageAttachmentPayload(source, 'image/png')
  if (!payload) return false

  return attachments.some((attachment) => (
    attachment.mimeType.toLowerCase() === payload.mimeType.toLowerCase()
    && attachment.data === payload.data
  ))
}

/** Remove only inline data images that are already rendered as message evidence. */
export function stripInlineImageReferences(
  text: string,
  attachments: readonly ImageAttachment[],
): string {
  if (!text || attachments.length === 0) return text

  return text
    .replace(MARKDOWN_IMAGE_PATTERN, (reference, destination: string) => (
      matchesAttachmentDataUrl(extractMarkdownImageSource(destination), attachments)
        ? ''
        : reference
    ))
    .replace(HTML_IMAGE_PATTERN, (tag) => {
      const sourceMatch = HTML_IMAGE_SOURCE_PATTERN.exec(tag)
      const source = sourceMatch?.[1] ?? sourceMatch?.[2] ?? sourceMatch?.[3] ?? ''
      return matchesAttachmentDataUrl(source, attachments) ? '' : tag
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
