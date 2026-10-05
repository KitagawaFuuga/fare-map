// 座標から推定した駅間距離（距離補正後）が、実営業キロとどれだけずれるかを測る分析スクリプト。
// fare-uncertainty.ts が揺らしに使う誤差の分布と同じものを要約して出す。
//
//   npx tsx scripts/analysis/estimate-error.ts
import { readFileSync } from "node:fs";
import { parseCsv } from "@/lib/graph/csv";
import {
  buildGraph,
  type ExtraJoin,
  type OperatorSplit,
} from "@/lib/graph/build";
import { calibratedKm, type CalibrationTable } from "@/lib/graph/calibrate";
import type { StationKmEdge } from "@/lib/graph/apply-station-km";
import type { RailGraph } from "@/lib/graph/types";

const out = (...a: unknown[]) =>
  process.stdout.write(`${a.join(" ")}
`);
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
const g = buildGraph(
  {
    companies: raw("company.csv"),
    lines: raw("line.csv"),
    stations: raw("station.csv"),
    joins: raw("join.csv"),
  },
  splits,
  extraJoins,
);
const cal = JSON.parse(
  readFileSync("data/calibration.json", "utf8"),
) as CalibrationTable;
const key = (op: string, a: string, b: string) =>
  `${op}|${[a, b].sort().join("|")}`;
const est = new Map<string, number>();
for (const e of g.edges) {
  if (e.kind !== "rail") continue;
  const n = g.nodes[e.from]!;
  const m = g.nodes[e.to]!;
  est.set(key(e.operator, n.name, m.name), calibratedKm(cal, n, e.km));
}
const real = (
  JSON.parse(readFileSync("data/station-km.json", "utf8")) as {
    edges: StationKmEdge[];
  }
).edges;
const errs: { op: string; km: number; r: number }[] = [];
const seen = new Set<string>();
for (const e of real) {
  const k = key(e.operator, e.from, e.to);
  if (seen.has(k)) continue;
  seen.add(k);
  const x = est.get(k);
  if (x === undefined || x <= 0 || e.km <= 0) continue;
  errs.push({ op: e.operator, km: e.km, r: Math.log(e.km / x) });
}
const final = JSON.parse(readFileSync("data/graph.json", "utf8")) as RailGraph;
let estimated = 0,
  rail = 0;
for (const e of final.edges) {
  if (e.kind !== "rail") continue;
  rail++;
  const x = est.get(
    key(e.operator, final.nodes[e.from]!.name, final.nodes[e.to]!.name),
  );
  if (x !== undefined && Math.abs(x - e.km) < 1e-6) estimated++;
}
const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(p * (s.length - 1))]!;
};
const summary = (name: string, a: typeof errs) => {
  const r = a.map((x) => x.r);
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / r.length);
  out(
    `${name}: n=${r.length} 平均${(mean * 100).toFixed(1)}% sd${(sd * 100).toFixed(1)}% p5 ${(q(r, 0.05) * 100).toFixed(1)}% p50 ${(q(r, 0.5) * 100).toFixed(1)}% p95 ${(q(r, 0.95) * 100).toFixed(1)}%`,
  );
};
out(`最終グラフの rail ${rail} のうち推定のまま ${estimated}`);
summary("全体", errs);
summary(
  "JR",
  errs.filter((e) => e.op.startsWith("JR")),
);
summary(
  "非JR",
  errs.filter((e) => !e.op.startsWith("JR")),
);
summary(
  "JR 5km超",
  errs.filter((e) => e.op.startsWith("JR") && e.km > 5),
);

// 同じ事業者で駅を共有する隣接区間の誤差の相関（路線全体で同じ向きにずれるか）
{
  const byNode = new Map<string, number[]>();
  const list = errs.map((x) => x);
  const ends: [string, string][] = [];
  seen.clear();
  let i = 0;
  for (const e of real) {
    const k = key(e.operator, e.from, e.to);
    if (seen.has(k)) continue;
    seen.add(k);
    const x = est.get(k);
    if (x === undefined || x <= 0 || e.km <= 0) continue;
    for (const n of [e.from, e.to]) {
      const nk = `${e.operator}|${n}`;
      byNode.set(nk, [...(byNode.get(nk) ?? []), i]);
    }
    ends.push([e.from, e.to]);
    i++;
  }
  const xs: number[] = [],
    ys: number[] = [];
  for (const idx of byNode.values()) {
    if (idx.length !== 2) continue; // 分岐駅を除いて、路線の途中の駅だけ
    xs.push(list[idx[0]!]!.r);
    ys.push(list[idx[1]!]!.r);
  }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const mx = mean(xs),
    my = mean(ys);
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let j = 0; j < xs.length; j++) {
    sxy += (xs[j]! - mx) * (ys[j]! - my);
    sxx += (xs[j]! - mx) ** 2;
    syy += (ys[j]! - my) ** 2;
  }
  out(
    `隣接区間の誤差の相関: ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)} (n=${xs.length})`,
  );
}
