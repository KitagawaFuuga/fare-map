import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import { buildSpecialCities } from "@/lib/fare/special-cities";
import type { FareRule } from "@/lib/fare/types";
import type { GraphEdge, RailGraph } from "@/lib/graph/types";
import { findReachable } from "@/lib/search/reachable";

// 運賃 = 切り上げたキロ × 10円
const perKm = (id: string, operators: string[]): FareRule => ({
  id,
  operators,
  table: [[1, 10]],
  beyond: { fromKm: 1, baseFare: 10, ratePerKm: 10 },
});
const kasanZero: FareRule = {
  id: "kasan",
  operators: ["__jr-honshu-kasan"],
  table: [[1000, 0]],
  beyond: { fromKm: 1000, baseFare: 0, ratePerKm: 0 },
};

const node = (id: string, operator: string) => ({
  id,
  groupId: id,
  name: id,
  lat: 35,
  lng: 139,
  lineId: operator,
  lineName: operator,
  operator,
});
const rail = (
  from: string,
  to: string,
  km: number,
  operator: string,
): GraphEdge => ({
  from,
  to,
  km,
  kind: "rail",
  operator,
});
const fareAt = (
  result: { id: string; fare: number }[],
  id: string,
): number | undefined => result.find((r) => r.id === id)?.fare;

describe("探索での特定都区市内", () => {
  // 区域X（中心C、区域の駅 A・C）。S から私鉄で区域内の A と区域外の N へ行ける。
  //   S —乙1km— A —甲JR5km— C —甲JR250km— F
  //   S —乙1km— N —甲JR3km— C
  const graph: RailGraph = {
    nodes: {
      S: node("S", "乙鉄道"),
      A: node("A", "甲JR"),
      N: node("N", "甲JR"),
      C: node("C", "甲JR"),
      F: node("F", "甲JR"),
      SA: node("SA", "乙鉄道"),
      SN: node("SN", "乙鉄道"),
    },
    edges: [
      rail("S", "SA", 1, "乙鉄道"),
      rail("S", "SN", 1, "乙鉄道"),
      { from: "SA", to: "A", km: 0, kind: "transfer", operator: "" },
      { from: "SN", to: "N", km: 0, kind: "transfer", operator: "" },
      rail("A", "C", 5, "甲JR"),
      rail("N", "C", 3, "甲JR"),
      rail("C", "F", 250, "甲JR"),
    ],
  };
  const cities = buildSpecialCities(graph, {
    cities: [
      {
        id: "x",
        name: "X市内",
        center: "C",
        operator: "甲JR",
        minKm: 200,
        stations: ["A", "C"],
      },
    ],
  });
  const calc = createFareCalculator(
    [perKm("kou", ["甲JR"]), perKm("otsu", ["乙鉄道"]), perKm("fb", [])],
    [],
    [],
    cities,
  );

  it("区域内の駅から乗ると中心駅からの距離で引く（予算ちょうどでも枝刈りされない）", () => {
    expect(fareAt(findReachable(graph, calc, "A", 2500), "F")).toBe(2500);
  });

  it("区域内の起点の状態は、距離の短い区域外の起点の状態に消されない", () => {
    // C 時点で N 起点（3km）が A 起点（5km）より短いが、F まで行くと A 起点は
    // 中心駅からの 250km、N 起点は 253km で引く
    expect(fareAt(findReachable(graph, calc, "S", 3000), "F")).toBe(10 + 2500);
  });
});

describe("探索での特定都区市内とJR本州3社の通し運賃", () => {
  //   A —東日本5km— C —東日本100km— P | P' —東海100km— Q —東海50km— F
  // （F は境界から2駅目。境界の直後でない駅でも通しの発駅を持ち回れているか見る）
  const graph: RailGraph = {
    nodes: {
      A: node("A", "JR東日本"),
      C: node("C", "JR東日本"),
      P: node("P", "JR東日本"),
      P2: { ...node("P2", "JR東海"), name: "P" },
      Q: node("Q", "JR東海"),
      F: node("F", "JR東海"),
    },
    edges: [
      rail("A", "C", 5, "JR東日本"),
      rail("C", "P", 100, "JR東日本"),
      { from: "P", to: "P2", km: 0, kind: "transfer", operator: "" },
      rail("P2", "Q", 100, "JR東海"),
      rail("Q", "F", 50, "JR東海"),
    ],
  };
  const cities = buildSpecialCities(graph, {
    cities: [
      {
        id: "x",
        name: "X市内",
        center: "C",
        operator: "JR東日本",
        minKm: 200,
        stations: ["A", "C"],
      },
    ],
  });
  const calc = createFareCalculator(
    [
      perKm("east", ["JR東日本"]),
      perKm("tokai", ["JR東海"]),
      kasanZero,
      perKm("fb", []),
    ],
    [],
    [],
    cities,
  );

  it("会社境界を越えても、乗り始めた区域内の駅で読み替える", () => {
    expect(fareAt(findReachable(graph, calc, "A", 2500), "F")).toBe(2500);
  });
});

describe("東京都区内・山手線内の加算額の除外（東京〜熱海）", () => {
  // 東京都区内: A（赤羽にあたる、除外区間の路線ではない）・C（東京、中心駅）
  // 山手線内: C のみ
  //   A —東日本13km— C —東日本105km（東海道本線 11301）— H | H' —東海50km— S —東海210km— N —東海10km— M
  //   A —東日本60km— B | B' —東海58km— H'（JR東日本の距離が短い別経路。S まで同じ168km）
  const graph: RailGraph = {
    nodes: {
      A: { ...node("A", "JR東日本"), lineId: "L1" },
      C: { ...node("C", "JR東日本"), lineId: "11301" },
      H: { ...node("H", "JR東日本"), lineId: "11301" },
      H2: { ...node("H2", "JR東海"), name: "H" },
      S: node("S", "JR東海"),
      N: node("N", "JR東海"),
      M: node("M", "JR東海"),
      B: { ...node("B", "JR東日本"), lineId: "L2" },
      B2: { ...node("B2", "JR東海"), name: "B" },
    },
    edges: [
      rail("A", "B", 60, "JR東日本"),
      { from: "B", to: "B2", km: 0, kind: "transfer", operator: "" },
      rail("B2", "H2", 58, "JR東海"),
      rail("A", "C", 13, "JR東日本"),
      rail("C", "H", 105, "JR東日本"),
      { from: "H", to: "H2", km: 0, kind: "transfer", operator: "" },
      rail("H2", "S", 50, "JR東海"),
      rail("S", "N", 210, "JR東海"),
      rail("N", "M", 10, "JR東海"),
    ],
  };
  const cities = buildSpecialCities(graph, {
    cities: [
      {
        id: "tokyo",
        name: "東京都区内",
        center: "C",
        operator: "JR東日本",
        minKm: 200,
        stations: ["A", "C"],
      },
      {
        id: "yamanote",
        name: "東京山手線内",
        center: "C",
        operator: "JR東日本",
        minKm: 100,
        maxKm: 200,
        stations: ["C"],
      },
    ],
  });
  // 加算額: 100kmまで100円、200kmまで200円
  const kasan: FareRule = {
    id: "kasan",
    operators: ["__jr-honshu-kasan"],
    table: [
      [100, 100],
      [200, 200],
    ],
    beyond: { fromKm: 200, baseFare: 200, ratePerKm: 0 },
  };
  const calc = createFareCalculator(
    [
      perKm("east", ["JR東日本"]),
      perKm("tokai", ["JR東海"]),
      kasan,
      perKm("fb", []),
    ],
    [],
    [],
    cities,
  );

  it("区域内の駅から東海道方面へ200km超なら、東京〜熱海も区域内の区間も加算額に入れない", () => {
    // 中心駅から 365km。基準額 3,650円 ＋ 加算額 0円
    const result = findReachable(graph, calc, "A", 5000);
    expect(fareAt(result, "N")).toBe(3650);
    expect(fareAt(result, "M")).toBe(3750);
  });

  it("逆方向（東海道方面から区域内の駅へ）も同じ額", () => {
    expect(fareAt(findReachable(graph, calc, "N", 5000), "A")).toBe(3650);
  });

  it("東京都区内が適用されない200km以下では、区域内の駅でも加算額がかかる", () => {
    // 実際の 168km（中心駅から 155km で200km以下）。東京経由は加算額 118km 分の200円、
    // B 経由は JR東日本が 60km で100円。B 経由が安い
    expect(fareAt(findReachable(graph, calc, "A", 5000), "S")).toBe(1680 + 100);
  });

  it("区域が適用されたときの加算額が小さい状態でも、適用されないときに高い状態は別の状態を消さない", () => {
    // 熱海で東京経由（加算額の距離 0km、適用されなければ118km）と B 経由（60km）が
    // 同じ距離で並ぶ。前者が後者を消すと、200km以下の S で B 経由の安い額を取りこぼす
    const result = findReachable(graph, calc, "A", 5000);
    expect(fareAt(result, "S")).toBe(1780);
    expect(fareAt(result, "N")).toBe(3650);
  });

  it("山手線内の駅からは100km超200km以下でも除外する", () => {
    expect(fareAt(findReachable(graph, calc, "C", 5000), "S")).toBe(1550);
  });
});
