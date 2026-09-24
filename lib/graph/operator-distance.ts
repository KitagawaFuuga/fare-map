import type { RailGraph } from "@/lib/graph/types";

// 事業者内の駅間営業キロを駅名で引くための表を作る。
//
// 運賃データの検証（lib/fare/verify-candidate.ts）と取り込み
// （scripts/fare/ingest/）は、どちらも「この事業者のこの2駅は何キロ離れているか」を
// 大量に問い合わせる。毎回ダイクストラを回すと駅数の2乗で効くため、
// 駅名ごとに1回だけ走らせて名前→名前の表に畳んでおく。
//
// グラフには同じ駅名のノードが路線ぶんだけあるので、始点は同名ノード全部を
// 距離0で初期化し、終点も同名ノードのうち最小値を採る。
export function buildOperatorKmTable(
  graph: RailGraph,
  operator: string,
): (a: string, b: string) => number | null {
  const nodes = Object.values(graph.nodes).filter(
    (n) => n.operator === operator,
  );
  const inOperator = new Set(nodes.map((n) => n.id));

  const adjacency = new Map<string, { to: string; km: number }[]>();
  const link = (from: string, to: string, km: number) => {
    const list = adjacency.get(from) ?? [];
    list.push({ to, km });
    adjacency.set(from, list);
  };
  for (const e of graph.edges) {
    if (!inOperator.has(e.from) || !inOperator.has(e.to)) continue;
    // 自社の駅同士でも、他社線の区間を通る経路は営業キロに含めない
    if (e.kind === "rail" && e.operator !== operator) continue;
    const km = e.kind === "rail" ? e.km : 0;
    link(e.from, e.to, km);
    link(e.to, e.from, km);
  }

  const idsByName = new Map<string, string[]>();
  for (const n of nodes) {
    const list = idsByName.get(n.name) ?? [];
    list.push(n.id);
    idsByName.set(n.name, list);
  }
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]));

  const table = new Map<string, Map<string, number>>();
  for (const [name, starts] of idsByName) {
    const distance = new Map<string, number>();
    // 駅数が数百規模なので、二分ヒープを持たず毎回最小値を線形に探す
    const queue: { id: string; km: number }[] = [];
    for (const id of starts) {
      distance.set(id, 0);
      queue.push({ id, km: 0 });
    }
    while (queue.length > 0) {
      let best = 0;
      for (let i = 1; i < queue.length; i++) {
        const q = queue[i];
        const b = queue[best];
        if (q !== undefined && b !== undefined && q.km < b.km) best = i;
      }
      const current = queue.splice(best, 1)[0];
      if (current === undefined) break;
      if (current.km > (distance.get(current.id) ?? Infinity)) continue;
      for (const edge of adjacency.get(current.id) ?? []) {
        const next = current.km + edge.km;
        if (next < (distance.get(edge.to) ?? Infinity)) {
          distance.set(edge.to, next);
          queue.push({ id: edge.to, km: next });
        }
      }
    }
    const byName = new Map<string, number>();
    for (const [id, km] of distance) {
      const other = nameOf.get(id);
      if (other === undefined) continue;
      if (km < (byName.get(other) ?? Infinity)) byName.set(other, km);
    }
    table.set(name, byName);
  }

  return (a, b) => table.get(a)?.get(b) ?? null;
}
