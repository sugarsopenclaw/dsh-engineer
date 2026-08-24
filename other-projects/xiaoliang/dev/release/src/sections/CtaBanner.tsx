import { SIGNUP_GRANT_CREDITS } from '../billing-api'
import { formatCredits } from '../credits'
import { Reveal } from '../reveal'
import { SITE } from '../site'

interface CtaBannerProps {
  downloadUrl: string
}

export function CtaBanner({ downloadUrl }: CtaBannerProps) {
  return (
    <section className="cta-banner">
      <div className="cta-banner__glow" aria-hidden="true" />
      <div className="shell">
        <Reveal className="cta-banner__inner">
          <h2>开启智能工程之旅</h2>
          <p>立即体验晓量 AI，让工程效率提升 10 倍</p>
          <div className="cta-banner__actions">
            <a className="btn btn--on-blue btn--lg" href={downloadUrl} rel="noreferrer">
              下载体验
            </a>
            <a className="btn btn--outline-white btn--lg" href="#pricing">
              查看会员服务
            </a>
          </div>
          <p className="cta-banner__note">
            注册即赠 {formatCredits(SIGNUP_GRANT_CREDITS)} Credits，全部 AI 能力开放
            <span aria-hidden="true"> · </span>
            商务洽谈 <a href={SITE.mailtoHref}>{SITE.email}</a>
          </p>
        </Reveal>
      </div>
    </section>
  )
}
