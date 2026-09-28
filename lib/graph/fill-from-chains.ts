import type { StationKmEdge } from "@/lib/graph/apply-station-km";
import { edgeKey } from "@/lib/graph/station-km";
import type { RailGraph } from "@/lib/graph/types";

// 実営業キロ（data/station-km.json）が当たらなかった辺のうち、実営業キロの辺だけで
// 両端を結べるものを、その経路の長さで置き換える。
//
// なぜ要るか: 快速など駅を飛ばす運転系統は、駅データ上で飛ばした2駅を直結する辺を
// 持つ（JR宝塚線は塚本に停まらないので 大阪-尼崎 が直結）。station-km は隣接駅間
// なのでこの辺には当たらず、座標の直線距離を補正した推定値が残る。直線距離は実際の
// 線路より必ず短いので、最短経路はこの辺を好んで選び、距離が短く＝運賃が安く出る
// （大阪〜元町が公式31.4kmに対し31.0km、大阪-尼崎が実際7.7kmに対し推定7.32km）。
//
// 同じ線路を飛ばしているだけなら、つないだ長さは推定とほぼ同じになる。大きく長い
// ときはその辺が別の線路（短絡線など）で、つないだ経路は遠回りなので使わない。
//
// つなぎ目に使うのは station-km の辺だけ。置き換えた辺を使って次の辺を埋めると、
// 判定の誤りが連鎖する。
// 実営業キロの置き換え（applyStationKm）のあと、運賃計算キロ（fareKm）の前に走らせる。

export interface FillOptions {
  /** つないだ長さ / 推定 がこれを超えたら置き換えない */
  maxRatio: number;
}

export interface FillResult {
  replaced: number;
  /** 置き換えで長くなった合計(km) */
  totalDelta: number;
  worst: { from: string; to: string; before: number; after: number }[];
  /** 結べたが遠回りすぎて使わなかった辺の数 */
  skippedDetour: number;
  /** 使わなかった辺の例（倍率の大きい順）。上限の妥当性を確かめるため */
  detours: { from: string; to: string; km: number; chain: number }[];
}

const WORST_SAMPLES = 10;

export function fillFromRealChains(
  graph: RailGraph,
  real: StationKmEdge[],
  options: FillOptions,
): FillResult {
  // 事業者ごとの、駅名どうしを実営業キロで結んだ隣接表
  const adjacency = new Map<string, Map<string, Map<string, number>>>();
  const realKeys = new Set<string>();
  for (const e of real) {
    realKeys.add(`${e.operator}\u0000${edgeKey(e.from, e.to)}`);
    const byName =
      adjacency.get(e.operator) ?? new Map<string, Map<string, number>>();
    for (const [a, b] of [
      [e.from, e.to],
      [e.to, e.from],
    ] as const) {
      const next = byName.get(a) ?? new Map<string, number>();
      next.set(b, Math.min(next.get(b) ?? Infinity, e.km));
      byName.set(a, next);
    }
    adjacency.set(e.operator, byName);
  }

  // 上限つきのダイクストラ。limit を超えたら打ち切る（遠回りは使わないので探す意味が無い）
  const shortest = (
    operator: string,
    from: string,
    to: string,
    limit: number,
  ): number | null => {
    const byName = adjacency.get(operator);
    if (byName === undefined || !byName.has(from) || !byName.has(to))
      return null;
    const dist = new Map<string, number>([[from, 0]]);
    const queue: [number, string][] = [[0, from]];
    while (queue.length > 0) {
      let best = 0;
      for (let i = 1; i < queue.length; i++)
        if (queue[i]![0] < queue[best]![0]) best = i;
      const [d, u] = queue.splice(best, 1)[0]!;
      if (u === to) return d;
      if (d > (dist.get(u) ?? Infinity)) continue;
      for (const [v, w] of byName.get(u) ?? []) {
        const nd = d + w;
        if (nd > limit) continue;
        if (nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd);
          queue.push([nd, v]);
        }
      }
    }
    return null;
  };

  const result: FillResult = {
    replaced: 0,
    totalDelta: 0,
    worst: [],
    skippedDetour: 0,
    detours: [],
  };
  const changes: FillResult["worst"] = [];
  for (const edge of graph.edges) {
    if (edge.kind !== "rail") continue;
    const from = graph.nodes[edge.from]?.name;
    const to = graph.nodes[edge.to]?.name;
    if (from === undefined || to === undefined || from === to) continue;
    // 実営業キロが当たっている辺は触らない
    if (realKeys.has(`${edge.operator}\u0000${edgeKey(from, to)}`)) continue;
    const limit = edge.km * options.maxRatio;
    const found = shortest(edge.operator, from, to, limit);
    if (found === null) {
      // 上限を広げれば結べるかを調べて、遠回りで捨てた数を報告する（上限なしで
      // 探すと事業者の全駅を回ることになるので5倍で打ち切る）
      const chain = shortest(edge.operator, from, to, edge.km * 5);
      if (chain !== null) {
        result.skippedDetour++;
        result.detours.push({ from, to, km: edge.km, chain });
      }
      continue;
    }
    const km = Number(found.toFixed(2));
    changes.push({ from, to, before: edge.km, after: km });
    result.totalDelta += km - edge.km;
    result.replaced++;
    edge.km = km;
  }
  result.detours.sort((a, b) => b.chain / b.km - a.chain / a.km);
  result.worst = changes
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
    .slice(0, WORST_SAMPLES);
  return result;
}
