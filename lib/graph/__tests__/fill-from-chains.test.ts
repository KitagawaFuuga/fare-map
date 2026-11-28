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

// 各停の駅を names の順に 1km ずつの実営業キロで並べ、快速の辺 express を足す
const lineGraph = (
  names: string[],
  express: [string, string, number][],
): { graph: RailGraph; real: StationKmEdge[] } => {
  const nodes = [
    ...names.map((n) => node(`L:${n}`, n, "各停")),
    ...names.map((n) => node(`R:${n}`, n, "快速")),
  ];
  const local = names.slice(1).map((n, i) => ({
    from: `L:${names[i]!}`,
    to: `L:${n}`,
    km: 1,
    kind: "rail" as const,
    operator: "甲鉄道",
  }));
  return {
    graph: {
      nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
      edges: [
        ...local,
        ...express.map(([a, b, km]) => ({
          from: `R:${a}`,
          to: `R:${b}`,
          km,
          kind: "rail" as const,
          operator: "甲鉄道",
        })),
      ],
    },
    real: names.slice(1).map((n, i) => ({
      operator: "甲鉄道",
      from: names[i]!,
      to: n,
      km: 1,
    })),
  };
};

describe("fillFromRealChains の報告", () => {
  it("置き換えた数・延びた合計・例を返し、遠回りは無し", () => {
    const graph = build();
    const result = fillFromRealChains(graph, real, { maxRatio: 1.3 });
    expect(result.totalDelta).toBeCloseTo(0.38, 10);
    expect({ ...result, totalDelta: 0 }).toEqual({
      replaced: 1,
      totalDelta: 0,
      worst: [{ from: "大阪", to: "尼崎", before: 7.32, after: 7.7 }],
      skippedDetour: 0,
      detours: [],
    });
  });

  it("遠回りで使わなかった辺を、推定とつないだ長さつきで数える", () => {
    const graph = build();
    graph.edges[2]!.km = 5.0;
    const result = fillFromRealChains(graph, real, { maxRatio: 1.3 });
    expect(result).toEqual({
      replaced: 0,
      totalDelta: 0,
      worst: [],
      skippedDetour: 1,
      detours: [
        { from: "大阪", to: "尼崎", km: 5.0, chain: expect.closeTo(7.7, 10) },
      ],
    });
  });

  it("推定の5倍を超えないと結べない辺は、遠回りにも数えない", () => {
    const graph = build();
    graph.edges[2]!.km = 1.5; // 7.7 / 1.5 ≒ 5.13
    const result = fillFromRealChains(graph, real, { maxRatio: 1.3 });
    expect(graph.edges[2]!.km).toBe(1.5);
    expect(result.skippedDetour).toBe(0);
    expect(result.detours).toEqual([]);
  });

  it("つないだ長さが上限ちょうどなら置き換える", () => {
    const { graph, real: chain } = lineGraph(["A", "B", "C"], [["A", "C", 2]]);
    const result = fillFromRealChains(graph, chain, { maxRatio: 1 });
    expect(result.replaced).toBe(1);
    expect(graph.edges[2]!.km).toBe(2);
  });

  it("例は延び縮みの大きい順（縮んだ辺も大きさで比べる）", () => {
    const { graph, real: chain } = lineGraph(
      ["A", "B", "C", "D", "E"],
      [
        ["A", "E", 3.5], // 4 になって +0.5
        ["B", "D", 1.7], // 2 になって +0.3
        ["A", "C", 2.6], // 2 になって -0.6
      ],
    );
    const result = fillFromRealChains(graph, chain, { maxRatio: 1.3 });
    expect(result.worst.map((w) => `${w.from}-${w.to}`)).toEqual([
      "A-C",
      "A-E",
      "B-D",
    ]);
    expect(result.totalDelta).toBeCloseTo(0.2, 10);
  });

  it("遠回りの例は、つないだ長さ / 推定 の大きい順", () => {
    const { graph, real: chain } = lineGraph(
      ["A", "B", "C", "D", "E"],
      [
        // 倍率の順と、推定の長さの順・つないだ長さの順がそれぞれ違う組
        ["A", "C", 1.0], // 2倍
        ["A", "E", 1.25], // 3.2倍
        ["B", "D", 0.5], // 4倍
      ],
    );
    const result = fillFromRealChains(graph, chain, { maxRatio: 1.3 });
    expect(result.detours.map((d) => `${d.from}-${d.to}`)).toEqual([
      "B-D",
      "A-E",
      "A-C",
    ]);
  });

  it("例は10件まで。置き換えた数は全件", () => {
    const names = Array.from({ length: 13 }, (_, i) => `S${i}`);
    const express = names
      .slice(0, 11)
      .map((n, i): [string, string, number] => [n, names[i + 2]!, 1.9]);
    const { graph, real: chain } = lineGraph(names, express);
    const result = fillFromRealChains(graph, chain, { maxRatio: 1.3 });
    expect(result.replaced).toBe(11);
    expect(result.worst).toHaveLength(10);
  });
});

describe("fillFromRealChains の経路探索", () => {
  // A から T へは Q-R 経由（3km）と P 経由（6km）がある。先に見つかる側でなく
  // 短い側を返す。駅数の少ない P 経由を先に取り出すと 6km になる
  it("駅数が多くても短い経路の長さで置き換える", () => {
    const graph: RailGraph = {
      nodes: Object.fromEntries(
        [node("a", "A", "快速"), node("t", "T", "快速")].map((n) => [n.id, n]),
      ),
      edges: [{ from: "a", to: "t", km: 3, kind: "rail", operator: "甲鉄道" }],
    };
    const chain: StationKmEdge[] = [
      ["A", "Q", 1],
      ["Q", "R", 1],
      ["R", "T", 1],
      ["A", "P", 1],
      ["P", "T", 5],
    ].map(([from, to, km]) => ({
      operator: "甲鉄道",
      from: from as string,
      to: to as string,
      km: km as number,
    }));
    fillFromRealChains(graph, chain, { maxRatio: 3 });
    expect(graph.edges[0]!.km).toBe(3);
  });
});

describe("fillFromRealChains が触らない辺", () => {
  it("乗換の辺は、実営業キロで結べても書き換えない", () => {
    const graph = build();
    graph.edges[2]!.kind = "transfer";
    const result = fillFromRealChains(graph, real, { maxRatio: 1.3 });
    expect(graph.edges[2]!.km).toBe(7.32);
    expect(result.replaced).toBe(0);
  });

  it("同じ駅名どうしの辺は 0km にしない", () => {
    const graph = build();
    graph.nodes["x1"] = node("x1", "大阪", "別線");
    graph.edges.push({
      from: "l1",
      to: "x1",
      km: 0.5,
      kind: "rail",
      operator: "甲鉄道",
    });
    fillFromRealChains(graph, real, { maxRatio: 1.3 });
    expect(graph.edges[3]!.km).toBe(0.5);
  });

  it("グラフに無い駅を指す辺は飛ばす", () => {
    for (const [from, to] of [
      ["l1", "missing"],
      ["missing", "l3"],
    ] as const) {
      const graph = build();
      graph.edges.push({ from, to, km: 1, kind: "rail", operator: "甲鉄道" });
      const result = fillFromRealChains(graph, real, { maxRatio: 1.3 });
      expect(graph.edges[3]!.km).toBe(1);
      expect(result.replaced).toBe(1);
    }
  });
});
