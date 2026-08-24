import { FAQS } from '../content'
import { ChevronIcon } from '../icons'
import { Reveal } from '../reveal'
import { SITE } from '../site'

export function Faq() {
  return (
    <section className="section faq" id="faq">
      <div className="shell shell--narrow">
        <Reveal className="section-head">
          <span className="pill">FAQ</span>
          <h2>常见问题</h2>
        </Reveal>

        <Reveal>
          <div className="faq-list stagger">
            {FAQS.map((item) => (
              <details key={item.q} className="faq-item">
                <summary>
                  <span>{item.q}</span>
                  <ChevronIcon className="faq-item__chevron" />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </Reveal>

        <p className="faq__contact">
          还没问到的，写信给 <a href={SITE.mailtoHref}>{SITE.email}</a>
        </p>
      </div>
    </section>
  )
}
