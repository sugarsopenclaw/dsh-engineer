import type { CapabilityAtomDetailDto } from "../api/types";
import {
  ATOM_KIND_LABELS,
  CLASSIFICATION_STATUS_LABELS,
  OPERATION_KIND_LABELS,
  surfaceMeta,
  translate,
} from "../graph/vocabulary";

function formatScalar(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/** 能力原子完整详情（点击后按需请求 /atoms/{atom_id} 得到）。 */
export function CapabilityDetailBody(props: { atom: CapabilityAtomDetailDto }) {
  const { atom } = props;
  const meta = surfaceMeta(atom.surface);

  return (
    <div className="drawer__body">
      <section className="drawer-section">
        <div className="tag-row">
          <span className="tag" style={{ borderColor: meta.color, color: meta.color }}>
            {meta.label}
          </span>
          <span className="tag">{translate(ATOM_KIND_LABELS, atom.atom_kind)}</span>
          <span className="tag">
            {translate(CLASSIFICATION_STATUS_LABELS, atom.classification_status)}
          </span>
          {atom.is_static ? <span className="tag">static</span> : null}
        </div>
        {atom.summary ? <p className="description">{atom.summary}</p> : null}
        <dl className="meta-grid">
          <dt>观测宿主</dt>
          <dd>{atom.observed_host_ids.join("、")}</dd>
          <dt>声明符号</dt>
          <dd className="mono">{atom.declaring_symbol_full_name ?? "—"}</dd>
          {atom.return_type ? (
            <>
              <dt>返回类型</dt>
              <dd className="mono">{atom.return_type}</dd>
            </>
          ) : null}
          {atom.classification_confidence != null ? (
            <>
              <dt>分类置信度</dt>
              <dd>{atom.classification_confidence}</dd>
            </>
          ) : null}
          {atom.processed_at ? (
            <>
              <dt>处理时间</dt>
              <dd>{atom.processed_at}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {atom.member_signature ? (
        <section className="drawer-section">
          <h3>签名</h3>
          <pre className="code-block">{atom.member_signature}</pre>
          {atom.member?.parameters && atom.member.parameters.length > 0 ? (
            <ul className="plain-list">
              {atom.member.parameters.map((param, index) => (
                <li key={index} className="mono">
                  {formatScalar(param.name ?? `#${index}`)}
                  <span className="muted">
                    {param.type ? `：${formatScalar(param.type)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="drawer-section">
        <h3>
          操作分类<span className="count-badge">{atom.operation_kinds.length}</span>
        </h3>
        {atom.operation_kinds.length === 0 ? (
          <p className="empty-hint">未分类（如原生导出线索保持 pending）</p>
        ) : (
          <div className="tag-row">
            {atom.operation_kinds.map((kind) => (
              <span key={kind} className="tag">
                {translate(OPERATION_KIND_LABELS, kind)}
              </span>
            ))}
          </div>
        )}
        {atom.domain_tags.length > 0 ? (
          <>
            <h3 style={{ marginTop: 12 }}>
              领域标签<span className="count-badge">{atom.domain_tags.length}</span>
            </h3>
            <div className="tag-row">
              {atom.domain_tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </section>

      {atom.source_artifact ? (
        <section className="drawer-section">
          <h3>来源构件</h3>
          <dl className="meta-grid">
            <dt>名称</dt>
            <dd className="mono">
              {atom.source_artifact.name ?? "—"}
              {atom.source_artifact.version ? `@${atom.source_artifact.version}` : ""}
            </dd>
            {atom.source_artifact.kind ? (
              <>
                <dt>类型</dt>
                <dd>{atom.source_artifact.kind}</dd>
              </>
            ) : null}
            {atom.source_artifact.sha256 ? (
              <>
                <dt>SHA-256</dt>
                <dd className="mono">{atom.source_artifact.sha256.slice(0, 16)}…</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}

      {atom.provenance ? (
        <section className="drawer-section">
          <h3>提取溯源</h3>
          <dl className="meta-grid">
            <dt>提取器</dt>
            <dd className="mono">
              {atom.provenance.extractor ?? "—"}
              {atom.provenance.extractor_version
                ? ` v${atom.provenance.extractor_version}`
                : ""}
            </dd>
          </dl>
          {atom.provenance.source_locator ? (
            <pre className="code-block">
              {Object.entries(atom.provenance.source_locator)
                .map(([k, v]) => `${k}: ${formatScalar(v)}`)
                .join("\n")}
            </pre>
          ) : null}
        </section>
      ) : null}

      {atom.evidence.length > 0 ? (
        <section className="drawer-section">
          <h3>
            分类证据<span className="count-badge">{atom.evidence.length}</span>
          </h3>
          {atom.evidence.map((ev, index) => (
            <blockquote key={index} className="evidence">
              {ev.claim ? <p>{ev.claim}</p> : null}
              <footer className="mono">
                {ev.kind ?? "evidence"}
                {ev.ref ? ` · ${ev.ref}` : ""}
              </footer>
            </blockquote>
          ))}
        </section>
      ) : null}

      {atom.notes ? (
        <section className="drawer-section">
          <h3>备注</h3>
          <p className="description description--emphasis">{atom.notes}</p>
        </section>
      ) : null}

      <section className="drawer-section">
        <h3>标识</h3>
        <dl className="meta-grid">
          <dt>atom_id</dt>
          <dd className="mono">{atom.atom_id}</dd>
          {atom.canonical_key ? (
            <>
              <dt>canonical_key</dt>
              <dd className="mono">{atom.canonical_key}</dd>
            </>
          ) : null}
          <dt>inventory</dt>
          <dd className="mono">{atom.inventory_id}</dd>
        </dl>
      </section>
    </div>
  );
}
