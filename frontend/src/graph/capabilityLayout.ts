import type { RuntimeGraphNode } from "./runtime";

/**
 * 能力原子暂存区布局。
 * 后端尚未为能力原子提供坐标，也不能伪造与需求层的语义关系，
 * 因此把用户加入画布的原子确定性地排在需求云右侧的一块独立区域：
 * 位置只用于“先排开”，没有任何业务含义（图例中明确说明）。
 */

const ZONE_MARGIN = 420;

interface GridParams {
  columns: number;
  spacingX: number;
  spacingY: number;
}

/**
 * 网格参数随暂存数量自适应：几十个原子用大格子方便点选，
 * 成千上万个分类整批时用密格子，避免需求云被稀释成一条细带。
 */
function gridParams(totalCount: number): GridParams {
  if (totalCount <= 64) return { columns: 8, spacingX: 110, spacingY: 70 };
  if (totalCount <= 400) return { columns: 20, spacingX: 60, spacingY: 45 };
  if (totalCount <= 2_500) return { columns: 50, spacingX: 34, spacingY: 26 };
  return {
    columns: Math.ceil(Math.sqrt(totalCount * 1.5)),
    spacingX: 22,
    spacingY: 16,
  };
}

/** 需求层的最大 |x|/|y|，用于把暂存区放到语义布局之外。 */
export function requirementExtent(nodes: RuntimeGraphNode[]): number {
  let extent = 0;
  for (const node of nodes) {
    if (node.nodeKind !== "business_requirement") continue;
    extent = Math.max(extent, Math.abs(node.x), Math.abs(node.y));
  }
  return extent;
}

/**
 * 第 index 个暂存原子的确定性坐标。同一批原子、同一加入顺序下结果稳定。
 * 区域以 (originX, 0) 为左上角向右、向下铺开，并在 Y 方向居中。
 */
export function capabilityZonePosition(
  index: number,
  totalCount: number,
  originX: number,
): { x: number; y: number; z: number } {
  const { columns, spacingX, spacingY } = gridParams(totalCount);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const totalRows = Math.max(1, Math.ceil(totalCount / columns));
  return {
    x: originX + column * spacingX,
    y: (row - (totalRows - 1) / 2) * spacingY,
    z: 0,
  };
}

/** 暂存区整体原点：需求范围之外加安全边距。 */
export function capabilityZoneOriginX(nodes: RuntimeGraphNode[]): number {
  return requirementExtent(nodes) + ZONE_MARGIN;
}
