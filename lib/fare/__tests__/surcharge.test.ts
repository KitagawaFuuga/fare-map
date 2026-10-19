import { describe, expect, it } from "vitest";
import {
  surchargeAmount,
  surchargePairAmount,
  type Surcharge,
} from "@/lib/fare/surcharge";

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

// 名鉄の加算運賃は距離の関数になっていない（知多新線は富貴→野間 7.0km が60円、
// 上野間→内海 11.5km が50円で、長いほうが安い）。駅間表で引く。
const chita: Surcharge = {
  id: "chita",
  operator: "名古屋鉄道",
  lines: ["名鉄知多新線"],
  pairs: [
    { from: "富貴", to: "野間", amount: 60 },
    { from: "上野間", to: "内海", amount: 50 },
  ],
};

describe("surchargePairAmount", () => {
  it("乗り入れ駅と降りた駅の組で引く", () => {
    expect(surchargePairAmount(chita, "富貴", "野間")).toBe(60);
  });

  it("方向が逆でも同じ額", () => {
    expect(surchargePairAmount(chita, "野間", "富貴")).toBe(60);
  });

  it("距離が長いほうが安い組も表どおりに引ける", () => {
    expect(surchargePairAmount(chita, "上野間", "内海")).toBe(50);
  });

  it("表に無い組は加算しない", () => {
    expect(surchargePairAmount(chita, "富貴", "内海")).toBe(0);
  });

  it("その路線に乗っていなければ加算しない", () => {
    expect(surchargePairAmount(chita, undefined, undefined)).toBe(0);
    expect(surchargePairAmount(chita, "富貴", undefined)).toBe(0);
  });

  it("同じ駅で乗り降りしていれば加算しない", () => {
    expect(surchargePairAmount(chita, "富貴", "富貴")).toBe(0);
  });
});
