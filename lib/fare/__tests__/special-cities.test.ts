import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import {
  buildSpecialCities,
  specialCitiesFileSchema,
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

  // 下界が緩すぎると探索で枝を刈れず遅くなる。読み替えで下がりうる分だけ下げる
  describe("下界は読み替えで下がりうる分だけ下げる", () => {
    // 下界の項は発駅ごとにキャッシュされる。共有の calc だと前のテストの値が残り、
    // ミューテーションテストで変化を見逃すので、テストごとに作る
    const fresh = () =>
      createFareCalculator(
        [perKm("kou", ["甲JR"]), fallback],
        [],
        [],
        [cityX, cityY],
      );

    it("区域内の発駅からは、中心駅からの距離まで下げる", () => {
      // A の項: 自区域 max(km−5, 200)、区域Yへ max(km−5−4, 300)
      const c = fresh();
      expect(c.lowerBound("甲JR", 255, "A")).toBe(2500);
      expect(c.lowerBound("甲JR", 309, "A")).toBe(3000);
    });

    it("区域外の発駅からは、着駅側の区域の半径か中心駅までの距離まで下げる", () => {
      // Far1 の項: 区域X max(km−8, 250)、区域Y max(km−4, 200)
      const c = fresh();
      expect(c.lowerBound("甲JR", 258, "Far1")).toBe(2500);
      expect(c.lowerBound("甲JR", 253, "Far1")).toBe(2490);
    });

    it("中心駅までの距離が分からない区域は、下界の計算に使わない", () => {
      // Far3 は区域Yの距離を持たない。区域Xだけで max(210−8, 202)
      expect(fresh().lowerBound("甲JR", 210, "Far3")).toBe(2020);
    });

    it("中心駅どうしの距離が分からない区域の組は、下界の計算に使わない", () => {
      const noK: SpecialCity = {
        ...cityX,
        centerKm: new Map([...cityX.centerKm].filter(([name]) => name !== "K")),
      };
      const c = createFareCalculator(
        [perKm("kou", ["甲JR"]), fallback],
        [],
        [],
        [noK, cityY],
      );
      expect(c.lowerBound("甲JR", 255, "A")).toBe(2500);
    });

    it("発駅が分からなければ、発着とも最大の半径だけ下げる", () => {
      // 半径は区域Xの 8km。max(255−16, 200)
      expect(fresh().lowerBound("甲JR", 255)).toBe(2390);
    });

    it("同じ条件の区域が2つあっても、片方は下界の計算に残す", () => {
      const twin = (id: string, center: string, near: string): SpecialCity => ({
        id,
        center,
        operator: "甲JR",
        minKm: 200,
        stations: [center, near],
        centerKm: new Map([
          [center, 0],
          [near, 4],
          ["S", 250],
        ]),
      });
      const c = createFareCalculator(
        [perKm("kou", ["甲JR"]), fallback],
        [],
        [],
        [twin("d1", "C1", "N1"), twin("d2", "C2", "N2")],
      );
      // どちらの区域でも max(260−4, 250)
      expect(c.lowerBound("甲JR", 260, "S")).toBe(2560);
    });
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

  it("2つの区域に入る駅は、予算で使える区域だけの id を返す", () => {
    const city = (id: string, center: string, minKm: number): SpecialCity => ({
      id,
      center,
      operator: "甲JR",
      minKm,
      stations: [center, "S"],
      centerKm: new Map([
        [center, 0],
        ["S", 3],
      ]),
    });
    const c = createFareCalculator(
      [perKm("kou", ["甲JR"]), fallback],
      [],
      [],
      [city("p", "P", 100), city("q", "Q", 300)],
    );
    // 規則の最低運賃は p が 1000円、q が 3000円
    expect(c.specialCityKeyOf("甲JR", "S", false, Infinity)).toBe("p+q");
    expect(c.specialCityKeyOf("甲JR", "S", false, 1500)).toBe("p");
    expect(c.specialCityKeyOf("甲JR", "S", false, 999)).toBe(undefined);
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

  it("着駅が区域内でも、中心駅から200km以下なら読み替えない", () => {
    // Far2→A 196km（区域を調べずに返す近道 192km を超える長さ）。
    // 読み替えは max(196−5, Far2 の 150km) = 191km で200km以下
    expect(calc.estimate("甲JR", 196, "Far2", "A")).toBe(1960);
  });

  it("発着とも区域内で、中心駅どうしがちょうど200kmなら読み替えない", () => {
    const at200X: SpecialCity = {
      ...cityX,
      centerKm: new Map([...cityX.centerKm, ["K", 200], ["E", 204]]),
    };
    const at200Y: SpecialCity = {
      ...cityY,
      centerKm: new Map([...cityY.centerKm, ["C", 200], ["A", 205]]),
    };
    const c = createFareCalculator(
      [perKm("kou", ["甲JR"]), fallback],
      [],
      [],
      [at200X, at200Y],
    );
    expect(c.estimate("甲JR", 230, "A", "E")).toBe(2300);
  });

  it("発着の区域で規則の距離が違えば、中心駅どうしは長いほうを超えなければ読み替えない", () => {
    // 発駅側は100km超で効く区域、着駅側は200km超。中心駅どうし150km
    const shortX: SpecialCity = {
      ...cityX,
      minKm: 100,
      centerKm: new Map([...cityX.centerKm, ["K", 150], ["E", 154]]),
    };
    const nearY: SpecialCity = {
      ...cityY,
      centerKm: new Map([...cityY.centerKm, ["C", 150], ["A", 155]]),
    };
    const c = createFareCalculator(
      [perKm("kou", ["甲JR"]), fallback],
      [],
      [],
      [shortX, nearY],
    );
    expect(c.estimate("甲JR", 230, "A", "E")).toBe(2300);
  });

  it("中心駅どうしの距離が分からなければ、発着とも区域内でも読み替えない", () => {
    const noK: SpecialCity = {
      ...cityX,
      centerKm: new Map([...cityX.centerKm].filter(([s]) => s !== "K")),
    };
    const c = createFareCalculator(
      [perKm("kou", ["甲JR"]), fallback],
      [],
      [],
      [noK, cityY],
    );
    expect(c.estimate("甲JR", 309, "A", "E")).toBe(3090);
  });

  it("発着とも区域内で、区域の外の距離が中心駅どうしより長ければ、そちらで引く", () => {
    // 320km − A の 5km − E の 4km = 311km（中心駅どうしは 300km）
    expect(calc.estimate("甲JR", 320, "A", "E")).toBe(3110);
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

  it("中心駅からちょうど200kmなら第87条を適用する（200km以下）", () => {
    // A→Far2 205km。中心駅から Far2 は 150km なので、読み替えは max(205−5, 150) = 200km
    expect(calc.estimate("甲JR", 205, "A", "Far2")).toBe(2000);
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

  it("通し運賃の下界は読み替えで下がりうる分だけ下げる", () => {
    // 下界の項のキャッシュが前のテストから残らないよう作り直す
    const c = createFareCalculator([base, kasan, fallback], [], [], [eastCity]);
    expect(c.honshuThroughBaseFare(255, "A")).toBe(2500);
    expect(c.honshuThroughBaseFare(258, "Far1")).toBe(2500);
    // 発駅が分からなければ max(255−16, 200)
    expect(c.honshuThroughBaseFare(255)).toBe(2390);
  });

  // 加算額: 100kmまで100円、200kmまで200円（区域内の5kmが効くと帯が変わる）
  const kasanSteps: FareRule = {
    id: "kasan",
    operators: ["__jr-honshu-kasan"],
    table: [
      [100, 100],
      [200, 200],
    ],
    beyond: { fromKm: 200, baseFare: 200, ratePerKm: 0 },
  };

  it("JR東日本の区域で縮んだ距離は、加算額の距離からも引く", () => {
    // 名古屋→赤羽で、東京→赤羽の13.2kmを加算額に入れていた（ekitan より80円高い）
    const c = createFareCalculator(
      [base, kasanSteps, fallback],
      [],
      [],
      [eastCity],
    );
    // A→C の5kmは中心駅までの区域内。JR東日本の区間 105km → 100km
    expect(c.estimateHonshuThrough(255, 105, "A", "Far1")).toBe(2500 + 100);
  });

  it("読み替えで距離が伸びても、加算額の距離は増やさない", () => {
    const c = createFareCalculator(
      [base, kasanSteps, fallback],
      [],
      [],
      [eastCity],
    );
    // 発駅が中心駅より着駅寄り（実際 245km、中心駅から 250km）
    expect(c.estimateHonshuThrough(245, 100, "A", "Far1")).toBe(2500 + 100);
  });

  it("JR東日本以外の区域で縮んだ距離は、加算額の距離から引かない", () => {
    const westCity: SpecialCity = { ...cityX, operator: "JR西日本" };
    const c = createFareCalculator(
      [base, kasanSteps, fallback],
      [],
      [],
      [westCity],
    );
    expect(c.estimateHonshuThrough(255, 105, "A", "Far1")).toBe(2500 + 200);
  });

  describe("発着とも区域内のとき、加算額の距離から引くのは JR東日本の区域の側だけ", () => {
    // 加算額 = 切り上げたキロ × 10円（引いた距離がそのまま見える）
    const kasanPerKm = perKm("kasan", ["__jr-honshu-kasan"]);
    const throughOf = (xOperator: string, yOperator: string) =>
      createFareCalculator(
        [base, kasanPerKm, fallback],
        [],
        [],
        [
          { ...cityX, operator: xOperator },
          { ...cityY, operator: yOperator },
        ],
      );

    it("発駅側だけ JR東日本なら、発駅〜中心駅の分だけ引く", () => {
      // 309km − A 5km − E 4km = 中心駅どうし 300km。JR東日本の区間 50km − 5km
      expect(
        throughOf("JR東日本", "JR西日本").estimateHonshuThrough(
          309,
          50,
          "A",
          "E",
        ),
      ).toBe(3000 + 450);
    });

    it("着駅側だけ JR東日本なら、中心駅〜着駅の分だけ引く", () => {
      expect(
        throughOf("JR西日本", "JR東日本").estimateHonshuThrough(
          309,
          50,
          "A",
          "E",
        ),
      ).toBe(3000 + 460);
    });

    it("両側とも JR東日本でも、縮んだ距離より多くは引かない", () => {
      // 305km は中心駅どうしの 300km に読み替えるので、縮んだのは5km（両側の半径は9km）
      expect(
        throughOf("JR東日本", "JR東日本").estimateHonshuThrough(
          305,
          50,
          "A",
          "E",
        ),
      ).toBe(3000 + 450);
    });

    it("実際の距離が中心駅どうしより短ければ、加算額の距離は引かない", () => {
      // 290km を中心駅どうしの 300km に読み替える（伸びる）
      expect(
        throughOf("JR東日本", "JR東日本").estimateHonshuThrough(
          290,
          50,
          "A",
          "E",
        ),
      ).toBe(3000 + 500);
    });
  });
});

describe("特定都区市内の境目と距離の小数の誤差", () => {
  it("中心駅からちょうど200kmなら、足し算の誤差で200kmをわずかに超えても読み替えない", () => {
    const calc = createFareCalculator(
      [perKm("kou", ["甲JR"]), fallback],
      [],
      [],
      [cityX],
    );
    // A（中心から5km）→Far2（中心から150km）を遠回りして実際の距離 205km。中心駅経由に
    // 読み替えると 200km ちょうどで、規則は効かない（205km のまま 2050円）。
    // 駅間キロを足す順番で 205.00000000000003 になると 200km 超と判定され、
    // 200km に読み替えて 2000円になっていた
    expect(calc.estimate("甲JR", 205.00000000000003, "A", "Far2")).toBe(2050);
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

describe("buildSpecialCities の駅のまとめ方", () => {
  const n = (id: string, name: string, operator: string, groupId = id) => ({
    id,
    groupId,
    name,
    lat: 0,
    lng: 0,
    lineId: "l",
    lineName: "l",
    operator,
  });
  const rail = (from: string, to: string, km: number, operator: string) => ({
    from,
    to,
    km,
    kind: "rail" as const,
    operator,
  });
  const transfer = (from: string, to: string) => ({
    from,
    to,
    km: 0,
    kind: "transfer" as const,
    operator: "",
  });
  const cityOn = (
    graph: RailGraph,
    extra: { stations?: string[]; maxKm?: number } = {},
  ) =>
    buildSpecialCities(graph, {
      cities: [
        {
          id: "x",
          name: "X市内",
          center: "C",
          operator: "JR東日本",
          minKm: 200,
          stations: extra.stations ?? ["C"],
          ...(extra.maxKm === undefined ? {} : { maxKm: extra.maxKm }),
        },
      ],
    })[0]!;

  it("同じ groupId の駅は1つの駅として、乗り換えなしでつなぐ", () => {
    // C —5— D(線1)、D(線2) —7— E。D の2つのノードは同じ groupId
    const graph: RailGraph = {
      nodes: {
        c: n("c", "C", "JR東日本"),
        d1: n("d1", "D", "JR東日本", "gD"),
        d2: n("d2", "D", "JR東日本", "gD"),
        e: n("e", "E", "JR東日本"),
      },
      edges: [rail("c", "d1", 5, "JR東日本"), rail("d2", "e", 7, "JR東日本")],
    };
    expect([...cityOn(graph).centerKm]).toEqual([
      ["C", 0],
      ["D", 5],
      ["E", 12],
    ]);
  });

  it("区域の会社以外の駅を挟んだ乗換では、区域の会社の駅どうしをつながない", () => {
    // JR東日本の S と JR東海の S は別の駅。私鉄の S が両方と乗換でつながっていても、
    // 通し運賃の距離で S を1つの駅とみなさない（みなすと C→S→T が 6km になる）
    const graph: RailGraph = {
      nodes: {
        c: n("c", "C", "JR東日本"),
        s1: n("s1", "S", "JR東日本"),
        s2: n("s2", "S", "JR東海"),
        sp: n("sp", "S", "私鉄"),
        t: n("t", "T", "JR東海"),
      },
      edges: [
        rail("c", "s1", 2, "JR東日本"),
        rail("s2", "t", 4, "JR東海"),
        transfer("sp", "s1"),
        transfer("sp", "s2"),
      ],
    };
    const city = cityOn(graph);
    expect(city.throughCenterKm?.has("T")).toBe(false);
    expect(city.throughCenterKm?.has("S")).toBe(false);
  });

  it("グラフに無い駅への乗換の辺は無視する", () => {
    const graph: RailGraph = {
      nodes: { c: n("c", "C", "JR東日本"), d: n("d", "D", "JR東日本") },
      edges: [rail("c", "d", 3, "JR東日本"), transfer("c", "ghost")],
    };
    expect([...cityOn(graph).centerKm]).toEqual([
      ["C", 0],
      ["D", 3],
    ]);
  });

  it("線路でつながった同名の駅は、別の駅として距離を持たない", () => {
    const graph: RailGraph = {
      nodes: {
        c: n("c", "C", "JR東日本"),
        s1: n("s1", "S", "JR東日本"),
        s2: n("s2", "S", "JR東日本"),
      },
      edges: [rail("c", "s1", 2, "JR東日本"), rail("s1", "s2", 1, "JR東日本")],
    };
    expect([...cityOn(graph).centerKm]).toEqual([["C", 0]]);
  });

  it("区域の会社の線路で届かない駅は距離を持たない", () => {
    const graph: RailGraph = {
      nodes: { c: n("c", "C", "JR東日本"), z: n("z", "Z", "JR東日本") },
      edges: [],
    };
    expect([...cityOn(graph).centerKm]).toEqual([["C", 0]]);
  });

  it("区域の会社以外に同名の駅があっても、中心駅は1つと数える", () => {
    const graph: RailGraph = {
      nodes: {
        c: n("c", "C", "JR東日本"),
        cp: n("cp", "C", "私鉄"),
        d: n("d", "D", "JR東日本"),
      },
      edges: [rail("c", "d", 3, "JR東日本")],
    };
    expect(cityOn(graph).centerKm.get("D")).toBe(3);
  });

  it("区域の会社に同名の中心駅が2つあれば例外", () => {
    const graph: RailGraph = {
      nodes: { c1: n("c1", "C", "JR東日本"), c2: n("c2", "C", "JR東日本") },
      edges: [],
    };
    expect(() => cityOn(graph)).toThrow(
      "中心駅 C が無いか、同名の駅が複数ある",
    );
  });

  it("区域の駅が別の会社にしか無ければ例外", () => {
    const graph: RailGraph = {
      nodes: { c: n("c", "C", "JR東日本"), r: n("r", "R", "私鉄") },
      edges: [],
    };
    expect(() => cityOn(graph, { stations: ["C", "R"] })).toThrow(
      "X市内: 駅 R が JR東日本 に無い",
    );
  });

  it("名前の違う駅どうしの乗換ではつながない", () => {
    // C の隣の X へ乗換の辺がある（浜松町と大門のような別の駅）。X から先の Y は
    // 区域の会社の線路では C から届かない
    const graph: RailGraph = {
      nodes: {
        c: n("c", "C", "JR東日本"),
        x: n("x", "X", "JR東日本"),
        y: n("y", "Y", "JR東日本"),
      },
      edges: [transfer("c", "x"), rail("x", "y", 5, "JR東日本")],
    };
    expect([...cityOn(graph).centerKm]).toEqual([["C", 0]]);
  });

  it("区域の会社以外の線路は、区域の会社の駅どうしをつなぐ経路にも使わない", () => {
    const graph: RailGraph = {
      nodes: { c: n("c", "C", "JR東日本"), d: n("d", "D", "JR東日本") },
      edges: [rail("c", "d", 3, "私鉄")],
    };
    expect([...cityOn(graph).centerKm]).toEqual([["C", 0]]);
  });

  it("先に見つかった遠い経路でなく、最短の距離を返す", () => {
    // C から A へ直接 10km、B 経由なら 1+1=2km
    const graph: RailGraph = {
      nodes: {
        c: n("c", "C", "JR東日本"),
        a: n("a", "A", "JR東日本"),
        b: n("b", "B", "JR東日本"),
      },
      edges: [
        // 近い B を先に積み、遠い A（10km）を後に積む並び。取り出しが距離の順で
        // なく積んだ順の逆だと、A を 10km で確定してしまう
        rail("c", "b", 1, "JR東日本"),
        rail("c", "a", 10, "JR東日本"),
        rail("b", "a", 1, "JR東日本"),
      ],
    };
    expect(cityOn(graph).centerKm.get("A")).toBe(2);
  });

  it("中心駅が区域の会社に無ければ例外", () => {
    const graph: RailGraph = {
      nodes: { c: n("c", "C", "私鉄") },
      edges: [],
    };
    expect(() => cityOn(graph)).toThrow(
      "中心駅 C が無いか、同名の駅が複数ある",
    );
  });

  it("maxKm は書いたときだけ持つ", () => {
    const graph: RailGraph = {
      nodes: { c: n("c", "C", "JR東日本") },
      edges: [],
    };
    expect("maxKm" in cityOn(graph)).toBe(false);
    expect(cityOn(graph, { maxKm: 200 }).maxKm).toBe(200);
  });
});

describe("specialCitiesFileSchema", () => {
  const city = {
    id: "x",
    name: "X市内",
    center: "C",
    operator: "JR東日本",
    minKm: 200,
    stations: ["C", "A"],
  };

  it("駅が2つ以上ある区域は通す", () => {
    expect(specialCitiesFileSchema.parse({ cities: [city] })).toEqual({
      cities: [city],
    });
  });

  it("駅が1つも無い区域は通さない", () => {
    expect(
      specialCitiesFileSchema.safeParse({ cities: [{ ...city, stations: [] }] })
        .success,
    ).toBe(false);
  });
});
