import logoBucea from '../assets/generated/logo-bucea.webp'
import logoQianfan from '../assets/generated/logo-qianfan.webp'
import { INNOVATION_CARDS } from '../content'
import { Reveal } from '../reveal'

const PARTNERS = [
  { src: logoQianfan, alt: '百度智能云千帆大模型产业（北京）创新基地' },
  { src: logoBucea, alt: '北京建筑大学' },
] as const

/* ── Card 1: neural mesh ── */
const MESH_LAYERS = [
  [40, 75, 110],
  [30, 65, 100, 130],
  [35, 70, 105, 135],
  [50, 90, 125],
].map((ys, column) => ys.map((y) => ({ x: 35 + column * 50, y })))

const MESH_EDGES = MESH_LAYERS.slice(0, -1).flatMap((layer, index) =>
  layer.flatMap((from) => MESH_LAYERS[index + 1].map((to) => ({ from, to }))),
)

function NeuralMesh() {
  return (
    <svg viewBox="0 0 220 170" className="art" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="mesh-glow">
          <stop offset="0%" stopColor="#2563EB" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
        </radialGradient>
      </defs>
      {MESH_EDGES.map(({ from, to }, index) => (
        <line
          key={index}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="#2563EB"
          strokeWidth="0.4"
          opacity="0.15"
        />
      ))}
      {MESH_LAYERS.flat().map((node, index) => (
        <g key={index}>
          <circle
            className="art__pulse"
            cx={node.x}
            cy={node.y}
            r="9"
            fill="url(#mesh-glow)"
            style={{ animationDelay: `${index * 0.15}s` }}
          />
          <circle cx={node.x} cy={node.y} r="3" fill="none" stroke="#2563EB" strokeWidth="0.8" opacity="0.4" />
          <circle cx={node.x} cy={node.y} r="1.5" fill="#2563EB" opacity="0.6" />
        </g>
      ))}
      {['INPUT', 'HIDDEN', 'HIDDEN', 'OUTPUT'].map((label, index) => (
        <text
          key={label + index}
          x={35 + index * 50}
          y="160"
          textAnchor="middle"
          fill="#94a3b8"
          fontSize="5"
          fontFamily="monospace"
          opacity="0.5"
        >
          {label}
        </text>
      ))}
    </svg>
  )
}

/* ── Card 2: validated waveform ── */
const WAVE = Array.from({ length: 60 }, (_, i) => {
  const x = 20 + i * 3.2
  const y = 85 + Math.sin(i * 0.3) * 25 + Math.sin(i * 0.7) * 12 + Math.sin(i * 1.3) * 6
  return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
}).join(' ')

function DataWaveform() {
  return (
    <svg viewBox="0 0 220 170" className="art" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="wave-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="50%" stopColor="#059669" />
          <stop offset="100%" stopColor="#10B981" />
        </linearGradient>
        <linearGradient id="wave-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563EB" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#059669" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g opacity="0.15">
        {[40, 60, 80, 100, 120, 140].map((y) => (
          <line key={`h${y}`} x1="20" y1={y} x2="200" y2={y} stroke="#94a3b8" strokeWidth="0.3" />
        ))}
        {[40, 80, 120, 160, 200].map((x) => (
          <line key={`v${x}`} x1={x} y1="30" x2={x} y2="140" stroke="#94a3b8" strokeWidth="0.3" />
        ))}
      </g>
      <path d={`${WAVE} L 200 140 L 20 140 Z`} fill="url(#wave-fill)" />
      <path d={WAVE} stroke="url(#wave-line)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <line className="art__scan" x1="20" y1="30" x2="20" y2="140" stroke="#10B981" strokeWidth="0.6" opacity="0.5" />
      {[
        { x: 60, y: 85 },
        { x: 120, y: 73 },
        { x: 170, y: 97 },
      ].map((dot, index) => (
        <g key={index}>
          <circle
            className="art__pulse"
            cx={dot.x}
            cy={dot.y}
            r="11"
            fill="#10B981"
            opacity="0.12"
            style={{ animationDelay: `${index * 0.4}s` }}
          />
          <circle cx={dot.x} cy={dot.y} r="3" fill="#10B981" opacity="0.7" />
        </g>
      ))}
      <g transform="translate(20, 152)">
        <circle cx="4" cy="3" r="2" fill="#10B981" opacity="0.8" />
        <text x="10" y="5" fill="#94a3b8" fontSize="5" fontFamily="monospace">
          Validated on real projects
        </text>
      </g>
    </svg>
  )
}

/* ── Card 3: API flow ── */
function ApiFlow() {
  const lanes = [
    { d: 'M65,85 L155,85', color: '#7C3AED', dur: '2s', begin: '0s' },
    { d: 'M65,65 Q110,55 155,65', color: '#7C3AED', dur: '2.5s', begin: '0.5s' },
    { d: 'M65,105 Q110,115 155,105', color: '#2563EB', dur: '2.5s', begin: '0.8s' },
  ]

  return (
    <svg viewBox="0 0 220 170" className="art" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="api-flow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      </defs>

      <circle cx="45" cy="85" r="22" fill="#7C3AED" opacity="0.08" />
      <circle cx="45" cy="85" r="18" fill="none" stroke="#7C3AED" strokeWidth="0.8" opacity="0.3" />
      <circle cx="45" cy="85" r="12" fill="none" stroke="#7C3AED" strokeWidth="0.6" opacity="0.2" />
      <circle cx="45" cy="85" r="6" fill="#7C3AED" opacity="0.15" />
      <text x="45" y="88" textAnchor="middle" fill="#7C3AED" fontSize="5" fontWeight="600" opacity="0.7">
        AI
      </text>
      <text x="45" y="115" textAnchor="middle" fill="#94a3b8" fontSize="5" fontFamily="monospace" opacity="0.5">
        Model
      </text>

      <line x1="65" y1="85" x2="155" y2="85" stroke="url(#api-flow)" strokeWidth="0.8" opacity="0.3" strokeDasharray="4 2" />
      <path d="M65,65 Q110,55 155,65" stroke="#7C3AED" strokeWidth="0.5" opacity="0.2" strokeDasharray="3 2" />
      <path d="M65,105 Q110,115 155,105" stroke="#2563EB" strokeWidth="0.5" opacity="0.2" strokeDasharray="3 2" />
      {lanes.map((lane) => (
        <circle key={lane.d} r="1.8" fill={lane.color} opacity="0.65">
          <animateMotion dur={lane.dur} begin={lane.begin} repeatCount="indefinite" path={lane.d} />
        </circle>
      ))}

      <rect x="100" y="72" width="20" height="26" rx="4" fill="none" stroke="#7C3AED" strokeWidth="0.6" opacity="0.3" />
      <text x="110" y="88" textAnchor="middle" fill="#7C3AED" fontSize="4" fontWeight="600" opacity="0.6">
        API
      </text>

      {[
        { y: 55, label: 'ERP', color: '#2563EB' },
        { y: 85, label: 'BIM', color: '#059669' },
        { y: 115, label: 'CMS', color: '#7C3AED' },
      ].map((node) => (
        <g key={node.label}>
          <circle cx="175" cy={node.y} r="14" fill={node.color} opacity="0.06" />
          <circle cx="175" cy={node.y} r="10" fill="none" stroke={node.color} strokeWidth="0.6" opacity="0.25" />
          <circle cx="175" cy={node.y} r="5" fill={node.color} opacity="0.12" />
          <text x="175" y={node.y + 1.5} textAnchor="middle" fill={node.color} fontSize="4" fontWeight="600" opacity="0.6">
            {node.label}
          </text>
        </g>
      ))}
      <text x="175" y="145" textAnchor="middle" fill="#94a3b8" fontSize="5" fontFamily="monospace" opacity="0.5">
        Enterprise
      </text>
    </svg>
  )
}

const ART = [NeuralMesh, DataWaveform, ApiFlow]

export function Innovation() {
  return (
    <section className="section innovation" id="innovation">
      <span className="innovation__grid" aria-hidden="true" />
      <div className="shell">
        <Reveal className="section-head">
          <span className="pill pill--plain">University &amp; Industry Innovation</span>
          <h2>产学研联合创新</h2>
          <p className="section-lead">
            携手高校科研团队，深度融合学术研究与工程实践，持续推动行业技术创新与商业化落地。
          </p>
        </Reveal>

        <Reveal>
          <div className="innovation__cards stagger">
            {INNOVATION_CARDS.map((card, index) => {
              const Art = ART[index]
              return (
                <article
                  key={card.title}
                  className="innovation__card"
                  style={{ ['--accent' as string]: card.accent }}
                >
                  <div className="innovation__art">
                    <span className="innovation__art-glow" aria-hidden="true" />
                    <Art />
                  </div>
                  <h3>{card.title}</h3>
                  <p className="innovation__card-en">{card.titleEn}</p>
                  <p className="innovation__card-desc">{card.desc}</p>
                </article>
              )
            })}
          </div>
        </Reveal>

        <Reveal className="innovation__partners">
          <p className="innovation__partners-label">合作机构</p>
          <ul>
            {PARTNERS.map((partner) => (
              <li key={partner.alt}>
                <img src={partner.src} alt={partner.alt} width={220} height={64} loading="lazy" />
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  )
}
