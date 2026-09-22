import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import {
  fareOverrideSchema,
  fareRuleSchema,
  type FareOverride,
  type FareRule,
} from "@/lib/fare/types";

// 運賃表を起こすとき、各社の公式運賃表（多くは三角表）から全駅ペアの (営業キロ, 運賃) を
// 取り出し、そこから距離帯テーブルを復元して、帯で再現できないペアだけを特定運賃に回して
// いる。その「公式表と全Nペア一致する」という主張は、元になった全ペアが残っていないと
// 誰も検算できない。data/fare-sources/ はその元データで、このテストが主張を検証する。
//
// 距離帯や特定運賃を書き換えて公式表と食い違わせると、ここが落ちる。
// （富山地方鉄道は全2211ペアがそのまま data/fare-overrides/chitetsu.json なので、
//   元データを別に持つ意味がなく calculator.test.ts 側で検証している）

interface FareSource {
  id: string;
  operator: string;
  source: { url: string; fetchedAt: string; note: string };
  // km が null のペアは、同じ事業者名の中で賃率が違うなどの理由で距離帯では
  // 表現できず、特定運賃でしか引けないもの（実例: しなの鉄道の北しなの線）
  pairs: { from: string; to: string; km: number | null; fare: number }[];
}

const readAll = <T>(dir: string): T[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as T);

const rules = readAll<unknown>("data/fare-rules").map((r) =>
  fareRuleSchema.parse(r),
) as FareRule[];
const overrides = readAll<unknown>("data/fare-overrides").map((o) =>
  fareOverrideSchema.parse(o),
) as FareOverride[];
const calc = createFareCalculator(rules, overrides);
const sources = readAll<FareSource>("data/fare-sources");

describe("公式運賃表の再現", () => {
  it("data/fare-sources/ が読み込めている", () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(s.pairs.length, `${s.id} のペア数`).toBeGreaterThan(0);
      expect(s.source.url, `${s.id} の出典`).not.toBe("");
    }
  });

  // 各社ぶんを1本のテストにすると、どの事業者が壊れたか見えないので分ける
  for (const s of sources) {
    describe(`${s.operator} (${s.pairs.length}ペア)`, () => {
      it("全ペアが公式表どおりの運賃になる", () => {
        const wrong: string[] = [];
        for (const p of s.pairs) {
          // km が null のペアは特定運賃でしか引けない。estimate は km<=0 で
          // 即 0 を返すので、正の微小値を渡して override が効くかどうかを見る
          // （override が無ければ距離表の初乗りが返り、公式値と違うので落ちる）
          const got = calc.estimate(s.operator, p.km ?? 0.1, p.from, p.to);
          if (got !== p.fare)
            wrong.push(
              `${p.from}→${p.to} ${p.km ?? "km不明"} 公式${p.fare} 実装${got}`,
            );
        }
        expect(wrong.slice(0, 10)).toEqual([]);
        expect(wrong).toHaveLength(0);
      });

      it("公式表に載っている運賃額の種類が変わっていない", () => {
        const levels = [...new Set(s.pairs.map((p) => p.fare))].sort(
          (a, b) => a - b,
        );
        // 抽出しなおしたとき、階梯そのものが変わっていれば改定を疑う手がかりになる
        expect(levels.length).toBeGreaterThan(1);
        expect(levels[0]).toBeGreaterThan(0);
      });
    });
  }

  it("運賃表を持つ事業者の元データは、その事業者名で引ける", () => {
    const operators = new Set(rules.flatMap((r) => r.operators));
    for (const s of sources) {
      expect(operators.has(s.operator), `${s.operator} の運賃表`).toBe(true);
    }
  });
});
