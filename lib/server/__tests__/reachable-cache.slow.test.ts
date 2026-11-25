import { describe, expect, it } from "vitest";
import { cachedReachable } from "@/app/api/reachable/cache";
import { getGraphStore } from "@/lib/server/graph-store";

// 実データ(data/graph.json)を読む。駅 id は JR山手線の新宿。
const SHINJUKU = "1130208";

describe("cachedReachable", () => {
  it("同じ出発駅と予算なら探索し直さず、同じ結果を返す", () => {
    // 徒歩ありの判定（/api/reachable/walk）は、直前の運賃の結果と比べる。
    // 運賃の探索をやり直すと、運賃と判定を分けた意味がなくなる
    const store = getGraphStore();
    const first = cachedReachable(store, SHINJUKU, 300);
    expect(cachedReachable(store, SHINJUKU, 300)).toBe(first);
  }, 30000);
});
