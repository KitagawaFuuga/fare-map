import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ExtraJoin, OperatorSplit } from "@/lib/graph/build";
import type { RailGraph } from "@/lib/graph/types";
import { parseCsv } from "@/lib/graph/csv";

// data/graph.json はコミット済みの生成物で、生成は scripts/pipeline/build-graph.ts が
// 手元で走ったときにしか行われない。つまり data/operator-splits.json や
// data/extra-joins.json を編集してもグラフを作り直さなければ、buildGraph が持っている
// 検証（lineId の実在、駅の実在、重複）はCIでは一度も動かない。
// 定義とコミット済みグラフが食い違ったまま気づかない状態を避けるため、
// 「定義どおりの結果がグラフに反映されているか」をここで直接確かめる。
const graph = JSON.parse(readFileSync("data/graph.json", "utf8")) as RailGraph;
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
const nodes = Object.values(graph.nodes);

describe("data/operator-splits.json と graph.json の整合", () => {
  it("定義された lineId がすべて graph に存在する", () => {
    const lineIds = new Set(nodes.map((n) => n.lineId));
    const missing = splits.filter((s) => !lineIds.has(s.lineId));
    expect(missing.map((s) => `${s.lineId}→${s.to}`)).toEqual([]);
  });

  it("定義された路線のノードは分割後の事業者名になっている", () => {
    const wrong: string[] = [];
    for (const s of splits) {
      const ns = nodes.filter((n) => n.lineId === s.lineId);
      for (const n of ns) {
        if (n.operator !== s.to)
          wrong.push(`${s.lineId} ${n.name}: ${n.operator} (期待 ${s.to})`);
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
  });

  // 分割後の事業者名で運賃表が引けないと、均一運賃の路面電車が対キロ制の
  // 運賃表で課金されるなどの取り違えが静かに起きる。名前は手打ちなので、
  // 分割定義と運賃表のどちらかだけ直したときにここで落ちる
  it("分割後の事業者名すべてに対応する運賃表がある", () => {
    const covered = new Set(
      readdirSync("data/fare-rules")
        .filter((f) => f.endsWith(".json"))
        .flatMap(
          (f) =>
            (
              JSON.parse(readFileSync(`data/fare-rules/${f}`, "utf8")) as {
                operators: string[];
              }
            ).operators,
        ),
    );
    const missing = [...new Set(splits.map((s) => s.to))].filter(
      (op) => !covered.has(op),
    );
    expect(missing).toEqual([]);
  });
});

describe("data/extra-joins.json と graph.json の整合", () => {
  it("補った接続の駅がすべて graph に存在し、指定の路線に属している", () => {
    const wrong: string[] = [];
    for (const j of extraJoins) {
      for (const id of [j.from, j.to]) {
        const n = graph.nodes[id];
        if (!n) {
          wrong.push(`${id} が存在しない`);
          continue;
        }
        if (n.lineId !== j.lineId)
          wrong.push(
            `${id} (${n.name}) は ${n.lineId} で ${j.lineId} ではない`,
          );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("補った接続が rail エッジとして反映されている", () => {
    const rail = new Set(
      graph.edges
        .filter((e) => e.kind === "rail")
        .map((e) => [e.from, e.to].sort().join("\u0000")),
    );
    const missing = extraJoins
      .filter((j) => !rail.has([j.from, j.to].sort().join("\u0000")))
      .map((j) => `${j.lineId} ${j.from}-${j.to}`);
    expect(missing).toEqual([]);
  });

  // 元データが更新されて接続が追加されたら、補完定義は不要になる。残したままだと
  // 同じ区間に2本エッジが張られて距離が狂う。グラフを作り直す前に気づけるよう、
  // コミット済みグラフではなく元データ(join.csv)と直接突き合わせる
  it("補った接続が元データ(join.csv)に無いこと", () => {
    const joins = parseCsv(readFileSync("data/raw/join.csv", "utf8"));
    const inRaw = new Set(
      joins.map((j) =>
        [j.station_cd1 ?? "", j.station_cd2 ?? ""].sort().join("\u0000"),
      ),
    );
    const redundant = extraJoins
      .filter((j) => inRaw.has([j.from, j.to].sort().join("\u0000")))
      .map((j) => `${j.lineId} ${j.from}-${j.to}`);
    expect(redundant).toEqual([]);
  });
});
