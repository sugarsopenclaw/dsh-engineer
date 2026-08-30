import { useEffect, useState } from "react";
import type {
  CapabilityAtomsPageResponse,
  CapabilityAtomsQuery,
  CapabilityAtomSummaryDto,
  CapabilityFacetValue,
  CapabilityFacetsResponse,
} from "../api/types";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  ATOM_KIND_LABELS,
  CLASSIFICATION_STATUS_LABELS,
  OPERATION_KIND_LABELS,
  surfaceMeta,
  translate,
} from "../graph/vocabulary";
import { MAX_BULK_ATOMS } from "../graph/capabilityBulk";

interface CapabilityPanelProps {
  facetsQuery: UseQueryResult<CapabilityFacetsResponse, Error>;
  atomsQuery: UseQueryResult<CapabilityAtomsPageResponse, Error>;
  query: CapabilityAtomsQuery;
  onQueryChange: (patch: Partial<CapabilityAtomsQuery>) => void;
  addedAtomIds: Set<string>;
  addedCount: number;
  onAdd: (atom: CapabilityAtomSummaryDto) => void;
  onRemove: (atomId: string) => void;
  onClear: () => void;
  onLocate: (atomId: string) => void;
  onShowDetail: (atomId: string) => void;
  /** 整批加载进度；非 null 表示正在加载。 */
  bulkProgress: { loaded: number; total: number } | null;
  bulkError: string | null;
  /** 按分类整批加载（filter 为分类条件，total 为该条件总数）。 */
  onBulkLoad: (
    filter: Omit<CapabilityAtomsQuery, "limit" | "offset">,
    total: number,
  ) => void;
  onCancelBulkLoad: () => void;
  /** 画布原子数较多时提示交互可能变慢。 */
  slowCanvasHint: boolean;
}

function FacetSelect(props: {
  label: string;
  values: CapabilityFacetValue[] | undefined;
  current: string | undefined;
  labels?: Record<string, string>;
  onChange: (value: string | undefined) => void;
}) {
  const { label, values, current, labels, onChange } = props;
  return (
    <label className="facet-field">
      <span>{label}</span>
      <select
        value={current ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      >
        <option value="">全部</option>
        {(values ?? []).map((facet) => (
          <option key={facet.value} value={facet.value}>
            {translate(labels ?? {}, facet.value)}（{facet.count}）
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * 能力原子面板：facets 驱动的筛选 + 服务端搜索/分页。
 * 79,549 个原子不整批进图，只有用户显式“加入画布”的原子才成为图节点。
 */
export function CapabilityPanel(props: CapabilityPanelProps) {
  const {
    facetsQuery,
    atomsQuery,
    query,
    onQueryChange,
    addedAtomIds,
    addedCount,
    onAdd,
    onRemove,
    onClear,
    onLocate,
    onShowDetail,
    bulkProgress,
    bulkError,
    onBulkLoad,
    onCancelBulkLoad,
    slowCanvasHint,
  } = props;

  // 搜索框本地防抖 300ms，避免每次按键都打一次服务端查询。
  const [searchInput, setSearchInput] = useState(query.q ?? "");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchInput !== (query.q ?? "")) {
        onQueryChange({ q: searchInput || undefined, offset: 0 });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, query.q, onQueryChange]);

  const facets = facetsQuery.data;
  const page = atomsQuery.data;
  const pageStart = page && page.total > 0 ? page.offset + 1 : 0;
  const pageEnd = page ? Math.min(page.offset + page.items.length, page.total) : 0;

  const setFilter = (patch: Partial<CapabilityAtomsQuery>) =>
    onQueryChange({ ...patch, offset: 0 });

  return (
    <aside className="filter-panel capability-panel" aria-label="CAD 能力原子">
      <section>
        <h3>能力原子检索</h3>
        <input
          type="search"
          className="capability-panel__search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="成员名 / 签名 / 声明符号…"
          aria-label="搜索能力原子"
        />
      </section>

      {facetsQuery.isError ? (
        <p className="empty-hint">筛选项加载失败：{facetsQuery.error.message}</p>
      ) : (
        <section className="facet-grid">
          <FacetSelect
            label="技术面"
            values={facets?.surfaces}
            current={query.surface}
            onChange={(surface) => setFilter({ surface })}
          />
          <FacetSelect
            label="宿主"
            values={facets?.observed_host_ids}
            current={query.observed_host_id}
            onChange={(observed_host_id) => setFilter({ observed_host_id })}
          />
          <FacetSelect
            label="原子种类"
            values={facets?.atom_kinds}
            current={query.atom_kind}
            labels={ATOM_KIND_LABELS}
            onChange={(atom_kind) => setFilter({ atom_kind })}
          />
          <FacetSelect
            label="分类状态"
            values={facets?.classification_statuses}
            current={query.classification_status}
            labels={CLASSIFICATION_STATUS_LABELS}
            onChange={(classification_status) => setFilter({ classification_status })}
          />
          <FacetSelect
            label="操作类型"
            values={facets?.operation_kinds}
            current={query.operation_kind}
            labels={OPERATION_KIND_LABELS}
            onChange={(operation_kind) => setFilter({ operation_kind })}
          />
          <FacetSelect
            label="领域标签"
            values={facets?.domain_tags}
            current={query.domain_tag}
            onChange={(domain_tag) => setFilter({ domain_tag })}
          />
        </section>
      )}

      {facets && facets.surfaces.length > 0 ? (
        <section>
          <h3>按技术面整层加载</h3>
          <div className="bulk-chips">
            {facets.surfaces.map((facet) => {
              const meta = surfaceMeta(facet.value);
              const tooMany = facet.count > MAX_BULK_ATOMS;
              return (
                <button
                  key={facet.value}
                  type="button"
                  className="mini-btn bulk-chip"
                  disabled={bulkProgress !== null || tooMany}
                  title={
                    tooMany
                      ? `${facet.count} 个超过单批上限 ${MAX_BULK_ATOMS}，请先用领域标签等条件细分`
                      : `把全部 ${facet.count} 个 ${meta.label} 原子加入画布`
                  }
                  onClick={() => onBulkLoad({ surface: facet.value }, facet.count)}
                >
                  <span className="dot" style={{ backgroundColor: meta.color }} />
                  {meta.label}（{facet.count}）
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="capability-panel__results">
        <h3>
          检索结果
          {page ? (
            <span className="count-badge">
              {pageStart}–{pageEnd} / {page.total}
            </span>
          ) : null}
        </h3>

        {page && page.total > 0 ? (
          <div className="bulk-row">
            <button
              type="button"
              className="mini-btn"
              disabled={bulkProgress !== null || page.total > MAX_BULK_ATOMS}
              title={
                page.total > MAX_BULK_ATOMS
                  ? `${page.total} 个超过单批上限 ${MAX_BULK_ATOMS}，请再加筛选条件`
                  : "把当前筛选的全部结果加入画布"
              }
              onClick={() => {
                onBulkLoad(
                  {
                    surface: query.surface,
                    observed_host_id: query.observed_host_id,
                    atom_kind: query.atom_kind,
                    classification_status: query.classification_status,
                    operation_kind: query.operation_kind,
                    domain_tag: query.domain_tag,
                    q: query.q,
                  },
                  page.total,
                );
              }}
            >
              整批加载 {page.total} 个
            </button>
          </div>
        ) : null}

        {bulkProgress ? (
          <div className="bulk-progress" role="status">
            <div
              className="bulk-progress__bar"
              style={{
                width: `${Math.min(100, (bulkProgress.loaded / bulkProgress.total) * 100)}%`,
              }}
            />
            <span className="bulk-progress__text">
              已加载 {bulkProgress.loaded} / {bulkProgress.total}
            </span>
            <button type="button" className="mini-btn" onClick={onCancelBulkLoad}>
              取消
            </button>
          </div>
        ) : null}
        {bulkError ? <p className="empty-hint">整批加载失败：{bulkError}</p> : null}

        {atomsQuery.isPending ? (
          <p className="empty-hint">正在查询…</p>
        ) : atomsQuery.isError ? (
          <div className="empty-hint">
            <p>查询失败：{atomsQuery.error.message}</p>
            <button type="button" className="tool-btn" onClick={() => void atomsQuery.refetch()}>
              重试
            </button>
          </div>
        ) : page && page.items.length === 0 ? (
          <p className="empty-hint">没有匹配的原子</p>
        ) : (
          <ul className="atom-list">
            {page?.items.map((atom) => {
              const added = addedAtomIds.has(atom.atom_id);
              const meta = surfaceMeta(atom.surface);
              return (
                <li key={atom.atom_id} className="atom-item">
                  <button
                    type="button"
                    className="atom-item__main"
                    onClick={() => onShowDetail(atom.atom_id)}
                    title={atom.member_signature ?? atom.member_name}
                  >
                    <span className="atom-item__name">{atom.member_name}</span>
                    <span className="atom-item__symbol">
                      {atom.declaring_symbol_full_name ?? atom.atom_id}
                    </span>
                    <span className="atom-item__badges">
                      <span className="dot" style={{ backgroundColor: meta.color }} />
                      {meta.label}
                      {" · "}
                      {translate(ATOM_KIND_LABELS, atom.atom_kind)}
                      {atom.operation_kinds.length > 0
                        ? ` · ${atom.operation_kinds
                            .slice(0, 3)
                            .map((k) => translate(OPERATION_KIND_LABELS, k))
                            .join("/")}`
                        : ""}
                    </span>
                  </button>
                  <div className="atom-item__actions">
                    <button
                      type="button"
                      className={added ? "mini-btn is-added" : "mini-btn"}
                      onClick={() => (added ? onRemove(atom.atom_id) : onAdd(atom))}
                    >
                      {added ? "✓ 已在画布" : "＋ 加入"}
                    </button>
                    {added ? (
                      <button
                        type="button"
                        className="mini-btn"
                        onClick={() => onLocate(atom.atom_id)}
                      >
                        定位
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {page && page.total > page.limit ? (
          <div className="pager">
            <button
              type="button"
              className="tool-btn"
              disabled={query.offset <= 0}
              onClick={() => onQueryChange({ offset: Math.max(0, query.offset - query.limit) })}
            >
              上一页
            </button>
            <button
              type="button"
              className="tool-btn"
              disabled={page.offset + page.items.length >= page.total}
              onClick={() => onQueryChange({ offset: query.offset + query.limit })}
            >
              下一页
            </button>
          </div>
        ) : null}
      </section>

      <section className="capability-panel__footer">
        <span className="muted">
          已加入画布 {addedCount} 个
          {slowCanvasHint ? "（较多，交互可能变慢）" : ""}
        </span>
        {addedCount > 0 ? (
          <button type="button" className="tool-btn" onClick={onClear}>
            清空画布原子
          </button>
        ) : null}
      </section>
    </aside>
  );
}
