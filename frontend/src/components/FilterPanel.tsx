import type { GraphFilters } from "../graph/filter";
import { ORIGIN_KIND_META, REQUIREMENT_KIND_LABELS } from "../graph/vocabulary";

interface FilterPanelProps {
  filters: GraphFilters;
  onChange: (filters: GraphFilters) => void;
  /** 当前数据集中实际出现过的 requirement_kind 值（开放字符串，动态收集）。 */
  availableRequirementKinds: string[];
  /** 后端响应中的真实计数（不写死）。 */
  counts: {
    nodes: number;
    edges: number;
    atomic_requirements: number;
    level_one_requirements: number;
    needs_confirmation: number;
  };
  /** 当前筛选后可见的节点/边数。 */
  visible: { nodes: number; edges: number };
}

function toggleInSet(values: Set<string>, value: string): Set<string> {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

export function FilterPanel(props: FilterPanelProps) {
  const { filters, onChange, availableRequirementKinds, counts, visible } = props;

  return (
    <aside className="filter-panel" aria-label="筛选条件">
      <section className="filter-panel__counts">
        <h3>数据集</h3>
        <dl>
          <div><dt>需求节点</dt><dd>{counts.nodes}</dd></div>
          <div><dt>关系</dt><dd>{counts.edges}</dd></div>
          <div><dt>原子需求</dt><dd>{counts.atomic_requirements}</dd></div>
          <div><dt>一级需求</dt><dd>{counts.level_one_requirements}</dd></div>
          <div><dt>待确认</dt><dd>{counts.needs_confirmation}</dd></div>
          <div className="is-visible"><dt>当前可见</dt><dd>{visible.nodes} 节点 / {visible.edges} 关系</dd></div>
        </dl>
      </section>

      <section>
        <h3>来源贴近度</h3>
        {Object.entries(ORIGIN_KIND_META).map(([kind, meta]) => (
          <label key={kind} className="check-row">
            <input
              type="checkbox"
              checked={filters.originKinds.has(kind)}
              onChange={() =>
                onChange({ ...filters, originKinds: toggleInSet(filters.originKinds, kind) })
              }
            />
            <span className="dot" style={{ backgroundColor: meta.color }} />
            <span>{meta.label}</span>
          </label>
        ))}
      </section>

      <section>
        <h3>需求类型</h3>
        {availableRequirementKinds.map((kind) => (
          <label key={kind} className="check-row">
            <input
              type="checkbox"
              checked={filters.requirementKinds.has(kind)}
              onChange={() =>
                onChange({
                  ...filters,
                  requirementKinds: toggleInSet(filters.requirementKinds, kind),
                })
              }
            />
            <span>{REQUIREMENT_KIND_LABELS[kind] ?? kind}</span>
          </label>
        ))}
      </section>

      <section>
        <h3>属性</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={filters.atomicOnly}
            onChange={(e) => onChange({ ...filters, atomicOnly: e.target.checked })}
          />
          <span>只看原子需求</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={filters.customerVisibleOnly}
            onChange={(e) =>
              onChange({ ...filters, customerVisibleOnly: e.target.checked })
            }
          />
          <span>只看客户可见</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={filters.needsConfirmationOnly}
            onChange={(e) =>
              onChange({ ...filters, needsConfirmationOnly: e.target.checked })
            }
          />
          <span>只看待确认</span>
        </label>
      </section>

      <button
        type="button"
        className="tool-btn tool-btn--block"
        onClick={() =>
          onChange({
            searchText: filters.searchText,
            originKinds: new Set(),
            requirementKinds: new Set(),
            atomicOnly: false,
            customerVisibleOnly: false,
            needsConfirmationOnly: false,
          })
        }
      >
        清空筛选
      </button>
    </aside>
  );
}
