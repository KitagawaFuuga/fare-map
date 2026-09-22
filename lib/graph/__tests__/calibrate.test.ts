import { describe, expect, it } from "vitest";
import { buildCalibration, calibratedKm } from "@/lib/graph/calibrate";
import type { RailGraph } from "@/lib/graph/types";

// A-B-C が一直線に並び、直線距離の合計が 10km、実営業キロが 12km の路線
const node = (
  id: string,
  lat: number,
  lineId = "L1",
  operator = "テスト鉄道",
) => ({
  id,
  groupId: id,
  name: id,
  lat,
  lng: 139,
  lineId,
  lineName: "テスト線",
  operator,
});
const graph: RailGraph = {
  nodes: { A: node("A", 35.0), B: node("B", 35.045), C: node("C", 35.09) },
  edges: [
    { from: "A", to: "B", km: 5, kind: "rail", operator: "テスト鉄道" },
    { from: "B", to: "C", km: 5, kind: "rail", operator: "テスト鉄道" },
  ],
};
const sections = [
  {
    operator: "テスト鉄道",
    line: "テスト線",
    from: "A",
    to: "C",
    officialKm: 12,
  },
];

describe("buildCalibration", () => {
  it("路線の補正係数を 実営業キロ / 直線距離合計 で算出する", () => {
    const t = buildCalibration(graph, sections);
    expect(t.byLine["L1"]).toBeCloseTo(1.2, 2);
  });

  it("事業者単位の係数も持つ", () => {
    const t = buildCalibration(graph, sections);
    expect(t.byOperator["テスト鉄道"]).toBeCloseTo(1.2, 2);
  });

  it("該当区間が無い路線は fallback（全国中央値）になる", () => {
    const t = buildCalibration(graph, sections);
    const other = node("X", 35.0, "L9", "別会社");
    expect(calibratedKm(t, other, 10)).toBeCloseTo(10 * t.fallback, 2);
  });

  it("補正係数が路線 → 事業者 → fallback の優先順で選ばれる", () => {
    const t = buildCalibration(graph, sections);
    expect(calibratedKm(t, graph.nodes["A"]!, 10)).toBeCloseTo(12, 2);
  });

  it("異常な係数（0以下、5超）は採用せず fallback にする", () => {
    const bad = [
      {
        operator: "テスト鉄道",
        line: "テスト線",
        from: "A",
        to: "C",
        officialKm: 0,
      },
    ];
    const t = buildCalibration(graph, bad);
    expect(t.byLine["L1"]).toBeUndefined();
  });
});

// data/operator-splits.json で事業者名を分けた路線は、実営業キロのデータ側の事業者名
// （分割前）とグラフ側の事業者名（分割後）が食い違う。別名を渡さないと区間が解決できず、
// その路線だけ補正係数が路線・事業者のどちらにも載らないまま全国中央値に落ちる。
// 実際に富山地鉄の軌道線を分割したときこれが起きて、3路線の係数が静かに消えていた。
describe("buildCalibration と事業者分割", () => {
  const splitGraph: RailGraph = {
    nodes: {
      A: node("A", 35.0, "L1", "テスト鉄道(市内線)"),
      B: node("B", 35.045, "L1", "テスト鉄道(市内線)"),
      C: node("C", 35.09, "L1", "テスト鉄道(市内線)"),
    },
    edges: [
      {
        from: "A",
        to: "B",
        km: 5,
        kind: "rail",
        operator: "テスト鉄道(市内線)",
      },
      {
        from: "B",
        to: "C",
        km: 5,
        kind: "rail",
        operator: "テスト鉄道(市内線)",
      },
    ],
  };

  it("別名を渡さないと、分割した路線の係数が作られない", () => {
    const table = buildCalibration(splitGraph, sections);
    expect(table.byLine["L1"]).toBeUndefined();
    expect(table.byOperator["テスト鉄道(市内線)"]).toBeUndefined();
    // 係数が無いので全国中央値（この入力では1）に落ちる
    expect(calibratedKm(table, splitGraph.nodes["A"]!, 10)).toBe(10);
  });

  it("別名を渡せば、分割後の事業者名で係数が作られる", () => {
    const table = buildCalibration(splitGraph, sections, [
      { from: "テスト鉄道", to: "テスト鉄道(市内線)" },
    ]);
    expect(table.byLine["L1"]).toBeCloseTo(1.2, 5);
    expect(table.byOperator["テスト鉄道(市内線)"]).toBeCloseTo(1.2, 5);
    expect(calibratedKm(table, splitGraph.nodes["A"]!, 10)).toBeCloseTo(12, 5);
  });

  it("分割していない事業者は別名を渡しても従来どおり", () => {
    const table = buildCalibration(graph, sections, [
      { from: "テスト鉄道", to: "テスト鉄道(市内線)" },
    ]);
    expect(table.byLine["L1"]).toBeCloseTo(1.2, 5);
  });
});
