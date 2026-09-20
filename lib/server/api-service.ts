import Fuse from "fuse.js";
import { haversineKm } from "@/lib/geo";
import { bracketOf } from "@/lib/brackets";
import { findReachable } from "@/lib/search/reachable";
import type { StationNode } from "@/lib/graph/types";
import type { GraphStore } from "@/lib/server/graph-store";

export interface StationSuggestion {
  id: string;
  name: string;
  lineName: string;
  operator: string;
}

// 全駅（約1万件）の曖昧検索インデックスは構築コストが高いので、GraphStore ごとに
// 1度だけ作って使い回す。WeakMap にしているのは、store が破棄されたらインデックスも
// 一緒に回収させるため（テストで store を何度も作り直してもリークしない）。
const fuseCache = new WeakMap<GraphStore, Fuse<StationNode>>();

function getFuse(store: GraphStore): Fuse<StationNode> {
  let fuse = fuseCache.get(store);
  if (!fuse) {
    fuse = new Fuse(Object.values(store.graph.nodes), {
      keys: ["name"], // 駅名だけを検索対象にする（路線名まで含めるとノイズが増える）
      threshold: 0.3, // 0=完全一致, 1=何でもヒット。打ち間違いは拾いつつ無関係な駅は出さない値
    });
    fuseCache.set(store, fuse);
  }
  return fuse;
}

// 駅名の曖昧検索。実データでは同じ物理駅が路線ごとに別ノードとして存在する
// （例: 新宿は JR山手線・JR中央線・小田急・京王… で11ノード）ため、そのまま返すと
// 候補が同名駅で埋まる。groupId（同一駅なら同じ値）で重複を除き、1駅1件にする。
export function suggestStations(
  store: GraphStore,
  query: string,
  limit = 10,
): StationSuggestion[] {
  const seen = new Set<string>();
  const out: StationSuggestion[] = [];
  // limit の3倍を要求するのは、重複除去で件数が減るのを見込んだ余裕分
  // （ちょうど limit 件だけ取ると、全部が同一駅の別路線で1件しか残らないことがある）。
  for (const { item } of getFuse(store).search(query, { limit: limit * 3 })) {
    if (seen.has(item.groupId)) continue;
    seen.add(item.groupId);
    out.push({
      id: item.id,
      name: item.name,
      lineName: item.lineName,
      operator: item.operator,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// 座標から最寄り駅を1件返す（地図タップ・現在地ボタンの着地点）。
// 空間インデックスを持たず全ノードを総当たりするが、1万件の距離計算は
// 数ミリ秒で終わり、呼ばれる頻度も低いので最適化していない。
export function nearestStation(
  store: GraphStore,
  lat: number,
  lng: number,
): StationSuggestion & { lat: number; lng: number } {
  let bestNode: StationNode | undefined;
  let bestKm = Infinity;
  for (const n of Object.values(store.graph.nodes)) {
    const km = haversineKm({ lat, lng }, n);
    if (km < bestKm) {
      bestKm = km;
      bestNode = n;
    }
  }
  if (!bestNode) throw new Error("グラフが空");
  return {
    id: bestNode.id,
    name: bestNode.name,
    lineName: bestNode.lineName,
    operator: bestNode.operator,
    lat: bestNode.lat,
    lng: bestNode.lng,
  };
}

export interface ReachableResult {
  stations: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    fare: number;
    line: string;
    operator: string;
    bracket: number;
  }[];
  meta: { from: string; budget: number; count: number };
}

export function reachable(
  store: GraphStore,
  fromId: string,
  budget: number,
): ReachableResult {
  const fromNode = store.graph.nodes[fromId];
  if (!fromNode) throw new Error(`未知の駅: ${fromId}`);
  const raw = findReachable(store.graph, store.calc, fromId, budget);

  // 同一駅グループは最小運賃の代表 1 件に集約（raw は fare 昇順なので先勝ち）
  const byGroup = new Map<string, { id: string; fare: number }>();
  for (const r of raw) {
    const g = store.graph.nodes[r.id]?.groupId;
    if (g !== undefined && !byGroup.has(g)) byGroup.set(g, r);
  }
  // 出発駅そのものを結果から除く。ここで消すのは id ではなく groupId である点が重要で、
  // 出発ノード以外の同一駅ノード（別路線ホーム）も一緒に消える。
  byGroup.delete(fromNode.groupId);

  const stations = [...byGroup.values()].map(({ id, fare }) => {
    const n = store.graph.nodes[id];
    if (!n) throw new Error(`未知の駅: ${id}`);
    return {
      id: n.id,
      name: n.name,
      lat: n.lat,
      lng: n.lng,
      fare,
      line: n.lineName,
      operator: n.operator,
      bracket: bracketOf(fare),
    };
  });
  return { stations, meta: { from: fromId, budget, count: stations.length } };
}
