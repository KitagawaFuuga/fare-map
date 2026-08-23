import { haversineKm } from "@/lib/geo";
import type { GraphEdge, RailGraph, StationNode } from "@/lib/graph/types";

export interface EkidataInput {
  companies: Record<string, string>[];
  lines: Record<string, string>[];
  stations: Record<string, string>[];
  joins: Record<string, string>[];
}

const TRANSFER_RADIUS_KM = 0.3;

export function buildGraph(input: EkidataInput): RailGraph {
  const companyName = new Map(
    input.companies.map((c) => [c.company_cd ?? "", c.company_name ?? ""]),
  );
  const lineInfo = new Map(
    input.lines.map((l) => [
      l.line_cd ?? "",
      {
        name: l.line_name ?? "",
        operator: companyName.get(l.company_cd ?? "") ?? "",
      },
    ]),
  );

  const nodes: Record<string, StationNode> = {};
  for (const s of input.stations) {
    const line = lineInfo.get(s.line_cd ?? "");
    if (!line || !s.station_cd) continue;
    // 空文字は Number("") = 0（null island）に、キー欠落は Number(undefined) = NaN になる。
    // どちらも座標欠損であり距離計算に使えないため、生値の段階で弾いてからノードに入れる。
    if (!s.lat || !s.lon) continue;
    const lat = Number(s.lat);
    const lng = Number(s.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    nodes[s.station_cd] = {
      id: s.station_cd,
      groupId: s.station_g_cd ?? s.station_cd,
      name: s.station_name ?? "",
      lat,
      lng,
      lineId: s.line_cd ?? "",
      lineName: line.name,
      operator: line.operator,
    };
  }

  const edges: GraphEdge[] = [];
  for (const j of input.joins) {
    const a = nodes[j.station_cd1 ?? ""];
    const b = nodes[j.station_cd2 ?? ""];
    if (!a || !b) continue;
    edges.push({
      from: a.id,
      to: b.id,
      km: haversineKm(a, b),
      kind: "rail",
      operator: a.operator,
    });
  }

  edges.push(...buildTransferEdges(Object.values(nodes)));
  return { nodes, edges };
}

function buildTransferEdges(stations: StationNode[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const add = (a: StationNode, b: StationNode) => {
    const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
    if (seen.has(key) || a.id === b.id) return;
    seen.add(key);
    edges.push({ from: a.id, to: b.id, km: 0, kind: "transfer", operator: "" });
  };

  // (a) 同一グループ
  const byGroup = new Map<string, StationNode[]>();
  for (const s of stations) {
    const arr = byGroup.get(s.groupId) ?? [];
    arr.push(s);
    byGroup.set(s.groupId, arr);
  }
  for (const group of byGroup.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a && b) add(a, b);
      }
    }
  }

  // (b) 近接駅。グリッド分割で近傍セルのみ比較する
  const cell = (s: StationNode) =>
    `${Math.round(s.lat * 100)}:${Math.round(s.lng * 100)}`;
  const grid = new Map<string, StationNode[]>();
  for (const s of stations) {
    const k = cell(s);
    const arr = grid.get(k) ?? [];
    arr.push(s);
    grid.set(k, arr);
  }
  for (const s of stations) {
    const clat = Math.round(s.lat * 100);
    const clng = Math.round(s.lng * 100);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const t of grid.get(`${clat + dy}:${clng + dx}`) ?? []) {
          if (t.id > s.id && haversineKm(s, t) <= TRANSFER_RADIUS_KM) add(s, t);
        }
      }
    }
  }
  return edges;
}
