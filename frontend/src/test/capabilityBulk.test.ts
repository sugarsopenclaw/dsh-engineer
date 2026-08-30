import { describe, expect, it } from "vitest";
import {
  loadAllMatchingAtoms,
  mergeAtomsById,
  type GraphAtomsResponseFetcher,
} from "../graph/capabilityBulk";
import type { CapabilityGraphAtomDto } from "../api/types";

function makeAtom(id: string): CapabilityGraphAtomDto {
  return {
    atom_id: id,
    surface: "dotnet",
    atom_kind: "method",
    observed_host_ids: ["thcad-v24"],
    member_name: id,
    declaring_symbol_full_name: "X.Y",
    classification_status: "classified",
    operation_kinds: ["read"],
    domain_tags: [],
  };
}

/** 把 NDJSON 文本按指定块大小切成字节流（只存在测试中）。 */
function ndjsonResponse(lines: string[], chunkSize = 64, total?: number): Response {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(lines.join("\n") + "\n");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: total !== undefined ? { "x-total-count": String(total) } : {},
  });
}

function fetcherReturning(response: Response): GraphAtomsResponseFetcher {
  return async () => response;
}

describe("mergeAtomsById", () => {
  it("按 atom_id 去重并保留顺序", () => {
    const existing = [makeAtom("a"), makeAtom("b")];
    const merged = mergeAtomsById(existing, [makeAtom("b"), makeAtom("c")]);
    expect(merged.map((a) => a.atom_id)).toEqual(["a", "b", "c"]);
  });

  it("没有新增时返回原数组引用", () => {
    const existing = [makeAtom("a")];
    expect(mergeAtomsById(existing, [makeAtom("a")])).toBe(existing);
    expect(mergeAtomsById(existing, [])).toBe(existing);
  });
});

describe("loadAllMatchingAtoms", () => {
  it("流式解析 NDJSON，跨块行也能正确拼回", async () => {
    const lines = [makeAtom("cap:t:1"), makeAtom("cap:t:2"), makeAtom("cap:t:3")].map((a) =>
      JSON.stringify(a),
    );
    const progress: Array<[number, number]> = [];
    const result = await loadAllMatchingAtoms(
      { surface: "dotnet" },
      {
        onProgress: (loaded, total) => progress.push([loaded, total]),
        signal: new AbortController().signal,
        expectedTotal: 3,
      },
      // 1 字节块强制每行都被切散。
      fetcherReturning(ndjsonResponse(lines, 1, 3)),
    );
    expect(result.map((a) => a.atom_id)).toEqual(["cap:t:1", "cap:t:2", "cap:t:3"]);
    expect(progress[progress.length - 1]).toEqual([3, 3]);
  });

  it("响应头缺 X-Total-Count 时回退 expectedTotal", async () => {
    const lines = [JSON.stringify(makeAtom("cap:t:1"))];
    let seenTotal = 0;
    await loadAllMatchingAtoms(
      {},
      {
        onProgress: (_loaded, total) => {
          seenTotal = total;
        },
        signal: new AbortController().signal,
        expectedTotal: 42,
      },
      fetcherReturning(ndjsonResponse(lines)),
    );
    expect(seenTotal).toBe(42);
  });

  it("body 为 null 时整段解析", async () => {
    const lines = [JSON.stringify(makeAtom("cap:t:1")), JSON.stringify(makeAtom("cap:t:2"))];
    const response = new Response(null, {
      status: 200,
      headers: { "x-total-count": "2" },
    });
    // 人为构造无 body 流但可 text() 的替身（只存在测试中）。
    const fake = {
      headers: response.headers,
      body: null,
      text: async () => lines.join("\n"),
    } as unknown as Response;
    const result = await loadAllMatchingAtoms(
      {},
      {
        onProgress: () => {},
        signal: new AbortController().signal,
        expectedTotal: 2,
      },
      fetcherReturning(fake),
    );
    expect(result).toHaveLength(2);
  });

  it("取消信号透传给 fetcher，AbortError 原样抛出", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher: GraphAtomsResponseFetcher = async (_filter, signal) => {
      if (signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return ndjsonResponse([]);
    };
    await expect(
      loadAllMatchingAtoms(
        {},
        { onProgress: () => {}, signal: controller.signal, expectedTotal: 10 },
        fetcher,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
