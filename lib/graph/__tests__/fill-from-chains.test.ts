import { describe, expect, it } from "vitest";
import { fillFromRealChains } from "@/lib/graph/fill-from-chains";
import type { StationKmEdge } from "@/lib/graph/apply-station-km";
import type { RailGraph } from "@/lib/graph/types";

const node = (
  id: string,
  name: string,
  lineName: string,
  operator = "甲鉄道",
) => ({
  id,
  groupId: name,
  name,
  lat: 0,
  lng: 0,
  lineId: lineName,
  lineName,
  operator,
});

// 各駅停車の路線は 大阪-塚本-尼崎、快速の路線は塚本を飛ばして 大阪-尼崎 を直結する。
// 実営業キロは 大阪-塚本 3.4km、塚本-尼崎 4.3km。快速の辺は推定の7.32kmのまま。
const build = (): RailGraph => ({
  nodes: Object.fromEntries(
    [
      node("l1", "大阪", "各停"),
      node("l2", "塚本", "各停"),
      node("l3", "尼崎", "各停"),
      node("r1", "大阪", "快速"),
      node("r3", "尼崎", "快速"),
    ].map((n) => [n.id, n]),
  ),
  edges: [
    { from: "l1", to: "l2", km: 3.4, kind: "rail", operator: "甲鉄道" },
    { from: "l2", to: "l3", km: 4.3, kind: "rail", operator: "甲鉄道" },
    { from: "r1", to: "r3", km: 7.32, kind: "rail", operator: "甲鉄道" },
  ],
});
const real: StationKmEdge[] = [
  { operator: "甲鉄道", from: "大阪", to: "塚本", km: 3.4 },
  { operator: "甲鉄道", from: "塚本", to: "尼崎", km: 4.3 },
];

describe("fillFromRealChains", () => {
  it("駅を飛ばす辺は、実営業キロの辺をつないだ長さで置き換える", () => {
    // 直線距離ベースの推定は実際の線路より必ず短く、最短経路がそちらを選ぶと
    // 距離が短く出る（大阪〜元町が公式31.4kmに対し31.0kmになっていた）
    const graph = build();
    const result = fillFromRealChains(graph, real, { maxRatio: 1.3 });
    expect(graph.edges[2]!.km).toBeCloseTo(7.7);
    expect(result.replaced).toBe(1);
  });

  it("実営業キロが入っている辺はそのまま", () => {
    const graph = build();
    fillFromRealChains(graph, real, { maxRatio: 1.3 });
    expect(graph.edges[0]!.km).toBe(3.4);
    expect(graph.edges[1]!.km).toBe(4.3);
  });

  it("実営業キロが当たっている辺は、別の経路のほうが短くても書き換えない", () => {
    // 大阪-尼崎 そのものに実営業キロ10.0kmがあるなら、塚本経由の7.7kmで上書きしない
    const graph = build();
    graph.edges[2]!.km = 10.0;
    const withDirect = [
      ...real,
      { operator: "甲鉄道", from: "大阪", to: "尼崎", km: 10.0 },
    ];
    fillFromRealChains(graph, withDirect, { maxRatio: 1.3 });
    expect(graph.edges[2]!.km).toBe(10.0);
  });

  it("実営業キロの辺で両端を結べなければそのまま", () => {
    const graph = build();
    fillFromRealChains(graph, [real[0]!], { maxRatio: 1.3 });
    expect(graph.edges[2]!.km).toBe(7.32);
  });

  it("つないだ長さが推定より大きく長い（環状線の反対回りなど）ならそのまま", () => {
    // 同じ線路を飛ばしているだけなら長さはほぼ同じになる。大きく長いなら、
    // その辺は別の線路で、つないだ経路は遠回りなので使えない
    const graph = build();
    graph.edges[2]!.km = 5.0; // 7.7 / 5.0 = 1.54 > 1.3
    fillFromRealChains(graph, real, { maxRatio: 1.3 });
    expect(graph.edges[2]!.km).toBe(5.0);
  });

  it("別の事業者の実営業キロではつながない", () => {
    const graph = build();
    const other = real.map((e) => ({ ...e, operator: "乙鉄道" }));
    fillFromRealChains(graph, other, { maxRatio: 1.3 });
    expect(graph.edges[2]!.km).toBe(7.32);
  });

  it("置き換えた辺もつなぎ目には使わない（推定どうしを連鎖させない）", () => {
    // 大阪-尼崎（推定）が置き換わったあと、それを使って別の推定辺を埋めると、
    // 1回目の判定の誤りが広がる。つなぐのは station-km の辺だけ
    const graph = build();
    graph.nodes["r4"] = node("r4", "西宮", "快速");
    graph.edges.push({
      from: "r3",
      to: "r4",
      km: 7.0,
      kind: "rail",
      operator: "甲鉄道",
    });
    graph.edges.push({
      from: "r1",
      to: "r4",
      km: 14.0,
      kind: "rail",
      operator: "甲鉄道",
    });
    fillFromRealChains(graph, real, { maxRatio: 1.3 });
    // 大阪-西宮 は 大阪-尼崎（置き換え済み）+ 尼崎-西宮（推定）でしか結べないので触らない
    expect(graph.edges[4]!.km).toBe(14.0);
  });
});
