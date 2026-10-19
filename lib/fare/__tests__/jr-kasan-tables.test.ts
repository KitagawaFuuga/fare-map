import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import { fareRuleSchema, type FareRule } from "@/lib/fare/types";

// JR東日本・JR九州・JR四国の運賃は、いずれも「基準額表 + 自社の加算額表」で決まる
// （本州3社の基準額に各社のキロ数に応じた加算額を足す通算加算方式）。
// data/fare-rules の各社の表はその和を焼いた派生データなので、元の2表を直したら
// 作り直さないと黙ってずれる。ここでその等式を全帯で検証する。
const rule = (id: string): FareRule =>
  fareRuleSchema.parse(
    JSON.parse(readFileSync(`data/fare-rules/${id}.json`, "utf8")),
  );

const fareOf = (r: FareRule, km: number): number => {
  const row = r.table.find(([maxKm]) => km <= maxKm);
  if (row !== undefined) return row[1];
  const { fromKm, baseFare, ratePerKm } = r.beyond;
  return Math.ceil((baseFare + (km - fromKm) * ratePerKm) / 10) * 10;
};

const base = rule("jr-central");
const targets = [
  { name: "JR東日本", id: "jr-east", kasan: "jr-honshu-kasan" },
  { name: "JR九州", id: "jr-kyushu", kasan: "jr-kyushu-kasan" },
  { name: "JR四国", id: "jr-shikoku", kasan: "jr-shikoku-kasan" },
];

describe.each(targets)("$name の運賃表", ({ id, kasan }) => {
  const own = rule(id);
  const add = rule(kasan);

  it("全帯で 基準額 + 加算額 と一致する", () => {
    expect(own.table.length).toBeGreaterThan(100);
    for (const [maxKm, fare] of own.table) {
      expect(fare, `${maxKm}km`).toBe(fareOf(base, maxKm) + fareOf(add, maxKm));
    }
  });

  it("帯の境界は基準額表・加算額表の境界に含まれる", () => {
    const bounds = new Set([
      ...base.table.map(([m]) => m),
      ...add.table.map(([m]) => m),
    ]);
    for (const [maxKm] of own.table)
      expect(bounds.has(maxKm), `${maxKm}km`).toBe(true);
  });

  it("距離が増えて運賃が下がることはない", () => {
    for (let i = 1; i < own.table.length; i++) {
      expect(own.table[i]![1]).toBeGreaterThanOrEqual(own.table[i - 1]![1]);
    }
  });
});

// JR北海道の表は他社とは別で、公式PDFの普通旅客運賃表（幹線61帯）をそのまま入れた
// ものなので上の等式では守れない。PDFからの抜き出しは行がずれても値がそれらしく出る
// （data/fare-rules/chitetsu.json の note にある実例）ため、構造で検証する。
describe("JR北海道の運賃表（公式PDFの抜き出し）", () => {
  const hok = rule("jr-hokkaido");

  it("帯が途切れていない（前の帯の上限+1 が次の帯の下限になる）", () => {
    // maxKm だけを持つ表なので、帯の下限は前の帯の maxKm+1。
    // 抜き出しで行が飛ぶと帯が欠け、境界のキロ数が不連続になる
    expect(hok.table.length).toBe(61);
    expect(hok.table[0]![0]).toBe(3);
    expect(hok.table.at(-1)![0]).toBe(1400);
  });

  it("距離が増えて運賃が下がることはない", () => {
    for (let i = 1; i < hok.table.length; i++) {
      expect(hok.table[i]![1]).toBeGreaterThanOrEqual(hok.table[i - 1]![1]);
    }
  });

  it("運賃の増え方は距離が伸びるほど緩くなる（賃率が下がる）", () => {
    // 行がずれると単位キロあたりの増え方が途中で跳ねる
    const rate = (i: number) =>
      (hok.table[i]![1] - hok.table[i - 1]![1]) /
      (hok.table[i]![0] - hok.table[i - 1]![0]);
    expect(rate(20)).toBeLessThan(rate(10));
    expect(rate(40)).toBeLessThan(rate(20));
    expect(rate(60)).toBeLessThan(rate(40));
  });
});

describe("100km超の実額", () => {
  const calc = createFareCalculator([
    ...targets.map((t) => rule(t.id)),
    ...targets.map((t) => rule(t.kasan)),
    base,
    rule("jr-hokkaido"),
    rule("generic-private"),
  ]);

  // 出典: ekitan.com (2026-09-25取得、乗車券のみ)
  it("東京→仙台 351.8km は 6,270円", () => {
    expect(calc.estimate("JR東日本", 351.8)).toBe(6270);
  });

  it("東京→新青森 713.7km は 10,780円", () => {
    expect(calc.estimate("JR東日本", 713.7)).toBe(10780);
  });

  it("博多→鹿児島中央 288.9km は 6,270円", () => {
    expect(calc.estimate("JR九州", 288.9)).toBe(6270);
  });

  it("札幌→釧路 348.5km は 7,150円", () => {
    expect(calc.estimate("JR北海道", 348.5)).toBe(7150);
  });

  // 出典: JR四国 運賃改定申請PDF (2022-08-26) p14
  it("松山→高松 194.4km は 3,960円", () => {
    expect(calc.estimate("JR四国", 194.4)).toBe(3960);
  });

  it("札幌→函館 318.7km は 6,600円", () => {
    expect(calc.estimate("JR北海道", 318.7)).toBe(6600);
  });
});
