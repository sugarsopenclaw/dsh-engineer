import { useState } from 'react'
import type { BillingProduct } from '../billing-api'
import { SIGNUP_GRANT_CREDITS } from '../billing-api'
import { ENTERPRISE_CREDIT_PACKS, ENTERPRISE_PLANS } from '../content'
import { formatCredits, formatUnitPrice, formatYuan } from '../credits'
import { CheckIcon } from '../icons'
import { Reveal } from '../reveal'
import { SITE } from '../site'

interface PricingProps {
  products: BillingProduct[]
  downloadUrl: string
}

/** The desktop purchase panel labels tiers in English; keep the two in sync. */
const TIER_LABEL: Record<string, string> = {
  starter: 'Starter',
  standard: 'Standard',
  professional: 'Professional',
}

function validityLabel(days: number): string {
  if (days % 365 === 0) {
    return `Credits 有效期 ${days / 365} 年`
  }
  return `Credits 有效期 ${Math.round(days / 30)} 个月`
}

function PersonalPlans({ products, downloadUrl }: PricingProps) {
  const recommendedId =
    products.find((product) => product.plan_tier === 'standard')?.id ?? products[1]?.id

  return (
    <>
      <div className="plan-grid stagger">
        {products.map((product) => {
          const featured = product.id === recommendedId
          return (
            <article key={product.id} className="plan" data-featured={featured || undefined}>
              {featured ? <span className="plan__badge">推荐</span> : null}
              {product.discount_percent > 0 ? (
                <span className="plan__save">省 {product.discount_percent}%</span>
              ) : null}

              <h3 className="plan__name">
                {TIER_LABEL[product.plan_tier] ? `${TIER_LABEL[product.plan_tier]} ` : ''}
                <span>（{product.name}）</span>
              </h3>

              <p className="plan__price">
                <span className="plan__currency">¥</span>
                {formatYuan(product.amount_fen)}
              </p>
              <p className="plan__credits">{formatCredits(product.credits)} Credits</p>
              <p className="plan__unit">{formatUnitPrice(product.amount_fen, product.credits)}</p>

              <ul className="plan__features">
                {['全部 AI 能力开放', validityLabel(product.duration_days), '随时充值，无需升级'].map(
                  (feature) => (
                    <li key={feature}>
                      <CheckIcon />
                      {feature}
                    </li>
                  ),
                )}
              </ul>

              <a className="btn btn--plan btn--block" href={downloadUrl} rel="noreferrer">
                下载后在客户端充值
              </a>
            </article>
          )
        })}
      </div>

      <p className="plan-note">
        注册即赠 {formatCredits(SIGNUP_GRANT_CREDITS)} Credits，先用起来再决定买哪一档。
        网页不收款，付费在桌面客户端内微信扫码完成，价格与本页读取的是同一个接口。
      </p>
    </>
  )
}

function EnterprisePlans() {
  return (
    <>
      <div className="plan-grid stagger">
        {ENTERPRISE_PLANS.map((plan) => {
          const custom = plan.price === '商务定制'
          return (
            <article key={plan.id} className="plan" data-featured={plan.popular || undefined}>
              {plan.popular ? <span className="plan__badge">推荐</span> : null}

              <h3 className="plan__name">{plan.name}</h3>
              <p className="plan__seats">{plan.seats}</p>

              <p className="plan__price">
                {custom ? (
                  <span className="plan__price-text">商务定制</span>
                ) : (
                  <>
                    <span className="plan__currency">¥</span>
                    {plan.price}
                    <span className="plan__period"> / 年</span>
                  </>
                )}
              </p>
              <p className="plan__credits">
                {custom ? 'Credits 共享算力池按需分配' : `含 ${plan.credits} Credits 共享算力池`}
              </p>
              <p className="plan__unit">席位扩展：{plan.seatExtension}</p>

              <ul className="plan__features">
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <CheckIcon />
                    {feature}
                  </li>
                ))}
              </ul>

              <a className="btn btn--plan btn--block" href={SITE.mailtoHref}>
                商务洽谈
              </a>
            </article>
          )
        })}
      </div>

      <div className="topup">
        <div className="section-head section-head--sub">
          <h3>企业算力池充值包</h3>
          <p className="section-lead">弹性充值，随时扩展算力。充值越多，单位成本越低。</p>
        </div>
        <div className="plan-grid plan-grid--compact stagger">
          {ENTERPRISE_CREDIT_PACKS.map((pack) => (
            <article key={pack.credits} className="plan plan--compact" data-featured={pack.popular || undefined}>
              {pack.popular ? <span className="plan__badge">推荐</span> : null}
              <h4 className="plan__name">{pack.desc}</h4>
              <p className="plan__price">{pack.price}</p>
              <p className="plan__credits">{pack.credits} Credits</p>
              <p className="plan__unit">{pack.unit}</p>
              <a className="btn btn--plan btn--block" href={SITE.mailtoHref}>
                联系购买
              </a>
            </article>
          ))}
        </div>
      </div>

      <p className="plan-note">
        企业档目前不在客户端自助下单：席位、共享算力池、管理员控制台和 Open API
        由人工确认后开通，避免产生无法履约的订单。
      </p>
    </>
  )
}

export function Pricing({ products, downloadUrl }: PricingProps) {
  const [tab, setTab] = useState<'personal' | 'enterprise'>('personal')

  return (
    <section className="section pricing" id="pricing">
      <div className="shell">
        <Reveal className="section-head">
          <span className="pill">Membership Service</span>
          <h2>会员服务</h2>
          <p className="section-lead">一个平台 · 全能力开放 · 按 AI 计算资源收费</p>
        </Reveal>

        <div className="tabs" role="tablist" aria-label="选择用户类型">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'personal'}
            className="tabs__btn"
            data-active={tab === 'personal' || undefined}
            onClick={() => setTab('personal')}
          >
            个人用户
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'enterprise'}
            className="tabs__btn"
            data-active={tab === 'enterprise' || undefined}
            onClick={() => setTab('enterprise')}
          >
            企业用户
          </button>
        </div>

        <Reveal key={tab}>
          {tab === 'personal' ? (
            <PersonalPlans products={products} downloadUrl={downloadUrl} />
          ) : (
            <EnterprisePlans />
          )}
        </Reveal>

        <p className="pricing__contact">
          商务与合作：<a href={SITE.mailtoHref}>{SITE.email}</a>
          <span aria-hidden="true"> · </span>
          <a href={SITE.telHref}>{SITE.phoneLabel}</a>
        </p>
      </div>
    </section>
  )
}
