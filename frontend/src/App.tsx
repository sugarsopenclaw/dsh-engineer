import { useCallback, useMemo, useRef, useState } from "react";
import type { GraphDimensions } from "./api/types";
import { useBusinessRequirementsGraph } from "./api/hooks";
import { adaptGraph } from "./graph/adapt";
import {
  computeNeighborhood,
  EMPTY_FILTERS,
  filterGraph,
  type GraphFilters,
} from "./graph/filter";
import { GraphCanvas, type GraphCanvasHandle } from "./components/GraphCanvas";
import { Toolbar } from "./components/Toolbar";
import { FilterPanel } from "./components/FilterPanel";
import { Legend } from "./components/Legend";
import { DetailDrawer } from "./components/DetailDrawer";
import { useThemeMode } from "./theme";

export function App() {
  const [dimensions, setDimensions] = useState<GraphDimensions>(2);
  const [filters, setFilters] = useState<GraphFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(true);
  // 选中的需求 ID 与维度无关：切换 2D/3D 时保留。
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const [themeMode, toggleThemeMode] = useThemeMode();

  const graphQuery = useBusinessRequirementsGraph(dimensions);

  // DTO → 运行时对象，只在响应变化时重新适配（图库会 mutate 传入对象）。
  const fullGraph = useMemo(
    () => (graphQuery.data ? adaptGraph(graphQuery.data.nodes, graphQuery.data.edges) : null),
    [graphQuery.data],
  );

  const filteredGraph = useMemo(
    () => (fullGraph ? filterGraph(fullGraph, filters) : null),
    [fullGraph, filters],
  );

  const availableRequirementKinds = useMemo(() => {
    if (!fullGraph) return [];
    return Array.from(new Set(fullGraph.nodes.map((n) => n.requirementKind))).sort();
  }, [fullGraph]);

  // 悬停优先，其次选中：高亮该节点的一阶邻接。
  const activeNodeId = hoveredNodeId ?? selectedNodeId;
  const { nodeIds: highlightNodeIds, linkIds: highlightLinkIds } = useMemo(() => {
    if (!activeNodeId || !filteredGraph) {
      return { nodeIds: new Set<string>(), linkIds: new Set<string>() };
    }
    return computeNeighborhood(activeNodeId, filteredGraph.links);
  }, [activeNodeId, filteredGraph]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((current) => (current === nodeId ? null : nodeId));
  }, []);

  const handleNavigate = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    canvasRef.current?.focusNode(nodeId);
  }, []);

  const handleCloseDrawer = useCallback(() => setSelectedNodeId(null), []);

  const graphData = graphQuery.data;

  return (
    <div className="app-shell">
      <Toolbar
        viewName={graphData?.view.name ?? "沈变业务需求图谱"}
        datasetId={graphData?.dataset.dataset_id ?? ""}
        dimensions={dimensions}
        onDimensionsChange={setDimensions}
        searchText={filters.searchText}
        onSearchTextChange={(text) => setFilters((f) => ({ ...f, searchText: text }))}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((open) => !open)}
        onResetView={() => canvasRef.current?.resetView()}
        themeMode={themeMode}
        onToggleThemeMode={toggleThemeMode}
        stats={{
          nodes: graphData?.counts.nodes ?? 0,
          edges: graphData?.counts.edges ?? 0,
          visibleNodes: filteredGraph?.nodes.length ?? 0,
          visibleEdges: filteredGraph?.links.length ?? 0,
        }}
      />

      <div className="app-main">
        {filtersOpen && fullGraph && graphData ? (
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            availableRequirementKinds={availableRequirementKinds}
            counts={graphData.counts}
            visible={{
              nodes: filteredGraph?.nodes.length ?? 0,
              edges: filteredGraph?.links.length ?? 0,
            }}
          />
        ) : null}

        <main className="graph-area">
          {graphQuery.isPending ? (
            <div className="graph-placeholder">正在从后端加载业务需求图谱…</div>
          ) : graphQuery.isError ? (
            <div className="graph-placeholder graph-placeholder--error" role="alert">
              <h2>图谱加载失败</h2>
              <p>{graphQuery.error.message}</p>
              <p className="muted">
                请求地址：/api/v1/business-requirements/graph?dimensions={dimensions}
                （开发代理由 Vite 转发到 http://127.0.0.1:8000）
              </p>
              <p className="muted">
                请先运行根目录 start-backend.cmd 启动后端。前端不会用假数据兜底。
              </p>
              <button
                type="button"
                className="tool-btn"
                onClick={() => void graphQuery.refetch()}
              >
                重试
              </button>
            </div>
          ) : filteredGraph ? (
            <GraphCanvas
              ref={canvasRef}
              dimensions={dimensions}
              themeMode={themeMode}
              graph={filteredGraph}
              highlightNodeIds={highlightNodeIds}
              highlightLinkIds={highlightLinkIds}
              selectedNodeId={selectedNodeId}
              onNodeClick={handleNodeClick}
              onNodeHover={setHoveredNodeId}
            />
          ) : null}
          {graphData ? (
            <p className="origin-hint">{graphData.view.origin_meaning}</p>
          ) : null}
          <Legend />
        </main>

        <DetailDrawer
          requirementId={selectedNodeId}
          onClose={handleCloseDrawer}
          onNavigate={handleNavigate}
        />
      </div>
    </div>
  );
}
