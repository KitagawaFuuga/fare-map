import { describe, expect, it } from "vitest";
import { createGraphStore } from "@/lib/server/graph-store";
import { nearestStation, reachable, suggestStations } from "@/lib/server/api-service";
import type { RailGraph } from "@/lib/graph/types";

const node = (id: string, name: string, lat: number, lng: number, groupId = id) => ({
  id, groupId, name, lat, lng, lineId: "L1", lineName: "テスト線", operator: "テスト鉄道",
});

const graph: RailGraph = {
  nodes: {
    S1: node("S1", "新宿", 35.690, 139.700),
    S2: node("S2", "代々木", 35.683, 139.702),
    S3: node("S3", "新宿", 35.691, 139.699, "G1"), // 別路線の同名駅
  },
  edges: [
    { from: "S1", to: "S2", km: 0.7, kind: "rail", operator: "テスト鉄道" },
    { from: "S1", to: "S3", km: 0, kind: "transfer", operator: "" },
  ],
};
const rules = [{ id: "t", operators: [], table: [[10, 150]] as [number, number][], beyond: { fromKm: 10, baseFare: 150, ratePerKm: 10 } }];
const store = createGraphStore(graph, rules);

describe("suggestStations", () => {
  it("駅名で検索でき同一グループは1件に集約される", () => {
    const r = suggestStations(store, "新宿");
    expect(r.length).toBeGreaterThanOrEqual(1);
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
});
