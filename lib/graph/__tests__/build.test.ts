import { describe, expect, it } from "vitest";
import { buildGraph } from "@/lib/graph/build";

const input = {
  companies: [{ company_cd: "1", company_name: "テスト鉄道" }],
  lines: [{ line_cd: "L1", company_cd: "1", line_name: "テスト線" }],
  stations: [
    {
      station_cd: "S1",
      station_g_cd: "G1",
      station_name: "あ駅",
      line_cd: "L1",
      lon: "139.70",
      lat: "35.69",
    },
    {
      station_cd: "S2",
      station_g_cd: "G2",
      station_name: "い駅",
      line_cd: "L1",
      lon: "139.75",
      lat: "35.69",
    },
    // S3 は S1 と同一グループ（同名駅の別路線ノード想定）
    {
      station_cd: "S3",
      station_g_cd: "G1",
      station_name: "あ駅",
      line_cd: "L1",
      lon: "139.701",
      lat: "35.69",
    },
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
      (e) =>
        (e.from === "S1" && e.to === "S3") ||
        (e.from === "S3" && e.to === "S1"),
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
        {
          station_cd: "S4",
          station_g_cd: "G4",
          station_name: "う駅",
          line_cd: "L1",
          lon: "139.80",
          lat: "",
        },
        // lon キー自体が欠落 → Number(undefined) = NaN になる不正データ
        {
          station_cd: "S5",
          station_g_cd: "G5",
          station_name: "え駅",
          line_cd: "L1",
          lat: "35.70",
        },
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
      (e) =>
        e.from === "S4" || e.to === "S4" || e.from === "S5" || e.to === "S5",
    );
    expect(touchesBroken).toBe(false);
  });
});

// 1事業者が運賃体系の異なる路線群を持つ場合の分割（札幌市電と地下鉄など）。
// lineId は station.csv 由来の内部IDで再生成時に振り直されうるため、
// 定義が実データと合わないときは黙って無効化されず例外になることを確認する。
describe("buildGraph の事業者分割 (operator-splits)", () => {
  const twoLines = {
    companies: [{ company_cd: "1", company_name: "テスト市交通局" }],
    lines: [
      { line_cd: "L1", company_cd: "1", line_name: "テスト地下鉄" },
      { line_cd: "L2", company_cd: "1", line_name: "テスト市電" },
    ],
    stations: [
      {
        station_cd: "S1",
        station_g_cd: "G1",
        station_name: "あ駅",
        line_cd: "L1",
        lon: "139.70",
        lat: "35.69",
      },
      {
        station_cd: "S2",
        station_g_cd: "G2",
        station_name: "い駅",
        line_cd: "L2",
        lon: "139.75",
        lat: "35.69",
      },
    ],
    joins: [],
  };

  it("指定した lineId のノードだけ事業者名が置き換わる", () => {
    const g = buildGraph(twoLines, [
      { lineId: "L2", from: "テスト市交通局", to: "テスト市交通局(市電)" },
    ]);
    expect(g.nodes["S1"]?.operator).toBe("テスト市交通局");
    expect(g.nodes["S2"]?.operator).toBe("テスト市交通局(市電)");
  });

  it("分割後の事業者名は rail エッジにも伝播する", () => {
    const withJoin = {
      ...twoLines,
      stations: [
        twoLines.stations[0]!,
        { ...twoLines.stations[1]!, station_cd: "S2" },
        {
          station_cd: "S3",
          station_g_cd: "G3",
          station_name: "う駅",
          line_cd: "L2",
          lon: "139.76",
          lat: "35.69",
        },
      ],
      joins: [{ line_cd: "L2", station_cd1: "S2", station_cd2: "S3" }],
    };
    const g = buildGraph(withJoin, [
      { lineId: "L2", from: "テスト市交通局", to: "テスト市交通局(市電)" },
    ]);
    const rail = g.edges.filter((e) => e.kind === "rail");
    expect(rail).toHaveLength(1);
    expect(rail[0]?.operator).toBe("テスト市交通局(市電)");
  });

  it("実データに存在しない lineId を指定したら例外（振り直しの検出）", () => {
    expect(() =>
      buildGraph(twoLines, [
        { lineId: "L99", from: "テスト市交通局", to: "テスト市交通局(市電)" },
      ]),
    ).toThrow(/存在しない lineId/);
  });

  it("lineId は実在するが事業者が想定と違う場合も例外", () => {
    expect(() =>
      buildGraph(twoLines, [
        { lineId: "L2", from: "別の会社", to: "テスト市交通局(市電)" },
      ]),
    ).toThrow(/事業者が想定と違います/);
  });

  it("分割定義が空なら従来どおり（既存の挙動を変えない）", () => {
    const g = buildGraph(twoLines);
    expect(g.nodes["S1"]?.operator).toBe("テスト市交通局");
    expect(g.nodes["S2"]?.operator).toBe("テスト市交通局");
  });
});
