import Fuse from "fuse.js";
import { bracketOf } from "@/lib/brackets";
import { findReachable } from "@/lib/search/reachable";
import type { RailGraph, StationNode } from "@/lib/graph/types";
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

// 運賃が徒歩連絡（別駅どうしを徒歩で乗り継ぐ）を前提にしている駅。
// 西武秩父→御花畑のように実在する連絡もあれば、代々木と南新宿のように
// 近いだけで誰も乗換とみなさない組もある。区別する情報が元データに無いため
// 画面に出して利用者に判断してもらう。
// 運賃とは別の API（/api/reachable/walk）で返す。判定には徒歩連絡を抜いた
// グラフでもう1回探索が要り、運賃と一緒に返すと応答が倍遅くなるため
// （大阪発・予算1万円で 4.5秒 → 9.3秒）。
export interface WalkResult {
  from: string;
  budget: number;
  viaWalkIds: string[];
}

// 徒歩連絡を取り除いたグラフ。groupId が同じ transfer（同一駅の別路線ホーム）は
// 残し、groupId が異なる transfer だけを落とす。
// 元グラフごとにキャッシュする（リクエストのたびに1万件のエッジを走査しないため）。
const noWalkGraphCache = new WeakMap<RailGraph, RailGraph>();

function getNoWalkGraph(graph: RailGraph): RailGraph {
  let cached = noWalkGraphCache.get(graph);
  if (!cached) {
    cached = {
      nodes: graph.nodes,
      edges: graph.edges.filter((e) => {
        if (e.kind !== "transfer") return true;
        const a = graph.nodes[e.from];
        const b = graph.nodes[e.to];
        return !a || !b || a.groupId === b.groupId;
      }),
    };
    noWalkGraphCache.set(graph, cached);
  }
  return cached;
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
  return {
    stations,
    meta: { from: fromId, budget, count: stations.length },
  };
}

// result（reachable の結果）のうち、徒歩連絡を抜いたグラフでは同じ運賃で
// 行けない（運賃が上がる、または予算内に届かない）駅の id。
// 比較は駅グループ単位で行う。同じ駅でも路線ごとにノードが分かれており、
// 代表ノード1件だけを見ると「この路線のホームには徒歩でしか着けないが、
// 同じ駅の別ホームには徒歩なしで着ける」場合に誤って徒歩前提と判定してしまう。
export function walkStationIds(
  store: GraphStore,
  result: ReachableResult,
): string[] {
  const noWalkFare = new Map<string, number>();
  for (const r of findReachable(
    getNoWalkGraph(store.graph),
    store.calc,
    result.meta.from,
    result.meta.budget,
  )) {
    const g = store.graph.nodes[r.id]?.groupId;
    if (g === undefined) continue;
    const prev = noWalkFare.get(g);
    if (prev === undefined || r.fare < prev) noWalkFare.set(g, r.fare);
  }
  return result.stations
    .filter((s) => {
      const g = store.graph.nodes[s.id]?.groupId;
      const without = g === undefined ? undefined : noWalkFare.get(g);
      return without === undefined || without > s.fare;
    })
    .map((s) => s.id);
}
