import { edgeKey } from "@/lib/graph/station-km";
import type { RailGraph } from "@/lib/graph/types";

// 実営業キロが分かっている駅間だけ、グラフの推定値を置き換える。
//
// グラフの km は座標由来の直線距離を区間営業キロの比で補正した推定値で、
// 運賃が距離で決まる事業者ではこれが誤差の主因になる。駅一覧から取れた
// 隣接駅間の営業キロ（data/station-km.json）がある区間はそちらを使う。
//
// 距離補正のあとに走らせること。補正は「推定値と実キロの比」を路線・事業者ごとに
// 出しているので、先に一部を実キロへ置き換えると比の母数が歪む。

export interface StationKmEdge {
  operator: string;
  from: string;
  to: string;
  km: number;
}

export interface ApplyResult {
  /** 置き換えたエッジ数 */
  replaced: number;
  /** 置き換え前後の差の合計(km)。推定がどれだけ外れていたかの目安 */
  totalDelta: number;
  /** 差が大きかった順の上位。駅の対応付けを誤っていれば、ここに極端な値が出る */
  worst: { from: string; to: string; before: number; after: number }[];
  /** グラフに該当するエッジが無かった駅間の数 */
  unmatched: number;
}

const WORST_SAMPLES = 10;

export function applyStationKm(
  graph: RailGraph,
  edges: StationKmEdge[],
): ApplyResult {
  const wanted = new Map<string, number>();
  for (const e of edges) {
    wanted.set(`${e.operator}\u0000${edgeKey(e.from, e.to)}`, e.km);
  }

  const result: ApplyResult = {
    replaced: 0,
    totalDelta: 0,
    worst: [],
    unmatched: 0,
  };
  const used = new Set<string>();
  const changes: { from: string; to: string; before: number; after: number }[] =
    [];

  for (const edge of graph.edges) {
    if (edge.kind !== "rail") continue;
    const from = graph.nodes[edge.from]?.name;
    const to = graph.nodes[edge.to]?.name;
    if (from === undefined || to === undefined) continue;
    const key = `${edge.operator}\u0000${edgeKey(from, to)}`;
    const km = wanted.get(key);
    if (km === undefined) continue;
    used.add(key);
    // 同じ駅名の組が複数エッジある（並行する別路線など）ことがあるので、
    // 一致したエッジはすべて置き換える
    changes.push({ from, to, before: edge.km, after: km });
    result.totalDelta += Math.abs(edge.km - km);
    result.replaced++;
    edge.km = km;
  }

  result.unmatched = wanted.size - used.size;
  result.worst = changes
    .sort((a, b) => Math.abs(b.before - b.after) - Math.abs(a.before - a.after))
    .slice(0, WORST_SAMPLES);
  return result;
}
