import { describe, expect, it } from "vitest";
import { findReachable } from "@/lib/search/reachable";
import { createFareCalculator } from "@/lib/fare/calculator";
import type { RailGraph } from "@/lib/graph/types";

// 非線形な運賃表にすることで「距離合算」と「区間ごと加算」の結果が
// 異なるようにし、初乗り二重取り防止をテストで判別できるようにする。
// 20km を 1 区間として引くと 150 円、10km を 2 回引くと 200 円。
const calc = createFareCalculator([
  {
    id: "test",
    operators: [],
    table: [
      [10, 100],
      [20, 150],
      [30, 300],
    ],
    beyond: { fromKm: 30, baseFare: 300, ratePerKm: 10 },
  },
]);

// 事業者→運賃表マッピングが未検証だと、OpB がフォールバック表を引いていても
// 気づけない（createFareCalculator は未知事業者をサイレントにフォールバックへ
// 落とすため）。フォールバックと異なる OpB 専用表を持つ calculator を別途用意し、
// D の運賃がその専用表由来になることを判別できるようにする。
const calcWithOpB = createFareCalculator([
  {
    id: "test",
    operators: [],
    table: [
      [10, 100],
      [20, 150],
      [30, 300],
    ],
    beyond: { fromKm: 30, baseFare: 300, ratePerKm: 10 },
  },
  {
    id: "opb",
    operators: ["OpB"],
    table: [[10, 80]],
    beyond: { fromKm: 10, baseFare: 80, ratePerKm: 5 },
  },
]);

const node = (id: string) => ({
  id,
  groupId: id,
  name: id,
  lat: 35,
  lng: 139,
  lineId: "L",
  lineName: "L",
  operator: "OpA",
});

// A -10km- B -10km- C、C から OpB で -10km- D
const graph: RailGraph = {
  nodes: {
    A: node("A"),
    B: node("B"),
    C: node("C"),
    D: { ...node("D"), operator: "OpB" },
  },
  edges: [
    { from: "A", to: "B", km: 10, kind: "rail", operator: "OpA" },
    { from: "B", to: "C", km: 10, kind: "rail", operator: "OpA" },
    { from: "C", to: "D", km: 10, kind: "rail", operator: "OpB" },
  ],
};

describe("findReachable", () => {
  it("同一事業者は距離合算で運賃を出す（初乗り二重取りしない）", () => {
    const result = findReachable(graph, calc, "A", 10000);
    const c = result.find((r) => r.id === "C");
    expect(c?.fare).toBe(150); // 20km を 1 区間として表引き。区間ごと加算なら 200 になる
  });

  it("事業者が変わると区間を分けて加算する", () => {
    const result = findReachable(graph, calc, "A", 10000);
    const d = result.find((r) => r.id === "D");
    expect(d?.fare).toBe(250); // OpA 20km = 150 + OpB 10km = 100
  });

  it("予算内の駅だけ返す", () => {
    const result = findReachable(graph, calc, "A", 150);
    expect(result.map((r) => r.id).sort()).toEqual(["A", "B", "C"]);
  });

  it("出発駅は fare 0 で含まれ、結果は fare 昇順", () => {
    const result = findReachable(graph, calc, "A", 10000);
    expect(result[0]).toEqual({ id: "A", fare: 0 });
    const fares = result.map((r) => r.fare);
    expect([...fares].sort((x, y) => x - y)).toEqual(fares);
  });

  it("逆方向（無向）にも到達できる", () => {
    const result = findReachable(graph, calc, "C", 10000);
    expect(result.some((r) => r.id === "A")).toBe(true);
  });

  it("事業者ごとの運賃表マッピングが効いている（OpB 専用表を引く）", () => {
    const result = findReachable(graph, calcWithOpB, "A", 10000);
    const d = result.find((r) => r.id === "D");
    // OpA 20km = 150（フォールバック表） + OpB 10km = 80（OpB 専用表）
    // フォールバック表を誤って引くと OpB 10km = 100 になり 250 になってしまう
    expect(d?.fare).toBe(230);
  });

  it("transfer エッジは運賃・区間状態を引き継ぐ（区間が分断されない）", () => {
    // A -rail(OpA,10km)- B -transfer- B2 -rail(OpA,10km)- C
    const transferGraph: RailGraph = {
      nodes: { A: node("A"), B: node("B"), B2: node("B2"), C: node("C") },
      edges: [
        { from: "A", to: "B", km: 10, kind: "rail", operator: "OpA" },
        { from: "B", to: "B2", km: 0, kind: "transfer", operator: "" },
        { from: "B2", to: "C", km: 10, kind: "rail", operator: "OpA" },
      ],
    };
    const result = findReachable(transferGraph, calc, "A", 10000);
    const c = result.find((r) => r.id === "C");
    // 区間が引き継がれていれば 20km 一括で 150。分断されれば 10km を 2 回引いて 200 になる
    expect(c?.fare).toBe(150);
  });

  it("transfer エッジの逆方向にも到達できる", () => {
    const transferGraph: RailGraph = {
      nodes: { A: node("A"), B: node("B"), B2: node("B2"), C: node("C") },
      edges: [
        { from: "A", to: "B", km: 10, kind: "rail", operator: "OpA" },
        { from: "B", to: "B2", km: 0, kind: "transfer", operator: "" },
        { from: "B2", to: "C", km: 10, kind: "rail", operator: "OpA" },
      ],
    };
    const result = findReachable(transferGraph, calc, "C", 10000);
    expect(result.some((r) => r.id === "A")).toBe(true);
  });
});
