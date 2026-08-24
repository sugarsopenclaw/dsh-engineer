import { Glyph } from '../icons'
import { SITE } from '../site'

const BRAND_MARK = '/xiaoliang.png'

const QUICK_LINKS = [
  { label: '产品能力', href: '#capabilities' },
  { label: '产学研联合创新', href: '#innovation' },
  { label: '会员服务', href: '#pricing' },
  { label: 'Credits 消耗参考', href: '#consumption' },
  { label: '下载中心', href: '#download' },
  { label: '常见问题', href: '#faq' },
]

export function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="shell">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <img src={BRAND_MARK} alt={`${SITE.productName}AI`} width={48} height={48} loading="lazy" />
            <p>智能工程时代，从这里开始</p>
          </div>

          <div>
            <h2>快速链接</h2>
            <ul className="site-footer__links">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href}>{link.label}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2>联系我们</h2>
            <ul className="site-footer__contact">
              <li>
                <Glyph name="mail" size={18} />
                <a href={SITE.mailtoHref}>{SITE.email}</a>
              </li>
              <li>
                <Glyph name="phone" size={18} />
                <a href={SITE.telHref}>{SITE.phoneLabel}</a>
              </li>
              <li>
                <Glyph name="pin" size={18} />
                <span>
                  {SITE.addressOrg}
                  <br />
                  {SITE.address}
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="site-footer__bar">
          <p>
            © {year} {SITE.company}. All rights reserved.
          </p>
          <p>
            {SITE.icp ? (
              <a href={SITE.icpHref} target="_blank" rel="noreferrer">
                备案号：{SITE.icp}
              </a>
            ) : (
              'ICP 备案号申请中'
            )}
          </p>
        </div>
      </div>
    </footer>
  )
}
