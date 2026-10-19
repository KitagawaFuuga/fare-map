import { reachable, type ReachableResult } from "@/lib/server/api-service";
import type { GraphStore } from "@/lib/server/graph-store";
import { createResultCache } from "@/lib/server/result-cache";
import { RESULT_CACHE_ENTRIES, reachableCacheKey } from "./config";

// 運賃の結果のキャッシュ。運賃（route.ts）と徒歩ありの判定（walk/route.ts）で
// 共有する。判定は直前の運賃の結果と比べるので、ここで使い回さないと運賃の
// 探索をやり直すことになり、運賃と判定を分けた意味がなくなる。
//
// graph-store と同じく、Next.js のサーバープロセスが生きている間だけ保持される
// 揮発状態（min-replicas 0 / 単一インスタンスの構成が前提）。
const cache = createResultCache<ReachableResult>(RESULT_CACHE_ENTRIES);

export function cachedReachable(
  store: GraphStore,
  from: string,
  budget: number,
): ReachableResult {
  const key = reachableCacheKey(from, budget);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const result = reachable(store, from, budget);
  cache.set(key, result);
  return result;
}
