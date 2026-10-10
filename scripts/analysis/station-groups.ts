import type { RailGraph } from "@/lib/graph/types";

// 事業者の中で「同じ駅」とみなすノードの組を作る（分析スクリプト用）。
//
// 駅名でまとめてはいけない。同名の別の駅がある（東京の大久保と秋田の大久保は
// どちらもJR東日本）。駅名でまとめると両者がつながり、大宮→盛岡が新宿→秋田の
// ワープで176.3km（公式505.0km）になっていた。探索（lib/search/reachable.ts）と
// 同じく、乗換の辺でつながったノードだけを同じ駅とする。
export function stationGroupsOf(
  graph: RailGraph,
  operator: string,
): (nodeId: string) => string {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const e of graph.edges) {
    if (e.kind !== "transfer") continue;
    const a = graph.nodes[e.from];
    const b = graph.nodes[e.to];
    if (a?.operator !== operator || b?.operator !== operator) continue;
    if (a.name !== b.name) continue; // 徒歩連絡の別駅は別の駅として扱う
    const ra = find(e.from);
    const rb = find(e.to);
    if (ra !== rb) parent.set(ra, rb);
  }
  return find;
}
