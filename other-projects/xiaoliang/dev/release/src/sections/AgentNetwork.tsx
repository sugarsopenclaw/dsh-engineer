/**
 * The hero's engineering-network diagram: a core model surrounded by the four
 * agents and the scenes each one feeds. Redrawn as one static SVG with native
 * `animateMotion` for the travelling dots, so it costs no animation library and
 * no per-frame JavaScript.
 */

interface Node {
  id: string
  label: string
  x: number
  y: number
  size: number
  color: string
  level: 0 | 1 | 2
}

const NODES: Node[] = [
  { id: 'core', label: 'AI Core', x: 270, y: 210, size: 56, color: '#3B82F6', level: 0 },

  { id: 'quantity-agent', label: '工程量计算', x: 140, y: 120, size: 44, color: '#60A5FA', level: 1 },
  { id: 'cost-agent', label: '造价分析', x: 400, y: 120, size: 44, color: '#818CF8', level: 1 },
  { id: 'drawing-agent', label: '图纸审查', x: 140, y: 300, size: 44, color: '#34D399', level: 1 },
  { id: 'construction-agent', label: '施工管理', x: 400, y: 300, size: 44, color: '#FB923C', level: 1 },

  { id: 'cad-link', label: 'CAD 关联', x: 60, y: 80, size: 30, color: '#60A5FA', level: 2 },
  { id: 'drawing-review', label: '图纸审查', x: 80, y: 160, size: 30, color: '#60A5FA', level: 2 },
  { id: 'cost-estimate', label: '工程造价', x: 480, y: 80, size: 30, color: '#818CF8', level: 2 },
  { id: 'quantity', label: '计量', x: 460, y: 160, size: 30, color: '#818CF8', level: 2 },
  { id: 'pricing', label: '清单计价', x: 500, y: 120, size: 30, color: '#818CF8', level: 2 },
  { id: 'schedule', label: '施工管理', x: 60, y: 340, size: 30, color: '#34D399', level: 2 },
  { id: 'cost-control', label: '成本控制', x: 80, y: 260, size: 30, color: '#34D399', level: 2 },
  { id: 'contract', label: '合同编制', x: 100, y: 380, size: 30, color: '#34D399', level: 2 },
  { id: 'spec-review', label: '工程规范', x: 480, y: 340, size: 30, color: '#FB923C', level: 2 },
  { id: 'plan-eval', label: '方案评估', x: 460, y: 260, size: 30, color: '#FB923C', level: 2 },
  { id: 'tender', label: '招投标', x: 500, y: 380, size: 30, color: '#FB923C', level: 2 },
  { id: 'knowledge', label: '知识库', x: 270, y: 60, size: 32, color: '#F472B6', level: 2 },
  { id: 'skill', label: 'Skill', x: 270, y: 360, size: 32, color: '#A78BFA', level: 2 },
]

const EDGES: [string, string][] = [
  ['core', 'quantity-agent'],
  ['core', 'cost-agent'],
  ['core', 'drawing-agent'],
  ['core', 'construction-agent'],
  ['quantity-agent', 'quantity'],
  ['quantity-agent', 'pricing'],
  ['cost-agent', 'cost-estimate'],
  ['cost-agent', 'cost-control'],
  ['cost-agent', 'contract'],
  ['drawing-agent', 'cad-link'],
  ['drawing-agent', 'drawing-review'],
  ['drawing-agent', 'spec-review'],
  ['construction-agent', 'schedule'],
  ['construction-agent', 'plan-eval'],
  ['construction-agent', 'tender'],
  ['knowledge', 'quantity-agent'],
  ['knowledge', 'drawing-agent'],
  ['skill', 'cost-agent'],
  ['skill', 'construction-agent'],
]

const BY_ID = new Map(NODES.map((node) => [node.id, node]))

/** Bow each edge away from the straight line so overlapping runs stay legible. */
function edgePath(from: Node, to: Node): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy) || 1
  const bow = Math.min(distance * 0.3, 60)
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const controlX = midX + (dy / distance) * bow
  const controlY = midY - (dx / distance) * bow
  return `M${from.x},${from.y} Q${controlX},${controlY} ${to.x},${to.y}`
}

const PATHS = EDGES.flatMap(([fromId, toId]) => {
  const from = BY_ID.get(fromId)
  const to = BY_ID.get(toId)
  return from && to ? [{ id: `${fromId}-${toId}`, d: edgePath(from, to) }] : []
})

export function AgentNetwork() {
  return (
    <svg
      className="agent-network"
      viewBox="0 0 540 420"
      role="img"
      aria-label="工程大模型核心与四大 Agent、应用场景之间的关系示意图"
    >
      <defs>
        <radialGradient id="core-halo">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="core-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>

      {PATHS.map((path, index) => (
        <g key={path.id}>
          <path d={path.d} fill="none" stroke="#3B82F6" strokeWidth={0.6} opacity={0.16} />
          <circle r="1.8" fill="#60A5FA" opacity="0.7">
            <animateMotion
              dur={`${4 + (index % 3) * 2}s`}
              repeatCount="indefinite"
              path={path.d}
            />
          </circle>
        </g>
      ))}

      {NODES.map((node) => {
        const radius = node.size / 2
        const isCore = node.level === 0
        return (
          <g key={node.id}>
            {isCore ? (
              <circle
                className="agent-network__halo"
                cx={node.x}
                cy={node.y}
                r={node.size * 1.2}
                fill="url(#core-halo)"
              />
            ) : null}
            <circle
              cx={node.x}
              cy={node.y}
              r={radius}
              fill={isCore ? 'url(#core-fill)' : `${node.color}26`}
              stroke={node.color}
              strokeOpacity={isCore ? 0.85 : 0.4}
              strokeWidth={1}
            />
            {isCore ? (
              <text
                x={node.x}
                y={node.y + 5}
                textAnchor="middle"
                fill="#fff"
                fontSize="15"
                fontWeight="600"
              >
                AI
              </text>
            ) : (
              <circle
                cx={node.x}
                cy={node.y}
                r={radius * 0.36}
                fill="none"
                stroke={node.color}
                strokeOpacity={0.75}
                strokeWidth={1.1}
              />
            )}
            {node.level <= 1 ? (
              <text
                x={node.x}
                y={node.y + radius + 15}
                textAnchor="middle"
                fill="#94A3B8"
                fontSize="10.5"
              >
                {node.label}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
