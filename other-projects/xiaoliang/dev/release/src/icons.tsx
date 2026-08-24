/** Inline SVG icon set. Keeps the page dependency-free and colourable by prop. */

interface IconProps {
  className?: string
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" {...stroke} strokeWidth={2.5}>
      <path d="M5 12L10 17L19 8" />
    </svg>
  )
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...stroke} strokeWidth={2}>
      <path d="M19 9l-7 7-7-7" />
    </svg>
  )
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...stroke} strokeWidth={1.5}>
      <path d="M19 14l-7 7m0 0l-7-7m7 7V3" />
    </svg>
  )
}

const GLYPHS = {
  platform: 'M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9',
  capability: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  credits:
    'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  account:
    'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.118a7.5 7.5 0 0115 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.5-1.632z',
  cad: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zM19.5 7.125L16.862 4.487M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10',
  network:
    'M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3s-4.5 4.03-4.5 9 2.015 9 4.5 9zM3.6 9h16.8M3.6 15h16.8',
  mail: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  phone:
    'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  pin: 'M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z',
} as const

export type GlyphName = keyof typeof GLYPHS

export function Glyph({ name, className, size = 22 }: { name: GlyphName; className?: string; size?: number }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...stroke}>
      <path d={GLYPHS[name]} />
    </svg>
  )
}

/** Platform marks, drawn on the same 48px tinted tile as the product site. */
export function PlatformIcon({ name, color }: { name: 'windows' | 'macos' | 'linux'; color: string }) {
  return (
    <svg viewBox="0 0 48 48" width="56" height="56" fill="none" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill={color} fillOpacity="0.1" />
      {name === 'windows' ? (
        <path
          d="M14 14H22V22H14V14ZM26 14H34V22H26V14ZM14 26H22V34H14V26ZM26 26H34V34H26V26Z"
          fill={color}
        />
      ) : null}
      {name === 'macos' ? (
        <>
          <path
            d="M24 12C20.6863 12 18 14.6863 18 18V30C18 33.3137 20.6863 36 24 36C27.3137 36 30 33.3137 30 30V18C30 14.6863 27.3137 12 24 12Z"
            stroke={color}
            strokeWidth="2"
          />
          <path d="M22 18H26" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </>
      ) : null}
      {name === 'linux' ? (
        <>
          <circle cx="24" cy="20" r="4" stroke={color} strokeWidth="2" />
          <path
            d="M20 28C20 25.7909 21.7909 24 24 24C26.2091 24 28 25.7909 28 28V32H20V28Z"
            stroke={color}
            strokeWidth="2"
          />
          <path d="M18 32H30" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  )
}
