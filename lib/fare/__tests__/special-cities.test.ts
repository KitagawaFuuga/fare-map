import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import {
  buildSpecialCities,
  type SpecialCity,
} from "@/lib/fare/special-cities";
import type { FareOverride, FareRule } from "@/lib/fare/types";
import type { RailGraph } from "@/lib/graph/types";

// 運賃 = 切り上げたキロ × 10円（距離の読み替えが運賃にそのまま見える）
const perKm = (id: string, operators: string[]): FareRule => ({
  id,
  operators,
  table: [[1, 10]],
  beyond: { fromKm: 1, baseFare: 10, ratePerKm: 10 },
});
const fallback = perKm("fallback", []);

// 区域X（中心C、区域の駅 C・A・B）と区域Y（中心K、区域の駅 K・E）。
// 中心からの距離: A 5km、B 8km、遠い駅 Far1 250km・Far2 150km、Yの中心K 300km
const cityX: SpecialCity = {
  id: "x",
  center: "C",
  operator: "甲JR",
  minKm: 200,
  stations: ["C", "A", "B"],
  centerKm: new Map([
    ["C", 0],
    ["A", 5],
    ["B", 8],
    ["Far1", 250],
    ["Far2", 150],
    ["Far3", 202],
    ["K", 300],
    ["E", 304],
  ]),
};
const cityY: SpecialCity = {
  id: "y",
  center: "K",
  operator: "甲JR",
  minKm: 200,
  stations: ["K", "E"],
  centerKm: new Map([
    ["K", 0],
    ["E", 4],
    ["C", 300],
    ["A", 305],
    ["Far1", 50],
  ]),
};

describe("特定都区市内（旅客営業規則 第86条）", () => {
  const calc = createFareCalculator(
    [perKm("kou", ["甲JR"]), perKm("otsu", ["乙鉄道"]), fallback],
    [],
    [],
    [cityX, cityY],
  );

  it("区域内の発駅から中心駅経由で200km超なら、中心駅からの距離で引く", () => {
    // A→C 5km ＋ C→Far1 250km = 255km。中心駅から 250km
    expect(calc.estimate("甲JR", 255, "A", "Far1")).toBe(2500);
  });

  it("中心駅から200km以下なら読み替えない", () => {
    expect(calc.estimate("甲JR", 155, "A", "Far2")).toBe(1550);
  });

  it("発駅が中心駅より遠い駅寄りでも中心駅からの距離になる（運賃は上がる）", () => {
    // A が C と Far1 の間にある経路（実際の距離 245km）
    expect(calc.estimate("甲JR", 245, "A", "Far1")).toBe(2500);
  });

  it("実際の距離が200km以下でも、中心駅から200km超なら読み替える", () => {
    // A が C と Far3 の間にあり、A から 197km・中心駅から 202km
    expect(calc.estimate("甲JR", 197, "A", "Far3")).toBe(2020);
  });

  it("着駅が区域内でも、中心駅までの距離で引く", () => {
    expect(calc.estimate("甲JR", 258, "Far1", "B")).toBe(2500);
  });

  it("発着とも別の区域内なら、中心駅どうしの距離で引く", () => {
    expect(calc.estimate("甲JR", 309, "A", "E")).toBe(3000);
  });

  it("発着とも同じ区域内なら、遠回りで200km超乗っても読み替えない", () => {
    expect(calc.estimate("甲JR", 250, "A", "B")).toBe(2500);
  });

  it("区域の事業者以外には適用しない", () => {
    expect(calc.estimate("乙鉄道", 255, "A", "Far1")).toBe(2550);
  });

  it("特定運賃（override）は規則より優先する", () => {
    const override: FareOverride = {
      operator: "甲JR",
      pairs: [{ from: "A", to: "Far1", fare: 1000 }],
      source: { url: "", fetchedAt: "", note: "" },
    };
    const withOverride = createFareCalculator(
      [perKm("kou", ["甲JR"]), fallback],
      [override],
      [],
      [cityX],
    );
    expect(withOverride.estimate("甲JR", 255, "A", "Far1")).toBe(1000);
  });

  it("下界は区域内の発駅からの運賃を上回らない", () => {
    expect(calc.lowerBound("甲JR", 255, "A")).toBeLessThanOrEqual(2500);
    expect(calc.lowerBound("甲JR", 309, "A")).toBeLessThanOrEqual(3000);
  });

  it("下界は区域内の着駅への運賃も上回らない（発駅が区域外でも）", () => {
    expect(calc.lowerBound("甲JR", 258, "Far1")).toBeLessThanOrEqual(2500);
  });

  it("規則が届かない短い距離では下界を緩めない", () => {
    expect(calc.lowerBound("甲JR", 50, "A")).toBe(500);
  });

  it("区域の駅なら区域の id を返す", () => {
    expect(calc.specialCityKeyOf("甲JR", "A", false, Infinity)).toBe("x");
    expect(calc.specialCityKeyOf("甲JR", "Far1", false, Infinity)).toBe(
      undefined,
    );
  });

  it("残りの予算が規則の最低運賃（200kmの運賃）未満なら区域として扱わない", () => {
    expect(calc.specialCityKeyOf("甲JR", "A", false, 1990)).toBe(undefined);
    expect(calc.specialCityKeyOf("甲JR", "A", false, 2000)).toBe("x");
  });

  it("発着とも区域内でも、中心駅どうしが200km以下なら読み替えない", () => {
    // Y の中心が X の中心から 150km の場合
    const near: SpecialCity = {
      ...cityY,
      centerKm: new Map([...cityY.centerKm, ["C", 150], ["A", 155]]),
    };
    const farX: SpecialCity = {
      ...cityX,
      centerKm: new Map([...cityX.centerKm, ["K", 150], ["E", 154]]),
    };
    const nearCalc = createFareCalculator(
      [perKm("kou", ["甲JR"]), fallback],
      [],
      [],
      [farX, near],
    );
    // 遠回りで 230km 乗っても、中心駅どうし 150km の読み替えはしない
    expect(nearCalc.estimate("甲JR", 230, "A", "E")).toBe(2300);
  });
});

describe("東京山手線内（旅客営業規則 第87条）", () => {
  const yamanote: SpecialCity = {
    ...cityX,
    id: "yamanote",
    minKm: 100,
    maxKm: 200,
  };
  const calc = createFareCalculator(
    [perKm("kou", ["甲JR"]), fallback],
    [],
    [],
    [yamanote],
  );

  it("中心駅から100km超200km以下なら中心駅からの距離で引く", () => {
    expect(calc.estimate("甲JR", 155, "A", "Far2")).toBe(1500);
  });

  it("200kmを超えると第87条は適用しない", () => {
    expect(calc.estimate("甲JR", 255, "A", "Far1")).toBe(2550);
  });
});

describe("特定都区市内とJR本州3社の通し運賃", () => {
  const base: FareRule = perKm("tokai", ["JR東海"]);
  const kasan: FareRule = {
    id: "kasan",
    operators: ["__jr-honshu-kasan"],
    table: [
      [0.001, 0],
      [100, 100],
    ],
    beyond: { fromKm: 100, baseFare: 100, ratePerKm: 0 },
  };
  const eastCity: SpecialCity = { ...cityX, operator: "JR東日本" };
  const calc = createFareCalculator(
    [base, kasan, fallback],
    [],
    [],
    [eastCity],
  );

  it("基準額は通しの発駅（区域内）の中心駅からの距離で引く", () => {
    expect(calc.estimateHonshuThrough(255, 0, "A", "Far1")).toBe(2500);
    expect(calc.estimateHonshuThrough(255, 50, "A", "Far1")).toBe(2600);
  });

  it("発着の駅を渡さなければ読み替えない", () => {
    expect(calc.estimateHonshuThrough(255, 0)).toBe(2550);
  });

  it("通し運賃の下界も読み替え後の運賃を上回らない", () => {
    expect(calc.honshuThroughBaseFare(255, "A")).toBeLessThanOrEqual(2500);
    expect(calc.honshuThroughBaseFare(258, "Far1")).toBeLessThanOrEqual(2500);
  });
});

describe("buildSpecialCities", () => {
  const node = (id: string, name: string, operator: string) => ({
    id,
    groupId: id,
    name,
    lat: 0,
    lng: 0,
    lineId: "l",
    lineName: "l",
    operator,
  });
  // C —(10, 運賃計算キロ11)— P —(20)— Q（P〜Q は JR東海）、C —(3)— 私鉄の R。
  // 同名で別の駅 W が JR東日本（C の隣）と JR東海（Q の隣）にある（乗換の辺は無い）
  const graph: RailGraph = {
    nodes: {
      c: node("c", "C", "JR東日本"),
      p: node("p", "P", "JR東日本"),
      p2: node("p2", "P", "JR東海"),
      q: node("q", "Q", "JR東海"),
      r: node("r", "R", "私鉄"),
      w1: node("w1", "W", "JR東日本"),
      w2: node("w2", "W", "JR東海"),
    },
    edges: [
      {
        from: "c",
        to: "p",
        km: 10,
        fareKm: 11,
        kind: "rail",
        operator: "JR東日本",
      },
      { from: "p", to: "p2", km: 0, kind: "transfer", operator: "" },
      { from: "p2", to: "q", km: 20, kind: "rail", operator: "JR東海" },
      { from: "c", to: "r", km: 3, kind: "rail", operator: "私鉄" },
      { from: "c", to: "w1", km: 1, kind: "rail", operator: "JR東日本" },
      { from: "q", to: "w2", km: 1, kind: "rail", operator: "JR東海" },
    ],
  };
  const [city] = buildSpecialCities(graph, {
    cities: [
      {
        id: "x",
        name: "X市内",
        center: "C",
        operator: "JR東日本",
        minKm: 200,
        stations: ["C"],
      },
    ],
  });

  it("中心駅からの距離は運賃計算キロで測る", () => {
    expect(city?.centerKm.get("P")).toBe(11);
  });

  it("1社の運賃用の距離は、その会社の線路だけで測る", () => {
    expect(city?.centerKm.has("Q")).toBe(false);
  });

  it("本州3社の区域は、通し運賃用に会社をまたいで測る（同じ駅の乗り換えは0km）", () => {
    expect(city?.throughCenterKm?.get("Q")).toBe(31);
  });

  it("同名で別の駅を同じ駅としてつながない", () => {
    // W を同じ駅とみなすと C→W→Q が 2km になる
    expect(city?.throughCenterKm?.get("Q")).toBe(31);
  });

  it("同名で別の駅は、どちらか決められないので距離を持たない", () => {
    expect(city?.throughCenterKm?.has("W")).toBe(false);
    // JR東日本の中では W は1駅だけ
    expect(city?.centerKm.get("W")).toBe(1);
  });

  it("JR以外の線路は通らない", () => {
    expect(city?.centerKm.has("R")).toBe(false);
  });

  it("区域の駅がグラフに無ければ例外", () => {
    expect(() =>
      buildSpecialCities(graph, {
        cities: [
          {
            id: "x",
            name: "X市内",
            center: "C",
            operator: "JR東日本",
            minKm: 200,
            stations: ["C", "Z"],
          },
        ],
      }),
    ).toThrow(/Z/);
  });
});
