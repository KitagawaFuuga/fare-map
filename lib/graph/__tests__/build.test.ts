import { describe, expect, it } from "vitest";
import { buildGraph } from "@/lib/graph/build";

const input = {
  companies: [{ company_cd: "1", company_name: "テスト鉄道" }],
  lines: [{ line_cd: "L1", company_cd: "1", line_name: "テスト線" }],
  stations: [
    { station_cd: "S1", station_g_cd: "G1", station_name: "あ駅", line_cd: "L1", lon: "139.70", lat: "35.69" },
    { station_cd: "S2", station_g_cd: "G2", station_name: "い駅", line_cd: "L1", lon: "139.75", lat: "35.69" },
    // S3 は S1 と同一グループ（同名駅の別路線ノード想定）
    { station_cd: "S3", station_g_cd: "G1", station_name: "あ駅", line_cd: "L1", lon: "139.701", lat: "35.69" },
  ],
  joins: [{ line_cd: "L1", station_cd1: "S1", station_cd2: "S2" }],
};

describe("buildGraph", () => {
  it("join から rail エッジを距離付きで作る", () => {
    const g = buildGraph(input);
    const rail = g.edges.filter((e) => e.kind === "rail");
    expect(rail).toHaveLength(1);
    expect(rail[0]?.operator).toBe("テスト鉄道");
    expect(rail[0]?.km).toBeGreaterThan(3);
    expect(rail[0]?.km).toBeLessThan(6);
  });

  it("同一グループの駅間に transfer エッジを作る", () => {
    const g = buildGraph(input);
    const tr = g.edges.filter((e) => e.kind === "transfer");
    const pair = tr.find(
      (e) => (e.from === "S1" && e.to === "S3") || (e.from === "S3" && e.to === "S1"),
    );
    expect(pair).toBeDefined();
    expect(pair?.km).toBe(0);
  });

  it("ノードに事業者名・路線名が入る", () => {
    const g = buildGraph(input);
    expect(g.nodes["S1"]?.operator).toBe("テスト鉄道");
    expect(g.nodes["S1"]?.lineName).toBe("テスト線");
  });

  it("座標が欠損した駅（空文字/キー欠落）はノードにもエッジにも現れない", () => {
    const brokenInput = {
      companies: input.companies,
      lines: input.lines,
      stations: [
        ...input.stations,
        // lat が空文字 → Number("") = 0 になってしまう不正データ
        { station_cd: "S4", station_g_cd: "G4", station_name: "う駅", line_cd: "L1", lon: "139.80", lat: "" },
        // lon キー自体が欠落 → Number(undefined) = NaN になる不正データ
        { station_cd: "S5", station_g_cd: "G5", station_name: "え駅", line_cd: "L1", lat: "35.70" },
      ],
      joins: [
        ...input.joins,
        { line_cd: "L1", station_cd1: "S4", station_cd2: "S5" },
      ],
    };
    const g = buildGraph(brokenInput);
    expect(g.nodes["S4"]).toBeUndefined();
    expect(g.nodes["S5"]).toBeUndefined();
    const touchesBroken = g.edges.some(
      (e) => e.from === "S4" || e.to === "S4" || e.from === "S5" || e.to === "S5",
    );
    expect(touchesBroken).toBe(false);
  });
});
