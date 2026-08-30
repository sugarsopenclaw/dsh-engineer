import { useEffect } from "react";
import { useBusinessRequirementDetail, useCapabilityAtomDetail } from "../api/hooks";
import type { BusinessRequirementGraphEdgeDto } from "../api/types";
import type { GraphNodeKind } from "../graph/runtime";
import { CapabilityDetailBody } from "./CapabilityDetail";
import {
  CRITERION_STATUS_LABELS,
  EVIDENCE_KIND_LABELS,
  LIFECYCLE_STATUS_LABELS,
  ORIGIN_KIND_META,
  QUESTION_STATUS_LABELS,
  RELATION_KIND_META,
  REQUIREMENT_KIND_LABELS,
  translate,
} from "../graph/vocabulary";

export interface NodeSelection {
  id: string;
  kind: GraphNodeKind;
}

interface DetailDrawerProps {
  /** 选中的节点；null 时抽屉关闭，也不发起详情请求。 */
  selection: NodeSelection | null;
  onClose: () => void;
  /** 点击上下游关系中的节点时切换选中（仅业务需求有上下游关系）。 */
  onNavigate: (requirementId: string) => void;
}

function RelationList(props: {
  title: string;
  relations: BusinessRequirementGraphEdgeDto[];
  selfId: string;
  onNavigate: (requirementId: string) => void;
}) {
  const { title, relations, selfId, onNavigate } = props;
  return (
    <section className="drawer-section">
      <h3>
        {title}
        <span className="count-badge">{relations.length}</span>
      </h3>
      {relations.length === 0 ? (
        <p className="empty-hint">无</p>
      ) : (
        <ul className="relation-list">
          {relations.map((rel) => {
            const otherId =
              rel.source_node_id === selfId ? rel.target_node_id : rel.source_node_id;
            const arrow = rel.source_node_id === selfId ? "→" : "←";
            return (
              <li key={rel.id}>
                <button type="button" onClick={() => onNavigate(otherId)}>
                  <span className="relation-kind">
                    {RELATION_KIND_META[rel.relation_kind]?.label ?? rel.relation_kind}
                  </span>
                  <span className="relation-arrow">{arrow}</span>
                  <span className="relation-target">{otherId}</span>
                </button>
                {rel.rationale ? <p className="relation-rationale">{rel.rationale}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * 右侧详情抽屉。仅在点击节点后请求详情接口；
 * verbatim_text 属于客户资料，只在这里（用户主动打开后）展示，不写入 URL 或浏览器存储。
 * 业务需求与能力原子共用同一抽屉，按节点类型路由到各自详情视图。
 */
export function DetailDrawer(props: DetailDrawerProps) {
  const { selection, onClose, onNavigate } = props;
  const isRequirement = selection?.kind === "business_requirement";
  const requirementQuery = useBusinessRequirementDetail(
    isRequirement && selection ? selection.id : null,
  );
  const capabilityQuery = useCapabilityAtomDetail(
    !isRequirement && selection ? selection.id : null,
  );

  // Escape 关闭抽屉。
  useEffect(() => {
    if (selection === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selection, onClose]);

  if (selection === null) return null;

  if (!isRequirement) {
    return (
      <aside className="drawer" aria-label="能力原子详情">
        <header className="drawer__header">
          <div>
            <span className="drawer__id">{selection.id}</span>
            <h2>
              {capabilityQuery.data ? capabilityQuery.data.atom.member_name : "加载中…"}
            </h2>
          </div>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="关闭详情">
            ×
          </button>
        </header>
        {capabilityQuery.isPending ? (
          <p className="drawer__status">正在加载详情…</p>
        ) : capabilityQuery.isError ? (
          <div className="drawer__status drawer__status--error">
            <p>详情加载失败：{capabilityQuery.error.message}</p>
            <button
              type="button"
              className="tool-btn"
              onClick={() => void capabilityQuery.refetch()}
            >
              重试
            </button>
          </div>
        ) : (
          <CapabilityDetailBody atom={capabilityQuery.data.atom} />
        )}
      </aside>
    );
  }

  const detailQuery = requirementQuery;
  const requirementId = selection.id;

  return (
    <aside className="drawer" aria-label="需求详情">
      <header className="drawer__header">
        <div>
          <span className="drawer__id">{requirementId}</span>
          {detailQuery.data ? (
            <h2>{detailQuery.data.requirement.label}</h2>
          ) : (
            <h2>加载中…</h2>
          )}
        </div>
        <button type="button" className="drawer__close" onClick={onClose} aria-label="关闭详情">
          ×
        </button>
      </header>

      {detailQuery.isPending ? (
        <p className="drawer__status">正在加载详情…</p>
      ) : detailQuery.isError ? (
        <div className="drawer__status drawer__status--error">
          <p>详情加载失败：{detailQuery.error.message}</p>
          <button
            type="button"
            className="tool-btn"
            onClick={() => void detailQuery.refetch()}
          >
            重试
          </button>
        </div>
      ) : (
        (() => {
          const detail = detailQuery.data;
          const req = detail.requirement;
          return (
            <div className="drawer__body">
              <section className="drawer-section">
                <div className="tag-row">
                  <span
                    className="tag"
                    style={{
                      borderColor: ORIGIN_KIND_META[req.origin_kind]?.color,
                      color: ORIGIN_KIND_META[req.origin_kind]?.color,
                    }}
                  >
                    {ORIGIN_KIND_META[req.origin_kind]?.label ?? req.origin_kind}
                  </span>
                  <span className="tag">
                    {translate(REQUIREMENT_KIND_LABELS, req.requirement_kind)}
                  </span>
                  {req.atomic ? <span className="tag">原子需求</span> : null}
                  {req.needs_confirmation ? (
                    <span className="tag tag--warn">待确认</span>
                  ) : null}
                </div>
                <dl className="meta-grid">
                  <dt>生命周期</dt>
                  <dd>{translate(LIFECYCLE_STATUS_LABELS, req.lifecycle_status)}</dd>
                  <dt>客户可见</dt>
                  <dd>{req.customer_visible ? "是" : "否"}</dd>
                  <dt>层级深度</dt>
                  <dd>{req.derived_min_depth}</dd>
                  <dt>贴近度等级</dt>
                  <dd>{req.source_proximity_rank}</dd>
                  {req.priority_order != null ? (
                    <>
                      <dt>优先级序号</dt>
                      <dd>{req.priority_order}</dd>
                    </>
                  ) : null}
                  {req.verification_method ? (
                    <>
                      <dt>验证方式</dt>
                      <dd>{req.verification_method}</dd>
                    </>
                  ) : null}
                </dl>
                {req.description ? <p className="description">{req.description}</p> : null}
                {req.source_emphasis ? (
                  <p className="description description--emphasis">
                    客户强调：{req.source_emphasis}
                  </p>
                ) : null}
              </section>

              {detail.aliases.length > 0 ? (
                <section className="drawer-section">
                  <h3>
                    别名<span className="count-badge">{detail.aliases.length}</span>
                  </h3>
                  <ul className="plain-list">
                    {detail.aliases.map((alias) => (
                      <li key={alias.requirement_alias_id}>
                        {alias.alternate_name}
                        <span className="muted">（{alias.alias_kind}）</span>
                        {alias.note ? <p className="muted">{alias.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <RelationList
                title="上游关系"
                relations={detail.relations.parents}
                selfId={req.id}
                onNavigate={onNavigate}
              />
              <RelationList
                title="下游关系"
                relations={detail.relations.children}
                selfId={req.id}
                onNavigate={onNavigate}
              />

              <section className="drawer-section">
                <h3>
                  来源证据<span className="count-badge">{detail.evidence.length}</span>
                </h3>
                {detail.evidence.length === 0 ? (
                  <p className="empty-hint">暂无直接证据</p>
                ) : (
                  detail.evidence.map((ev) => (
                    <blockquote key={ev.requirement_source_link_id} className="evidence">
                      <p>“{ev.verbatim_text}”</p>
                      <footer>
                        {ev.source_document.name}
                        <span className="muted">
                          {" "}
                          · {translate(EVIDENCE_KIND_LABELS, ev.evidence_kind)} ·{" "}
                          {Object.entries(ev.locator)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join("，")}
                        </span>
                      </footer>
                    </blockquote>
                  ))
                )}
              </section>

              <section className="drawer-section">
                <h3>
                  适用范围<span className="count-badge">{detail.scopes.length}</span>
                </h3>
                {detail.scopes.length === 0 ? (
                  <p className="empty-hint">未单独限定范围</p>
                ) : (
                  <ul className="plain-list">
                    {detail.scopes.map((scope) => (
                      <li key={scope.requirement_scope_link_id}>
                        <strong>{scope.dimension.name}</strong>：{scope.value.name}
                        <span className="muted">
                          {" "}
                          · {scope.applicability}
                          {scope.inherit_to_descendants ? " · 继承到子需求" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="drawer-section">
                <h3>
                  候选验收条件
                  <span className="count-badge">{detail.acceptance_criteria.length}</span>
                </h3>
                {detail.acceptance_criteria.length === 0 ? (
                  <p className="empty-hint">暂无候选验收条件</p>
                ) : (
                  <ul className="plain-list">
                    {detail.acceptance_criteria.map((criterion) => (
                      <li key={criterion.acceptance_criterion_id}>
                        <p>{criterion.criterion_statement}</p>
                        <span className="muted">
                          {translate(CRITERION_STATUS_LABELS, criterion.criterion_status)}
                          {" · "}
                          {criterion.measurement_method}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="drawer-section">
                <h3>
                  待确认问题
                  <span className="count-badge">{detail.open_questions.length}</span>
                </h3>
                {detail.open_questions.length === 0 ? (
                  <p className="empty-hint">没有待确认问题</p>
                ) : (
                  <ul className="plain-list">
                    {detail.open_questions.map((question) => (
                      <li key={question.open_question_id}>
                        <p>{question.question}</p>
                        <span className="muted">
                          {question.blocking_kind}
                          {" · "}
                          {translate(QUESTION_STATUS_LABELS, question.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          );
        })()
      )}
    </aside>
  );
}
