import { describe, expect, it } from "vitest";
import type { FareRule } from "@/lib/fare/types";
import type { RailGraph } from "@/lib/graph/types";
import { createGraphStore } from "@/lib/server/graph-store";

// 運賃 = 切り上げたキロ × 10円
const perKm: FareRule = {
  id: "kou",
  operators: ["甲JR"],
  table: [[1, 10]],
  beyond: { fromKm: 1, baseFare: 10, ratePerKm: 10 },
};
// 計算機はどの事業者にも当たらないときの表を必ず要る
const rules: FareRule[] = [perKm, { ...perKm, id: "fallback", operators: [] }];
const node = (id: string, name: string) => ({
  id,
  groupId: id,
  name,
  lat: 0,
  lng: 0,
  lineId: "l",
  lineName: "l",
  operator: "甲JR",
});
// 区域の駅 A は中心 C から 5km、区域外の F は C から 250km
const graph: RailGraph = {
  nodes: { c: node("c", "C"), a: node("a", "A"), f: node("f", "F") },
  edges: [
    { from: "c", to: "a", km: 5, kind: "rail", operator: "甲JR" },
    { from: "c", to: "f", km: 250, kind: "rail", operator: "甲JR" },
  ],
};
const specialCities = {
  cities: [
    {
      id: "x",
      name: "X市内",
      center: "C",
      operator: "甲JR",
      minKm: 200,
      stations: ["C", "A"],
    },
  ],
};

describe("createGraphStore", () => {
  it("特定都区市内を渡すと、区域内の駅からは中心駅からの距離で引く", () => {
    const store = createGraphStore(graph, rules, [], [], specialCities);
    expect(store.calc.estimate("甲JR", 255, "A", "F")).toBe(2500);
  });

  it("特定都区市内を渡さなければ、乗った距離のまま引く", () => {
    const store = createGraphStore(graph, rules);
    expect(store.calc.estimate("甲JR", 255, "A", "F")).toBe(2550);
  });

  it("特定都区市内のファイルの形が違えば例外", () => {
    expect(() =>
      createGraphStore(graph, rules, [], [], { cities: [{ id: "x" }] }),
    ).toThrow();
  });
});
