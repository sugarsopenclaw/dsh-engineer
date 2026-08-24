import { PHILOSOPHY } from '../content'
import { Glyph } from '../icons'
import { Reveal } from '../reveal'

export function Philosophy() {
  return (
    <section className="section philosophy">
      <div className="shell">
        <Reveal className="section-head">
          <span className="pill">Platform Philosophy</span>
          <h2>平台理念</h2>
          <p className="section-lead">
            没有会员等级，没有功能墙。收费的唯一依据是 AI 计算资源的消耗量。
          </p>
        </Reveal>

        <Reveal>
          <div className="icon-cards stagger">
            {PHILOSOPHY.map((item) => (
              <article key={item.title} className="icon-card">
                <span className="icon-card__badge">
                  <Glyph name={item.icon} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </article>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
