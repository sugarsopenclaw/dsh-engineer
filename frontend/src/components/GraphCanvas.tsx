import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import ForceGraph2D, {
  type ForceGraphMethods as ForceGraph2DMethods,
  type NodeObject as FG2DNodeObject,
  type LinkObject as FG2DLinkObject,
} from "react-force-graph-2d";
import type ForceGraph3DComponent from "react-force-graph-3d";
import {
  type ForceGraphMethods as ForceGraph3DMethods,
  type NodeObject as FG3DNodeObject,
  type LinkObject as FG3DLinkObject,
} from "react-force-graph-3d";
import type { GraphDimensions } from "../api/types";
import type { RuntimeGraph, RuntimeGraphLink, RuntimeGraphNode } from "../graph/runtime";
import { linkEndpointId } from "../graph/filter";
import { nodeColor, RELATION_KIND_META } from "../graph/vocabulary";
import { CANVAS_PALETTES, type ThemeMode } from "../theme";

// three.js 体积大，3D 引擎按需懒加载；类型上仍对齐原组件签名（含 ref 转发）。
const ForceGraph3D = lazy(() => import("react-force-graph-3d")) as unknown as typeof ForceGraph3DComponent;

export interface GraphCanvasHandle {
  /** 重置缩放与相机，回到“全图适配”。 */
  resetView: () => void;
  /** 视图聚焦到指定节点（用于搜索跳转和选中）。 */
  focusNode: (nodeId: string) => void;
}

interface GraphCanvasProps {
  dimensions: GraphDimensions;
  themeMode: ThemeMode;
  graph: RuntimeGraph;
  /** 当前高亮的节点/边集合（悬停或选中节点的一阶邻接）；为空表示无高亮状态。 */
  highlightNodeIds: Set<string>;
  highlightLinkIds: Set<string>;
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
  onNodeHover: (nodeId: string | null) => void;
}

type FGNode = FG2DNodeObject & FG3DNodeObject & RuntimeGraphNode;
type FGLink = FG2DLinkObject & FG3DLinkObject & RuntimeGraphLink;

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 图谱画布。后端已给出语义坐标（越靠近原点越贴近客户原始需求），
 * 因此彻底关闭力导向排布：cooldownTicks/warmupTicks=0，节点位置只来自 position.x/y/z。
 * 不保存用户拖拽位置（首版规格），拖拽本身也禁用，避免破坏语义布局。
 */
export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  function GraphCanvas(props, ref) {
    const {
      dimensions,
      themeMode,
      graph,
      highlightNodeIds,
      highlightLinkIds,
      selectedNodeId,
      onNodeClick,
      onNodeHover,
    } = props;

    const palette = CANVAS_PALETTES[themeMode];

    const fg2dRef = useRef<ForceGraph2DMethods<FGNode, FGLink> | undefined>(undefined);
    const fg3dRef = useRef<ForceGraph3DMethods<FGNode, FGLink> | undefined>(undefined);
    const containerRef = useRef<HTMLDivElement>(null);
    const prevDimensionsRef = useRef(dimensions);

    // 抽屉开合、筛选面板切换都会改变容器尺寸而不触发 window resize，
    // 用 ResizeObserver 显式把容器尺寸喂给画布。
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    useEffect(() => {
      const element = containerRef.current;
      if (!element) return;
      const observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect && rect.width > 0 && rect.height > 0) {
          setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
        }
      });
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    const hasHighlight = highlightNodeIds.size > 0;

    const resetView = useCallback(() => {
      if (dimensions === 2) {
        fg2dRef.current?.zoomToFit(600, 48);
      } else {
        fg3dRef.current?.zoomToFit(600, 48);
      }
    }, [dimensions]);

    const focusNode = useCallback(
      (nodeId: string) => {
        const node = graph.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        if (dimensions === 2) {
          fg2dRef.current?.centerAt(node.x, node.y, 500);
          fg2dRef.current?.zoom(2.2, 500);
        } else {
          const distance = 260;
          const hypot = Math.hypot(node.x, node.y, node.z) || 1;
          const ratio = 1 + distance / hypot;
          fg3dRef.current?.cameraPosition(
            { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
            { x: node.x, y: node.y, z: node.z },
            800,
          );
        }
      },
      [dimensions, graph],
    );

    useImperativeHandle(ref, () => ({ resetView, focusNode }), [resetView, focusNode]);

    // 首次加载和数据变化后适配全图；切换维度时若选中节点仍可见，则镜头定位到它。
    useEffect(() => {
      const dimensionsChanged = prevDimensionsRef.current !== dimensions;
      prevDimensionsRef.current = dimensions;
      const timer = window.setTimeout(() => {
        if (
          dimensionsChanged &&
          selectedNodeId &&
          graph.nodes.some((n) => n.id === selectedNodeId)
        ) {
          focusNode(selectedNodeId);
        } else {
          resetView();
        }
      }, 80);
      return () => window.clearTimeout(timer);
    }, [resetView, focusNode, graph, dimensions, selectedNodeId]);

    const nodeVisibilityColor = useCallback(
      (node: FGNode): string => {
        const base = nodeColor(node.originKind, node.sourceProximityRank);
        if (!hasHighlight) return base;
        return highlightNodeIds.has(node.id)
          ? base
          : withAlpha(base, palette.dimNodeAlpha);
      },
      [hasHighlight, highlightNodeIds, palette],
    );

    const linkColor = useCallback(
      (link: FGLink): string => {
        if (hasHighlight) {
          return highlightLinkIds.has(link.id) ? palette.highlightLink : palette.dimLink;
        }
        return RELATION_KIND_META[link.relationKind]?.color ?? "rgba(148,163,184,0.4)";
      },
      [hasHighlight, highlightLinkIds, palette],
    );

    const linkWidth = useCallback(
      (link: FGLink): number => (hasHighlight && highlightLinkIds.has(link.id) ? 2.4 : 1),
      [hasHighlight, highlightLinkIds],
    );

    const paintNode2D = useCallback(
      (node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const size = node.sourceProximityRank === 0 ? 7 : node.atomic ? 3.2 : 4.6;
        const isSelected = node.id === selectedNodeId;
        const isHighlighted = highlightNodeIds.has(node.id);
        const dimmed = hasHighlight && !isHighlighted;
        const color = nodeVisibilityColor(node);

        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();

        if (isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, size + 2.6, 0, 2 * Math.PI);
          ctx.strokeStyle = palette.selectionRing;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }

        // 待确认需求用虚线外环标记（这是业务字段，不是坐标语义）。
        if (node.needsConfirmation) {
          ctx.beginPath();
          ctx.setLineDash([2, 2]);
          ctx.arc(node.x, node.y, size + 1.8, 0, 2 * Math.PI);
          ctx.strokeStyle = dimmed
            ? withAlpha("#f97316", palette.dimNodeAlpha)
            : "rgba(249, 115, 22, 0.9)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // 缩放足够近、或处于高亮/选中、或是一级及以上节点时绘制标签。
        const showLabel =
          globalScale > 1.35 || isSelected || isHighlighted || node.derivedMinDepth <= 1;
        if (showLabel && !dimmed) {
          const fontSize = Math.max(11 / globalScale, 2.6);
          ctx.font = `${isSelected ? "600 " : ""}${fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = dimmed
            ? withAlpha("#94a3b8", palette.dimNodeAlpha)
            : palette.label;
          ctx.fillText(node.label, node.x, node.y + size + 1.6);
        }
      },
      [hasHighlight, highlightNodeIds, nodeVisibilityColor, palette, selectedNodeId],
    );

    const paintPointerArea2D = useCallback(
      (node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
        const size = node.sourceProximityRank === 0 ? 9 : 6;
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      },
      [],
    );

    const commonGraphProps = useMemo(
      () => ({
        graphData: graph,
        nodeId: "id",
        linkSource: "source",
        linkTarget: "target",
        // 关闭力导向：不 warm up、不 tick，位置完全由后端坐标决定。
        warmupTicks: 0,
        cooldownTicks: 0,
        enableNodeDrag: false,
        enablePanInteraction: true,
        enableZoomInteraction: true,
        ...(size ? { width: size.width, height: size.height } : {}),
      }),
      [graph, size],
    );

    const nodeLabel = useCallback(
      (node: FGNode) =>
        `${node.id} · ${node.label}${node.needsConfirmation ? "（待确认）" : ""}`,
      [],
    );

    const linkLabel = useCallback(
      (link: FGLink) =>
        `${RELATION_KIND_META[link.relationKind]?.label ?? link.relationKind}：${linkEndpointId(link.source)} → ${linkEndpointId(link.target)}`,
      [],
    );

    const handleNodeClick = useCallback(
      (node: FGNode) => onNodeClick(node.id),
      [onNodeClick],
    );
    const handleNodeHover = useCallback(
      (node: FGNode | null) => onNodeHover(node ? node.id : null),
      [onNodeHover],
    );

    return (
      <div ref={containerRef} className="graph-canvas">
        {dimensions === 2 ? (
          <ForceGraph2D
            ref={fg2dRef as never}
            {...commonGraphProps}
            backgroundColor={palette.background}
            nodeCanvasObject={paintNode2D}
            nodePointerAreaPaint={paintPointerArea2D}
            linkColor={linkColor}
            linkWidth={linkWidth}
            linkDirectionalArrowLength={3.5}
            linkDirectionalArrowRelPos={0.85}
            linkLabel={linkLabel}
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
          />
        ) : (
          <Suspense
            fallback={<div className="graph-placeholder">正在加载 3D 引擎…</div>}
          >
            <ForceGraph3D
              ref={fg3dRef as never}
              {...commonGraphProps}
              backgroundColor={palette.background}
              nodeColor={nodeVisibilityColor}
              nodeVal={(node: FGNode) => (node.sourceProximityRank === 0 ? 16 : node.atomic ? 4 : 7)}
              nodeOpacity={0.95}
              nodeResolution={16}
              nodeLabel={nodeLabel}
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkOpacity={0.5}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={0.85}
              linkLabel={linkLabel}
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
            />
          </Suspense>
        )}
      </div>
    );
  },
);
