import type { GraphDimensions } from "../api/types";
import type { ThemeMode } from "../theme";

interface ToolbarProps {
  viewName: string;
  datasetId: string;
  dimensions: GraphDimensions;
  onDimensionsChange: (dimensions: GraphDimensions) => void;
  searchText: string;
  onSearchTextChange: (text: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onResetView: () => void;
  themeMode: ThemeMode;
  onToggleThemeMode: () => void;
  stats: {
    nodes: number;
    edges: number;
    visibleNodes: number;
    visibleEdges: number;
  };
}

export function Toolbar(props: ToolbarProps) {
  const {
    viewName,
    datasetId,
    dimensions,
    onDimensionsChange,
    searchText,
    onSearchTextChange,
    filtersOpen,
    onToggleFilters,
    onResetView,
    themeMode,
    onToggleThemeMode,
    stats,
  } = props;

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <h1>{viewName}</h1>
        <span className="toolbar__dataset" title={datasetId}>
          {datasetId}
        </span>
      </div>

      <div className="toolbar__search">
        <input
          type="search"
          value={searchText}
          onChange={(e) => onSearchTextChange(e.target.value)}
          placeholder="搜索需求 ID 或名称…"
          aria-label="搜索需求"
        />
      </div>

      <div className="toolbar__actions">
        <div className="segmented" role="group" aria-label="维度切换">
          <button
            type="button"
            className={dimensions === 2 ? "segmented__item is-active" : "segmented__item"}
            onClick={() => onDimensionsChange(2)}
          >
            2D
          </button>
          <button
            type="button"
            className={dimensions === 3 ? "segmented__item is-active" : "segmented__item"}
            onClick={() => onDimensionsChange(3)}
          >
            3D
          </button>
        </div>
        <button
          type="button"
          className={filtersOpen ? "tool-btn is-active" : "tool-btn"}
          onClick={onToggleFilters}
        >
          筛选
        </button>
        <button type="button" className="tool-btn" onClick={onResetView}>
          重置视角
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onToggleThemeMode}
          aria-label={themeMode === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          title={themeMode === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        >
          {themeMode === "dark" ? "浅色" : "深色"}
        </button>
        <span className="toolbar__stats">
          {stats.visibleNodes}/{stats.nodes} 节点 · {stats.visibleEdges}/{stats.edges} 关系
        </span>
      </div>
    </header>
  );
}
