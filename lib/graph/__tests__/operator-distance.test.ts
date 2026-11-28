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

describe("buildOperatorKmTable が通らない辺", () => {
  const withEdges = (
    extraNodes: ReturnType<typeof node>[],
    extraEdges: RailGraph["edges"],
  ): RailGraph => ({
    nodes: {
      ...graph.nodes,
      ...Object.fromEntries(extraNodes.map((n) => [n.id, n])),
    },
    edges: [...graph.edges, ...extraEdges],
  });

  it("他社の駅を挟んだ乗換では、自社の別の駅へつながない", () => {
    // C駅 →乗換→ 乙鉄道の X駅 →乗換→ 自社の E駅。自社線だけでは E駅へ届かない
    const g = withEdges(
      [node("x", "X駅", "乙鉄道"), node("e", "E駅", "甲鉄道")],
      [
        { from: "c", to: "x", km: 0, kind: "transfer", operator: "" },
        { from: "x", to: "e", km: 0, kind: "transfer", operator: "" },
      ],
    );
    const km = buildOperatorKmTable(g, "甲鉄道");
    expect(km("A駅", "E駅")).toBeNull();
    expect(km("A駅", "X駅")).toBeNull();
  });

  it("自社の駅どうしでも、他社の線路の区間は辿らない", () => {
    const g = withEdges(
      [node("e", "E駅", "甲鉄道")],
      [{ from: "c", to: "e", km: 4, kind: "rail", operator: "乙鉄道" }],
    );
    expect(buildOperatorKmTable(g, "甲鉄道")("A駅", "E駅")).toBeNull();
  });

  it("乗換の辺は、km が入っていても0として数える", () => {
    const g: RailGraph = {
      ...graph,
      edges: graph.edges.map((e) =>
        e.kind === "transfer" ? { ...e, km: 0.5 } : e,
      ),
    };
    expect(buildOperatorKmTable(g, "甲鉄道")("A駅", "C駅")).toBeCloseTo(3.0);
  });

  it("始点の駅名に同名の駅が複数あれば、乗換でつながっていなくてもどれからでも測る", () => {
    // B駅の2つのノードの乗換を外す。A駅へは b から、C駅へは b2 からしか行けない
    const g: RailGraph = {
      ...graph,
      edges: graph.edges.filter((e) => e.kind !== "transfer"),
    };
    const km = buildOperatorKmTable(g, "甲鉄道");
    expect(km("B駅", "A駅")).toBeCloseTo(1.0);
    expect(km("B駅", "C駅")).toBeCloseTo(2.0);
  });

  it("自社の駅でも、自社の線路で届かなければ null", () => {
    const g = withEdges([node("z", "Z駅", "甲鉄道")], []);
    expect(buildOperatorKmTable(g, "甲鉄道")("A駅", "Z駅")).toBeNull();
  });
});
