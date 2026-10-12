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
