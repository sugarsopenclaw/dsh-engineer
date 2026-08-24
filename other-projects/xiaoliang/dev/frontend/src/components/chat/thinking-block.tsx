import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ThinkingBlockProps {
  content: string
  isThinking?: boolean
  fullBleed?: boolean
}

export function ThinkingBlock({
  content,
  isThinking = false,
  fullBleed = false,
}: ThinkingBlockProps) {
  const [open, setOpen] = useState(isThinking)
  const contentScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isThinking || !(open || isThinking)) {
      return
    }

    const element = contentScrollRef.current
    if (!element) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [content, isThinking, open])

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/88',
        fullBleed && '-mx-4 w-[calc(100%+2rem)]',
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-500 transition hover:bg-slate-100/80"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open || isThinking}
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', (open || isThinking) && 'rotate-90')} />
        <Brain className="h-3.5 w-3.5" />
        <span>{isThinking ? '思考中...' : '思考过程'}</span>
      </button>
      {(open || isThinking) && content ? (
        <div className="border-t border-slate-200/80 px-3 py-2 text-xs leading-6 text-slate-500">
          <div
            ref={contentScrollRef}
            className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words"
          >
            {content}
          </div>
        </div>
      ) : null}
    </div>
  )
}
