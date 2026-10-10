// JRの運賃が「推定値のまま残っている営業キロ」のせいで誤っている確率を、
// モンテカルロで見積もる分析スクリプト（データ生成には使わない）。
//
// 考え方: JRの運賃表は一次資料と全帯で照合済みなので、残る誤差の主因は距離。
// 実営業キロが取れていない区間（graph.json の約1割）は座標から推定した距離で、
// その誤差の分布は実営業キロのある区間で測れる（scripts/analysis/estimate-error.ts）。
// 推定区間の距離をその分布で揺らし、駅ペアの運賃が変わる確率を「誤っている確率」とする。
//
// 見積もれるのは距離の推定に由来する誤りだけ。運賃規則の未対応や、実営業キロ側の
// 誤りは含まない（そちらは実額の抜き取り照合で見る）。
//
//   npx tsx scripts/analysis/fare-uncertainty.ts [--pairs=300] [--draws=200] [--seed=1]
import { readdirSync, readFileSync } from "node:fs";
import { parseCsv } from "@/lib/graph/csv";
import {
  buildGraph,
  mergeExtraStations,
  type ExtraJoin,
  type OperatorSplit,
} from "@/lib/graph/build";
import { calibratedKm, type CalibrationTable } from "@/lib/graph/calibrate";
import type { StationKmEdge } from "@/lib/graph/apply-station-km";
import { createFareCalculator } from "@/lib/fare/calculator";
import {
  fareOverrideSchema,
  fareRuleSchema,
  fareZoneSchema,
} from "@/lib/fare/types";
import type { RailGraph } from "@/lib/graph/types";

const arg = (name: string, fallback: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : Number(hit.split("=")[1]);
};
const PAIRS = arg("pairs", 300);
const DRAWS = arg("draws", 200);
const SEED = arg("seed", 1);
const OPERATORS = [
  "JR北海道",
  "JR東日本",
  "JR東海",
  "JR西日本",
  "JR四国",
  "JR九州",
];

// 再現できるよう乱数は種つき
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)]!;

// --- 推定値と誤差の分布（estimate-error.ts と同じ作り方） ---
const raw = (n: string) => parseCsv(readFileSync(`data/raw/${n}`, "utf8"));
const splits = (
  JSON.parse(readFileSync("data/operator-splits.json", "utf8")) as {
    splits: OperatorSplit[];
  }
).splits;
const extraJoins = (
  JSON.parse(readFileSync("data/extra-joins.json", "utf8")) as {
    joins: ExtraJoin[];
  }
).joins;
const base = buildGraph(
  {
    companies: raw("company.csv"),
    lines: raw("line.csv"),
    // グラフ生成（build-graph.ts）と同じく、元データから消えた駅を補う
    stations: mergeExtraStations(
      raw("station.csv"),
      (
        JSON.parse(readFileSync("data/extra-stations.json", "utf8")) as {
          stations: Record<string, string>[];
        }
      ).stations,
    ),
    joins: raw("join.csv"),
  },
  splits,
  extraJoins,
);
const cal = JSON.parse(
  readFileSync("data/calibration.json", "utf8"),
) as CalibrationTable;
const pairKey = (op: string, a: string, b: string) =>
  `${op}|${[a, b].sort().join("|")}`;
const estimate = new Map<string, number>();
for (const e of base.edges) {
  if (e.kind !== "rail") continue;
  const n = base.nodes[e.from]!;
  const m = base.nodes[e.to]!;
  estimate.set(pairKey(e.operator, n.name, m.name), calibratedKm(cal, n, e.km));
}
const real = (
  JSON.parse(readFileSync("data/station-km.json", "utf8")) as {
    edges: StationKmEdge[];
  }
).edges;
// JRの区間で測った log(実営業キロ/推定)。ここから復元抽出して揺らす
const residuals: number[] = [];
{
  const seen = new Set<string>();
  for (const e of real) {
    if (!e.operator.startsWith("JR")) continue;
    const k = pairKey(e.operator, e.from, e.to);
    if (seen.has(k)) continue;
    seen.add(k);
    const x = estimate.get(k);
    if (x !== undefined && x > 0 && e.km > 0)
      residuals.push(Math.log(e.km / x));
  }
}

// --- 本番と同じ運賃計算器 ---
const rules = readdirSync("data/fare-rules").map((f) =>
  fareRuleSchema.parse(
    JSON.parse(readFileSync(`data/fare-rules/${f}`, "utf8")),
  ),
);
const overrides = readdirSync("data/fare-overrides").map((f) =>
  fareOverrideSchema.parse(
    JSON.parse(readFileSync(`data/fare-overrides/${f}`, "utf8")),
  ),
);
const zones = (
  JSON.parse(readFileSync("data/fare-zones.json", "utf8")) as {
    zones: unknown[];
  }
).zones.map((z) => fareZoneSchema.parse(z));
const calc = createFareCalculator(rules, overrides, zones);
const graph = JSON.parse(readFileSync("data/graph.json", "utf8")) as RailGraph;

interface Edge {
  to: number;
  km: number; // 営業キロ
  fareKm: number; // 運賃計算キロ
  local: boolean;
  estimated: boolean;
  id: number; // 揺らしの係数を引く番号（往復で同じ値を使う）
}

// 事業者の中だけで完結する経路の運賃。最短経路は運賃計算キロで取り、地方交通線だけで
// 行ける経路は別に営業キロで取って、安いほうを採る（探索と同じ扱い）
function buildOperator(op: string) {
  const names: string[] = [];
  const index = new Map<string, number>();
  const idOf = (name: string) => {
    let i = index.get(name);
    if (i === undefined) {
      i = names.length;
      names.push(name);
      index.set(name, i);
    }
    return i;
  };
  const adj: Edge[][] = [];
  let edgeId = 0;
  let estimatedCount = 0;
  for (const e of graph.edges) {
    if (e.kind !== "rail" || e.operator !== op) continue;
    const a = idOf(graph.nodes[e.from]!.name);
    const b = idOf(graph.nodes[e.to]!.name);
    if (a === b) continue;
    const est = estimate.get(pairKey(op, names[a]!, names[b]!));
    const estimated = est !== undefined && Math.abs(est - e.km) < 1e-6;
    if (estimated) estimatedCount++;
    const fareKm = e.fareKm ?? e.km;
    const local = fareKm > e.km && calc.hasLocalTable(op);
    const id = edgeId++;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      (adj[x] ??= []).push({ to: y, km: e.km, fareKm, local, estimated, id });
    }
  }
  return { names, adj, edgeCount: edgeId, estimatedCount };
}

function dijkstra(
  adj: Edge[][],
  n: number,
  from: number,
  weight: (e: Edge) => number | null,
): Float64Array {
  const dist = new Float64Array(n).fill(Infinity);
  dist[from] = 0;
  const done = new Uint8Array(n);
  // 事業者単位のグラフは高々2千駅なので、単純な O(n^2) で足りる
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++)
      if (!done[i] && dist[i]! < best) {
        best = dist[i]!;
        u = i;
      }
    if (u < 0) break;
    done[u] = 1;
    for (const e of adj[u] ?? []) {
      const w = weight(e);
      if (w === null) continue;
      const nd = best + w;
      if (nd < dist[e.to]!) dist[e.to] = nd;
    }
  }
  return dist;
}

function faresFrom(
  op: string,
  g: ReturnType<typeof buildOperator>,
  from: number,
  dests: number[],
  factor: Float64Array | null,
): number[] {
  const f = (e: Edge) => (factor !== null && e.estimated ? factor[e.id]! : 1);
  const n = g.names.length;
  const byFareKm = dijkstra(g.adj, n, from, (e) => e.fareKm * f(e));
  const byLocal = calc.hasLocalTable(op)
    ? dijkstra(g.adj, n, from, (e) => (e.local ? e.km * f(e) : null))
    : null;
  return dests.map((d) => {
    const km = byFareKm[d]!;
    if (!Number.isFinite(km)) return NaN;
    let fare = calc.estimate(op, km, g.names[from], g.names[d]);
    const localKm = byLocal?.[d];
    if (localKm !== undefined && Number.isFinite(localKm)) {
      fare = Math.min(
        fare,
        calc.estimate(op, km, g.names[from], g.names[d], localKm),
      );
    }
    return fare;
  });
}

// --- 実行 ---
const ORIGINS = Math.max(1, Math.round(PAIRS / 10));
const DESTS = Math.max(1, Math.round(PAIRS / ORIGINS));
const results: { op: string; pairs: number; errorProbs: number[] }[] = [];
for (const op of OPERATORS) {
  const g = buildOperator(op);
  const n = g.names.length;
  const errorProbs: number[] = [];
  for (let o = 0; o < ORIGINS; o++) {
    const from = Math.floor(rand() * n);
    const dests: number[] = [];
    while (dests.length < DESTS) {
      const d = Math.floor(rand() * n);
      if (d !== from) dests.push(d);
    }
    const baseFares = faresFrom(op, g, from, dests, null);
    const changed = new Array<number>(dests.length).fill(0);
    for (let k = 0; k < DRAWS; k++) {
      const factor = new Float64Array(g.edgeCount);
      for (let i = 0; i < g.edgeCount; i++)
        factor[i] = Math.exp(pick(residuals));
      const fares = faresFrom(op, g, from, dests, factor);
      fares.forEach((fare, i) => {
        if (fare !== baseFares[i]) changed[i]!++;
      });
    }
    baseFares.forEach((fare, i) => {
      // 事業者の中だけではつながらない組（別会社経由でしか行けない）は数えない
      if (Number.isFinite(fare)) errorProbs.push(changed[i]! / DRAWS);
    });
  }
  results.push({ op, pairs: (n * (n - 1)) / 2, errorProbs });
  const mean = errorProbs.reduce((s, x) => s + x, 0) / errorProbs.length;
  const touched = errorProbs.filter((p) => p > 0).length;
  process.stdout.write(
    `${op}: 駅${n} 推定区間 ${g.estimatedCount}/${g.edgeCount} ` +
      `標本${errorProbs.length}組 誤り確率の平均 ${(mean * 100).toFixed(2)}% ` +
      `（揺らすと運賃が変わりうる組 ${touched}）\n`,
  );
}

// 会社ごとの駅ペア数で重み付けした全体の誤り率と、組の復元抽出による95%区間
const totalPairs = results.reduce((s, r) => s + r.pairs, 0);
const weighted = (rs: typeof results) =>
  rs.reduce(
    (s, r) =>
      s +
      (r.pairs / totalPairs) *
        (r.errorProbs.reduce((a, x) => a + x, 0) / r.errorProbs.length),
    0,
  );
const point = weighted(results);
const boots: number[] = [];
for (let b = 0; b < 1000; b++) {
  boots.push(
    weighted(
      results.map((r) => ({
        ...r,
        errorProbs: r.errorProbs.map(() => pick(r.errorProbs)),
      })),
    ),
  );
}
boots.sort((a, b) => a - b);
process.stdout.write(
  `\nJR全体（駅ペア数で重み付け）: 距離の推定に由来する誤り率 ${(point * 100).toFixed(2)}% ` +
    `（95%区間 ${(boots[25]! * 100).toFixed(2)}〜${(boots[974]! * 100).toFixed(2)}%）\n`,
);
