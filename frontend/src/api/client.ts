import type {
  ApiErrorBody,
  BusinessRequirementDetailResponse,
  BusinessRequirementsGraphResponse,
  GraphDimensions,
} from "./types";

/**
 * 只走相对路径 /api：开发时由 Vite 代理到 http://127.0.0.1:8000（见 vite.config.ts），
 * 不做 mock、不做失败兜底数据；任何非 2xx 都以 ApiError 抛出，交给 UI 展示真实错误。
 */
const API_PREFIX = "/api/v1/business-requirements";

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
