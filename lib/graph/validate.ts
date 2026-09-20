import type { RailGraph } from "@/lib/graph/types";

const MAX_RAIL_KM = 100;

export function validateGraph(g: RailGraph): string[] {
  const problems: string[] = [];
  const touched = new Set<string>();

  for (const e of g.edges) {
    for (const id of [e.from, e.to]) {
      if (!g.nodes[id]) problems.push(`エッジが存在しないノード ${id} を参照`);
      touched.add(id);
    }
    // NaN 判定を範囲判定より先に置く必要がある。NaN > 100 は常に false なので、
    // 順序を入れ替えると座標欠損由来の NaN が無警告で通り抜ける。
    if (e.kind === "rail" && !Number.isFinite(e.km)) {
      problems.push(
        `rail エッジ ${e.from}-${e.to} の距離が NaN/非有限値 (座標欠損の疑い)`,
      );
    } else if (e.kind === "rail" && e.km > MAX_RAIL_KM) {
      problems.push(
        `rail エッジ ${e.from}-${e.to} が 100km 超 (${e.km.toFixed(1)}km)`,
      );
    }
  }
  for (const id of Object.keys(g.nodes)) {
    if (!touched.has(id))
      problems.push(`孤立ノード: ${id} (${g.nodes[id]?.name})`);
  }
  return problems;
}
