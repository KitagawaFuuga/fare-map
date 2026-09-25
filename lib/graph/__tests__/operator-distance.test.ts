import { describe, expect, it } from "vitest";
import { buildOperatorKmTable } from "@/lib/graph/operator-distance";
import type { RailGraph } from "@/lib/graph/types";

// A -1.0- B -2.0- C が事業者「甲鉄道」、C -5.0- D が別事業者「乙鉄道」。
// B には同名の別路線ノード B' があり、transfer で繋がっている。
const node = (id: string, name: string, operator: string) => ({
  id,
  groupId: name,
  name,
  lat: 0,
  lng: 0,
  lineId: "L",
  lineName: "線",
  operator,
});

const graph: RailGraph = {
  nodes: Object.fromEntries(
    [
      node("a", "A駅", "甲鉄道"),
      node("b", "B駅", "甲鉄道"),
      node("b2", "B駅", "甲鉄道"),
      node("c", "C駅", "甲鉄道"),
      node("d", "D駅", "乙鉄道"),
    ].map((n) => [n.id, n]),
  ),
  edges: [
    { from: "a", to: "b", km: 1.0, kind: "rail", operator: "甲鉄道" },
    { from: "b2", to: "c", km: 2.0, kind: "rail", operator: "甲鉄道" },
    { from: "b", to: "b2", km: 0, kind: "transfer", operator: "" },
    { from: "c", to: "d", km: 5.0, kind: "rail", operator: "乙鉄道" },
  ],
};

describe("buildOperatorKmTable", () => {
  it("同じ事業者の駅間は最短経路の営業キロを返す", () => {
    const km = buildOperatorKmTable(graph, "甲鉄道");
    expect(km("A駅", "C駅")).toBeCloseTo(3.0);
  });

  it("乗り換えエッジは距離0として跨げる", () => {
    const km = buildOperatorKmTable(graph, "甲鉄道");
    expect(km("B駅", "C駅")).toBeCloseTo(2.0);
  });

  it("方向を問わず同じ値を返す", () => {
    const km = buildOperatorKmTable(graph, "甲鉄道");
    expect(km("C駅", "A駅")).toBeCloseTo(3.0);
  });

  it("同じ駅は0", () => {
    const km = buildOperatorKmTable(graph, "甲鉄道");
    expect(km("A駅", "A駅")).toBe(0);
  });

  it("他事業者の駅は null（自社線だけを辿るため到達できない）", () => {
    const km = buildOperatorKmTable(graph, "甲鉄道");
    expect(km("A駅", "D駅")).toBeNull();
  });

  it("存在しない駅名は null", () => {
    const km = buildOperatorKmTable(graph, "甲鉄道");
    expect(km("無い駅", "A駅")).toBeNull();
  });

  it("同名の別路線ノードが複数あるときは最短のものを採る", () => {
    // 「A駅」が2ノードあり、片方からは C駅 が 3.0km、もう片方からは 0.5km
    const g: RailGraph = {
      nodes: {
        ...graph.nodes,
        a2: node("a2", "A駅", "甲鉄道"),
      },
      edges: [
        ...graph.edges,
        { from: "a2", to: "c", km: 0.5, kind: "rail", operator: "甲鉄道" },
      ],
    };
    expect(buildOperatorKmTable(g, "甲鉄道")("A駅", "C駅")).toBeCloseTo(0.5);
  });
});

describe("buildOperatorKmTable（運賃計算キロ）", () => {
  // B'-C に擬制キロ（営業キロ2.0 → 運賃計算キロ2.5）を持たせたグラフ
  const withFareKm: RailGraph = {
    nodes: graph.nodes,
    edges: graph.edges.map((e) =>
      e.from === "b2" && e.to === "c" ? { ...e, fareKm: 2.5 } : e,
    ),
  };

  it("useFareKm を指定すると運賃計算キロで合算する", () => {
    const km = buildOperatorKmTable(withFareKm, "甲鉄道", {
      useFareKm: true,
    });
    expect(km("A駅", "C駅")).toBe(3.5);
  });

  it("既定は営業キロ（fareKm があっても使わない）", () => {
    expect(buildOperatorKmTable(withFareKm, "甲鉄道")("A駅", "C駅")).toBe(3.0);
  });
});
