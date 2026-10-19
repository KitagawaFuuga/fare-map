import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/graph/csv";
import {
  csvOperatorOf,
  operatorAliasesSchema,
} from "@/lib/graph/operator-alias";
import type { RailGraph } from "@/lib/graph/types";

const aliases = operatorAliasesSchema.parse(
  JSON.parse(readFileSync("data/operator-aliases.json", "utf8")),
).aliases;

describe("csvOperatorOf", () => {
  it("別名があれば実営業キロ側の事業者名を返す", () => {
    expect(csvOperatorOf(aliases, "東京メトロ")).toBe("東京地下鉄");
  });

  it("別名が無ければそのまま返す", () => {
    expect(csvOperatorOf(aliases, "東武鉄道")).toBe("東武鉄道");
  });
});

// 別名を1つでも間違えると、別事業者の区間キロを正解として採用してしまう。
// 対応表そのものを実データで検証する
describe("data/operator-aliases.json", () => {
  const graph = JSON.parse(
    readFileSync("data/graph.json", "utf8"),
  ) as RailGraph;
  const kmRows = parseCsv(
    readFileSync("data/raw/kilometrage.csv", "utf8").replace(/"/g, ""),
  );
  const namesOf = new Map<string, Set<string>>();
  for (const n of Object.values(graph.nodes)) {
    const s = namesOf.get(n.operator) ?? new Set<string>();
    s.add(n.name);
    namesOf.set(n.operator, s);
  }
  const csvOperators = new Set(kmRows.map((r) => r["事業者名"] ?? ""));

  it.each(aliases.map((a) => [a.graph, a.csv, a.sections] as const))(
    "%s → %s は両側に実在し、区間を %i 本生む",
    (graphOperator, csv, sections) => {
      expect(namesOf.has(graphOperator), "グラフに無い事業者名").toBe(true);
      expect(csvOperators.has(csv), "実営業キロ側に無い事業者名").toBe(true);
      const names = namesOf.get(graphOperator) ?? new Set<string>();
      const usable = kmRows.filter(
        (r) =>
          (r["事業者名"] ?? "") === csv &&
          names.has(r["起点駅"] ?? "") &&
          names.has(r["終点駅"] ?? ""),
      ).length;
      expect(usable).toBe(sections);
      expect(usable).toBeGreaterThan(0);
    },
  );

  it("同じグラフ事業者に2つの別名を与えていない", () => {
    const seen = new Set<string>();
    for (const a of aliases) {
      expect(seen.has(a.graph), `${a.graph} が重複`).toBe(false);
      seen.add(a.graph);
    }
  });

  it("別名の左辺は、実営業キロ側にその名前が無い事業者に限る", () => {
    // CSV にそのまま在る名前を別名で上書きすると、正しい区間を捨てて
    // 別事業者の区間を読みにいくことになる
    for (const a of aliases) {
      expect(csvOperators.has(a.graph), `${a.graph} は CSV にも在る`).toBe(
        false,
      );
    }
  });
});
