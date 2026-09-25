import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/graph/csv";
import {
  buildKilometrageFix,
  kilometrageCorrectionsSchema,
} from "@/lib/graph/kilometrage";

const corrections = kilometrageCorrectionsSchema.parse(
  JSON.parse(readFileSync("data/kilometrage-corrections.json", "utf8")),
).corrections;
const fix = buildKilometrageFix(corrections);

describe("buildKilometrageFix", () => {
  it("事業者・駅ペア・元の値が一致したら差し替える", () => {
    expect(fix("近畿日本鉄道", "大阪難波", "大阪上本町", 2.8)).toBe(2.0);
  });

  it("向きを問わない", () => {
    expect(fix("近畿日本鉄道", "大阪上本町", "大阪難波", 2.8)).toBe(2.0);
  });

  it("元の値が違えば差し替えない（CSVが直った可能性があるため）", () => {
    expect(fix("近畿日本鉄道", "大阪難波", "大阪上本町", 2.0)).toBe(2.0);
    expect(fix("近畿日本鉄道", "大阪難波", "大阪上本町", 3.0)).toBe(3.0);
  });

  it("対象外の区間はそのまま返す", () => {
    expect(fix("近畿日本鉄道", "大阪上本町", "布施", 4.1)).toBe(4.1);
    expect(fix("東武鉄道", "大阪難波", "大阪上本町", 2.8)).toBe(2.8);
  });
});

// 差し替えが空振りしていたら意味がない。CSVの実データに当てて確認する
describe("data/kilometrage-corrections.json", () => {
  const rows = parseCsv(
    readFileSync("data/raw/kilometrage.csv", "utf8").replace(/"/g, ""),
  );

  it.each(corrections.map((c) => [c.operator, c.from, c.to, c.csvKm] as const))(
    "%s %s-%s は CSV に %f km で実在する",
    (operator, from, to, csvKm) => {
      const hit = rows.find(
        (r) =>
          (r["事業者名"] ?? "") === operator &&
          [r["起点駅"], r["終点駅"]].sort().join("\u0000") ===
            [from, to].sort().join("\u0000"),
      );
      expect(hit, "CSV に該当行が無い").toBeDefined();
      expect(Number(hit!["営業キロ"])).toBe(csvKm);
    },
  );

  it("差し替え後の値がCSVの値と同じものは入れない（無意味なので）", () => {
    for (const c of corrections) expect(c.officialKm).not.toBe(c.csvKm);
  });
});
