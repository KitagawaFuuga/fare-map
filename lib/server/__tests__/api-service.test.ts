import { describe, expect, it } from "vitest";
import { createGraphStore } from "@/lib/server/graph-store";
import {
  reachable,
  suggestStations,
  walkStationIds,
} from "@/lib/server/api-service";
import type { RailGraph } from "@/lib/graph/types";

const node = (
  id: string,
  name: string,
  lat: number,
  lng: number,
  groupId = id,
  lineName = "テスト線",
) => ({
  id,
  groupId,
  name,
  lat,
  lng,
  lineId: "L1",
  lineName,
  operator: "テスト鉄道",
});

// S1/S3 は同一グループ（新宿の別路線ノード）、S2/S4 も同一グループ（代々木の別路線ノード）
const graph: RailGraph = {
  nodes: {
    S1: node("S1", "新宿", 35.69, 139.7, "G_SHINJUKU"),
    S2: node("S2", "代々木", 35.683, 139.702, "G_YOYOGI"),
    S3: node("S3", "新宿", 35.691, 139.699, "G_SHINJUKU", "テスト線2"),
    S4: node("S4", "代々木", 35.686, 139.705, "G_YOYOGI", "テスト線2"),
  },
  edges: [
    { from: "S1", to: "S2", km: 0.7, kind: "rail", operator: "テスト鉄道" },
    { from: "S1", to: "S3", km: 0, kind: "transfer", operator: "" },
    { from: "S1", to: "S4", km: 2, kind: "rail", operator: "テスト鉄道" },
  ],
};
// 1km までは 150円、3km までは 300円（S2 経由は 150円・S4 経由は 300円になる想定）
const rules = [
  {
    id: "t",
    operators: [],
    table: [
      [1, 150],
      [3, 300],
    ] as [number, number][],
    beyond: { fromKm: 3, baseFare: 300, ratePerKm: 10 },
  },
];
const store = createGraphStore(graph, rules);

describe("suggestStations", () => {
  it("駅名で検索でき同一グループは1件に集約される", () => {
    const r = suggestStations(store, "新宿");
    // S1・S3 は同一グループ (G_SHINJUKU) の新宿駅なので代表 1 件のみ返る
    expect(r.length).toBe(1);
    expect(r[0]?.name).toBe("新宿");
  });

  it("候補に座標を含める（選んだ時点で出発駅を地図に描くため）", () => {
    const [shinjuku] = suggestStations(store, "新宿");
    expect(shinjuku).toMatchObject({ lat: 35.69, lng: 139.7 });
  });
});

describe("reachable", () => {
  it("予算内の駅を bracket 付きで返し、出発駅は含まない", () => {
    const r = reachable(store, "S1", 500);
    expect(r.stations.some((s) => s.id === "S1")).toBe(false);
    const yoyogi = r.stations.find((s) => s.name === "代々木");
    expect(yoyogi?.fare).toBe(150);
    expect(yoyogi?.bracket).toBe(0);
    expect(r.meta.count).toBe(r.stations.length);
  });

  it("出発駅と同一グループの別路線ノードも結果から除外される", () => {
    const r = reachable(store, "S1", 500);
    // S3 は S1 と同一グループ (G_SHINJUKU) の新宿駅なので、id 単位ではなく
    // groupId 単位で除外されないと漏れてしまう
    expect(r.stations.some((s) => s.id === "S3")).toBe(false);
    expect(r.stations.some((s) => s.name === "新宿")).toBe(false);
  });

  it("同一グループ内で複数の到達経路がある場合は最小運賃が採用される", () => {
    const r = reachable(store, "S1", 500);
    // 代々木グループ (G_YOYOGI) には S2 (150円) と S4 (300円) の2経路があるが、
    // 代表として採用されるのは fare が小さい S2 のみ
    const yoyogiEntries = r.stations.filter((s) => s.name === "代々木");
    expect(yoyogiEntries.length).toBe(1);
    expect(yoyogiEntries[0]?.id).toBe("S2");
    expect(yoyogiEntries[0]?.fare).toBe(150);
  });
});

// 徒歩連絡（groupId が異なる駅どうしの transfer エッジ）を含むグラフ。
// A社の終点 W1 から、別の駅 W2 まで歩いて B 社に乗り継げる形にする。
const walkGraph: RailGraph = {
  nodes: {
    W0: node("W0", "起点", 35.69, 139.7, "G_W0"),
    W1: node("W1", "乗換元", 35.683, 139.702, "G_W1"),
    W2: node("W2", "乗換先", 35.6832, 139.7022, "G_W2"),
    W3: node("W3", "目的地", 35.68, 139.71, "G_W3"),
    // 徒歩を使わずに W3 へ着く迂回路（高くつく）
    W4: node("W4", "迂回", 35.7, 139.72, "G_W4"),
  },
  edges: [
    { from: "W0", to: "W1", km: 0.5, kind: "rail", operator: "テスト鉄道" },
    // 徒歩連絡: groupId が異なる 0km transfer
    { from: "W1", to: "W2", km: 0, kind: "transfer", operator: "" },
    { from: "W2", to: "W3", km: 0.5, kind: "rail", operator: "テスト鉄道" },
    // 迂回路は距離が長く、同じ W3 に高い運賃で着く
    { from: "W0", to: "W4", km: 2.5, kind: "rail", operator: "テスト鉄道" },
    { from: "W4", to: "W3", km: 2.5, kind: "rail", operator: "テスト鉄道" },
  ],
};
const walkStore = createGraphStore(walkGraph, rules);

describe("walkStationIds（徒歩ありの判定）", () => {
  const res = reachable(walkStore, "W0", 2000);
  const walk = new Set(walkStationIds(walkStore, res));
  const idOf = (name: string) => res.stations.find((s) => s.name === name)?.id;

  it("運賃の結果には徒歩の判定を含めない（探索を1回で済ませるため）", () => {
    expect(res.stations.every((s) => !("viaWalk" in s))).toBe(true);
  });

  it("徒歩連絡を通らないと同じ運賃で行けない駅を返す", () => {
    expect(idOf("目的地")).toBeDefined();
    expect(walk.has(idOf("目的地")!)).toBe(true);
  });

  it("徒歩を使わずに着ける駅は返さない", () => {
    expect(walk.has(idOf("乗換元")!)).toBe(false);
    expect(walk.has(idOf("迂回")!)).toBe(false);
  });

  it("徒歩連絡が無いグラフでは何も返さない", () => {
    const r = reachable(store, "S1", 2000);
    expect(walkStationIds(store, r)).toEqual([]);
  });
});

describe("suggestStations の件数", () => {
  const many = createGraphStore(
    {
      nodes: {
        E1: node("E1", "東駅一", 35, 139),
        E2: node("E2", "東駅二", 35, 139),
        E3: node("E3", "東駅三", 35, 139),
        E4: node("E4", "東駅四", 35, 139),
      },
      edges: [],
    },
    rules,
  );

  it("別の駅が上限より多く当たれば、上限の件数だけ返す", () => {
    expect(suggestStations(many, "東駅", 2)).toHaveLength(2);
    expect(suggestStations(many, "東駅", 3)).toHaveLength(3);
  });
});

describe("reachable の例外とグラフに無い駅", () => {
  it("知らない出発駅は例外", () => {
    expect(() => reachable(store, "NOPE", 500)).toThrow("未知の駅: NOPE");
  });

  // 乗換の辺の片端がグラフに無い（M）。探索は M を通って Z に着く
  for (const [label, transfer] of [
    ["乗換の先", { from: "S1", to: "M" }],
    ["乗換の元", { from: "M", to: "S1" }],
  ] as const) {
    it(`${label}がグラフに無い駅でも、結果からその駅だけ除き、徒歩連絡とは見なさない`, () => {
      const s = createGraphStore(
        {
          nodes: {
            S1: node("S1", "出発", 35, 139, "G1"),
            Z: node("Z", "先", 35, 139, "GZ"),
          },
          edges: [
            { ...transfer, km: 0, kind: "transfer", operator: "" },
            {
              from: "M",
              to: "Z",
              km: 0.5,
              kind: "rail",
              operator: "テスト鉄道",
            },
          ],
        },
        rules,
      );
      const r = reachable(s, "S1", 500);
      expect(r.stations.map((x) => [x.id, x.fare])).toEqual([["Z", 150]]);
      expect(walkStationIds(s, r)).toEqual([]);
    });
  }
});

describe("walkStationIds の境目", () => {
  it("徒歩なしでは予算内に届かない駅も返す", () => {
    // 徒歩なら 乗換先 0.5km・目的地 1.0km でどちらも 150円。迂回は 目的地 5.0km で
    // 320円、乗換先はさらに先（どちらも予算 300円を超える）
    const r = reachable(walkStore, "W0", 300);
    expect(walkStationIds(walkStore, r)).toEqual(["W2", "W3"]);
  });

  it("結果にグラフに無い駅があれば、運賃を確かめられないので徒歩前提として返す", () => {
    const r = reachable(walkStore, "W0", 300);
    const ghost = { ...r.stations[0]!, id: "GHOST" };
    expect(
      walkStationIds(walkStore, { ...r, stations: [...r.stations, ghost] }),
    ).toEqual(["W2", "W3", "GHOST"]);
  });
});

describe("walkStationIds と同じ駅の乗換", () => {
  it("同じ駅の別路線ホームへの乗換は、徒歩連絡と見なさない", () => {
    // P1 と P2 は同じ駅（groupId が同じ）。X へは P2 からしか行けない
    const s = createGraphStore(
      {
        nodes: {
          P1: node("P1", "駅", 35, 139, "G_P"),
          P2: node("P2", "駅", 35, 139, "G_P", "テスト線2"),
          X: node("X", "先", 35, 139, "G_X"),
        },
        edges: [
          { from: "P1", to: "P2", km: 0, kind: "transfer", operator: "" },
          {
            from: "P2",
            to: "X",
            km: 0.5,
            kind: "rail",
            operator: "テスト鉄道",
          },
        ],
      },
      rules,
    );
    const r = reachable(s, "P1", 500);
    expect(r.stations.map((x) => x.id)).toEqual(["X"]);
    expect(walkStationIds(s, r)).toEqual([]);
  });
});
