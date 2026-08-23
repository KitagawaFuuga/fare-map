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

const fuseCache = new WeakMap<GraphStore, Fuse<StationNode>>();

function getFuse(store: GraphStore): Fuse<StationNode> {
  let fuse = fuseCache.get(store);
  if (!fuse) {
    fuse = new Fuse(Object.values(store.graph.nodes), {
      keys: ["name"],
      threshold: 0.3,
    });
    fuseCache.set(store, fuse);
  }
  return fuse;
}

export function suggestStations(
  store: GraphStore,
  q: string,
  limit = 10,
): StationSuggestion[] {
  const seen = new Set<string>();
  const out: StationSuggestion[] = [];
  for (const { item } of getFuse(store).search(q, { limit: limit * 3 })) {
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
