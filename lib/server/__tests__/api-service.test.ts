import { describe, expect, it } from "vitest";
import { createGraphStore } from "@/lib/server/graph-store";
import {
  nearestStation,
  reachable,
  suggestStations,
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
});

describe("nearestStation", () => {
  it("最も近い駅を返す", () => {
    expect(nearestStation(store, 35.684, 139.702).name).toBe("代々木");
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
