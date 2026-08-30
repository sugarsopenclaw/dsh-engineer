import { useCallback, useMemo, useRef, useState } from "react";
import type {
  CapabilityAtomsQuery,
  CapabilityGraphAtomDto,
  GraphDimensions,
} from "./api/types";
import {
  useBusinessRequirementsGraph,
  useCapabilityAtoms,
  useCapabilityFacets,
} from "./api/hooks";
import { adaptCapabilityAtom, adaptGraph, mergeGraphs } from "./graph/adapt";
import { capabilityZoneOriginX, capabilityZonePosition } from "./graph/capabilityLayout";
import {
  loadAllMatchingAtoms,
  mergeAtomsById,
  MAX_BULK_ATOMS,
  SLOW_CANVAS_HINT_ATOMS,
} from "./graph/capabilityBulk";
import {
  computeNeighborhood,
  EMPTY_FILTERS,
  filterGraph,
  type GraphFilters,
} from "./graph/filter";
import type { GraphNodeKind, RuntimeGraph } from "./graph/runtime";
import { GraphCanvas, type GraphCanvasHandle } from "./components/GraphCanvas";
import { Toolbar } from "./components/Toolbar";
import { FilterPanel } from "./components/FilterPanel";
import { CapabilityPanel } from "./components/CapabilityPanel";
import { Legend } from "./components/Legend";
import { DetailDrawer, type NodeSelection } from "./components/DetailDrawer";
import { useThemeMode } from "./theme";

export function App() {
  const [dimensions, setDimensions] = useState<GraphDimensions>(2);
  const [filters, setFilters] = useState<GraphFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(true);
  // 选中的节点与维度无关：切换 2D/3D 时保留。
  const [selection, setSelection] = useState<NodeSelection | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const [themeMode, toggleThemeMode] = useThemeMode();

  const graphQuery = useBusinessRequirementsGraph(dimensions);

  /* ---------------- 能力原子图层状态 ---------------- */

  const [capabilityPanelOpen, setCapabilityPanelOpen] = useState(false);
  const [capabilityQuery, setCapabilityQuery] = useState<CapabilityAtomsQuery>({
    limit: 50,
    offset: 0,
  });
  // 只有用户显式加入的原子才进画布（79,549 个原子禁止整批加载）。
  const [addedAtoms, setAddedAtoms] = useState<CapabilityGraphAtomDto[]>([]);
  // 按分类整批加载的进度与错误；AbortController 用于取消进行中的流式加载。
  const [bulkProgress, setBulkProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const bulkAbortRef = useRef<AbortController | null>(null);

  const facetsQuery = useCapabilityFacets(capabilityPanelOpen);
  const atomsQuery = useCapabilityAtoms(capabilityQuery, capabilityPanelOpen);

  const addedAtomIds = useMemo(
    () => new Set(addedAtoms.map((a) => a.atom_id)),
    [addedAtoms],
  );

  const handleCapabilityQueryChange = useCallback(
    (patch: Partial<CapabilityAtomsQuery>) =>
      setCapabilityQuery((current) => ({ ...current, ...patch })),
    [],
  );

  const handleAddAtom = useCallback((atom: CapabilityGraphAtomDto) => {
    setAddedAtoms((current) =>
      current.some((a) => a.atom_id === atom.atom_id) ? current : [...current, atom],
    );
  }, []);

  const handleRemoveAtom = useCallback((atomId: string) => {
    setAddedAtoms((current) => current.filter((a) => a.atom_id !== atomId));
  }, []);

  const handleClearAtoms = useCallback(() => setAddedAtoms([]), []);

  /**
   * 按分类整批加载：一次 fetch 流式拉取 graph-atoms NDJSON，去重后并入画布。
   * total 由面板从分页响应给出，上限 MAX_BULK_ATOMS 是前端渲染预算。
   */
  const handleBulkLoad = useCallback(
    async (filter: Omit<CapabilityAtomsQuery, "limit" | "offset">, total: number) => {
      if (bulkProgress !== null || total <= 0 || total > MAX_BULK_ATOMS) return;
      const controller = new AbortController();
      bulkAbortRef.current = controller;
      setBulkError(null);
      setBulkProgress({ loaded: 0, total });
      try {
        const collected = await loadAllMatchingAtoms(filter, {
          onProgress: (loaded, expected) => setBulkProgress({ loaded, total: expected }),
          signal: controller.signal,
          expectedTotal: total,
        });
        setAddedAtoms((current) => mergeAtomsById(current, collected));
      } catch (error) {
        // 取消即整批丢弃，不留半截数据；AbortError 不算错误。
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setBulkError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        bulkAbortRef.current = null;
        setBulkProgress(null);
      }
    },
    [bulkProgress],
  );

  const handleCancelBulkLoad = useCallback(() => {
    bulkAbortRef.current?.abort();
  }, []);

  /* ---------------- 同一张图：需求层 + 能力原子暂存区 ---------------- */

  // DTO → 运行时对象，只在响应变化时重新适配（图库会 mutate 传入对象）。
  const requirementGraph = useMemo(
    () => (graphQuery.data ? adaptGraph(graphQuery.data.nodes, graphQuery.data.edges) : null),
    [graphQuery.data],
  );

  const capabilityGraph = useMemo<RuntimeGraph>(() => {
    if (!requirementGraph || addedAtoms.length === 0) {
      return { nodes: [], links: [] };
    }
    const originX = capabilityZoneOriginX(requirementGraph.nodes);
    return {
      // 暂存区坐标只是“先排开”，没有任何业务含义（图例注明）。
      nodes: addedAtoms.map((atom, index) =>
        adaptCapabilityAtom(atom, capabilityZonePosition(index, addedAtoms.length, originX)),
      ),
      // 后端尚未提供需求→能力原子的正式关系，这里不伪造连线；
      // mergeGraphs 的 links 结构可以直接接收后端未来的跨层边。
      links: [],
    };
  }, [requirementGraph, addedAtoms]);

  const fullGraph = useMemo(
    () => (requirementGraph ? mergeGraphs(requirementGraph, capabilityGraph) : null),
    [requirementGraph, capabilityGraph],
  );

  const filteredGraph = useMemo(
    () => (fullGraph ? filterGraph(fullGraph, filters) : null),
    [fullGraph, filters],
  );

  const availableRequirementKinds = useMemo(() => {
    if (!requirementGraph) return [];
    const kinds = new Set<string>();
    for (const node of requirementGraph.nodes) {
      if (node.nodeKind === "business_requirement") kinds.add(node.requirementKind);
    }
    return Array.from(kinds).sort();
  }, [requirementGraph]);

  // 图例展示当前画布上实际出现的能力技术面（开放字符串，动态收集）。
  const capabilitySurfacesOnCanvas = useMemo(() => {
    const surfaces = new Set<string>();
    for (const node of capabilityGraph.nodes) {
      if (node.nodeKind === "capability_atom") surfaces.add(node.surface);
    }
    return Array.from(surfaces).sort();
  }, [capabilityGraph]);

  /* ---------------- 选中 / 高亮 ---------------- */

  // 悬停优先，其次选中：高亮该节点的一阶邻接。
  const activeNodeId = hoveredNodeId ?? selection?.id ?? null;
  const { nodeIds: highlightNodeIds, linkIds: highlightLinkIds } = useMemo(() => {
    if (!activeNodeId || !filteredGraph) {
      return { nodeIds: new Set<string>(), linkIds: new Set<string>() };
    }
    return computeNeighborhood(activeNodeId, filteredGraph.links);
  }, [activeNodeId, filteredGraph]);

  const handleNodeClick = useCallback((nodeId: string, nodeKind: GraphNodeKind) => {
    setSelection((current) =>
      current?.id === nodeId ? null : { id: nodeId, kind: nodeKind },
    );
  }, []);

  const handleNavigate = useCallback((nodeId: string) => {
    setSelection({ id: nodeId, kind: "business_requirement" });
    canvasRef.current?.focusNode(nodeId);
  }, []);

  const handleShowAtomDetail = useCallback((atomId: string) => {
    setSelection({ id: atomId, kind: "capability_atom" });
  }, []);

  const handleLocateAtom = useCallback((atomId: string) => {
    canvasRef.current?.focusNode(atomId);
  }, []);

  const handleCloseDrawer = useCallback(() => setSelection(null), []);

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
        capabilityPanelOpen={capabilityPanelOpen}
        onToggleCapabilityPanel={() => setCapabilityPanelOpen((open) => !open)}
        onResetView={() => canvasRef.current?.resetView()}
        themeMode={themeMode}
        onToggleThemeMode={toggleThemeMode}
        stats={{
          nodes: (graphData?.counts.nodes ?? 0) + addedAtoms.length,
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

        {capabilityPanelOpen ? (
          <CapabilityPanel
            facetsQuery={facetsQuery}
            atomsQuery={atomsQuery}
            query={capabilityQuery}
            onQueryChange={handleCapabilityQueryChange}
            addedAtomIds={addedAtomIds}
            addedCount={addedAtoms.length}
            onAdd={handleAddAtom}
            onRemove={handleRemoveAtom}
            onClear={handleClearAtoms}
            onLocate={handleLocateAtom}
            onShowDetail={handleShowAtomDetail}
            bulkProgress={bulkProgress}
            bulkError={bulkError}
            onBulkLoad={handleBulkLoad}
            onCancelBulkLoad={handleCancelBulkLoad}
            slowCanvasHint={addedAtoms.length > SLOW_CANVAS_HINT_ATOMS}
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
              selectedNodeId={selection?.id ?? null}
              onNodeClick={handleNodeClick}
              onNodeHover={setHoveredNodeId}
            />
          ) : null}
          {graphData ? (
            <p className="origin-hint">{graphData.view.origin_meaning}</p>
          ) : null}
          <Legend capabilitySurfaces={capabilitySurfacesOnCanvas} />
        </main>

        <DetailDrawer
          selection={selection}
          onClose={handleCloseDrawer}
          onNavigate={handleNavigate}
        />
      </div>
    </div>
  );
}
