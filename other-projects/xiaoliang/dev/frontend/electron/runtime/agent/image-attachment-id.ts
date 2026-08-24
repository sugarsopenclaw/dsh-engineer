import { createHash } from 'node:crypto'

interface ImageAttachmentIdentityInput {
  id?: unknown
  data: string
  mimeType: string
}

export function stableImageAttachmentId(input: ImageAttachmentIdentityInput): string {
  const existingId = typeof input.id === 'string' ? input.id.trim() : ''
  if (existingId && existingId.length <= 128) return existingId

  const digest = createHash('sha256')
    .update(input.mimeType.trim().toLowerCase())
    .update('\0')
    .update(input.data)
    .digest('hex')
  return `image-sha256:${digest}`
}
