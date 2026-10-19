import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import type { FareOverride, FareRule, FareZone } from "@/lib/fare/types";

// 事業者「甲鉄道」の運賃表と、その一部の区間（A・B・C駅）だけに使う安い表
const main: FareRule = {
  id: "main",
  operators: ["甲鉄道"],
  table: [
    [10, 200],
    [20, 400],
    [30, 600],
  ],
  beyond: { fromKm: 30, baseFare: 600, ratePerKm: 20 },
};
const fallback: FareRule = {
  id: "fallback",
  operators: [],
  table: [[100, 999]],
  beyond: { fromKm: 100, baseFare: 999, ratePerKm: 0 },
};
const zone: FareZone = {
  id: "zone",
  operator: "甲鉄道",
  stations: ["A", "B", "C"],
  table: [
    [10, 150],
    [20, 300],
    [30, 450],
  ],
  beyond: { fromKm: 30, baseFare: 450, ratePerKm: 15 },
  source: { url: "", fetchedAt: "", note: "" },
};
const special: FareOverride = {
  operator: "甲鉄道",
  pairs: [{ from: "A", to: "C", fare: 100 }],
  source: { url: "", fetchedAt: "", note: "" },
};

describe("区間運賃（fare-zones）", () => {
  const calc = createFareCalculator([main, fallback], [special], [zone]);

  it("発着の両駅が区間内なら区間の表を引く", () => {
    expect(calc.estimate("甲鉄道", 15, "A", "B")).toBe(300);
  });

  it("片方が区間外なら事業者の表を引く（区間内で完結しない）", () => {
    expect(calc.estimate("甲鉄道", 15, "A", "D")).toBe(400);
    expect(calc.estimate("甲鉄道", 15, "D", "B")).toBe(400);
  });

  it("駅名が無ければ事業者の表を引く", () => {
    expect(calc.estimate("甲鉄道", 15)).toBe(400);
  });

  it("特定運賃がある組は区間の表より特定運賃が優先", () => {
    expect(calc.estimate("甲鉄道", 15, "A", "C")).toBe(100);
  });

  it("区間の無い事業者には影響しない", () => {
    expect(calc.estimate("乙鉄道", 15, "A", "B")).toBe(999);
  });

  it("区間の表を超える距離は区間の賃率で外挿する", () => {
    expect(calc.estimate("甲鉄道", 40, "A", "B")).toBe(600);
  });

  // 探索は confirmedFare + lowerBound で枝を刈る。発駅が区間内なら着駅しだいで
  // 区間の安い表になりうるので、下界もそちらで取らないと予算内の駅を刈ってしまう
  it("発駅が区間内なら、下界は区間の表で取る", () => {
    expect(calc.lowerBound("甲鉄道", 15, "B")).toBe(300);
  });

  it("発駅が区間外なら、下界は事業者の表で取る", () => {
    expect(calc.lowerBound("甲鉄道", 15, "D")).toBe(400);
  });

  it("区間の駅を含む特定運賃があれば、下界はそこまで締まる", () => {
    // A 発の特定運賃（A→C 100円）が区間の表より安い
    expect(calc.lowerBound("甲鉄道", 15, "A")).toBe(100);
  });
});
