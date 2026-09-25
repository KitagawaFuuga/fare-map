import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import { fareOverrideSchema, fareRuleSchema } from "@/lib/fare/types";
import { buildOperatorKmTable } from "@/lib/graph/operator-distance";
import type { RailGraph } from "@/lib/graph/types";

// 実額との層別スポット照合。事業者 × 距離帯 × 線区分（幹線 / 地方交通線）で選んだ
// 区間を、運賃と営業キロの両方で固定する。
//
// なぜ要るか: 実額の全ペアを持っているのは11事業者・429駅（全体の4.1%）だけで、
// JR＋大手私鉄の6,842駅（65.3%）は全ペアの正解が無い。そこはスポット照合しか
// 手段がなく、実際にこの方法で次の2つを見つけた。
//   - 豊肥本線（阿蘇高原線）の表が0.2kmの矛盾で棄却され、熊本〜大分が公式148.0kmに
//     対し143.8km、実額3,740円が3,300円になっていた（判定規則を直した）
//   - 難波線の区間キロが全国鉄道運行本数データで2.8km（正しくは2.0km）になっており、
//     大阪難波〜近鉄名古屋が189.7kmではなく190.5kmで2,860円が3,000円になっていた
//
// 距離は必ず graph.json から引く。直値で書くとグラフ側が狂っても気づけない。
const rules = readdirSync("data/fare-rules")
  .filter((f) => f.endsWith(".json"))
  .map((f) =>
    fareRuleSchema.parse(
      JSON.parse(readFileSync(`data/fare-rules/${f}`, "utf8")),
    ),
  );
const overrides = readdirSync("data/fare-overrides")
  .filter((f) => f.endsWith(".json"))
  .map((f) =>
    fareOverrideSchema.parse(
      JSON.parse(readFileSync(`data/fare-overrides/${f}`, "utf8")),
    ),
  );
const calc = createFareCalculator(rules, overrides);
const graph = JSON.parse(readFileSync("data/graph.json", "utf8")) as RailGraph;

const cache = new Map<string, (a: string, b: string) => number | null>();
const kmOf = (operator: string, useFareKm: boolean) => {
  const key = `${operator}:${useFareKm}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const table = buildOperatorKmTable(graph, operator, { useFareKm });
  cache.set(key, table);
  return table;
};

interface Case {
  operator: string;
  from: string;
  to: string;
  /** 公表営業キロ。許容は0.6km（推定値が残る区間を含むため） */
  officialKm: number;
  fare: number;
  note: string;
}

// 出典はすべて ekitan.com（2026-09-26取得、乗車券のみ・特急料金を含まない）。
// 営業キロも同ページの表示。
const CASES: Case[] = [
  {
    operator: "JR東日本",
    from: "郡山",
    to: "会津若松",
    officialKm: 64.6,
    fare: 1230,
    note: "磐越西線＝地方交通線。擬制キロが効く",
  },
  {
    operator: "JR東海",
    from: "岐阜",
    to: "高山",
    officialKm: 136.4,
    fare: 2640,
    note: "高山本線＝地方交通線の100km超",
  },
  {
    operator: "JR北海道",
    from: "札幌",
    to: "網走",
    officialKm: 374.5,
    fare: 7700,
    note: "石北本線＝地方交通線の長距離。公式61帯の表が効く",
  },
  {
    operator: "JR四国",
    from: "高松",
    to: "高知",
    officialKm: 159.3,
    fare: 3190,
    note: "土讃線の100km超。基準額＋加算額で作った表が効く",
  },
  {
    operator: "JR九州",
    from: "大分",
    to: "熊本",
    officialKm: 148.0,
    fare: 3740,
    note: "豊肥本線＝地方交通線。判定規則を直して143.8km→148.0kmになった区間",
  },
  {
    operator: "名古屋鉄道",
    from: "名鉄名古屋",
    to: "豊橋",
    officialKm: 68.0,
    fare: 1270,
    note: "名古屋本線は擬制率1.00。擬制キロを掛けすぎていないことの確認",
  },
];

describe.each(CASES)("$from→$to（$operator）", (c) => {
  it(`営業キロが公表の ${c.officialKm}km と合う`, () => {
    const km = kmOf(c.operator, false)(c.from, c.to);
    expect(km).not.toBeNull();
    expect(
      Math.abs(km! - c.officialKm),
      `実測 ${km?.toFixed(1)}km`,
    ).toBeLessThan(0.6);
  });

  it(`運賃が実額の ${c.fare}円 になる（${c.note}）`, () => {
    const km = kmOf(c.operator, true)(c.from, c.to);
    expect(km).not.toBeNull();
    expect(calc.estimate(c.operator, km!, c.from, c.to)).toBe(c.fare);
  });
});

// 実額と違って見えるが誤りではない例。残しておかないと「直すべきずれ」と
// 取り違える。
describe("岡山→出雲市（JR西日本）", () => {
  it("吉備線経由の安い経路を採るので、伯備線経由の実額より安くなる", () => {
    // ekitan は伯備線経由（220.7km・きっぷ4,070円）を出す。当方は
    // 岡山〜総社を吉備線20.4kmで抜ける経路を採り、214.1km・3,740円になる。
    // 吉備線は地方交通線なので擬制キロがかかった上でこの額。予算内で行ける駅を
    // 探すアプリなので、安いほうを採るのは意図どおり。
    const km = kmOf("JR西日本", true)("岡山", "出雲市");
    expect(km).not.toBeNull();
    expect(km!).toBeLessThan(220.7);
    expect(calc.estimate("JR西日本", km!)).toBe(3740);
  });

  it("伯備線経由の距離なら実額どおり4,070円になる（表は正しい）", () => {
    expect(calc.estimate("JR西日本", 220.7)).toBe(4070);
  });
});
