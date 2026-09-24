import { describe, expect, it } from "vitest";
import { applyStationKm } from "@/lib/graph/apply-station-km";
import type { RailGraph } from "@/lib/graph/types";

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

const makeGraph = (): RailGraph => ({
  nodes: Object.fromEntries(
    [
      node("a", "甲", "甲鉄道"),
      node("b", "乙", "甲鉄道"),
      node("c", "丙", "乙鉄道"),
      node("d", "丁", "乙鉄道"),
    ].map((n) => [n.id, n]),
  ),
  edges: [
    { from: "a", to: "b", km: 3.3, kind: "rail", operator: "甲鉄道" },
    { from: "c", to: "d", km: 5.0, kind: "rail", operator: "乙鉄道" },
    { from: "b", to: "c", km: 0, kind: "transfer", operator: "" },
  ],
});

describe("applyStationKm", () => {
  it("一致した駅間の km を実営業キロに置き換える", () => {
    const g = makeGraph();
    applyStationKm(g, [{ operator: "甲鉄道", from: "甲", to: "乙", km: 3.0 }]);
    expect(g.edges[0]?.km).toBe(3.0);
  });

  it("方向が逆でも一致させる", () => {
    const g = makeGraph();
    applyStationKm(g, [{ operator: "甲鉄道", from: "乙", to: "甲", km: 3.0 }]);
    expect(g.edges[0]?.km).toBe(3.0);
  });

  it("事業者が違えば置き換えない", () => {
    const g = makeGraph();
    const r = applyStationKm(g, [
      { operator: "丙鉄道", from: "甲", to: "乙", km: 99 },
    ]);
    expect(g.edges[0]?.km).toBe(3.3);
    expect(r.replaced).toBe(0);
    expect(r.unmatched).toBe(1);
  });

  it("乗換エッジは触らない", () => {
    const g = makeGraph();
    applyStationKm(g, [{ operator: "", from: "乙", to: "丙", km: 1.0 }]);
    expect(g.edges[2]?.km).toBe(0);
  });

  it("置き換えた数と、推定がどれだけ外れていたかを返す", () => {
    const g = makeGraph();
    const r = applyStationKm(g, [
      { operator: "甲鉄道", from: "甲", to: "乙", km: 3.0 },
      { operator: "乙鉄道", from: "丙", to: "丁", km: 4.5 },
    ]);
    expect(r.replaced).toBe(2);
    expect(r.totalDelta).toBeCloseTo(0.8);
    expect(r.worst[0]).toEqual({
      from: "丙",
      to: "丁",
      before: 5.0,
      after: 4.5,
    });
  });

  it("グラフに無い駅間は unmatched に数える", () => {
    const g = makeGraph();
    const r = applyStationKm(g, [
      { operator: "甲鉄道", from: "甲", to: "戊", km: 1.0 },
    ]);
    expect(r.unmatched).toBe(1);
    expect(r.replaced).toBe(0);
  });
});
