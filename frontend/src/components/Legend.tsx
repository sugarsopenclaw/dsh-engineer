import {
  ORIGIN_KIND_META,
  RELATION_KIND_META,
  ROOT_NODE_COLOR,
  surfaceMeta,
} from "../graph/vocabulary";

/**
 * 图例：只解释契约明确的语义。
 * 坐标含义：越靠近原点，越贴近客户原始需求表达；角度和 Z 高度暂无业务含义。
 * 能力原子按技术面着色、方块形状；暂存区位置无业务含义（后端尚未提供原子坐标）。
 */
export function Legend(props: { capabilitySurfaces: string[] }) {
  const { capabilitySurfaces } = props;
  return (
    <div className="legend" aria-label="图例">
      <p className="legend__title">越靠近中心，越贴近客户原始需求</p>
      <ul>
        <li>
          <span className="dot" style={{ backgroundColor: ROOT_NODE_COLOR }} />
          需求原点（BR-000）
        </li>
        {Object.entries(ORIGIN_KIND_META).map(([kind, meta]) => (
          <li key={kind} title={meta.description}>
            <span className="dot" style={{ backgroundColor: meta.color }} />
            {meta.label}
          </li>
        ))}
        <li>
          <span className="dot dot--dashed" />
          待确认需求（虚线外环）
        </li>
      </ul>
      <ul className="legend__links">
        {Object.entries(RELATION_KIND_META).map(([kind, meta]) => (
          <li key={kind}>
            <span className="line-swatch" style={{ backgroundColor: meta.color }} />
            {meta.label}关系
          </li>
        ))}
      </ul>
      {capabilitySurfaces.length > 0 ? (
        <>
          <p className="legend__title legend__title--sub">能力原子（按技术面，方块）</p>
          <ul>
            {capabilitySurfaces.map((surface) => {
              const meta = surfaceMeta(surface);
              return (
                <li key={surface}>
                  <span className="square" style={{ backgroundColor: meta.color }} />
                  {meta.label}
                </li>
              );
            })}
            <li className="legend__note">暂存区位置无业务含义</li>
          </ul>
        </>
      ) : null}
    </div>
  );
}
