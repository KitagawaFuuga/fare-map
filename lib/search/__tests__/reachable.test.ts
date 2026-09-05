import { describe, expect, it } from "vitest";
import {
  findReachable,
  tryInsertPareto,
  __internalRunSearchForTest,
  type ParetoEntry,
  type __internalParetoStore,
} from "@/lib/search/reachable";
import type { FareCalculator } from "@/lib/fare/calculator";
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
    expect(tryInsertPareto(bucket, { doneFare: 100, totalKm: 10, totalEastKm: 0, pendingEastKm: 0, fare: 150, alive: true })).toBe(true);
    // 両方で劣るので挿入されない
    expect(tryInsertPareto(bucket, { doneFare: 200, totalKm: 20, totalEastKm: 0, pendingEastKm: 0, fare: 250, alive: true })).toBe(false);
    expect(bucket).toEqual([{ doneFare: 100, totalKm: 10, totalEastKm: 0, pendingEastKm: 0, fare: 150, alive: true }]);
  });

  it("新しい状態がより有利なら、既存の支配される状態を追い出して挿入する", () => {
    const bucket: ParetoEntry[] = [
      { doneFare: 200, totalKm: 20, totalEastKm: 0, pendingEastKm: 0, fare: 250, alive: true },
    ];
    expect(tryInsertPareto(bucket, { doneFare: 100, totalKm: 10, totalEastKm: 0, pendingEastKm: 0, fare: 150, alive: true })).toBe(true);
    expect(bucket).toEqual([{ doneFare: 100, totalKm: 10, totalEastKm: 0, pendingEastKm: 0, fare: 150, alive: true }]);
  });

  it("片方だけ有利（doneFare 小・segKm 大）なトレードオフはどちらも残す", () => {
    const bucket: ParetoEntry[] = [];
    expect(tryInsertPareto(bucket, { doneFare: 100, totalKm: 20, totalEastKm: 0, pendingEastKm: 0, fare: 150, alive: true })).toBe(true);
    expect(tryInsertPareto(bucket, { doneFare: 50, totalKm: 30, totalEastKm: 0, pendingEastKm: 0, fare: 200, alive: true })).toBe(true);
    expect(bucket).toHaveLength(2);
  });

  it("完全に同一の状態は重複して増えない（先着ちで既存が残る）", () => {
    const bucket: ParetoEntry[] = [];
    tryInsertPareto(bucket, { doneFare: 100, totalKm: 10, totalEastKm: 0, pendingEastKm: 0, fare: 150, alive: true });
    // doneFare・segKm が完全一致 => 相互支配なので既存で弾かれる
    expect(tryInsertPareto(bucket, { doneFare: 100, totalKm: 10, totalEastKm: 0, pendingEastKm: 0, fare: 150, alive: true })).toBe(false);
    expect(bucket).toHaveLength(1);
  });

  it("支配されて追い出された既存エントリは alive が false になる", () => {
    const bucket: ParetoEntry[] = [];
    tryInsertPareto(bucket, { doneFare: 200, totalKm: 20, totalEastKm: 0, pendingEastKm: 0, fare: 250, alive: true });
    const dominated = bucket[0];
    tryInsertPareto(bucket, { doneFare: 100, totalKm: 10, totalEastKm: 0, pendingEastKm: 0, fare: 150, alive: true });
    expect(dominated?.alive).toBe(false);
  });

  it("totalKm を無視すると、通算距離の大きい状態が小さい状態を誤って握り潰す（反映漏れの再現）", () => {
    // Task 9: SearchState に honshuKm/honshuEastKm を追加したが、これを
    // dominates() の比較に反映し忘れると、このプロジェクトで4回繰り返した
    // 「状態次元の追加が Pareto 判定に反映されない」欠陥類型が再発する。
    // 性能改善(b)で honshuKm・segKm は totalKm（両者の和）に統合されたが、
    // 「合計距離が違えば将来の運賃が変わりうる」という性質自体は変わらないため、
    // totalKm を dominates() で比較しないと「通算距離が小さい（有利な）」状態が
    // 「通算距離が大きい（不利な）」状態に誤って支配されてしまう、という
    // 同種の反映漏れが再発しうる。
    const bucket: ParetoEntry[] = [];
    // 先に「通算距離が大きい（不利な）」状態が入る
    const worse: ParetoEntry = {
      doneFare: 0,
      totalKm: 50,
      totalEastKm: 40,
      pendingEastKm: 40,
      fare: 999,
      alive: true,
    };
    expect(tryInsertPareto(bucket, worse)).toBe(true);
    // 後から「通算距離が小さい（有利な）」状態が来た場合、totalKm を見ていれば
    // worse を支配して追い出し、挿入されるはず。
    const better: ParetoEntry = {
      doneFare: 0,
      totalKm: 10,
      totalEastKm: 0,
      pendingEastKm: 0,
      fare: 500,
      alive: true,
    };
    expect(tryInsertPareto(bucket, better)).toBe(true);
    expect(bucket).toEqual([better]);
    expect(worse.alive).toBe(false);
  });

  // レビュー指摘2（Important）: honshuThrough=true かつ eastKm除外が現在
  // 適用中（加算額対象キロへの寄与が0）のバケットでは、totalEastKm が常に
  // honshuEastKm（segKmに依存しない）になるため、segKm/honshuKmの内訳が
  // totalKm/totalEastKmから復元できない。この状態で、除外が後から解除される
  // （ラチェットが落ちる）同一事業者エッジに当たると、内訳だけが違う2状態が
  // (doneFare, totalKm, totalEastKm) で完全に一致し相互支配になり、
  // 先着ちでsegKmの大きい（将来、除外解除時に加算額が多く乗る、不利な）方が
  // 残りうる。pendingEastKm（= totalEastKm + 除外中に隠れているsegKm）を
  // 追加の非strict次元として比較することで、segKmが小さい（有利な）方を
  // 正しく残す。
  it("pendingEastKm を無視すると、eastKm除外中に隠れた segKm の大小を区別できず、不利な状態が残りうる（反映漏れの再現）", () => {
    const bucket: ParetoEntry[] = [];
    // 除外中(totalEastKmはhonshuEastKm=0のまま)だが、隠れているsegKmが45と
    // 大きい（不利な）状態が先に入る
    const worse: ParetoEntry = {
      doneFare: 0,
      totalKm: 50,
      totalEastKm: 0,
      pendingEastKm: 45,
      fare: 900,
      alive: true,
    };
    expect(tryInsertPareto(bucket, worse)).toBe(true);
    // doneFare・totalKm・totalEastKmは完全に同じだが、隠れているsegKmが5と
    // 小さい（有利な）状態。pendingEastKmを見ていれば worse を支配して
    // 追い出し、挿入されるはず。見ていなければ相互支配で拒否されてしまう。
    const better: ParetoEntry = {
      doneFare: 0,
      totalKm: 50,
      totalEastKm: 0,
      pendingEastKm: 5,
      fare: 900,
      alive: true,
    };
    expect(tryInsertPareto(bucket, better)).toBe(true);
    expect(bucket).toEqual([better]);
    expect(worse.alive).toBe(false);
  });

  it("挿入が拒否された（false が返る）とき、渡した entry 自身の alive は変更されない", () => {
    // tryInsertPareto は「拒否されたエントリ」を書き換える必要はない
    // （そのエントリはどのbucketにも入らず捨てられるだけ）。ここが誤って
    // false にされていないかを直接確認する。
    const bucket: ParetoEntry[] = [];
    tryInsertPareto(bucket, { doneFare: 100, totalKm: 10, totalEastKm: 0, pendingEastKm: 0, fare: 150, alive: true });
    const rejected: ParetoEntry = { doneFare: 200, totalKm: 20, totalEastKm: 0, pendingEastKm: 0, fare: 250, alive: true };
    const inserted = tryInsertPareto(bucket, rejected);
    expect(inserted).toBe(false);
    expect(rejected.alive).toBe(true);
  });
});

// alive フラグは tryInsertPareto 単体では正しく動いても、findReachable 側の
// 「配線」（next.entry の差し替え、inserted 判定の位置、PENDING_ENTRY の扱い）が
// 壊れると事故が起きる。tryInsertPareto 単体のテストではこれらの配線ミスを
// 検出できないため、ここでは (1) 枝刈りを一切行わない素朴な参照実装との
// 結果一致、(2) 探索後の bucket 内不変条件、の2通りで配線ごと固定する。
describe("findReachable の alive フラグ配線（参照実装との一致・探索後の不変条件）", () => {
  // Pareto 支配による枝刈りを一切行わない素朴な参照実装。
  // findReachable 本体の状態遷移ロジック（rail/transfer/事業者切り替え）だけを
  // 借りたいところだが、「枝刈りを無効化した参照実装」であることが目的なので
  // ここで独立に組み直す（本体の実装をそのまま呼ぶと枝刈りごと再利用してしまい、
  // 配線が壊れたことを検出できなくなる）。
  // 停止性は budget が有限であることに依る lowerBound カットのみで確保する
  // （本体のコメント参照。Pareto 支配に依らない）。
  function naiveFindReachable(
    graph: RailGraph,
    calc: FareCalculator,
    fromId: string,
    budget: number,
  ) {
    type State = {
      stationId: string;
      doneFare: number;
      segOperator: string;
      segFromId: string;
      segKm: number;
      fare: number;
      // 直前に使った辺そのものを逆走しないようにするための記録。
      // グラフは無向（両方向にaddAdj）なので、これが無いと「同じ辺を
      // 行って戻って」を繰り返すだけで segKm が単調増加する状態が
      // 無限に生成され続け、終了しなくなる（override anchor 区間では
      // lowerBound が事業者最安値で頭打ちになり km について単調増加しない
      // ため、budget によるカットも効かない。lib/fare/calculator.ts の
      // lowerBound コメント参照）。この U ターンは doneFare・現在駅とも
      // 直前と完全に同じ状態を再生産するだけで新しい到達駅を一切生まない
      // （区間の起点駅名・現在駅名が変わらない以上 fare も変わらない）ため、
      // 除外しても最終結果には影響しない。
      arrivedVia?: {
        from: string;
        to: string;
        kind: "rail" | "transfer";
        operator: string;
        km: number;
      };
    };
    const adjacency = new Map<
      string,
      { to: string; km: number; kind: "rail" | "transfer"; operator: string }[]
    >();
    const addAdj = (
      from: string,
      to: string,
      km: number,
      kind: "rail" | "transfer",
      operator: string,
    ) => {
      const arr = adjacency.get(from) ?? [];
      arr.push({ to, km, kind, operator });
      adjacency.set(from, arr);
    };
    for (const e of graph.edges) {
      addAdj(e.from, e.to, e.km, e.kind, e.operator);
      addAdj(e.to, e.from, e.km, e.kind, e.operator);
    }
    const nameOf = (id: string): string | undefined => graph.nodes[id]?.name;

    const key = (s: State) =>
      `${s.stationId} ${s.segOperator} ${s.segFromId} ${s.doneFare} ${s.segKm}`;

    const initial: State = {
      stationId: fromId,
      doneFare: 0,
      segOperator: "",
      segFromId: fromId,
      segKm: 0,
      fare: 0,
    };
    const visited = new Set<string>([key(initial)]);
    const queue: State[] = [initial];
    let head = 0;
    const byStation = new Map<string, number>();

    while (head < queue.length) {
      const state = queue[head++];
      if (state === undefined) continue;
      if (state.fare <= budget) {
        const cur = byStation.get(state.stationId) ?? Infinity;
        if (state.fare < cur) byStation.set(state.stationId, state.fare);
      }
      for (const edge of adjacency.get(state.stationId) ?? []) {
        // 直前に使った辺をそのまま逆走するだけの手は打ち切る（結果に影響しない理由は
        // 上記コメント参照）。
        const via = state.arrivedVia;
        if (
          via !== undefined &&
          edge.to === via.from &&
          edge.kind === via.kind &&
          edge.operator === via.operator &&
          edge.km === via.km
        ) {
          continue;
        }
        const arrivedVia = {
          from: state.stationId,
          to: edge.to,
          kind: edge.kind,
          operator: edge.operator,
          km: edge.km,
        };
        let next: State;
        if (edge.kind === "transfer") {
          next = {
            stationId: edge.to,
            doneFare: state.doneFare,
            segOperator: state.segOperator,
            segFromId: state.segFromId,
            segKm: state.segKm,
            fare:
              state.doneFare +
              calc.estimate(
                state.segOperator,
                state.segKm,
                nameOf(state.segFromId),
                nameOf(edge.to),
              ),
            arrivedVia,
          };
        } else if (edge.operator === state.segOperator) {
          const segKm = state.segKm + edge.km;
          next = {
            stationId: edge.to,
            doneFare: state.doneFare,
            segOperator: state.segOperator,
            segFromId: state.segFromId,
            segKm,
            fare:
              state.doneFare +
              calc.estimate(
                state.segOperator,
                segKm,
                nameOf(state.segFromId),
                nameOf(edge.to),
              ),
            arrivedVia,
          };
        } else {
          const doneFare =
            state.doneFare +
            calc.estimate(
              state.segOperator,
              state.segKm,
              nameOf(state.segFromId),
              nameOf(state.stationId),
            );
          next = {
            stationId: edge.to,
            doneFare,
            segOperator: edge.operator,
            segFromId: state.stationId,
            segKm: edge.km,
            fare:
              doneFare +
              calc.estimate(
                edge.operator,
                edge.km,
                nameOf(state.stationId),
                nameOf(edge.to),
              ),
            arrivedVia,
          };
        }
        const segLowerBound = calc.lowerBound(
          next.segOperator,
          next.segKm,
          nameOf(next.segFromId),
        );
        if (next.doneFare + segLowerBound > budget) continue;
        const k = key(next);
        if (visited.has(k)) continue;
        visited.add(k);
        queue.push(next);
      }
    }

    return [...byStation.entries()]
      .map(([id, fare]) => ({ id, fare }))
      .sort((a, b) => a.fare - b.fare);
  }

  const sortResult = (r: { id: string; fare: number }[]) =>
    [...r].sort((a, b) => (a.id === b.id ? a.fare - b.fare : a.id.localeCompare(b.id)));

  it("由来違いの支配が起きる合成グラフで、findReachable の結果が枝刈り無効の参照実装と一致する", () => {
    // 「由来（区間の起点駅）が違う同一駅の状態を安易な運賃比較で握り潰さない」
    // テストと同じグラフを使う。M で迂回状態(160円)が直通状態(200円)より
    // 一時的に安く、Pareto支配が実際に発生する（迂回はdoneFare・segKmとも
    // 直通以下ではないので支配はしないが、bucketの非支配集合管理が働く）。
    const table: [number, number][] = [
      [5, 80],
      [10, 200],
      [15, 250],
    ];
    const calc = createFareCalculator(
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
    const node = (id: string, operator = "OpX") => ({
      id,
      groupId: id,
      name: id,
      lat: 35,
      lng: 139,
      lineId: "L",
      lineName: "L",
      operator,
    });
    const originGraph: RailGraph = {
      nodes: {
        Start: node("Start"),
        Start2: node("Start2", "OpY"),
        P: node("P", "OpY"),
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

    for (const budget of [50, 100, 150, 160, 200, 250, 280, 10000]) {
      const actual = findReachable(originGraph, calc, "Start", budget);
      const expected = naiveFindReachable(originGraph, calc, "Start", budget);
      expect(sortResult(actual)).toEqual(sortResult(expected));
    }
  });

  it("初乗り二重取り抑止・複数事業者・乗り換えを含む一般的なグラフでも参照実装と一致する", () => {
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
      {
        id: "opb",
        operators: ["OpB"],
        table: [[10, 80]],
        beyond: { fromKm: 10, baseFare: 80, ratePerKm: 5 },
      },
    ]);
    const node = (id: string, operator = "OpA") => ({
      id,
      groupId: id,
      name: id,
      lat: 35,
      lng: 139,
      lineId: "L",
      lineName: "L",
      operator,
    });
    const graph: RailGraph = {
      nodes: {
        A: node("A"),
        B: node("B"),
        C: node("C"),
        D: node("D", "OpB"),
      },
      edges: [
        { from: "A", to: "B", km: 10, kind: "rail", operator: "OpA" },
        { from: "B", to: "C", km: 10, kind: "rail", operator: "OpA" },
        { from: "C", to: "D", km: 10, kind: "rail", operator: "OpB" },
      ],
    };
    for (const budget of [100, 150, 200, 250, 10000]) {
      const actual = findReachable(graph, calc, "A", budget);
      const expected = naiveFindReachable(graph, calc, "A", budget);
      expect(sortResult(actual)).toEqual(sortResult(expected));
    }
  });

  function allEntries(store: __internalParetoStore): ParetoEntry[] {
    const entries: ParetoEntry[] = [];
    for (const byOperator of store.values()) {
      for (const byFrom of byOperator.values()) {
        for (const byFlags of byFrom.values()) {
          for (const bucket of byFlags.values()) {
            entries.push(...bucket);
          }
        }
      }
    }
    return entries;
  }

  it("探索後、store の全 bucket の全エントリが alive === true である（不変条件）", () => {
    // tryInsertPareto は支配されたエントリを splice で bucket から取り除く際に
    // alive=false にする。よって探索終了時点で bucket に残っているエントリは
    // 全て alive=true でなければならない。ここが崩れる典型的な事故は、
    // splice のタイミングをずらす／alive の更新を忘れる、といった変更。
    const table: [number, number][] = [
      [5, 80],
      [10, 200],
      [15, 250],
    ];
    const calc = createFareCalculator(
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
    const node = (id: string, operator = "OpX") => ({
      id,
      groupId: id,
      name: id,
      lat: 35,
      lng: 139,
      lineId: "L",
      lineName: "L",
      operator,
    });
    const originGraph: RailGraph = {
      nodes: {
        Start: node("Start"),
        Start2: node("Start2", "OpY"),
        P: node("P", "OpY"),
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
    const store = __internalRunSearchForTest(originGraph, calc, "Start", 10000);
    const entries = allEntries(store);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.alive).toBe(true);
    }
  });
});

// Task 9: JR本州3社（東日本・東海・西日本）をまたぐ場合は会社境界で区間を
// 確定せず、「基準額（総距離で1回引く）＋加算額（eastKmで1回引く）」の
// 通し運賃にする。「総距離が100kmを超えると加算額0円」は出典にない誤りだった
// ため廃止した（レビュー指摘1。詳細は task-9-report.md 参照）。
// 基準額表・加算額表は JR東海(HONSHU_BASE_OPERATOR)・合成事業者名
// "__jr-honshu-kasan" のルールから引かれる（lib/fare/calculator.ts 参照）。
// 非線形な運賃表にすることで、「初乗り二重取り（旧実装）」「通し運賃（新実装）」の
// 結果が必ず異なるようにしている。
describe("findReachable: JR本州3社をまたぐ通し運賃（基準額＋加算額方式）", () => {
  const honshuBaseTable: [number, number][] = [
    [10, 100],
    [20, 150],
    [30, 300],
    [50, 500],
    [110, 900],
  ];
  const honshuCalc = createFareCalculator([
    {
      id: "fallback",
      operators: [],
      table: [[10, 999999]],
      beyond: { fromKm: 10, baseFare: 999999, ratePerKm: 1 },
    },
    {
      // JR東海: 通し運賃の「基準額表」として参照される代表事業者。
      id: "jr-central",
      operators: ["JR東海"],
      table: honshuBaseTable,
      beyond: { fromKm: 110, baseFare: 900, ratePerKm: 5 },
    },
    {
      // JR西日本: 基準額表と同一の値（本物のデータでも一致が確認済み）。
      id: "jr-west",
      operators: ["JR西日本"],
      table: honshuBaseTable,
      beyond: { fromKm: 110, baseFare: 900, ratePerKm: 5 },
    },
    {
      // JR東日本: 単独事業者としての自社表はあえて基準額表と異なる（高い）値に
      // しておく。honshuKm=0（会社境界を跨いでいない）間はこちらが使われる
      // ことをテストで確認するため。
      id: "jr-east",
      operators: ["JR東日本"],
      table: [
        [10, 120],
        [20, 200],
        [30, 360],
        [60, 700],
      ],
      beyond: { fromKm: 60, baseFare: 700, ratePerKm: 8 },
    },
    {
      id: "jr-honshu-kasan",
      operators: ["__jr-honshu-kasan"],
      table: [
        [10, 10],
        [20, 20],
        [30, 30],
        [60, 70],
        [100, 110],
      ],
      beyond: { fromKm: 100, baseFare: 110, ratePerKm: 0 },
    },
    {
      id: "private-x",
      operators: ["PrivateX"],
      table: [[5, 50]],
      beyond: { fromKm: 5, baseFare: 50, ratePerKm: 10 },
    },
  ]);

  const jrNode = (id: string, operator: string) => ({
    id,
    groupId: id,
    name: id,
    lat: 35,
    lng: 139,
    lineId: "L",
    lineName: "L",
    operator,
  });

  it("JR東日本→JR東海（100km以下）: 会社ごとの初乗りではなく通算距離の基準額＋加算額になる", () => {
    // A --JR東日本10km--> B --JR東海10km--> C。総距離20km・JR東日本区間10km。
    // 通し: 基準額(20km)=150 + 加算額(10km)=10 = 160円。
    // 会社ごとの初乗り（旧実装・修正前）だと JR東日本 10km=120（自社表）+
    // JR東海 10km=100（自社表）= 220円になってしまう。
    const graph: RailGraph = {
      nodes: {
        A: jrNode("A", "JR東日本"),
        B: jrNode("B", "JR東日本"),
        C: jrNode("C", "JR東海"),
      },
      edges: [
        { from: "A", to: "B", km: 10, kind: "rail", operator: "JR東日本" },
        { from: "B", to: "C", km: 10, kind: "rail", operator: "JR東海" },
      ],
    };
    const result = findReachable(graph, honshuCalc, "A", 10000);
    expect(result.find((r) => r.id === "C")?.fare).toBe(160);
  });

  it("会社境界が0km transferエッジで表現されていても通し運賃になる（熱海のような実データの構造）", () => {
    // 実データでは会社境界は同一物理駅を表す2つのノード間の0km transferエッジで
    // 表現される（例: 熱海）。rail エッジで直接事業者が変わる場合と同じ結果になる
    // ことを確認する。
    const graph: RailGraph = {
      nodes: {
        A: jrNode("A", "JR東日本"),
        B: jrNode("B", "JR東日本"),
        B2: jrNode("B2", "JR東海"),
        C: jrNode("C", "JR東海"),
      },
      edges: [
        { from: "A", to: "B", km: 10, kind: "rail", operator: "JR東日本" },
        { from: "B", to: "B2", km: 0, kind: "transfer", operator: "" },
        { from: "B2", to: "C", km: 10, kind: "rail", operator: "JR東海" },
      ],
    };
    const result = findReachable(graph, honshuCalc, "A", 10000);
    expect(result.find((r) => r.id === "C")?.fare).toBe(160);
  });

  it("総距離が100kmを超えても加算額は0円にならない（レビュー指摘の修正確認）", () => {
    // A --JR東日本60km--> B --JR東海50km--> C。総距離110km(>100km)、eastKm=60km。
    // 通し: 基準額(110km)=900円 + 加算額(60km)=70円 = 970円。
    // 修正前は totalKm>100 の場合に加算額を強制的に0円にしていたため900円になっていた
    // （task-9-report.md記載の通り、修正前にこのテストを実行すると
    // 「expected 970 to be 900」で落ちることを確認済み）。
    // 会社ごとの初乗りだと JR東日本60km=700（自社表、beyond式）+
    // JR東海50km=500（自社表）= 1,200円になってしまう（いずれとも異なることも確認）。
    const graph: RailGraph = {
      nodes: {
        A: jrNode("A", "JR東日本"),
        B: jrNode("B", "JR東日本"),
        C: jrNode("C", "JR東海"),
      },
      edges: [
        { from: "A", to: "B", km: 60, kind: "rail", operator: "JR東日本" },
        { from: "B", to: "C", km: 50, kind: "rail", operator: "JR東海" },
      ],
    };
    const result = findReachable(graph, honshuCalc, "A", 10000);
    expect(result.find((r) => r.id === "C")?.fare).toBe(970);
  });

  it("JR東日本→JR東海→JR西日本（3社またぎ）でも会社境界のたびに確定せず通算が続く", () => {
    // 総距離30km・JR東日本区間10km。基準額(30km)=300 + 加算額(10km)=10 = 310円。
    const graph: RailGraph = {
      nodes: {
        A: jrNode("A", "JR東日本"),
        B: jrNode("B", "JR東日本"),
        C: jrNode("C", "JR東海"),
        D: jrNode("D", "JR西日本"),
      },
      edges: [
        { from: "A", to: "B", km: 10, kind: "rail", operator: "JR東日本" },
        { from: "B", to: "C", km: 10, kind: "rail", operator: "JR東海" },
        { from: "C", to: "D", km: 10, kind: "rail", operator: "JR西日本" },
      ],
    };
    const result = findReachable(graph, honshuCalc, "A", 10000);
    expect(result.find((r) => r.id === "D")?.fare).toBe(310);
  });

  it("会社境界を跨がない単一JR会社の乗車は通し方式を使わず、従来どおり自社の運賃表を使う", () => {
    // A --JR東日本10km--> B（会社境界を跨いでいない＝honshuKm=0のまま）。
    // 通し方式（基準額表=10km:100円）ではなく、JR東日本の自社表(10km:120円)が
    // 使われるはず。honshuKm>0の条件を付け忘れて常に通し方式を使ってしまう
        // 回帰を防ぐ。
    const graph: RailGraph = {
      nodes: { A: jrNode("A", "JR東日本"), B: jrNode("B", "JR東日本") },
      edges: [{ from: "A", to: "B", km: 10, kind: "rail", operator: "JR東日本" }],
    };
    const result = findReachable(graph, honshuCalc, "A", 10000);
    expect(result.find((r) => r.id === "B")?.fare).toBe(120);
  });

  it("JR⇔私鉄の切り替えは対象外で、従来どおり会社境界で区間を確定する", () => {
    // A --JR東日本10km--> B --PrivateX5km--> C。
    // JR東日本区間は自社表(10km=120)、PrivateX区間は自社表(5km=50)で
    // それぞれ初乗りから計算され、合計170円になるはず（通し方式は使われない）。
    const graph: RailGraph = {
      nodes: {
        A: jrNode("A", "JR東日本"),
        B: jrNode("B", "JR東日本"),
        C: jrNode("C", "PrivateX"),
      },
      edges: [
        { from: "A", to: "B", km: 10, kind: "rail", operator: "JR東日本" },
        { from: "B", to: "C", km: 5, kind: "rail", operator: "PrivateX" },
      ],
    };
    const result = findReachable(graph, honshuCalc, "A", 10000);
    expect(result.find((r) => r.id === "C")?.fare).toBe(170);
  });

  it("JR本州3社をまたいだ後に私鉄へ乗り継ぐと、通し運賃が確定してから私鉄区間が加算される", () => {
    // A --JR東日本10km--> B --JR東海10km--> C --PrivateX5km--> D。
    // C までは通し運賃 160円（1つ目のテストと同じ）で確定し、
    // そこから PrivateX 5km=50円が追加されて 210円になるはず。
    // segmentFare を使わず単純に calc.estimate(直前のJR会社の自社表) で
    // 確定してしまう回帰があると、ここが 160 にならず別の値になる。
    const graph: RailGraph = {
      nodes: {
        A: jrNode("A", "JR東日本"),
        B: jrNode("B", "JR東日本"),
        C: jrNode("C", "JR東海"),
        D: jrNode("D", "PrivateX"),
      },
      edges: [
        { from: "A", to: "B", km: 10, kind: "rail", operator: "JR東日本" },
        { from: "B", to: "C", km: 10, kind: "rail", operator: "JR東海" },
        { from: "C", to: "D", km: 5, kind: "rail", operator: "PrivateX" },
      ],
    };
    const result = findReachable(graph, honshuCalc, "A", 10000);
    expect(result.find((r) => r.id === "D")?.fare).toBe(210);
  });

  // レビュー指摘1: 「東京都区内・山手線内〜東京(品川)～熱海間は新幹線(JR東海)経由と
  // して計算するためJR東日本分の加算はない」という規則(出典:
  // https://ameblo.jp/yyrapid/entry-12937999551.html)を、実データの構造
  // （lineId "11301"=JR東海道本線 東京～熱海、"11302"=JR山手線）で再現する。
  describe("eastKm除外規則（東京都区内・山手線内〜東京～熱海間は加算額の対象外）", () => {
    // name を id と独立に指定できるようにしている（実データでは同じ物理駅が
    // 路線ごとに別ノードIDを持つため、id !== name のケースを正しく表現するため）。
    const tokaidoNode = (
      id: string,
      name: string,
      operator: string,
      lineId: string,
    ) => ({
      id,
      groupId: id,
      name,
      lat: 35,
      lng: 139,
      lineId,
      lineName: "L",
      operator,
    });

    it("東京～熱海間相当のJR東日本区間はeastKmから除外され、加算額に反映されない", () => {
      // Tokyo(11301)--JR東日本60km-->Atami(11301)--JR東海50km-->C。
      // 総距離110km・eastKm=0（東京～熱海間の在来線=lineId 11301のため除外）。
      // 通し: 基準額(110km)=900円のみ（加算額表[0]=対象外のため0円）。
      // 除外がなければ前のテストと同じく970円になってしまう。
      //
      // 実データでは同じ物理駅（東京）が lineId 11301（東海道本線）と
      // 11302（山手線）の両方に別ノードとして存在する。ここでも
      // TokyoYamanote（lineId 11302・同名"Tokyo"）を無関係ノードとして
      // 追加し、「起点の駅名が山手線内駅集合に属するか」の判定が
      // 実データの構造どおりに機能することを確認する。
      const graph: RailGraph = {
        nodes: {
          Tokyo: tokaidoNode("Tokyo", "Tokyo", "JR東日本", "11301"),
          TokyoYamanote: tokaidoNode("TokyoYamanote", "Tokyo", "JR東日本", "11302"),
          Atami: tokaidoNode("Atami", "Atami", "JR東日本", "11301"),
          C: jrNode("C", "JR東海"),
        },
        edges: [
          { from: "Tokyo", to: "Atami", km: 60, kind: "rail", operator: "JR東日本" },
          { from: "Atami", to: "C", km: 50, kind: "rail", operator: "JR東海" },
        ],
      };
      const result = findReachable(graph, honshuCalc, "Tokyo", 10000);
      expect(result.find((r) => r.id === "C")?.fare).toBe(900);
    });

    it("山手線内(lineId 11302)からの区間もeastKmから除外される", () => {
      const graph: RailGraph = {
        nodes: {
          Shinjuku: tokaidoNode("Shinjuku", "Shinjuku", "JR東日本", "11302"),
          Tokyo: tokaidoNode("Tokyo", "Tokyo", "JR東日本", "11302"),
          C: jrNode("C", "JR東海"),
        },
        edges: [
          { from: "Shinjuku", to: "Tokyo", km: 10, kind: "rail", operator: "JR東日本" },
          { from: "Tokyo", to: "C", km: 20, kind: "rail", operator: "JR東海" },
        ],
      };
      const result = findReachable(graph, honshuCalc, "Shinjuku", 10000);
      // 総距離30km・eastKm=0（山手線内のため除外） => 基準額(30km)=300円のみ
      expect(result.find((r) => r.id === "C")?.fare).toBe(300);
    });

    it("lineIdが対象外（通常のJR東日本区間）ならeastKmは通常どおり積まれる（回帰確認）", () => {
      // "L"という無関係のlineIdのJR東日本区間は除外対象ではないので、
      // 通常どおり加算額の対象になるはず（前段の「100kmを超えても加算額は0円に
      // ならない」テストと同じ構図をlineId付きノードで再確認する）。
      const graph: RailGraph = {
        nodes: {
          A: jrNode("A", "JR東日本"),
          B: jrNode("B", "JR東日本"),
          C: jrNode("C", "JR東海"),
        },
        edges: [
          { from: "A", to: "B", km: 60, kind: "rail", operator: "JR東日本" },
          { from: "B", to: "C", km: 50, kind: "rail", operator: "JR東海" },
        ],
      };
      const result = findReachable(graph, honshuCalc, "A", 10000);
      expect(result.find((r) => r.id === "C")?.fare).toBe(970);
    });

    it("除外区間の後に通常区間が混在すると、除外区間分の距離も加算額に含めてしまう（安全側の近似の限界）", () => {
      // Tokyo(11301)--JR東日本60km-->Atami(11301)--JR東日本10km-->X(lineId "L")
      // --JR東海40km--> C。
      //
      // 本来の趣旨に忠実に計算するなら、除外されるのはTokyo→Atami分(60km)のみで
      // eastKmはAtami→X分の10kmだけになるはずだが、本実装のsegEastExcludedは
      // 「除外区間でないエッジに一度でも当たったら区間の残り全体で恒久的にfalseに
      // なる」一方向ラチェットのため、Atami→X（除外対象外のlineId）で除外フラグが
      // 落ちた時点で、それ以前の60km分も含めた区間全体(70km)がeastKmに算入されて
      // しまう。これは「絶対に安全側（過大評価はしても過小評価はしない）」設計上の
      // トレードオフであり、意図的な近似である（コメント参照）。
      const graph: RailGraph = {
        nodes: {
          Tokyo: tokaidoNode("Tokyo", "Tokyo", "JR東日本", "11301"),
          TokyoYamanote: tokaidoNode("TokyoYamanote", "Tokyo", "JR東日本", "11302"),
          Atami: tokaidoNode("Atami", "Atami", "JR東日本", "11301"),
          X: jrNode("X", "JR東日本"), // lineId "L"（対象外）
          C: jrNode("C", "JR東海"),
        },
        edges: [
          { from: "Tokyo", to: "Atami", km: 60, kind: "rail", operator: "JR東日本" },
          { from: "Atami", to: "X", km: 10, kind: "rail", operator: "JR東日本" },
          { from: "X", to: "C", km: 40, kind: "rail", operator: "JR東海" },
        ],
      };
      const result = findReachable(graph, honshuCalc, "Tokyo", 10000);
      // 総距離110km(60+10+40)・eastKm=70km(Tokyo→X全体。除外区間60km分も
      // 算入されてしまう安全側の近似)。基準額(110km)=900 + 加算額(70km、
      // 61〜100km帯)=110 = 1010円。
      expect(result.find((r) => r.id === "C")?.fare).toBe(1010);
    });

    // レビュー指摘（過小評価バグ）: isEastKmExcludedEdge は両端ノードの lineId
    // だけを見ており、「乗車が東京都区内・山手線内発か」を一切見ていなかった。
    // lineId "11301"（JR東海道本線 東京〜熱海）には小田原・大船・藤沢・平塚・
    // 湯河原・横浜など、東京都区内でも山手線内でもない駅が含まれるため、
    // これらの駅を起点にしても除外が発動し、加算額が丸ごと0円になってしまう
    // （過小評価）。まず修正前に失敗することを確認する。
    it("小田原（東京都区内・山手線内ではない）を起点にすると、eastKm除外は発動しない", () => {
      // Odawara(11301)--JR東日本20km-->Atami(11301)--JR東海50km-->C。
      // グラフ内に別途 Shinjuku(11302) を無関係ノードとして置き、山手線名集合が
      // 空にならないようにする（「常に false を返す実装」でも通ってしまう、
      // というレビュー指摘への対応。この集合が空だと isEligibleExclusionName は
      // 何を渡しても false になり、実装の正しさを検証できていなかった）。
      // 起点が東京都区内・山手線内の駅ではないので、除外は発動せず、
      // eastKm=20kmとして加算額が乗るべき。
      // 総距離70km => 基準額(70km、beyond帯: fromKm=110未満なので110km帯)=900円
      // + 加算額(eastKm20km、11〜20km帯)=20円 = 920円。
      // 除外が（誤って）発動するとeastKm=0円になり900円になってしまう。
      const graph: RailGraph = {
        nodes: {
          Odawara: tokaidoNode("Odawara", "Odawara", "JR東日本", "11301"),
          Atami: tokaidoNode("Atami", "Atami", "JR東日本", "11301"),
          Shinjuku: tokaidoNode("Shinjuku", "Shinjuku", "JR東日本", "11302"),
          C: jrNode("C", "JR東海"),
        },
        edges: [
          { from: "Odawara", to: "Atami", km: 20, kind: "rail", operator: "JR東日本" },
          { from: "Atami", to: "C", km: 50, kind: "rail", operator: "JR東海" },
        ],
      };
      const result = findReachable(graph, honshuCalc, "Odawara", 10000);
      expect(result.find((r) => r.id === "C")?.fare).toBe(920);
    });

    it("横浜（東京都区内・山手線内ではない）を起点にすると、eastKm除外は発動しない", () => {
      // Yokohama(11301)--JR東日本30km-->Atami(11301)--JR東海50km-->C。
      // Shinjuku(11302) を無関係ノードとして置き、山手線名集合を非空にする。
      // 総距離80km => 基準額(80km)=900円 + 加算額(eastKm30km、21〜30km帯)=30円
      // = 930円。除外が（誤って）発動すると900円になってしまう。
      const graph: RailGraph = {
        nodes: {
          Yokohama: tokaidoNode("Yokohama", "Yokohama", "JR東日本", "11301"),
          Atami: tokaidoNode("Atami", "Atami", "JR東日本", "11301"),
          Shinjuku: tokaidoNode("Shinjuku", "Shinjuku", "JR東日本", "11302"),
          C: jrNode("C", "JR東海"),
        },
        edges: [
          { from: "Yokohama", to: "Atami", km: 30, kind: "rail", operator: "JR東日本" },
          { from: "Atami", to: "C", km: 50, kind: "rail", operator: "JR東海" },
        ],
      };
      const result = findReachable(graph, honshuCalc, "Yokohama", 10000);
      expect(result.find((r) => r.id === "C")?.fare).toBe(930);
    });

    // レビュー指摘1（Important）: isEligibleExclusionOrigin は区間の「起点」しか
    // 見ておらず、上り方向（東京着）で除外が発動しない非対称バグがあった。
    // 実運賃は方向対称（東京→名古屋 = 名古屋→東京）のはずだが、修正前は
    // 上り方向で加算額が誤って上乗せされる（過大評価）。
    it("上り方向（終端が山手線内）でもeastKm除外が発動する（方向対称性の修正）", () => {
      // C(JR東海)--50km-->Atami(11301)--60km(JR東日本)-->Tokyo(11301)。
      // TokyoYamanote(11302,同名"Tokyo")を追加し、終端Tokyoが山手線内である
      // ことを表現する。起点Atami（山手線内ではない）だけを見ていた修正前は
      // 除外が発動せず、eastKm=60km分の加算額が乗ってしまう
      // （基準額900+加算額70=970円）。終端も見るようにすると、下り方向の
      // 「東京～熱海間相当」テストと対称に、eastKm=0円（基準額900円のみ）になる。
      const graph: RailGraph = {
        nodes: {
          C: jrNode("C", "JR東海"),
          Atami: tokaidoNode("Atami", "Atami", "JR東日本", "11301"),
          Tokyo: tokaidoNode("Tokyo", "Tokyo", "JR東日本", "11301"),
          TokyoYamanote: tokaidoNode("TokyoYamanote", "Tokyo", "JR東日本", "11302"),
        },
        edges: [
          { from: "C", to: "Atami", km: 50, kind: "rail", operator: "JR東海" },
          { from: "Atami", to: "Tokyo", km: 60, kind: "rail", operator: "JR東日本" },
        ],
      };
      const result = findReachable(graph, honshuCalc, "C", 10000);
      expect(result.find((r) => r.id === "Tokyo")?.fare).toBe(900);
    });
  });

  // レビュー指摘3: honshuKm を「距離」と「通算中フラグ」の兼用にしていると、
  // 会社境界を0kmのrailエッジで跨いだ直後（honshuKm+segKm===0）にフラグが
  // 失われる。honshuThrough を独立フィールドとして分離したことを確認する。
  describe("honshuThrough フラグの分離（honshuKm===0でも通算モードを見失わない）", () => {
    it("会社境界を2回続けて0kmで跨ぐと honshuKm は0のままだが、通し運賃方式であり続ける", () => {
      // A --JR東日本0km--> B --JR東海0km--> C --JR東日本0km--> D --JR東日本10km--> E。
      //
      // B→C, C→D はどちらも0kmの会社境界跨ぎ（HONSHU_OPERATORS同士）なので、
      // honshuKm は「0(直前のsegKm) + 0(直前のsegKm)」の繰り返しでずっと0のまま
      // だが、honshuThrough は最初の境界跨ぎ（B→C）以降ずっと true のはず。
      //
      // honshuKm > 0 を「通算中フラグ」の代わりに使っていた場合（レビュー指摘3の
      // 修正前の実装）、D→E の時点で honshuKm===0 のため通算中と判定できず、
      // JR東日本の単独表（このテストでは基準額表よりわざと高い値にしてある）に
      // 落ちてしまう。honshuThrough を独立フィールドとして持てば、この場合でも
      // 正しく基準額＋加算額方式（10km: 100円 + 加算額10円 = 110円）が使われる。
      const graph: RailGraph = {
        nodes: {
          A: jrNode("A", "JR東日本"),
          B: jrNode("B", "JR東日本"),
          C: jrNode("C", "JR東海"),
          D: jrNode("D", "JR東日本"),
          E: jrNode("E", "JR東日本"),
        },
        edges: [
          { from: "A", to: "B", km: 0, kind: "rail", operator: "JR東日本" },
          { from: "B", to: "C", km: 0, kind: "rail", operator: "JR東海" },
          { from: "C", to: "D", km: 0, kind: "rail", operator: "JR東日本" },
          { from: "D", to: "E", km: 10, kind: "rail", operator: "JR東日本" },
        ],
      };
      const result = findReachable(graph, honshuCalc, "A", 10000);
      // 通し運賃(honshuThrough正しく分離): 基準額(10km)=100 + 加算額(10km)=10 = 110円。
      // 修正前(honshuKm>0をフラグ代用)なら JR東日本単独表(10km)=120円 になる。
      expect(result.find((r) => r.id === "E")?.fare).toBe(110);
    });
  });
});
