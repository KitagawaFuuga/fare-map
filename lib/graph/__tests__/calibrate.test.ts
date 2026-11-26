import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCalibration,
  calibratedKm,
  type CalibrationTable,
} from "@/lib/graph/calibrate";
import type { GraphEdge, RailGraph, StationNode } from "@/lib/graph/types";

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

// 以下は駅名・路線名・事業者を個別に指定できる組み立て部品
interface StOpts {
  name?: string;
  lineName?: string;
  operator?: string;
}
const st = (id: string, lineId: string, o: StOpts = {}): StationNode => ({
  id,
  groupId: id,
  name: o.name ?? id,
  lat: 35,
  lng: 139,
  lineId,
  lineName: o.lineName ?? "テスト線",
  operator: o.operator ?? "テスト鉄道",
});
const rail = (from: string, to: string, km: number): GraphEdge => ({
  from,
  to,
  km,
  kind: "rail",
  operator: "テスト鉄道",
});
const graphOf = (nodes: StationNode[], edges: GraphEdge[]): RailGraph => ({
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  edges,
});
const sec = (
  from: string,
  to: string,
  officialKm: number,
  line = "テスト線",
  operator = "テスト鉄道",
) => ({ operator, line, from, to, officialKm });

const abc = graphOf(
  [st("A", "L1"), st("B", "L1"), st("C", "L1")],
  [rail("A", "B", 5), rail("B", "C", 5)],
);

describe("buildCalibration の直線距離の求め方", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("区間の向きが線路の向きと逆でも同じ距離になる", () => {
    const t = buildCalibration(abc, [sec("C", "A", 12)]);
    expect(t.byLine["L1"]).toBeCloseTo(1.2, 10);
  });

  it("途中駅までの区間は途中駅までの距離で割る", () => {
    const t = buildCalibration(abc, [sec("A", "B", 6)]);
    expect(t.byLine["L1"]).toBeCloseTo(1.2, 10);
  });

  it("遠回りの道があっても最短の道のりを使う（近道を先に見つける形）", () => {
    // A→B→D が 2km、A→C→D が 20km
    const g = graphOf(
      [st("A", "L1"), st("B", "L1"), st("C", "L1"), st("D", "L1")],
      [
        rail("A", "B", 1),
        rail("B", "D", 1),
        rail("A", "C", 10),
        rail("C", "D", 10),
      ],
    );
    const t = buildCalibration(g, [sec("A", "D", 4)]);
    expect(t.byLine["L1"]).toBeCloseTo(2, 10);
  });

  it("遠回りの道があっても最短の道のりを使う（後から長い道が見つかる形）", () => {
    // A→C 1.5km の直通と A→B→C 2.5km の遠回り。T は C の先 1km
    const g = graphOf(
      [st("A", "L1"), st("B", "L1"), st("C", "L1"), st("T", "L1")],
      [
        rail("A", "B", 1),
        rail("A", "C", 1.5),
        rail("B", "C", 1.5),
        rail("C", "T", 1),
      ],
    );
    const t = buildCalibration(g, [sec("A", "T", 5)]);
    expect(t.byLine["L1"]).toBeCloseTo(2, 10);
  });

  it("同じ路線でも線路でつながっていない駅どうしの区間は使わない", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Z は線路が1本も無い駅
    const g = graphOf(
      [st("X", "L1"), st("Y", "L1"), st("Z", "L1")],
      [rail("X", "Y", 5)],
    );
    const t = buildCalibration(g, [sec("Z", "X", 5)]);
    expect(t.byLine).toEqual({});
    expect(t.fallback).toBe(1);
  });

  it("線路が1本も無い路線の区間は使わない", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = graphOf(
      [...Object.values(abc.nodes), st("P", "L2"), st("Q", "L2")],
      abc.edges,
    );
    const t = buildCalibration(g, [sec("P", "Q", 5)]);
    expect(t.byLine).toEqual({});
  });

  it("乗換の辺は距離に入れない", () => {
    const g = graphOf(Object.values(abc.nodes), [
      ...abc.edges,
      { from: "A", to: "C", km: 1, kind: "transfer", operator: "" },
    ]);
    const t = buildCalibration(g, [sec("A", "C", 12)]);
    expect(t.byLine["L1"]).toBeCloseTo(1.2, 10);
  });

  it("別の路線の駅へ伸びる線路は距離に入れない", () => {
    // A→Z→C と通れば 2km だが、Z は別の路線
    const g = graphOf(
      [...Object.values(abc.nodes), st("Z", "L2")],
      [...abc.edges, rail("A", "Z", 1), rail("C", "Z", 1)],
    );
    const t = buildCalibration(g, [sec("A", "C", 12)]);
    expect(t.byLine["L1"]).toBeCloseTo(1.2, 10);
  });

  it("グラフに無い駅を指す辺は無視する", () => {
    const g = graphOf(Object.values(abc.nodes), [
      rail("A", "無い駅", 1),
      rail("無い駅", "C", 1),
      ...abc.edges,
    ]);
    const t = buildCalibration(g, [sec("A", "C", 12)]);
    expect(t.byLine["L1"]).toBeCloseTo(1.2, 10);
  });

  it("同じ駅どうしの区間（距離0）は解決できなかった区間に数える", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = buildCalibration(abc, [sec("A", "A", 12)]);
    expect(t.byLine).toEqual({});
    expect(warn.mock.calls).toEqual([
      ["buildCalibration: 1 件の区間を解決できずスキップしました"],
    ]);
  });
});

describe("buildCalibration の路線の選び方", () => {
  // 甲・乙 の2駅が、路線名の違う2つの路線に乗っている
  const twoLines = (
    lineName1: string,
    km1: number,
    lineName2: string,
    km2: number,
  ) =>
    graphOf(
      [
        // 乙 の無い路線にも 甲 がある
        st("L3甲", "L3", { name: "甲", lineName: "別線" }),
        st("L1甲", "L1", { name: "甲", lineName: lineName1 }),
        st("L1乙", "L1", { name: "乙", lineName: lineName1 }),
        st("L2甲", "L2", { name: "甲", lineName: lineName2 }),
        st("L2乙", "L2", { name: "乙", lineName: lineName2 }),
      ],
      [rail("L1甲", "L1乙", km1), rail("L2甲", "L2乙", km2)],
    );

  it("路線名が一致する路線を、距離の短い別の路線より優先する", () => {
    const g = twoLines("JR中央線(快速)", 10, "中央本線", 8);
    const t = buildCalibration(g, [sec("甲", "乙", 12, "中央線")]);
    expect(t.byLine).toEqual({ L1: 1.2 });
  });

  it("全角カッコと前後の空白も外して路線名を比べる", () => {
    const g = twoLines("中央線 （快速）", 10, "中央本線", 8);
    const t = buildCalibration(g, [sec("甲", "乙", 12, "中央線")]);
    expect(t.byLine).toEqual({ L1: 1.2 });
  });

  it("JR は先頭にあるときだけ外す", () => {
    const g = twoLines("テストJR線", 10, "テスト本線", 8);
    const t = buildCalibration(g, [sec("甲", "乙", 12, "テスト線")]);
    // どちらも一致しないので短い L2 を採る
    expect(t.byLine).toEqual({ L2: 1.5 });
  });

  it("路線名が一致しなければ最短の候補を採り、同じ長さなら先の候補を採る", () => {
    const g = graphOf(
      ["LA", "LB", "LC"].flatMap((l) => [
        st(`${l}甲`, l, { name: "甲", lineName: `${l}線` }),
        st(`${l}乙`, l, { name: "乙", lineName: `${l}線` }),
      ]),
      [
        rail("LA甲", "LA乙", 9),
        rail("LB甲", "LB乙", 7),
        rail("LC甲", "LC乙", 7),
      ],
    );
    const t = buildCalibration(g, [sec("甲", "乙", 14, "無関係線")]);
    expect(t.byLine).toEqual({ LB: 2 });
  });

  it("分割前の1つの名前に別名が2つあっても、両方の路線を引ける", () => {
    const g = graphOf(
      [
        st("A", "L1", { operator: "テスト鉄道(本線)" }),
        st("B", "L1", { operator: "テスト鉄道(本線)" }),
        st("P", "L2", { operator: "テスト鉄道(市内線)" }),
        st("Q", "L2", { operator: "テスト鉄道(市内線)" }),
      ],
      [rail("A", "B", 5), rail("P", "Q", 5)],
    );
    const t = buildCalibration(
      g,
      [sec("A", "B", 6), sec("P", "Q", 7)],
      [
        { from: "テスト鉄道", to: "テスト鉄道(本線)" },
        { from: "テスト鉄道", to: "テスト鉄道(市内線)" },
      ],
    );
    expect(t.byLine["L1"]).toBeCloseTo(1.2, 10);
    expect(t.byLine["L2"]).toBeCloseTo(1.4, 10);
  });
});

describe("buildCalibration の係数の集め方", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const line5 = graphOf(
    ["A", "B", "C", "D", "E"].map((id) => st(id, "L1")),
    [
      rail("A", "B", 5),
      rail("B", "C", 5),
      rail("C", "D", 5),
      rail("D", "E", 5),
    ],
  );

  it("区間が偶数個なら、比を並べた真ん中2つの平均を係数にする", () => {
    // 比は 1.4, 1.0, 2.0, 1.2 の順に出る
    const t = buildCalibration(line5, [
      sec("A", "B", 7),
      sec("B", "C", 5),
      sec("C", "D", 10),
      sec("D", "E", 6),
    ]);
    expect(t.byLine["L1"]).toBeCloseTo(1.3, 10);
    expect(t.byOperator["テスト鉄道"]).toBeCloseTo(1.3, 10);
    expect(t.fallback).toBeCloseTo(1.3, 10);
  });

  it("区間が奇数個なら、比を並べた真ん中を係数にする", () => {
    // 比は 1.4, 1.0, 1.2 の順に出る
    const t = buildCalibration(line5, [
      sec("A", "B", 7),
      sec("B", "C", 5),
      sec("C", "D", 6),
    ]);
    expect(t.byLine["L1"]).toBeCloseTo(1.2, 10);
  });

  it("比がちょうど5なら採用し、5を超えると採らない", () => {
    expect(buildCalibration(abc, [sec("A", "C", 50)]).byLine).toEqual({
      L1: 5,
    });
    expect(buildCalibration(abc, [sec("A", "C", 50.5)]).byLine).toEqual({});
  });

  it("全区間を解決できたら警告を出さない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildCalibration(abc, [sec("A", "C", 12)]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("出典と、渡した区間の総数（解決できなかった分も含む）を記録する", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = buildCalibration(abc, [sec("A", "C", 12), sec("A", "無い駅", 1)]);
    expect(t.meta.source).toBe(
      "https://gtfs-gis.jp/railway_honsu/data/unkohonsu2026_kukan_sjis.csv",
    );
    expect(t.meta.sections).toBe(2);
    expect(t.meta.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("calibratedKm", () => {
  const table: CalibrationTable = {
    byLine: { L1: 1.1 },
    byOperator: { テスト鉄道: 1.3 },
    fallback: 1.05,
    meta: { source: "", fetchedAt: "", sections: 0 },
  };

  it("路線の係数があればそれを使う", () => {
    expect(calibratedKm(table, st("A", "L1"), 10)).toBeCloseTo(11, 10);
  });

  it("路線の係数が無ければ事業者の係数を使う", () => {
    expect(calibratedKm(table, st("A", "L9"), 10)).toBeCloseTo(13, 10);
  });

  it("どちらも無ければ全国中央値を使う", () => {
    expect(
      calibratedKm(table, st("A", "L9", { operator: "別会社" }), 10),
    ).toBeCloseTo(10.5, 10);
  });
});
