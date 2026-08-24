import { AGENTS, type Agent } from '../content'
import { CheckIcon } from '../icons'
import { Reveal } from '../reveal'

interface CapabilitiesProps {
  downloadUrl: string
}

function AgentBlock({ agent, index, downloadUrl }: { agent: Agent; index: number; downloadUrl: string }) {
  const tint = { ['--agent' as string]: agent.color, ['--agent-wash' as string]: agent.colorLight }

  return (
    <Reveal className="agent">
      <article className="agent__row" data-flip={index % 2 === 1 || undefined} style={tint}>
        <div className="agent__visual">
          <span className="agent__watermark" aria-hidden="true">
            {agent.id}
          </span>
          <div className="agent__frame">
            <img
              src={agent.image}
              alt={agent.alt}
              width={960}
              height={720}
              loading={index === 0 ? 'eager' : 'lazy'}
            />
            <div className="agent__frame-tags">
              <span className="agent__frame-tag agent__frame-tag--solid">Agent {agent.id}</span>
              <span className="agent__frame-tag">{agent.title}</span>
            </div>
          </div>
        </div>

        <div className="agent__copy">
          <span className="agent__number">Agent {agent.id}</span>
          <h3>{agent.title}</h3>
          <p className="agent__title-en">{agent.titleEn}</p>
          <p className="agent__desc">{agent.desc}</p>

          <ul className="agent__features">
            {agent.features.map((feature) => (
              <li key={feature.title}>
                <span className="agent__check">
                  <CheckIcon />
                </span>
                <span>
                  <strong>{feature.title}</strong>
                  <span className="agent__feature-desc"> — {feature.desc}</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="agent__scenarios">
            <strong>应用场景</strong>
            <span>{agent.scenarios}</span>
          </p>

          <div className="agent__actions">
            <a className="btn btn--agent btn--sm" href={downloadUrl} rel="noreferrer">
              下载体验
            </a>
            <a className="btn btn--agent-soft btn--sm" href="#pricing">
              查看服务 →
            </a>
          </div>
        </div>
      </article>
    </Reveal>
  )
}

export function Capabilities({ downloadUrl }: CapabilitiesProps) {
  return (
    <section className="section capabilities" id="capabilities">
      <div className="shell">
        <Reveal className="section-head">
          <span className="pill">Product Capabilities</span>
          <h2>四大智能 Agent，覆盖工程造价全流程</h2>
          <p className="section-lead">
            每个 Agent 专注一个核心领域，由工程大模型驱动，持续学习与进化。
            四个 Agent 对所有用户全部开放，不按套餐分级。
          </p>
        </Reveal>

        <div className="agent-list">
          {AGENTS.map((agent, index) => (
            <AgentBlock key={agent.id} agent={agent} index={index} downloadUrl={downloadUrl} />
          ))}
        </div>
      </div>
    </section>
  )
}
