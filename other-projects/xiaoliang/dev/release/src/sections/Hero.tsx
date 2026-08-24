import { SIGNUP_GRANT_CREDITS } from '../billing-api'
import { HERO_STATS } from '../content'
import { formatCredits } from '../credits'
import { formatPublishedAt } from '../format'
import { ArrowDownIcon } from '../icons'
import type { ClientReleaseArtifact } from '../release-api'
import { AgentNetwork } from './AgentNetwork'

interface HeroProps {
  version: string | null
  publishedAt: string | null
  artifact: ClientReleaseArtifact | undefined
  downloadUrl: string
  loadError: string | null
}

export function Hero({ version, publishedAt, artifact, downloadUrl, loadError }: HeroProps) {
  const meta = [
    version ? `v${version}` : null,
    artifact?.file_size ?? null,
    formatPublishedAt(publishedAt ?? undefined) || null,
    'Windows 10/11 64 位',
  ].filter(Boolean)

  return (
    <header className="hero" id="top">
      <div className="hero__backdrop" aria-hidden="true">
        <span className="hero__grid" />
        <span className="hero__glow hero__glow--one" />
        <span className="hero__glow hero__glow--two" />
        <span className="hero__glow hero__glow--three" />
      </div>

      <div className="hero__inner">
        <div className="hero__copy">
          <span className="hero__badge">
            <span className="hero__pulse" aria-hidden="true" />
            自主工程大模型 · 面向全球工程师
          </span>

          <h1 className="hero__title">
            智能工程时代，
            <br />
            <span className="hero__title-accent">从这里开始</span>
          </h1>
          <p className="hero__title-en">Start the Future of Intelligent Engineering</p>

          <p className="hero__lead">
            基于自主工程大模型与行业知识体系，晓量让 AI 读懂图纸、理解规范、辅助决策，
            并通过 Skill 沉淀工程经验，让 AI 按照你的方式工作，成为工程师的智能工作引擎。
          </p>

          <div className="hero__actions">
            <a className="btn btn--primary btn--lg" href={downloadUrl} rel="noreferrer">
              下载体验
            </a>
            <a className="btn btn--ghost-dark btn--lg" href="#pricing">
              会员服务
            </a>
          </div>

          <p className="hero__grant">
            注册即赠 <strong>{formatCredits(SIGNUP_GRANT_CREDITS)} Credits</strong>，
            全部 AI 能力开放，无需先付费。
          </p>

          <p className="hero__meta">{meta.join(' · ')}</p>
          {loadError ? (
            <p className="hero__error">版本信息暂时读不到（{loadError}），下载入口仍然可用。</p>
          ) : null}

          <ul className="hero__stats">
            {HERO_STATS.map((stat) => (
              <li key={stat.label}>
                <span className="hero__stat-value">{stat.value}</span>
                <span className="hero__stat-label">{stat.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="hero__visual">
          <AgentNetwork />
        </div>
      </div>

      <a className="hero__scroll" href="#capabilities">
        <span>探索更多</span>
        <ArrowDownIcon />
      </a>
    </header>
  )
}
