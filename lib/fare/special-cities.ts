import { z } from "zod";
import { HONSHU_OPERATORS } from "@/lib/fare/calculator";
import type { RailGraph } from "@/lib/graph/types";
import { MinHeap } from "@/lib/search/heap";

// JRの特定都区市内（旅客営業規則 第86条）と東京山手線内（第87条）。
// data/special-cities.json の形。駅の一覧は scripts/fare/build-special-cities.ts が作る。
export const specialCitiesFileSchema = z.object({
  cities: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      center: z.string(),
      operator: z.string(),
      /** 中心駅からの距離がこれを超えると適用（第86条は200km、第87条は100km） */
      minKm: z.number(),
      /** 第87条は200km以下だけ */
      maxKm: z.number().optional(),
      stations: z.array(z.string()).min(1),
    }),
  ),
});
export type SpecialCitiesFile = z.infer<typeof specialCitiesFileSchema>;

export interface SpecialCity {
  id: string;
  center: string;
  operator: string;
  minKm: number;
  maxKm?: number;
  stations: string[];
  // 中心駅から各駅（駅名）までの運賃計算キロ。区域の会社の線路上の最短距離で、
  // 1社の中の運賃に使う
  centerKm: ReadonlyMap<string, number>;
  // 本州3社の区域だけ。3社をまたいで測った距離で、通し運賃に使う
  throughCenterKm?: ReadonlyMap<string, number>;
}

// 中心駅からの距離はグラフから起動時に測る。運賃計算キロ（fareKm）はグラフを
// 作り直すたびに変わりうるので、データファイルに焼き込むとずれる。
export function buildSpecialCities(
  graph: RailGraph,
  file: Pick<SpecialCitiesFile, "cities">,
): SpecialCity[] {
  return file.cities.map((c) => {
    const centerKm = distancesByName(graph, c.center, new Set([c.operator]));
    const names = new Set(
      Object.values(graph.nodes)
        .filter((n) => n.operator === c.operator)
        .map((n) => n.name),
    );
    for (const s of [c.center, ...c.stations])
      if (!names.has(s))
        throw new Error(`${c.name}: 駅 ${s} が ${c.operator} に無い`);
    return {
      id: c.id,
      center: c.center,
      operator: c.operator,
      minKm: c.minKm,
      ...(c.maxKm === undefined ? {} : { maxKm: c.maxKm }),
      stations: c.stations,
      centerKm,
      ...(HONSHU_OPERATORS.has(c.operator)
        ? {
            throughCenterKm: distancesByName(graph, c.center, HONSHU_OPERATORS),
          }
        : {}),
    };
  });
}

// 駅名ごとの最短距離。頂点は物理的な駅（groupId が同じノード、および同名で乗換の
// 辺でつながったノード）で、乗り換えは0km。駅名を頂点にしてはいけない。同名で別の駅
// （武蔵野線と大和路線の三郷、東北本線と関西本線の大河原）がつながり、東京→仙台が
// 104.6km になっていた。計算機は駅名しか知らないので、同名で別の駅がある駅名は
// どちらの距離か決められず、結果に含めない（その駅では規則を使わない）
function distancesByName(
  graph: RailGraph,
  sourceName: string,
  operators: ReadonlySet<string>,
): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const inScope = (id: string) => {
    const op = graph.nodes[id]?.operator;
    return op !== undefined && operators.has(op);
  };
  const byGroup = new Map<string, string>();
  for (const n of Object.values(graph.nodes)) {
    if (!operators.has(n.operator)) continue;
    const first = byGroup.get(n.groupId);
    if (first === undefined) byGroup.set(n.groupId, n.id);
    else union(first, n.id);
  }
  for (const e of graph.edges)
    if (
      e.kind === "transfer" &&
      inScope(e.from) &&
      inScope(e.to) &&
      graph.nodes[e.from]?.name === graph.nodes[e.to]?.name
    )
      union(e.from, e.to);

  const adj = new Map<string, [string, number][]>();
  for (const e of graph.edges) {
    if (e.kind !== "rail" || !operators.has(e.operator)) continue;
    const a = find(e.from);
    const b = find(e.to);
    if (a === b) continue;
    const km = e.fareKm ?? e.km;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push([b, km]);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push([a, km]);
  }
  // 駅名 → 物理的な駅
  const stationsByName = new Map<string, Set<string>>();
  for (const n of Object.values(graph.nodes)) {
    if (!operators.has(n.operator)) continue;
    const set = stationsByName.get(n.name) ?? new Set<string>();
    set.add(find(n.id));
    stationsByName.set(n.name, set);
  }
  const sources = stationsByName.get(sourceName);
  if (sources === undefined || sources.size !== 1)
    throw new Error(`中心駅 ${sourceName} が無いか、同名の駅が複数ある`);

  const dist = new Map<string, number>();
  const heap = new MinHeap<[string, number]>((a, b) => a[1] - b[1]);
  for (const s of sources) heap.push([s, 0]);
  for (let top = heap.pop(); top !== undefined; top = heap.pop()) {
    const [u, du] = top;
    if (dist.has(u)) continue;
    dist.set(u, du);
    for (const [v, w] of adj.get(u) ?? []) {
      // 小数第1位のキロを足し続けると誤差がたまるので丸める
      if (!dist.has(v)) heap.push([v, Math.round((du + w) * 1000) / 1000]);
    }
  }
  const out = new Map<string, number>();
  for (const [name, set] of stationsByName) {
    if (set.size !== 1) continue;
    const [station] = set;
    const d = station === undefined ? undefined : dist.get(station);
    if (d !== undefined) out.set(name, d);
  }
  return out;
}
