import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface ConfirmDeleteDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
}

export function ConfirmDeleteDialog({
  open,
  title,
  description,
  confirmLabel = '删除',
  onConfirm,
  onOpenChange,
}: ConfirmDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!open || isDeleting) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isDeleting, onOpenChange, open])

  const handleConfirm = async () => {
    setIsDeleting(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setIsDeleting(false)
    }
  }

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-4"
      onClick={() => {
        if (!isDeleting) {
          onOpenChange(false)
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <div className="flex justify-end gap-2 pt-5">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            取消
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}