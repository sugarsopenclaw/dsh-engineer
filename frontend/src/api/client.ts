import type {
  ApiErrorBody,
  BusinessRequirementDetailResponse,
  BusinessRequirementsGraphResponse,
  CapabilityAtomDetailResponse,
  CapabilityAtomsPageResponse,
  CapabilityAtomsQuery,
  CapabilityFacetsResponse,
  GraphDimensions,
} from "./types";
/**
 * 只走相对路径 /api：开发时由 Vite 代理到 http://127.0.0.1:8000（见 vite.config.ts），
 * 不做 mock、不做失败兜底数据；任何非 2xx 都以 ApiError 抛出，交给 UI 展示真实错误。
 */
const API_PREFIX = "/api/v1/business-requirements";
const CAPABILITY_PREFIX = "/api/v1/cad-capabilities";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      `无法连接后端服务（${path}）。请确认 FastAPI 已在 127.0.0.1:8000 运行。`,
    );
  }

  if (!response.ok) {
    let code: string | null = null;
    let message = `请求失败：HTTP ${response.status}`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body.detail?.code) code = body.detail.code;
      if (body.detail?.message) message = body.detail.message;
    } catch {
      // 响应体不是 JSON 时保留默认错误消息。
    }
    throw new ApiError(response.status, code, message);
  }

  return (await response.json()) as T;
}

export function fetchBusinessRequirementsGraph(
  dimensions: GraphDimensions,
): Promise<BusinessRequirementsGraphResponse> {
  const params = new URLSearchParams({ dimensions: String(dimensions) });
  return requestJson<BusinessRequirementsGraphResponse>(
    `${API_PREFIX}/graph?${params.toString()}`,
  );
}

export function fetchBusinessRequirementDetail(
  requirementId: string,
): Promise<BusinessRequirementDetailResponse> {
  return requestJson<BusinessRequirementDetailResponse>(
    `${API_PREFIX}/${encodeURIComponent(requirementId)}`,
  );
}

/* ---------------- CAD 原子能力 ---------------- */

export function fetchCapabilityFacets(): Promise<CapabilityFacetsResponse> {
  return requestJson<CapabilityFacetsResponse>(`${CAPABILITY_PREFIX}/facets`);
}

export function fetchCapabilityAtoms(
  query: CapabilityAtomsQuery,
): Promise<CapabilityAtomsPageResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit));
  params.set("offset", String(query.offset));
  if (query.surface) params.set("surface", query.surface);
  if (query.observed_host_id) params.set("observed_host_id", query.observed_host_id);
  if (query.atom_kind) params.set("atom_kind", query.atom_kind);
  if (query.classification_status) {
    params.set("classification_status", query.classification_status);
  }
  if (query.operation_kind) params.set("operation_kind", query.operation_kind);
  if (query.domain_tag) params.set("domain_tag", query.domain_tag);
  if (query.q && query.q.trim() !== "") params.set("q", query.q.trim());
  return requestJson<CapabilityAtomsPageResponse>(
    `${CAPABILITY_PREFIX}/atoms?${params.toString()}`,
  );
}

export function fetchCapabilityAtomDetail(
  atomId: string,
): Promise<CapabilityAtomDetailResponse> {
  // atom_id 含冒号，按契约仍整体 encodeURIComponent。
  return requestJson<CapabilityAtomDetailResponse>(
    `${CAPABILITY_PREFIX}/atoms/${encodeURIComponent(atomId)}`,
  );
}

/**
 * graph-atoms 批量流：返回未消费的 Response（NDJSON body 由调用方流式解析）。
 * ETag/304 由浏览器 HTTP 缓存自动处理；signal 用于取消（后端随即关闭数据库游标）。
 */
export async function fetchCapabilityGraphAtoms(
  filter: Omit<CapabilityAtomsQuery, "limit" | "offset">,
  signal: AbortSignal,
): Promise<Response> {
  const params = new URLSearchParams();
  if (filter.surface) params.set("surface", filter.surface);
  if (filter.observed_host_id) params.set("observed_host_id", filter.observed_host_id);
  if (filter.atom_kind) params.set("atom_kind", filter.atom_kind);
  if (filter.classification_status) {
    params.set("classification_status", filter.classification_status);
  }
  if (filter.operation_kind) params.set("operation_kind", filter.operation_kind);
  if (filter.domain_tag) params.set("domain_tag", filter.domain_tag);
  if (filter.q && filter.q.trim() !== "") params.set("q", filter.q.trim());

  const path = `${CAPABILITY_PREFIX}/graph-atoms?${params.toString()}`;
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { Accept: "application/x-ndjson" },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(
      0,
      "network_error",
      `无法连接后端服务（${path}）。请确认 FastAPI 已在 127.0.0.1:8000 运行。`,
    );
  }

  if (!response.ok) {
    let code: string | null = null;
    let message = `请求失败：HTTP ${response.status}`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body.detail?.code) code = body.detail.code;
      if (body.detail?.message) message = body.detail.message;
    } catch {
      // 响应体不是 JSON 时保留默认错误消息。
    }
    throw new ApiError(response.status, code, message);
  }
  return response;
}
