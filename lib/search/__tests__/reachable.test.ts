import { describe, expect, it } from "vitest";
import { findReachable } from "@/lib/search/reachable";
import { createFareCalculator } from "@/lib/fare/calculator";
import type { RailGraph } from "@/lib/graph/types";

// 非線形な運賃表にすることで「距離合算」と「区間ごと加算」の結果が
// 異なるようにし、初乗り二重取り防止をテストで判別できるようにする。
// 20km を 1 区間として引くと 150 円、10km を 2 回引くと 200 円。
const calc = createFareCalculator([
  {
    id: "test",
    operators: [],
    table: [
      [10, 100],
      [20, 150],
      [30, 300],
    ],
    beyond: { fromKm: 30, baseFare: 300, ratePerKm: 10 },
  },
]);

// 事業者→運賃表マッピングが未検証だと、OpB がフォールバック表を引いていても
// 気づけない（createFareCalculator は未知事業者をサイレントにフォールバックへ
// 落とすため）。フォールバックと異なる OpB 専用表を持つ calculator を別途用意し、
// D の運賃がその専用表由来になることを判別できるようにする。
const calcWithOpB = createFareCalculator([
  {
    id: "test",
    operators: [],
    table: [
      [10, 100],
      [20, 150],
      [30, 300],
    ],
    beyond: { fromKm: 30, baseFare: 300, ratePerKm: 10 },
  },
  {
    id: "opb",
    operators: ["OpB"],
    table: [[10, 80]],
    beyond: { fromKm: 10, baseFare: 80, ratePerKm: 5 },
  },
]);

const node = (id: string) => ({
  id,
  groupId: id,
  name: id,
  lat: 35,
  lng: 139,
  lineId: "L",
  lineName: "L",
  operator: "OpA",
});

// A -10km- B -10km- C、C から OpB で -10km- D
const graph: RailGraph = {
  nodes: {
    A: node("A"),
    B: node("B"),
    C: node("C"),
    D: { ...node("D"), operator: "OpB" },
  },
  edges: [
    { from: "A", to: "B", km: 10, kind: "rail", operator: "OpA" },
    { from: "B", to: "C", km: 10, kind: "rail", operator: "OpA" },
    { from: "C", to: "D", km: 10, kind: "rail", operator: "OpB" },
  ],
};

describe("findReachable", () => {
  it("同一事業者は距離合算で運賃を出す（初乗り二重取りしない）", () => {
    const result = findReachable(graph, calc, "A", 10000);
    const c = result.find((r) => r.id === "C");
    expect(c?.fare).toBe(150); // 20km を 1 区間として表引き。区間ごと加算なら 200 になる
  });

  it("事業者が変わると区間を分けて加算する", () => {
    const result = findReachable(graph, calc, "A", 10000);
    const d = result.find((r) => r.id === "D");
    expect(d?.fare).toBe(250); // OpA 20km = 150 + OpB 10km = 100
  });

  it("予算内の駅だけ返す", () => {
    const result = findReachable(graph, calc, "A", 150);
    expect(result.map((r) => r.id).sort()).toEqual(["A", "B", "C"]);
  });

  it("出発駅は fare 0 で含まれ、結果は fare 昇順", () => {
    const result = findReachable(graph, calc, "A", 10000);
    expect(result[0]).toEqual({ id: "A", fare: 0 });
    const fares = result.map((r) => r.fare);
    expect([...fares].sort((x, y) => x - y)).toEqual(fares);
  });

  it("逆方向（無向）にも到達できる", () => {
    const result = findReachable(graph, calc, "C", 10000);
    expect(result.some((r) => r.id === "A")).toBe(true);
  });

  it("事業者ごとの運賃表マッピングが効いている（OpB 専用表を引く）", () => {
    const result = findReachable(graph, calcWithOpB, "A", 10000);
    const d = result.find((r) => r.id === "D");
    // OpA 20km = 150（フォールバック表） + OpB 10km = 80（OpB 専用表）
    // フォールバック表を誤って引くと OpB 10km = 100 になり 250 になってしまう
    expect(d?.fare).toBe(230);
  });

  it("transfer エッジは運賃・区間状態を引き継ぐ（区間が分断されない）", () => {
    // A -rail(OpA,10km)- B -transfer- B2 -rail(OpA,10km)- C
    const transferGraph: RailGraph = {
      nodes: { A: node("A"), B: node("B"), B2: node("B2"), C: node("C") },
      edges: [
        { from: "A", to: "B", km: 10, kind: "rail", operator: "OpA" },
        { from: "B", to: "B2", km: 0, kind: "transfer", operator: "" },
        { from: "B2", to: "C", km: 10, kind: "rail", operator: "OpA" },
      ],
    };
    const result = findReachable(transferGraph, calc, "A", 10000);
    const c = result.find((r) => r.id === "C");
    // 区間が引き継がれていれば 20km 一括で 150。分断されれば 10km を 2 回引いて 200 になる
    expect(c?.fare).toBe(150);
  });

  it("探索経由で特定運賃が適用される（区間全体の駅ペアに override があれば距離表より優先される）", () => {
    // A -5km- B -5km- C（OpA）。距離表なら 10km=300 円だが、
    // override で (A, C) ペアに 250 円が設定されているのでそちらが採用されるはず
    const calcWithOverride = createFareCalculator(
      [
        {
          id: "test",
          operators: [],
          table: [
            [5, 100],
            [10, 300],
            [20, 500],
          ],
          beyond: { fromKm: 20, baseFare: 500, ratePerKm: 10 },
        },
      ],
      [
        {
          operator: "OpA",
          pairs: [{ from: "A", to: "C", fare: 250 }],
          source: { url: "", fetchedAt: "2026-08-29", note: "test" },
        },
      ],
    );
    const abcGraph: RailGraph = {
      nodes: { A: node("A"), B: node("B"), C: node("C") },
      edges: [
        { from: "A", to: "B", km: 5, kind: "rail", operator: "OpA" },
        { from: "B", to: "C", km: 5, kind: "rail", operator: "OpA" },
      ],
    };
    const result = findReachable(abcGraph, calcWithOverride, "A", 10000);
    const c = result.find((r) => r.id === "C");
    expect(c?.fare).toBe(250);
  });

  it("区間の途中駅ペアには override が適用されない（区間全体の駅ペアでのみ判定する）", () => {
    // A -5km- B -5km- C（OpA）。override は (A,B)=999円 と (B,C)=111円 の
    // “途中駅ペア” に設定されているが、A→C は区間全体としては (A,C) ペアであり、
    // これらのどちらとも一致しないため距離表（10km=300円）が採用されるはず。
    // segFromId を使わず「直前の駅」を from として誤って引くバグがあれば
    // (B,C)=111 円になってしまい、このテストで判別できる。
    const calcWithMidOverride = createFareCalculator(
      [
        {
          id: "test",
          operators: [],
          table: [
            [5, 100],
            [10, 300],
            [20, 500],
          ],
          beyond: { fromKm: 20, baseFare: 500, ratePerKm: 10 },
        },
      ],
      [
        {
          operator: "OpA",
          pairs: [
            { from: "A", to: "B", fare: 999 },
            { from: "B", to: "C", fare: 111 },
          ],
          source: { url: "", fetchedAt: "2026-08-29", note: "test" },
        },
      ],
    );
    const abcGraph: RailGraph = {
      nodes: { A: node("A"), B: node("B"), C: node("C") },
      edges: [
        { from: "A", to: "B", km: 5, kind: "rail", operator: "OpA" },
        { from: "B", to: "C", km: 5, kind: "rail", operator: "OpA" },
      ],
    };
    const result = findReachable(abcGraph, calcWithMidOverride, "A", 10000);
    const c = result.find((r) => r.id === "C");
    expect(c?.fare).toBe(300);
  });

  it("transfer エッジの逆方向にも到達できる", () => {
    const transferGraph: RailGraph = {
      nodes: { A: node("A"), B: node("B"), B2: node("B2"), C: node("C") },
      edges: [
        { from: "A", to: "B", km: 10, kind: "rail", operator: "OpA" },
        { from: "B", to: "B2", km: 0, kind: "transfer", operator: "" },
        { from: "B2", to: "C", km: 10, kind: "rail", operator: "OpA" },
      ],
    };
    const result = findReachable(transferGraph, calc, "C", 10000);
    expect(result.some((r) => r.id === "A")).toBe(true);
  });

  it("由来（区間の起点駅）が違う同一駅の状態を安易な運賃比較で握り潰さない", () => {
    // 実データ（御陵→びわ湖浜大津）で発覚したバグを再現する合成グラフ。
    //
    //   Start(OpX) --rail(OpX,10km)-------------------------> M(OpX) --rail(OpX,5km)--> Z(OpX)
    //   Start(OpX) --transfer--> Start2(OpY) --rail(OpY,1km)--> P(OpY) --transfer--> P2(OpX) --rail(OpX,2km)--> M(OpX)
    //
    // M には2通りで到達できる:
    //   - 直通 (OpX を Start から乗り続け): 10km => 200円、segFromId=Start
    //   - 迂回 (OpY を1駅使って P2 で OpX に乗り換え): 80(OpY 1km) + 80(OpX 2km) = 160円、segFromId=P2
    // 迂回のほうが M での「今の運賃」は安い(160<200)。
    // stationId だけで枝刈りすると直通側(200円, segFromId=Start)が握り潰される。
    //
    // しかし OpX には Start→Z の特定運賃(150円)が override 登録されており、
    // これは segFromId=Start のまま OpX に乗り続けた場合にしか適用されない。
    // 迂回側は M で乗り換えているため segFromId=P2 になり、override は適用されず
    // 距離表で 80+200=280円 になる。
    //
    // 正しい最安値は 150円（直通 + override）。stationId だけで枝刈りすると
    // 直通状態が消え、280円しか見つからない。
    const table: [number, number][] = [
      [5, 80],
      [10, 200],
      [15, 250],
    ];
    const calcWithOverride = createFareCalculator(
      [
        {
          id: "test",
          operators: [],
          table,
          beyond: { fromKm: 15, baseFare: 250, ratePerKm: 50 },
        },
      ],
      [
        {
          operator: "OpX",
          pairs: [{ from: "Start", to: "Z", fare: 150 }],
          source: { url: "", fetchedAt: "2026-08-29", note: "test" },
        },
      ],
    );
    const originGraph: RailGraph = {
      nodes: {
        Start: node("Start"),
        Start2: { ...node("Start2"), operator: "OpY" },
        P: { ...node("P"), operator: "OpY" },
        P2: node("P2"),
        M: node("M"),
        Z: node("Z"),
      },
      edges: [
        { from: "Start", to: "M", km: 10, kind: "rail", operator: "OpX" },
        { from: "M", to: "Z", km: 5, kind: "rail", operator: "OpX" },
        { from: "Start", to: "Start2", km: 0, kind: "transfer", operator: "" },
        { from: "Start2", to: "P", km: 1, kind: "rail", operator: "OpY" },
        { from: "P", to: "P2", km: 0, kind: "transfer", operator: "" },
        { from: "P2", to: "M", km: 2, kind: "rail", operator: "OpX" },
      ],
    };
    const result = findReachable(originGraph, calcWithOverride, "Start", 10000);
    const z = result.find((r) => r.id === "Z");
    expect(z?.fare).toBe(150);
  });
});
