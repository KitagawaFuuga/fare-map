import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "@/lib/graph/csv";
import {
  buildGraph,
  type ExtraJoin,
  type OperatorSplit,
} from "@/lib/graph/build";
import {
  buildCalibration,
  calibratedKm,
  type CalibrationSection,
} from "@/lib/graph/calibrate";
import {
  applyStationKm,
  type StationKmEdge,
} from "@/lib/graph/apply-station-km";

// データ更新時にだけ走る生成スクリプト。ekidata の CSV からグラフを組み、
// 実営業キロで距離補正をかけて data/graph.json に焼き付ける。
// 実行時（検索API）はこの出力を読むだけで、このファイルは通らない。
const raw = (name: string) =>
  parseCsv(readFileSync(`data/raw/${name}`, "utf8"));

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

const graph = buildGraph(
  {
    companies: raw("company.csv"),
    lines: raw("line.csv"),
    stations: raw("station.csv"),
    joins: raw("join.csv"),
  },
  splits,
  extraJoins,
);

// kilometrage.csv は引用符で囲まれているが埋め込みカンマは無いため、
// 引用符を除去してから parseCsv（単純 split 実装）に通せる
const kmRows = parseCsv(
  readFileSync("data/raw/kilometrage.csv", "utf8").replace(/"/g, ""),
);
const sections: CalibrationSection[] = kmRows
  .map((r) => ({
    operator: r["事業者名"] ?? "",
    line: r["路線名"] ?? "",
    from: r["起点駅"] ?? "",
    to: r["終点駅"] ?? "",
    officialKm: Number(r["営業キロ"]),
  }))
  .filter(
    (s) =>
      s.operator !== "" &&
      s.line !== "" &&
      s.from !== "" &&
      s.to !== "" &&
      Number.isFinite(s.officialKm) &&
      s.officialKm > 0,
  );

// operator-splits で分けた事業者名は実営業キロのデータ側には存在しないので、
// 分割前の名前で分割後のノードを引けるよう別名として渡す
const calibration = buildCalibration(graph, sections, splits);
for (const edge of graph.edges) {
  // 補正するのは rail のみ。transfer エッジは距離0の乗換なので係数を掛けない
  if (edge.kind !== "rail") continue;
  const node = graph.nodes[edge.from];
  if (!node) continue;
  edge.km = calibratedKm(calibration, node, edge.km);
}

// 駅一覧から取れた実営業キロがある区間は、推定値を置き換える。
// 補正の後でなければならない（補正は推定値と実キロの比を路線・事業者ごとに
// 出しているので、先に一部を実キロにすると比の母数が歪む）。
if (existsSync("data/station-km.json")) {
  const stationKm = JSON.parse(
    readFileSync("data/station-km.json", "utf8"),
  ) as { edges: StationKmEdge[] };
  const applied = applyStationKm(graph, stationKm.edges);
  process.stdout.write(
    `station-km: ${applied.replaced} エッジを実営業キロに置き換え` +
      `（推定との差の合計 ${applied.totalDelta.toFixed(1)}km、` +
      `平均 ${(applied.totalDelta / Math.max(applied.replaced, 1)).toFixed(3)}km）、` +
      `グラフに無い駅間 ${applied.unmatched}
`,
  );
  for (const w of applied.worst.slice(0, 5)) {
    process.stdout.write(
      `  差が大きい: ${w.from}–${w.to} ${w.before.toFixed(2)} → ${w.after.toFixed(2)}km
`,
    );
  }
}

// 運賃計算キロが営業キロと違う線区に fareKm を入れる。
// 距離補正と実営業キロの置き換えが終わったあとで行う（倍率の母数は営業キロ）。
const distanceClasses = (
  JSON.parse(readFileSync("data/fare-distance-classes.json", "utf8")) as {
    classes: { operator: string; rates: Record<string, number> }[];
  }
).classes;
const rateOf = new Map<string, number>();
for (const c of distanceClasses) {
  for (const [line, rate] of Object.entries(c.rates)) {
    if (rate !== 1) rateOf.set(`${c.operator}\u0000${line}`, rate);
  }
}
let weighted = 0;
for (const edge of graph.edges) {
  if (edge.kind !== "rail") continue;
  const from = graph.nodes[edge.from];
  const to = graph.nodes[edge.to];
  // 両端の路線名が一致する辺だけを対象にする（乗り入れで路線をまたぐ辺は
  // どちらの線区か決まらないので営業キロのまま）
  if (from === undefined || to === undefined) continue;
  if (from.lineName !== to.lineName) continue;
  const rate = rateOf.get(`${edge.operator}\u0000${from.lineName}`);
  if (rate === undefined) continue;
  edge.fareKm = Number((edge.km * rate).toFixed(3));
  weighted++;
}
process.stdout.write(
  `fareKm: ${weighted} エッジに運賃計算キロを設定（擬制キロ・換算キロ）
`,
);

// calibration.json はコミット対象なので prettier の書式（末尾改行あり）に合わせる。
// 付け忘れると再生成のたびに format:check が落ちる。
writeFileSync(
  "data/calibration.json",
  `${JSON.stringify(calibration, null, 2)}\n`,
);
writeFileSync("data/graph.json", JSON.stringify(graph));
process.stdout.write(
  `nodes: ${Object.keys(graph.nodes).length}, edges: ${graph.edges.length}\n`,
);
process.stdout.write(
  `calibration: byLine=${Object.keys(calibration.byLine).length} 路線, byOperator=${
    Object.keys(calibration.byOperator).length
  } 事業者, fallback=${calibration.fallback.toFixed(3)}\n`,
);
