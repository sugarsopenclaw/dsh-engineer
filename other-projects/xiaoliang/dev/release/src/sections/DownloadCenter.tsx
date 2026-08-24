import { CLIENT_ADVANTAGES, PLATFORMS, PREREQUISITES } from '../content'
import { formatPublishedAt } from '../format'
import { CheckIcon, Glyph, PlatformIcon } from '../icons'
import { Reveal } from '../reveal'
import type { ClientReleaseArtifact } from '../release-api'
import { FALLBACK_INSTALL_STEPS } from '../site'

interface DownloadCenterProps {
  version: string | null
  publishedAt: string | null
  artifact: ClientReleaseArtifact | undefined
  downloadUrl: string
  steps: string[]
}

export function DownloadCenter({
  version,
  publishedAt,
  artifact,
  downloadUrl,
  steps,
}: DownloadCenterProps) {
  const installSteps = steps.length > 0 ? steps : [...FALLBACK_INSTALL_STEPS]
  const published = formatPublishedAt(publishedAt ?? undefined)

  return (
    <section className="section download" id="download">
      <div className="shell">
        <Reveal className="section-head">
          <span className="pill">Download Center</span>
          <h2>下载中心</h2>
          <p className="section-lead">选择您的平台，立即下载晓量 AI 客户端。下载无需注册。</p>
        </Reveal>

        <Reveal>
          <div className="platforms stagger">
            {PLATFORMS.map((platform) => {
              const live = platform.status === 'available'
              return (
                <article
                  key={platform.name}
                  className="platform"
                  data-live={live || undefined}
                  style={{ ['--accent' as string]: platform.accent }}
                >
                  {live ? <span className="platform__badge">当前支持</span> : null}
                  <PlatformIcon name={platform.icon} color={platform.accent} />
                  <h3>{platform.name}</h3>

                  {live ? (
                    <>
                      <p className="platform__version">{version ? `版本 v${version}` : '最新版本'}</p>
                      <p className="platform__meta">{platform.requirements}</p>
                      <p className="platform__meta">
                        {[artifact?.file_size ? `文件大小 ${artifact.file_size}` : null, published]
                          .filter(Boolean)
                          .join(' · ') || '安装包由下载接口实时提供'}
                      </p>
                      <a className="btn btn--primary btn--block" href={downloadUrl} rel="noreferrer">
                        直接下载
                      </a>
                    </>
                  ) : (
                    <>
                      <p className="platform__meta">{platform.requirements}</p>
                      <span className="platform__soon">即将推出</span>
                    </>
                  )}
                </article>
              )
            })}
          </div>
        </Reveal>

        <Reveal>
          <div className="install">
            <div className="install__steps">
              <h3>安装步骤</h3>
              <ol>
                {installSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
            <div className="install__verify">
              <h3>安装包校验</h3>
              {artifact?.checksum_sha512 ? (
                <details className="checksum">
                  <summary>
                    SHA-512 校验值
                    {artifact.file_name ? ` · ${artifact.file_name}` : ''}
                  </summary>
                  <code>{artifact.checksum_sha512}</code>
                </details>
              ) : (
                <p className="install__hint">
                  当前版本未返回校验值。下载请求先由后端记录，再跳转到对象存储的签名地址。
                </p>
              )}
            </div>
          </div>
        </Reveal>

        <div className="section-head section-head--sub">
          <h3>客户端优势</h3>
          <p className="section-lead">本地客户端为您带来更好的使用体验。</p>
        </div>

        <Reveal>
          <div className="mini-cards stagger">
            {CLIENT_ADVANTAGES.map((item) => (
              <article key={item.title} className="mini-card mini-card--center">
                <span className="mini-card__check">
                  <CheckIcon />
                </span>
                <h4>{item.title}</h4>
                <p>{item.desc}</p>
              </article>
            ))}
          </div>
        </Reveal>

        <div className="section-head section-head--sub">
          <h3>使用前须知</h3>
          <p className="section-lead">安装软件后，请完成以下步骤以正常使用。</p>
        </div>

        <Reveal>
          <div className="mini-cards mini-cards--two stagger">
            {PREREQUISITES.map((item) => (
              <article key={item.title} className="mini-card mini-card--row">
                <span className="mini-card__glyph">
                  <Glyph name={item.icon} size={20} />
                </span>
                <div>
                  <h4>{item.title}</h4>
                  <p>{item.desc}</p>
                </div>
              </article>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
