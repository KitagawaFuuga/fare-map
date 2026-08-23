import { describe, expect, it } from "vitest";
import { validateGraph } from "@/lib/graph/validate";
import type { RailGraph } from "@/lib/graph/types";

const node = (id: string, lat = 35, lng = 139) => ({
  id,
  groupId: id,
  name: id,
  lat,
  lng,
  lineId: "L1",
  lineName: "L",
  operator: "Op",
});

describe("validateGraph", () => {
  it("正常なグラフは空配列", () => {
    const g: RailGraph = {
      nodes: { A: node("A"), B: node("B", 35.01) },
      edges: [{ from: "A", to: "B", km: 1.1, kind: "rail", operator: "Op" }],
    };
    expect(validateGraph(g)).toEqual([]);
  });

  it("エッジの無い孤立ノードを報告する", () => {
    const g: RailGraph = { nodes: { A: node("A") }, edges: [] };
    expect(validateGraph(g).some((m) => m.includes("孤立"))).toBe(true);
  });

  it("存在しないノードを指すエッジを報告する", () => {
    const g: RailGraph = {
      nodes: { A: node("A") },
      edges: [{ from: "A", to: "X", km: 1, kind: "rail", operator: "Op" }],
    };
    expect(validateGraph(g).some((m) => m.includes("X"))).toBe(true);
  });

  it("駅間 100km 超の rail エッジを異常値として報告する", () => {
    const g: RailGraph = {
      nodes: { A: node("A"), B: node("B", 36) },
      edges: [{ from: "A", to: "B", km: 150, kind: "rail", operator: "Op" }],
    };
    expect(validateGraph(g).some((m) => m.includes("100km"))).toBe(true);
  });

  it("km が NaN の rail エッジを異常値として報告する", () => {
    const g: RailGraph = {
      nodes: { A: node("A"), B: node("B", 36) },
      edges: [{ from: "A", to: "B", km: NaN, kind: "rail", operator: "Op" }],
    };
    expect(validateGraph(g).some((m) => m.includes("NaN"))).toBe(true);
  });
});
