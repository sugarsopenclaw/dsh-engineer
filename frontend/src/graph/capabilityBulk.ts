import { fetchCapabilityGraphAtoms } from "../api/client";
import type {
  CapabilityAtomsQuery,
  CapabilityGraphAtomDto,
} from "../api/types";

/**
 * 按分类整批加载能力原子：一次 fetch 流式解析 graph-atoms NDJSON。
 * 后端按数据集版本在内存快照上筛选（首次请求重建快照约 90s），
 * 因此 MAX_BULK_ATOMS 是前端渲染预算，不是接口限制。
 */

/** 单次整批加载的渲染预算上限：2D Canvas 在此量级内保持可交互，3D 会同步降低球体分辨率。 */
export const MAX_BULK_ATOMS = 30_000;

/** 超过该数量后在面板上提示交互可能变慢（不阻止）。 */
export const SLOW_CANVAS_HINT_ATOMS = 3_000;

export type GraphAtomsResponseFetcher = (
  filter: Omit<CapabilityAtomsQuery, "limit" | "offset">,
  signal: AbortSignal,
) => Promise<Response>;

export interface BulkLoadOptions {
  onProgress: (loaded: number, total: number) => void;
  signal: AbortSignal;
  /** 面板从分页接口看到的总数；响应头缺 X-Total-Count 时回退使用。 */
  expectedTotal: number;
}

/** 按 atom_id 去重合并，保留既有顺序，新原子追加在后。 */
export function mergeAtomsById<T extends { atom_id: string }>(
  existing: T[],
  incoming: T[],
): T[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((a) => a.atom_id));
  const additions = incoming.filter((a) => !seen.has(a.atom_id));
  return additions.length === 0 ? existing : [...existing, ...additions];
}

/** 增量解析 NDJSON 字节流，逐行产出对象。 */
async function* readNdjsonLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<CapabilityGraphAtomDto> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) yield JSON.parse(line) as CapabilityGraphAtomDto;
    }
  }
  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as CapabilityGraphAtomDto;
}

/**
 * 拉取某个筛选条件下的全部原子（调用方保证 expectedTotal ≤ MAX_BULK_ATOMS）。
 * 取消（signal abort）时抛出的 AbortError 原样向上传，由调用方按“取消即丢弃”处理。
 */
export async function loadAllMatchingAtoms(
  filter: Omit<CapabilityAtomsQuery, "limit" | "offset">,
  options: BulkLoadOptions,
  fetcher: GraphAtomsResponseFetcher = fetchCapabilityGraphAtoms,
): Promise<CapabilityGraphAtomDto[]> {
  const response = await fetcher(filter, options.signal);
  const headerTotal = Number(response.headers.get("x-total-count"));
  const total =
    Number.isFinite(headerTotal) && headerTotal > 0 ? headerTotal : options.expectedTotal;

  const atoms: CapabilityGraphAtomDto[] = [];
  if (response.body === null) {
    // 无 ReadableStream 的环境（测试替身、旧浏览器）：整段解析。
    const text = await response.text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) atoms.push(JSON.parse(trimmed) as CapabilityGraphAtomDto);
    }
    options.onProgress(atoms.length, total);
    return atoms;
  }

  let reported = 0;
  for await (const atom of readNdjsonLines(response.body)) {
    atoms.push(atom);
    // 每 500 行报一次进度，避免每行触发 React 状态更新。
    if (atoms.length - reported >= 500) {
      reported = atoms.length;
      options.onProgress(atoms.length, total);
    }
  }
  options.onProgress(atoms.length, total);
  return atoms;
}
