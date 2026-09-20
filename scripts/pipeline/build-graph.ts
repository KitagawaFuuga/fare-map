import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "@/lib/graph/csv";
import { buildGraph } from "@/lib/graph/build";
import {
  buildCalibration,
  calibratedKm,
  type CalibrationSection,
} from "@/lib/graph/calibrate";

// データ更新時にだけ走る生成スクリプト。ekidata の CSV からグラフを組み、
// 実営業キロで距離補正をかけて data/graph.json に焼き付ける。
// 実行時（検索API）はこの出力を読むだけで、このファイルは通らない。
const raw = (name: string) =>
  parseCsv(readFileSync(`data/raw/${name}`, "utf8"));

const graph = buildGraph({
  companies: raw("company.csv"),
  lines: raw("line.csv"),
  stations: raw("station.csv"),
  joins: raw("join.csv"),
});

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

const calibration = buildCalibration(graph, sections);
for (const edge of graph.edges) {
  // 補正するのは rail のみ。transfer エッジは距離0の乗換なので係数を掛けない
  if (edge.kind !== "rail") continue;
  const node = graph.nodes[edge.from];
  if (!node) continue;
  edge.km = calibratedKm(calibration, node, edge.km);
}

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
