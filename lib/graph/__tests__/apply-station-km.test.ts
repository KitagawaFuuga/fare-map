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

describe("applyStationKm の報告", () => {
  it("置き換えた数・差の合計・差の大きい順の例・当たらなかった数を返す", () => {
    const g = makeGraph();
    // 甲-乙 は 9.0→8.9（差0.1、和17.9）、丙-丁 は 5.0→3.0（差2.0、和8.0）、
    // 戊-己 は 1.0→1.5（差0.5、和2.5）。差の大きい順は 丙-丁・戊-己・甲-乙 で、
    // 並べ替えない順とも、片方だけ和で比べた順とも違う
    g.edges[0]!.km = 9.0;
    g.nodes["e"] = node("e", "戊", "乙鉄道");
    g.nodes["f"] = node("f", "己", "乙鉄道");
    g.edges.push({
      from: "e",
      to: "f",
      km: 1.0,
      kind: "rail",
      operator: "乙鉄道",
    });
    const result = applyStationKm(g, [
      { operator: "甲鉄道", from: "甲", to: "乙", km: 8.9 },
      { operator: "乙鉄道", from: "丙", to: "丁", km: 3.0 },
      { operator: "乙鉄道", from: "戊", to: "己", km: 1.5 },
      { operator: "乙鉄道", from: "庚", to: "辛", km: 1.0 },
    ]);
    expect(result.totalDelta).toBeCloseTo(2.6, 10);
    expect({ ...result, totalDelta: 0 }).toEqual({
      replaced: 3,
      totalDelta: 0,
      worst: [
        { from: "丙", to: "丁", before: 5.0, after: 3.0 },
        { from: "戊", to: "己", before: 1.0, after: 1.5 },
        { from: "甲", to: "乙", before: 9.0, after: 8.9 },
      ],
      unmatched: 1,
    });
  });

  it("グラフに無い駅を指す辺は飛ばす", () => {
    for (const [from, to] of [
      ["a", "ghost"],
      ["ghost", "b"],
    ] as const) {
      const g = makeGraph();
      g.edges.push({ from, to, km: 1, kind: "rail", operator: "甲鉄道" });
      const result = applyStationKm(g, [
        { operator: "甲鉄道", from: "甲", to: "乙", km: 3.0 },
      ]);
      expect(result.replaced).toBe(1);
      expect(g.edges[3]!.km).toBe(1);
    }
  });

  it("例は差の大きい順に10件まで", () => {
    // 駅 S0〜S12 を 1km ずつの推定でつなぎ、実営業キロを i×0.1km ずらす
    const names = Array.from({ length: 13 }, (_, i) => `S${i}`);
    const g: RailGraph = {
      nodes: Object.fromEntries(names.map((n) => [n, node(n, n, "甲鉄道")])),
      edges: names.slice(1).map((n, i) => ({
        from: names[i]!,
        to: n,
        km: 1,
        kind: "rail" as const,
        operator: "甲鉄道",
      })),
    };
    const result = applyStationKm(
      g,
      names.slice(1).map((n, i) => ({
        operator: "甲鉄道",
        from: names[i]!,
        to: n,
        km: Number((1 + (i % 2 === 0 ? 1 : -1) * 0.05 * i).toFixed(2)),
      })),
    );
    expect(result.replaced).toBe(12);
    expect(result.worst.map((w) => w.from)).toEqual([
      "S11",
      "S10",
      "S9",
      "S8",
      "S7",
      "S6",
      "S5",
      "S4",
      "S3",
      "S2",
    ]);
  });
});
