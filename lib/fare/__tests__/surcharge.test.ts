import { describe, expect, it } from "vitest";
import { surchargeAmount, type Surcharge } from "@/lib/fare/surcharge";

// 近鉄鳥羽線の実表
const toba: Surcharge = {
  id: "toba",
  operator: "近畿日本鉄道",
  lines: ["近鉄鳥羽線"],
  table: [
    [6, 10],
    [12, 20],
    [14, 30],
  ],
  beyond: 30,
};

describe("surchargeAmount", () => {
  it("帯の中の距離に対応する額を返す", () => {
    expect(surchargeAmount(toba, 5)).toBe(10);
    expect(surchargeAmount(toba, 8)).toBe(20);
    expect(surchargeAmount(toba, 13.2)).toBe(30);
  });

  it("帯の上限ちょうどは その帯の額", () => {
    expect(surchargeAmount(toba, 6)).toBe(10);
    expect(surchargeAmount(toba, 12)).toBe(20);
  });

  it("表を超える距離は beyond", () => {
    expect(surchargeAmount(toba, 20)).toBe(30);
  });

  // 加算対象の線に1mも乗っていなければ加算は起きない。
  // ここを 0 にしないと、対象外の区間にまで加算が乗る
  it("距離が0なら加算しない", () => {
    expect(surchargeAmount(toba, 0)).toBe(0);
  });

  it("負の距離も加算しない", () => {
    expect(surchargeAmount(toba, -1)).toBe(0);
  });

  it("端数は切り上げずそのまま帯に当てる（0.1kmは最初の帯）", () => {
    expect(surchargeAmount(toba, 0.1)).toBe(10);
  });
});
