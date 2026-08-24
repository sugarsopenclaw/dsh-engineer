import type { BillingProduct } from '../billing-api'
import { SIGNUP_GRANT_CREDITS } from '../billing-api'
import {
  formatCredits,
  ratesForModel,
  scenarioCosts,
  tasksPerBalance,
  type CreditPricing,
} from '../credits'
import { formatMicroRate } from '../format'
import { Reveal } from '../reveal'

interface ConsumptionProps {
  pricing: CreditPricing
  products: BillingProduct[]
}

function coverageLabel(balance: number, taskCredits: number): string {
  const count = tasksPerBalance(balance, taskCredits)
  return count > 0 ? `约 ${count} 次` : '不足 1 次'
}

export function Consumption({ pricing, products }: ConsumptionProps) {
  const costs = scenarioCosts(pricing)
  const rates = ratesForModel(pricing)
  const starter = products[0]
  const cadCredits = costs.find((cost) => cost.id === 'cad_takeoff')?.credits ?? 0
  const columns = [
    { id: 'signup', label: '注册赠送', credits: SIGNUP_GRANT_CREDITS },
    ...products.slice(0, 3).map((product) => ({
      id: product.id,
      label: product.name,
      credits: product.credits,
    })),
  ]

  return (
    <section className="section consumption" id="consumption">
      <div className="shell">
        <Reveal className="section-head">
          <span className="pill">Credits Usage</span>
          <h2>Credits 消耗参考</h2>
          <p className="section-lead">
            注册即赠 2,000 Credits，按常见任务大约可完成 10 次单轮问答、5 次常规分析、
            2 次图纸算量、1 次大图分析。入门 / 标准 / 专业按同一消耗比例类推。
          </p>
        </Reveal>

        <Reveal>
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">常见任务的 Credits 消耗与各档可完成次数</caption>
              <thead>
                <tr>
                  <th scope="col">任务</th>
                  <th scope="col">参考消耗</th>
                  {columns.map((column) => (
                    <th key={column.id} scope="col">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {costs.map((cost) => (
                  <tr key={cost.id}>
                    <th scope="row">
                      <span className="data-table__title">{cost.label}</span>
                      <span className="data-table__detail">
                        {cost.detail} · 约 {cost.medianCalls} 次调用
                      </span>
                    </th>
                    <td className="data-table__cost">{formatCredits(cost.credits)} Credits</td>
                    {columns.map((column) => (
                      <td key={column.id}>{coverageLabel(column.credits, cost.credits)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        {rates ? (
          <Reveal>
            <dl className="rate-card stagger">
              <div>
                <dt>未命中缓存的输入</dt>
                <dd>{formatMicroRate(rates.uncached_input_micro, pricing.micro_per_credit)}</dd>
              </div>
              <div>
                <dt>命中缓存的输入</dt>
                <dd>{formatMicroRate(rates.cached_input_micro, pricing.micro_per_credit)}</dd>
              </div>
              <div>
                <dt>模型输出</dt>
                <dd>{formatMicroRate(rates.output_micro, pricing.micro_per_credit)}</dd>
              </div>
            </dl>
          </Reveal>
        ) : null}

        <p className="fine-print">
          费率版本 {pricing.pricing_version}。失败或拿不到用量的调用不计费；
          文档解析、语音识别、联网搜索暂不计量。
          {starter && cadCredits > 0
            ? ` 按同一比例估算，${starter.name}大约能做完 ${tasksPerBalance(
                starter.credits,
                cadCredits,
              )} 张完整 CAD 算量。`
            : ''}{' '}
          实际消耗取决于图纸复杂度、上下文长度和推理深度，以上仅供参考。
        </p>
      </div>
    </section>
  )
}
