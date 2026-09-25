import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import { fareRuleSchema } from "@/lib/fare/types";

// JR東日本の11km以上の運賃は、2026年3月の通算加算方式の導入により
// 「基準額表 + 加算額表」で定義される。data/fare-rules/jr-east.json はその和を
// 焼いた派生データなので、元の2表を直したら作り直さないと黙ってずれる。
// ここでその等式を全帯で検証する。
const rule = (id: string) =>
  fareRuleSchema.parse(
    JSON.parse(readFileSync(`data/fare-rules/${id}.json`, "utf8")),
  );
const east = rule("jr-east");
const base = rule("jr-central");
const kasan = rule("jr-honshu-kasan");

const calc = createFareCalculator([east, base, kasan, rule("generic-private")]);
const fareOf = (r: ReturnType<typeof rule>, km: number): number => {
  const row = r.table.find(([maxKm]) => km <= maxKm);
  if (row !== undefined) return row[1];
  const { fromKm, baseFare, ratePerKm } = r.beyond;
  return Math.ceil((baseFare + (km - fromKm) * ratePerKm) / 10) * 10;
};

describe("JR東日本の運賃表", () => {
  it("全帯で 基準額 + 加算額 と一致する", () => {
    expect(east.table.length).toBeGreaterThan(100);
    for (const [maxKm, fare] of east.table) {
      expect(fare, `${maxKm}km`).toBe(
        fareOf(base, maxKm) + fareOf(kasan, maxKm),
      );
    }
  });

  it("帯の境界は基準額表・加算額表の境界に含まれる", () => {
    const bounds = new Set([
      ...base.table.map(([m]) => m),
      ...kasan.table.map(([m]) => m),
    ]);
    for (const [maxKm] of east.table)
      expect(bounds.has(maxKm), `${maxKm}km`).toBe(true);
  });

  // 出典: ekitan.com (2026-09-25取得)。乗車券のみの額。
  // 100km超を16.96円/kmの線形で近似していたときは 6,060円・11,970円で、
  // 351.8kmでは実額より210円安く出ていた（到達できない駅を到達できると言う側の誤り）
  it("東京→仙台 351.8km は 6,270円", () => {
    expect(calc.estimate("JR東日本", 351.8)).toBe(6270);
  });

  it("東京→新青森 713.7km は 10,780円", () => {
    expect(calc.estimate("JR東日本", 713.7)).toBe(10780);
  });

  // 出典: 運賃改定認可プレス(2025-08-01) p3 の「10kmまでの普通旅客運賃」
  it("10kmまでは認可プレスの運賃表どおり（きっぷ）", () => {
    expect(calc.estimate("JR東日本", 3)).toBe(160);
    expect(calc.estimate("JR東日本", 6)).toBe(200);
    expect(calc.estimate("JR東日本", 10)).toBe(210);
  });

  it("距離が増えて運賃が下がることはない", () => {
    for (let i = 1; i < east.table.length; i++) {
      expect(east.table[i]![1]).toBeGreaterThanOrEqual(east.table[i - 1]![1]);
    }
  });
});
