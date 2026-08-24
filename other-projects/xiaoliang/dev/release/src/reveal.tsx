import { useEffect, useRef, useState, type ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  className?: string
  /** Extra ms before this block starts its transition. */
  delay?: number
  id?: string
}

/**
 * Scroll-triggered fade-up, matching the product site's motion without pulling
 * in an animation library. The transition itself lives in CSS, so
 * `prefers-reduced-motion` disables it for free; blocks still become visible
 * because the reveal only ever toggles a data attribute.
 */
export function Reveal({ children, className, delay = 0, id }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true)
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -60px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      id={id}
      className={className ? `reveal ${className}` : 'reveal'}
      data-shown={shown || undefined}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}
