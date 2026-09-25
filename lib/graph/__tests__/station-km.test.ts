import { describe, expect, it } from "vitest";
import {
  edgeKey,
  extractStationKm,
  type KmSection,
} from "@/lib/graph/station-km";

// Wikipedia の駅一覧を模した表。列は「駅名 / 駅間 / 累計(A起点) / 累計(B起点)」。
// 累計が2本あるのは実在の形（内房線は蘇我からと千葉からが並ぶ）で、
// 駅間の列を取り違えると営業キロが全部狂うため、そこを落とせるかが要点。
const HEADER = ["駅名", "駅間", "累計", "累計"];
const ROWS: string[][] = [
  ["甲駅", "-", "0.0", "2.0"],
  ["乙駅", "3.0", "3.0", "5.0"],
  ["丙駅", "4.5", "7.5", "9.5"],
  ["丁駅", "2.5", "10.0", "12.0"],
];
const table = [HEADER, ...ROWS];
const names = new Set(["甲", "乙", "丙", "丁"]);
const sections: KmSection[] = [{ from: "甲", to: "丁", officialKm: 10.0 }];

describe("extractStationKm", () => {
  it("累計の列から隣接駅間の距離を出す", () => {
    const r = extractStationKm([table], { stationNames: names, sections });
    expect(r.edgeKm.get(edgeKey("甲", "乙"))).toBeCloseTo(3.0);
    expect(r.edgeKm.get(edgeKey("乙", "丙"))).toBeCloseTo(4.5);
    expect(r.edgeKm.get(edgeKey("丙", "丁"))).toBeCloseTo(2.5);
  });

  it("起点が違う累計の列でも同じ距離になる（どちらを採っても差は同じ）", () => {
    const onlyB = [
      ["駅名", "累計"],
      ...ROWS.map((r) => [r[0] as string, r[3] as string]),
    ];
    const r = extractStationKm([onlyB], { stationNames: names, sections });
    expect(r.edgeKm.get(edgeKey("甲", "乙"))).toBeCloseTo(3.0);
  });

  it("駅間（単調でない列）は累計と取り違えない", () => {
    const onlyGap = [
      ["駅名", "駅間"],
      ...ROWS.map((r) => [r[0] as string, r[1] as string]),
    ];
    const r = extractStationKm([onlyGap], { stationNames: names, sections });
    expect(r.edgeKm.size).toBe(0);
    expect(r.accepted).toEqual([]);
  });

  it("実データの区間キロと合わない列は採らない", () => {
    const wrong = [
      ["駅名", "累計"],
      ["甲駅", "0.0"],
      ["乙駅", "1.0"],
      ["丙駅", "2.0"],
      ["丁駅", "3.0"],
    ];
    const r = extractStationKm([wrong], { stationNames: names, sections });
    expect(r.edgeKm.size).toBe(0);
    expect(r.rejected).toBeGreaterThan(0);
  });

  it("検証に使える区間が1つも無ければ採用しない", () => {
    const r = extractStationKm([table], { stationNames: names, sections: [] });
    expect(r.edgeKm.size).toBe(0);
    expect(r.unverifiable).toBe(true);
  });

  it("グラフに無い行（信号場・貨物駅）は飛ばして前後を繋ぐ", () => {
    const withSignal = [
      ["駅名", "累計"],
      ["甲駅", "0.0"],
      ["乙信号場", "1.5"],
      ["乙駅", "3.0"],
      ["丙駅", "7.5"],
      ["丁駅", "10.0"],
    ];
    const r = extractStationKm([withSignal], { stationNames: names, sections });
    expect(r.edgeKm.get(edgeKey("甲", "乙"))).toBeCloseTo(3.0);
  });

  // 記号は駅名の後ろに付くので、先に落とさないと「駅」を外せず一致しない。
  // # は近鉄名古屋線の「伊勢中川駅#」、↷ は近鉄京都線の「京都駅↷」で実際に踏んだ
  it("駅名の脚注・記号・かっこ書きを落として突き合わせる", () => {
    const noisy = [
      ["駅名", "累計"],
      ["甲駅[1]", "0.0"],
      ["乙駅↷", "3.0"],
      ["丙駅（仮称）", "7.5"],
      ["丁駅#", "10.0"],
    ];
    const r = extractStationKm([noisy], { stationNames: names, sections });
    expect(r.edgeKm.get(edgeKey("乙", "丙"))).toBeCloseTo(4.5);
  });

  it("複数の表に分かれた路線を繋げる", () => {
    const first = [
      ["駅名", "累計"],
      ["甲駅", "0.0"],
      ["乙駅", "3.0"],
    ];
    const second = [
      ["駅名", "累計"],
      ["丙駅", "7.5"],
      ["丁駅", "10.0"],
    ];
    const r = extractStationKm([first, second], {
      stationNames: names,
      sections: [
        { from: "甲", to: "乙", officialKm: 3.0 },
        { from: "丙", to: "丁", officialKm: 2.5 },
      ],
    });
    expect(r.edgeKm.get(edgeKey("甲", "乙"))).toBeCloseTo(3.0);
    expect(r.edgeKm.get(edgeKey("丙", "丁"))).toBeCloseTo(2.5);
  });

  // 区間キロ（甲→丁 10.0）は満たすが、途中の駅位置が採用済みの表と食い違う表。
  // 黙って混ぜず、丸ごと却下しなければならない
  it("採用済みの表と途中が食い違う表は却下する", () => {
    const other = [
      ["駅名", "累計"],
      ["甲駅", "0.0"],
      ["乙駅", "3.9"],
      ["丙駅", "8.4"],
      ["丁駅", "10.0"],
    ];
    const r = extractStationKm([table, other], {
      stationNames: names,
      sections,
    });
    expect(r.rejected).toBe(1);
    expect(r.edgeKm.get(edgeKey("甲", "乙"))).toBeCloseTo(3.0);
  });

  // 路線記事は区間ごとに表が分かれ、実営業キロの区間が1つも無い表が出る。
  // 採用済みの表と駅が重なっていれば、そちらを正解にして検証を伝播できる
  it("採用済みの表と重なる表は、区間キロが無くても採用する", () => {
    const verified = [
      ["駅名", "累計"],
      ["甲駅", "0.0"],
      ["乙駅", "3.0"],
      ["丙駅", "7.5"],
      ["丁駅", "10.0"],
    ];
    const continued = [
      ["駅名", "累計"],
      ["丙駅", "100.0"],
      ["丁駅", "102.5"],
      ["戊駅", "108.0"],
    ];
    const r = extractStationKm([verified, continued], {
      stationNames: new Set([...names, "戊"]),
      sections,
    });
    expect(r.edgeKm.get(edgeKey("丁", "戊"))).toBeCloseTo(5.5);
  });

  it("採用済みの表と重なるが値が食い違う表は採らない", () => {
    const verified = [
      ["駅名", "累計"],
      ["甲駅", "0.0"],
      ["乙駅", "3.0"],
      ["丙駅", "7.5"],
      ["丁駅", "10.0"],
    ];
    const wrong = [
      ["駅名", "累計"],
      ["丙駅", "100.0"],
      ["丁駅", "109.9"],
      ["戊駅", "115.0"],
    ];
    const r = extractStationKm([verified, wrong], {
      stationNames: new Set([...names, "戊"]),
      sections,
    });
    expect(r.edgeKm.has(edgeKey("丁", "戊"))).toBe(false);
  });
});

// 列の取り違えは必ず「正解との一致0」になる（実データ1,106列のうち矛盾を含む
// 340列はすべて一致0だった）。一方、環状線を遠回りに回った累計や別経路が
// あるぶんは、正しい列でも数個だけ正解と食い違う。山手線は30駅・一致10に対して
// 矛盾1（東京-田町が公表4.6kmに対し表は遠回りの29.9km）で棄却されていた。
describe("extractStationKm: 一致と矛盾の比で判定する", () => {
  const loop = [
    ["駅名", "累計"],
    ["甲駅", "0.0"],
    ["乙駅", "3.0"],
    ["丙駅", "7.5"],
    ["丁駅", "10.0"],
  ];

  it("一致が矛盾の3倍以上あれば採用する（環状線の遠回りなどを許す）", () => {
    const r = extractStationKm([loop], {
      stationNames: names,
      sections: [
        { from: "甲", to: "乙", officialKm: 3.0 },
        { from: "乙", to: "丙", officialKm: 4.5 },
        { from: "丙", to: "丁", officialKm: 2.5 },
        // 環状線の短い側。表は遠回りの10.0を持つ
        { from: "甲", to: "丁", officialKm: 1.5 },
      ],
    });
    expect(r.edgeKm.get(edgeKey("乙", "丙"))).toBeCloseTo(4.5);
    expect(r.accepted[0]?.contradicted).toBe(1);
  });

  it("一致が矛盾の3倍に届かなければ採用しない", () => {
    const r = extractStationKm([loop], {
      stationNames: names,
      sections: [
        { from: "甲", to: "乙", officialKm: 3.0 },
        { from: "甲", to: "丙", officialKm: 2.0 },
        { from: "甲", to: "丁", officialKm: 1.5 },
      ],
    });
    expect(r.edgeKm.size).toBe(0);
    expect(r.rejected).toBeGreaterThan(0);
  });

  it("食い違った隣接駅間は出さない（公表営業キロを上書きしてしまう）", () => {
    const withBranch = [
      ["駅名", "累計"],
      ["甲駅", "0.0"],
      ["乙駅", "3.0"],
      ["丙駅", "7.5"],
      ["丁駅", "10.0"],
      ["戊駅", "12.0"],
    ];
    const r = extractStationKm([withBranch], {
      stationNames: new Set([...names, "戊"]),
      sections: [
        { from: "甲", to: "乙", officialKm: 3.0 },
        { from: "甲", to: "丙", officialKm: 7.5 },
        { from: "甲", to: "丁", officialKm: 10.0 },
        // 丁-戊 は公表5.0km。表の累計の差は2.0で食い違う
        { from: "丁", to: "戊", officialKm: 5.0 },
      ],
    });
    expect(r.accepted).toHaveLength(1);
    expect(r.edgeKm.get(edgeKey("甲", "乙"))).toBeCloseTo(3.0);
    expect(r.edgeKm.get(edgeKey("丁", "戊"))).toBeUndefined();
  });
});

// 矛盾の大きさは二極化する。実データでは別経路によるものが 1.2〜25.3km、
// 資料の食い違いによるものが 0.2〜0.8km で、間が空いていた。
// 0.2km の差は別経路では説明できない（経路が違えばキロは大きく変わる）ので、
// 小さい矛盾は従来どおり棄却する。
describe("extractStationKm: 小さい矛盾は別経路では説明できない", () => {
  const chain = [
    ["駅名", "累計"],
    ["甲駅", "0.0"],
    ["乙駅", "3.0"],
    ["丙駅", "7.5"],
    ["丁駅", "10.0"],
  ];
  const agreeing: KmSection[] = [
    { from: "甲", to: "乙", officialKm: 3.0 },
    { from: "甲", to: "丙", officialKm: 7.5 },
    { from: "乙", to: "丙", officialKm: 4.5 },
  ];

  it("1km以上の矛盾は別経路として許す", () => {
    const r = extractStationKm([chain], {
      stationNames: names,
      sections: [...agreeing, { from: "甲", to: "丁", officialKm: 1.5 }],
    });
    expect(r.accepted).toHaveLength(1);
  });

  it("1km未満の矛盾があれば採用しない（資料の食い違い）", () => {
    const r = extractStationKm([chain], {
      stationNames: names,
      sections: [...agreeing, { from: "甲", to: "丁", officialKm: 10.3 }],
    });
    expect(r.edgeKm.size).toBe(0);
    expect(r.rejected).toBeGreaterThan(0);
  });
});
