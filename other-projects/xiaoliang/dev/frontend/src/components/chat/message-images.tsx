import { memo, useId, useRef, useState, type ComponentProps } from 'react'
import { Maximize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  imageAttachmentToDataUrl,
  type ImageAttachment,
} from '@/shared/local-agent'

export interface MessageImagesProps extends Omit<ComponentProps<'div'>, 'children'> {
  attachments: readonly ImageAttachment[]
  tone?: 'assistant' | 'user'
}

interface ImagePreview {
  attachment: ImageAttachment
  label: string
}

export const MessageImages = memo(function MessageImages({
  attachments,
  tone = 'assistant',
  className,
  'aria-label': ariaLabel,
  ...props
}: MessageImagesProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogTitleId = useId()
  const [preview, setPreview] = useState<ImagePreview | null>(null)

  if (attachments.length === 0) return null

  const openPreview = (attachment: ImageAttachment, label: string) => {
    setPreview({ attachment, label })
    if (!dialogRef.current?.open) dialogRef.current?.showModal()
  }

  const closePreview = () => dialogRef.current?.close()

  return (
    <>
      <div
        role="list"
        aria-label={ariaLabel ?? (tone === 'assistant' ? '回复图片证据' : '已发送图片')}
        className={cn(
          tone === 'assistant'
            ? 'grid w-full max-w-[22rem] grid-cols-3 gap-1.5'
            : 'grid gap-2 grid-cols-1 sm:grid-cols-2',
          className,
        )}
        {...props}
      >
        {attachments.map((attachment, index) => {
          const label = attachment.name?.trim() || `图片 ${index + 1}`
          return (
            <figure
              key={attachment.id}
              role="listitem"
              className={cn(
                'min-w-0 overflow-hidden border',
                tone === 'assistant'
                  ? 'w-full rounded-lg border-slate-200/80 bg-slate-50/90'
                  : 'flex min-h-28 items-center justify-center rounded-[18px] border-white/15 bg-white/10',
              )}
            >
              <button
                type="button"
                className={cn(
                  'group relative flex items-center justify-center overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-inset',
                  tone === 'assistant' ? 'aspect-[4/3] w-full' : 'w-full',
                )}
                aria-label={`查看大图：${label}`}
                title="查看大图"
                onClick={() => openPreview(attachment, label)}
              >
                <img
                  src={imageAttachmentToDataUrl(attachment)}
                  alt=""
                  decoding="async"
                  loading="lazy"
                  className={cn(
                    'object-contain',
                    tone === 'assistant' ? 'h-full w-full' : 'max-h-80 w-full',
                  )}
                />
                <span className="pointer-events-none absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-950/65 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <Maximize2 className="h-3 w-3" aria-hidden="true" />
                </span>
              </button>
              {tone === 'assistant' ? (
                <figcaption className="flex items-center gap-1 border-t border-slate-200/70 px-1.5 py-1 text-[10px] text-slate-500">
                  <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
                  <Maximize2 className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                </figcaption>
              ) : null}
            </figure>
          )
        })}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby={dialogTitleId}
        className="fixed inset-0 m-auto max-h-[calc(100vh-2rem)] w-[min(960px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-white/15 bg-slate-950 p-0 text-white shadow-2xl backdrop:bg-slate-950/70"
        onClose={() => setPreview(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closePreview()
        }}
      >
        <div className="flex max-h-[calc(100vh-2rem)] flex-col">
          <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2">
            <h2 id={dialogTitleId} className="min-w-0 flex-1 truncate text-sm font-medium">
              {preview?.label || '图片证据预览'}
            </h2>
            <button
              type="button"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              aria-label="关闭图片预览"
              onClick={closePreview}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
            {preview ? (
              <img
                src={imageAttachmentToDataUrl(preview.attachment)}
                alt={preview.label}
                className="max-h-[calc(100vh-7rem)] max-w-full object-contain"
              />
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  )
})
