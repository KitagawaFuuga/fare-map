import { describe, expect, it } from "vitest";
import {
  findReachable,
  tryInsertPareto,
  type ParetoEntry,
} from "@/lib/search/reachable";
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

  it("C-1再現: override非対象でも (stationId, segOperator) 粒度の枝刈りは初乗り二重取りを握り潰してはいけない", () => {
    // 上のテストから override を丸ごと外した版。isOverrideAnchor は override 0件なので
    // 常に false になり、旧実装は stationId+segOperator 粒度で枝刈りしてしまう。
    // M では「迂回(OpY経由, 160円, segFromId=P2)」が「直通(OpX, 200円, segFromId=Start)」より
    // 一時的に安いため、旧実装は直通側を握り潰す。
    // しかし真の最安は直通で Start→Z を 15km 通しにした estimate(OpX,15)=250円。
    // 迂回側しか残っていないと Z は 80(OpY)+200(OpX 2km) = 280円 になってしまう。
    const table: [number, number][] = [
      [5, 80],
      [10, 200],
      [15, 250],
    ];
    const calcNoOverride = createFareCalculator([
      {
        id: "test",
        operators: [],
        table,
        beyond: { fromKm: 15, baseFare: 250, ratePerKm: 50 },
      },
    ]);
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
    const result = findReachable(originGraph, calcNoOverride, "Start", 10000);
    const m = result.find((r) => r.id === "M");
    const z = result.find((r) => r.id === "Z");
    expect(m?.fare).toBe(160); // M 単体では迂回のほうが安いのでこれは正しい
    expect(z?.fare).toBe(250); // だが Z へは直通の方が本来安い
  });

  it("I-1再現: 予算超過を理由に途中で捨てると override による割安な遠方駅が消える", () => {
    // Start→Z の直線。距離表なら 10km=300円 だが override で Start→Z ペアに
    // 150円が設定されている。旧実装は M（途中経由点の運賃200円 > budget=190）で
    // 打ち切ってしまい、Z（override適用で150円、budget内）に到達できなくなる。
    const calcWithOverride = createFareCalculator(
      [
        {
          id: "test",
          operators: [],
          table: [
            [5, 200],
            [10, 300],
          ],
          beyond: { fromKm: 10, baseFare: 300, ratePerKm: 50 },
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
    const straightGraph: RailGraph = {
      nodes: { Start: node("Start"), M: node("M"), Z: node("Z") },
      edges: [
        { from: "Start", to: "M", km: 5, kind: "rail", operator: "OpX" },
        { from: "M", to: "Z", km: 5, kind: "rail", operator: "OpX" },
      ],
    };
    const full = findReachable(straightGraph, calcWithOverride, "Start", 10000);
    expect(full.find((r) => r.id === "Z")?.fare).toBe(150);
    expect(full.find((r) => r.id === "M")?.fare).toBe(200);

    const limited = findReachable(straightGraph, calcWithOverride, "Start", 190);
    const ids = limited.map((r) => r.id).sort();
    expect(ids).toEqual(["Start", "Z"]); // M(200円) は予算外だが Z(150円) は予算内で残るはず
  });

  it("レビュー指摘1再現: transfer 分岐で fare を再計算しないと stale な fare で override 状態を握り潰す", () => {
    // A --rail 5km(OpX)--> T,  A --rail 3km(OpX)--> S,  T --transfer 0km--> S
    // override: (A,T) = 100円 / 表: 5km以下=200円, 10km以下=300円
    //
    // T には2通りで到達できる:
    //   - 直通 A->T (5km): override(A,T)=100円、(doneFare=0, segKm=5)
    //   - 迂回 A->S(3km)->transfer->T: stationId が T に変わるだけで fare を
    //     再計算しないと、S 時点の fare=200(表引き、override非該当)が
    //     そのまま stale に持ち越されてしまう。(doneFare=0, segKm=3, fare=200 stale)
    //
    // stale な迂回状態は (doneFare=0, segKm=3) が (doneFare=0, segKm=5) を
    // segKm の小ささで支配してしまい、正しい override 適用済みの直通状態
    // (100円) を bucket から追い出す。fare を正しく再計算していれば
    // 迂回状態の実際の fare は estimate(OpX,3,A,T)=override(A,T)=100 になり、
    // 直通と同額（支配し合わない）になるはずで、最終的な T の最安値は 100円 のまま。
    const table: [number, number][] = [
      [5, 200],
      [10, 300],
    ];
    const calcOverride = createFareCalculator(
      [
        {
          id: "test",
          operators: [],
          table,
          beyond: { fromKm: 10, baseFare: 300, ratePerKm: 50 },
        },
      ],
      [
        {
          operator: "OpX",
          pairs: [{ from: "A", to: "T", fare: 100 }],
          source: { url: "", fetchedAt: "2026-08-29", note: "test" },
        },
      ],
    );
    const transferOverrideGraph: RailGraph = {
      nodes: { A: node("A"), T: node("T"), S: node("S") },
      edges: [
        { from: "A", to: "T", km: 5, kind: "rail", operator: "OpX" },
        { from: "A", to: "S", km: 3, kind: "rail", operator: "OpX" },
        { from: "T", to: "S", km: 0, kind: "transfer", operator: "" },
      ],
    };
    const result = findReachable(transferOverrideGraph, calcOverride, "A", 10000);
    expect(result.find((r) => r.id === "T")?.fare).toBe(100);
  });
});

describe("tryInsertPareto（同一キー内の非支配集合の管理）", () => {
  // 同一 (stationId, segOperator, segFromId) キー内では override 適用の可否が
  // km に依存しないため、doneFare・segKm ともに小さいほうが同等以上に有利になる
  // （運賃表は km について単調非減少で、override は駅名ペアのみで判定されるため）。
  // 「segKm が大きいほうが有利」という向きにすると、同じ路線を往復するだけで
  // segKm が単調増加する非支配状態を無限に生成し続け、探索が停止しなくなる。

  it("doneFare・segKm ともに小さい状態は、両方大きい状態を支配して締め出す", () => {
    const bucket: ParetoEntry[] = [];
    expect(tryInsertPareto(bucket, { doneFare: 100, segKm: 10, fare: 150, alive: true })).toBe(true);
    // 両方で劣るので挿入されない
    expect(tryInsertPareto(bucket, { doneFare: 200, segKm: 20, fare: 250, alive: true })).toBe(false);
    expect(bucket).toEqual([{ doneFare: 100, segKm: 10, fare: 150, alive: true }]);
  });

  it("新しい状態がより有利なら、既存の支配される状態を追い出して挿入する", () => {
    const bucket: ParetoEntry[] = [
      { doneFare: 200, segKm: 20, fare: 250, alive: true },
    ];
    expect(tryInsertPareto(bucket, { doneFare: 100, segKm: 10, fare: 150, alive: true })).toBe(true);
    expect(bucket).toEqual([{ doneFare: 100, segKm: 10, fare: 150, alive: true }]);
  });

  it("片方だけ有利（doneFare 小・segKm 大）なトレードオフはどちらも残す", () => {
    const bucket: ParetoEntry[] = [];
    expect(tryInsertPareto(bucket, { doneFare: 100, segKm: 20, fare: 150, alive: true })).toBe(true);
    expect(tryInsertPareto(bucket, { doneFare: 50, segKm: 30, fare: 200, alive: true })).toBe(true);
    expect(bucket).toHaveLength(2);
  });

  it("完全に同一の状態は重複して増えない（先着ちで既存が残る）", () => {
    const bucket: ParetoEntry[] = [];
    tryInsertPareto(bucket, { doneFare: 100, segKm: 10, fare: 150, alive: true });
    // doneFare・segKm が完全一致 => 相互支配なので既存で弾かれる
    expect(tryInsertPareto(bucket, { doneFare: 100, segKm: 10, fare: 150, alive: true })).toBe(false);
    expect(bucket).toHaveLength(1);
  });

  it("支配されて追い出された既存エントリは alive が false になる", () => {
    const bucket: ParetoEntry[] = [];
    tryInsertPareto(bucket, { doneFare: 200, segKm: 20, fare: 250, alive: true });
    const dominated = bucket[0];
    tryInsertPareto(bucket, { doneFare: 100, segKm: 10, fare: 150, alive: true });
    expect(dominated?.alive).toBe(false);
  });
});
