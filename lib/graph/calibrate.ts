import type { GraphEdge, RailGraph, StationNode } from "@/lib/graph/types";

export interface CalibrationTable {
  byLine: Record<string, number>; // lineId → 係数
  byOperator: Record<string, number>; // 事業者名 → 係数
  fallback: number; // 全国中央値
  meta: { source: string; fetchedAt: string; sections: number };
}

export interface CalibrationSection {
  operator: string;
  line: string;
  from: string;
  to: string;
  officialKm: number;
}

const MIN_RATIO = 0;
const MAX_RATIO = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

// 同一路線（lineId）の rail エッジだけを辿る Dijkstra で from→to の直線距離合計を求める
function shortestSameLineKm(
  railEdgesByLine: Map<string, GraphEdge[]>,
  from: StationNode,
  to: StationNode,
): number | undefined {
  if (from.lineId !== to.lineId) return undefined;
  if (from.id === to.id) return 0;

  const edges = railEdgesByLine.get(from.lineId) ?? [];
  const adjacency = new Map<string, { to: string; km: number }[]>();
  const addAdj = (a: string, b: string, km: number) => {
    const arr = adjacency.get(a) ?? [];
    arr.push({ to: b, km });
    adjacency.set(a, arr);
  };
  for (const e of edges) {
    addAdj(e.from, e.to, e.km);
    addAdj(e.to, e.from, e.km);
  }

  const dist = new Map<string, number>([[from.id, 0]]);
  const visited = new Set<string>();
  for (;;) {
    let currentId: string | undefined;
    let currentDist = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < currentDist) {
        currentDist = d;
        currentId = id;
      }
    }
    if (currentId === undefined) return undefined;
    if (currentId === to.id) return currentDist;
    visited.add(currentId);
    for (const { to: neighborId, km } of adjacency.get(currentId) ?? []) {
      const nd = currentDist + km;
      if (nd < (dist.get(neighborId) ?? Infinity)) dist.set(neighborId, nd);
    }
  }
}

// "JR中央線(快速)" のような表記から会社名接頭辞・カッコ書き（区間表記や愛称）を除いて
// 実データの路線名（例: "中央線"）と比較しやすくする
function normalizeLineName(name: string): string {
  return name
    .replace(/^JR/, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .trim();
}

// 同名駅が複数路線にまたがる場合があるため、from/to 双方が乗る共通路線のうち
// まず路線名が一致するものに絞り込む（例: 「中央線」区間データを、駅並びが粗い
// 「中央本線」ではなく駅並びが細かい「中央線(快速)」に対応させるため）。
// 路線名で一致するものが無ければ直線距離合計が最小になる候補を採用する
// （区間は隣接駅間が前提のため、遠回りの別路線に迷い込むのを避けられる）
function resolveSectionKm(
  graph: RailGraph,
  railEdgesByLine: Map<string, GraphEdge[]>,
  section: CalibrationSection,
): { lineId: string; operator: string; rawKm: number } | undefined {
  const allNodes = Object.values(graph.nodes);
  const fromCandidates = allNodes.filter(
    (n) => n.name === section.from && n.operator === section.operator,
  );
  const toCandidates = new Map(
    allNodes
      .filter((n) => n.name === section.to && n.operator === section.operator)
      .map((n) => [n.lineId, n] as const),
  );

  const pairs: { from: StationNode; to: StationNode; km: number }[] = [];
  for (const f of fromCandidates) {
    const t = toCandidates.get(f.lineId);
    if (!t) continue;
    const km = shortestSameLineKm(railEdgesByLine, f, t);
    if (km === undefined) continue;
    pairs.push({ from: f, to: t, km });
  }
  if (pairs.length === 0) return undefined;

  const wantedLine = normalizeLineName(section.line);
  const nameMatched = pairs.filter((p) => normalizeLineName(p.from.lineName) === wantedLine);
  const pool = nameMatched.length > 0 ? nameMatched : pairs;

  let best: { lineId: string; operator: string; rawKm: number } | undefined;
  for (const p of pool) {
    if (!best || p.km < best.rawKm) {
      best = { lineId: p.from.lineId, operator: p.from.operator, rawKm: p.km };
    }
  }
  return best;
}

export function buildCalibration(
  graph: RailGraph,
  sections: CalibrationSection[],
): CalibrationTable {
  const railEdgesByLine = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (e.kind !== "rail") continue;
    const a = graph.nodes[e.from];
    const b = graph.nodes[e.to];
    if (!a || !b || a.lineId !== b.lineId) continue;
    const arr = railEdgesByLine.get(a.lineId) ?? [];
    arr.push(e);
    railEdgesByLine.set(a.lineId, arr);
  }

  const ratiosByLine = new Map<string, number[]>();
  const ratiosByOperator = new Map<string, number[]>();
  const allRatios: number[] = [];
  let unresolved = 0;

  for (const section of sections) {
    const resolved = resolveSectionKm(graph, railEdgesByLine, section);
    if (!resolved || resolved.rawKm <= 0) {
      unresolved++;
      continue;
    }
    const ratio = section.officialKm / resolved.rawKm;
    if (ratio <= MIN_RATIO || ratio > MAX_RATIO) continue;

    allRatios.push(ratio);
    const lineRatios = ratiosByLine.get(resolved.lineId) ?? [];
    lineRatios.push(ratio);
    ratiosByLine.set(resolved.lineId, lineRatios);
    const opRatios = ratiosByOperator.get(resolved.operator) ?? [];
    opRatios.push(ratio);
    ratiosByOperator.set(resolved.operator, opRatios);
  }

  if (unresolved > 0) {
    console.warn(`buildCalibration: ${unresolved} 件の区間を解決できずスキップしました`);
  }

  const byLine: Record<string, number> = {};
  for (const [lineId, ratios] of ratiosByLine) byLine[lineId] = median(ratios);
  const byOperator: Record<string, number> = {};
  for (const [operator, ratios] of ratiosByOperator) byOperator[operator] = median(ratios);
  const fallback = allRatios.length > 0 ? median(allRatios) : 1;

  return {
    byLine,
    byOperator,
    fallback,
    meta: {
      source: "https://gtfs-gis.jp/railway_honsu/data/unkohonsu2026_kukan_sjis.csv",
      fetchedAt: new Date().toISOString(),
      sections: sections.length,
    },
  };
}

export function calibratedKm(
  table: CalibrationTable,
  node: StationNode,
  rawKm: number,
): number {
  const coefficient = table.byLine[node.lineId] ?? table.byOperator[node.operator] ?? table.fallback;
  return rawKm * coefficient;
}
