import { useEffect, useState } from 'react'
import { SITE } from '../site'

const BRAND_MARK = '/xiaoliang.png'

const LINKS = [
  { label: '产品能力', href: '#capabilities' },
  { label: '产学研', href: '#innovation' },
  { label: '会员服务', href: '#pricing' },
  { label: '消耗参考', href: '#consumption' },
  { label: '下载中心', href: '#download' },
  { label: '常见问题', href: '#faq' },
]

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <a className="skip-link" href="#download">
        跳到下载
      </a>
      <nav className="site-nav" data-scrolled={scrolled || undefined} aria-label="页面导航">
        <div className="site-nav__inner">
          <a className="site-nav__brand" href="#top">
            <img src={BRAND_MARK} alt={`${SITE.productName}AI`} width={44} height={44} />
            <span className="site-nav__divider" aria-hidden="true" />
            <span className="site-nav__product">{SITE.productName}</span>
          </a>

          <div className="site-nav__links">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </div>

          <a className="btn btn--primary btn--sm site-nav__cta" href="#download">
            下载体验
          </a>

          <button
            type="button"
            className="site-nav__toggle"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? '收起导航' : '展开导航'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
              {menuOpen ? (
                <path d="M6 6L18 18M6 18L18 6" strokeLinecap="round" />
              ) : (
                <path d="M3 6H21M3 12H21M3 18H21" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>

        {menuOpen ? (
          <div className="site-nav__drawer">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
                {link.label}
              </a>
            ))}
            <a
              className="btn btn--primary btn--block"
              href="#download"
              onClick={() => setMenuOpen(false)}
            >
              下载体验
            </a>
          </div>
        ) : null}
      </nav>
    </>
  )
}
