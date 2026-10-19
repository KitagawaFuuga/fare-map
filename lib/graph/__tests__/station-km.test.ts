import { describe, expect, it } from "vitest";
import {
  edgeKey,
  extractStationKm,
  normalizeStationName,
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

  // 首都圏・関西圏の駅一覧は駅名のうしろに特定都区市内の記号を置く
  // （根岸線は「横浜駅 浜」、大阪環状線は「大阪駅 阪」）。記号は漢字なので
  // 末尾の記号だけを落とす規則では外れず、根岸線は全行が漏れていた
  it("駅名のうしろの特定都区市内の記号を落とす（「横浜駅 浜」）", () => {
    const marked = [
      ["駅名", "累計"],
      ["甲駅 浜", "0.0"],
      ["乙駅　区", "3.0"],
      ["丙駅 名", "7.5"],
      ["丁駅 阪", "10.0"],
    ];
    const r = extractStationKm([marked], { stationNames: names, sections });
    expect(r.edgeKm.get(edgeKey("甲", "乙"))).toBeCloseTo(3.0);
    expect(r.edgeKm.get(edgeKey("丙", "丁"))).toBeCloseTo(2.5);
  });

  // 路線図テンプレートの表は駅名セルに駅ナンバリングを付ける
  // （東京メトロ有楽町線は「Y-01 和光市駅」）。落とさないと1駅も一致しない
  it("駅名の前の駅ナンバリングを落とす（「Y-01 和光市駅」）", () => {
    const numbered = [
      ["", "0.0", "A-01 甲駅"],
      ["", "3.0", "A-02 乙駅"],
      ["", "7.5", "A-03 丙駅"],
      ["", "10.0", "A-04 丁駅"],
    ];
    const r = extractStationKm([numbered], { stationNames: names, sections });
    expect(r.edgeKm.get(edgeKey("甲", "乙"))).toBeCloseTo(3.0);
    expect(r.edgeKm.get(edgeKey("丙", "丁"))).toBeCloseTo(2.5);
  });

  it("英字と数字の間が空白の駅ナンバリングも落とす（「JO 19 東京駅」）", () => {
    // JR東日本の路線図は「JO 19」の形。落とせないと番号付きの駅だけが漏れ、
    // 番号の無い支線の駅と遠くの駅が隣り合った並びになる（総武本線で
    // 「御茶ノ水 4.3」と「南酒々井 59.3」がつながり、55kmの駅間が出ていた）
    expect(normalizeStationName("JO 19 東京駅")).toBe("東京");
    expect(normalizeStationName("JO 28 千葉駅 (II)")).toBe("千葉");
  });

  it("空白で区切られていなければ駅ナンバリングとみなさない", () => {
    // 落とすのは「英数字＋空白」で始まる形だけ。駅名の一部を削ってはいけない
    expect(normalizeStationName("A-01 甲駅")).toBe("甲");
    expect(normalizeStationName("A-01甲駅")).toBe("A-01甲");
    expect(normalizeStationName("JR難波駅")).toBe("JR難波");
  });

  it("文章のセルを駅名と読み違えない", () => {
    // 接続路線の欄には「甲駅 - 乙駅間」のような文が入る
    expect(
      extractStationKm(
        [
          [
            ["駅名", "累計", "接続路線"],
            ["甲駅", "0.0", "甲駅 - 乙駅間は複線"],
            ["乙駅", "3.0", ""],
          ],
        ],
        {
          stationNames: names,
          sections: [{ from: "甲", to: "乙", officialKm: 3.0 }],
        },
      ).edgeKm.get(edgeKey("甲", "乙")),
    ).toBeCloseTo(3.0);
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

  // 環状線の記事は、路線図（品川起点で1周）と駅一覧（東京起点で1周）で起点が違う。
  // 先に採った表の値で、1周のつなぎ目をまたぐ駅ペアが「遠回り側」の距離で正解に
  // 入るため、後の表はその全ペアで食い違って棄却される。記事の並び順で先に来た
  // 表を採ると、区間キロとの一致が多い駅一覧のほうを落とす（山手線で起きた）
  it("区間キロとの一致が多い表を、並び順より先に採用する", () => {
    const loopFrom丙 = [
      ["駅名", "累計"],
      ["丙駅", "0.0"],
      ["丁駅", "2.5"],
      ["戊駅", "4.5"],
      ["甲駅", "9.5"],
      ["乙駅", "12.5"],
    ];
    const loopFrom甲 = [
      ["駅名", "累計"],
      ["甲駅", "0.0"],
      ["乙駅", "3.0"],
      ["丙駅", "7.5"],
      ["丁駅", "10.0"],
      ["戊駅", "12.0"],
      ["己駅", "14.0"],
    ];
    const r = extractStationKm([loopFrom丙, loopFrom甲], {
      stationNames: new Set([...names, "戊", "己"]),
      sections: [
        { from: "甲", to: "乙", officialKm: 3.0 },
        { from: "乙", to: "丙", officialKm: 4.5 },
        { from: "丙", to: "丁", officialKm: 2.5 },
        { from: "丁", to: "戊", officialKm: 2.0 },
        { from: "戊", to: "甲", officialKm: 5.0 },
        { from: "丙", to: "戊", officialKm: 4.5 },
        { from: "戊", to: "己", officialKm: 2.0 },
      ],
    });
    expect(r.edgeKm.get(edgeKey("戊", "己"))).toBeCloseTo(2.0);
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

// 矛盾の大きさは二極化する（別経路によるものが 1.2〜25.3km、資料の食い違いが
// 0.2〜0.8km）。以前は後者を「別経路では説明できない」として棄却していたが、
// それは誤りだった。棄却すると路線全体が推定値のまま残り、失うキロ数のほうが
// ずっと大きい。豊肥本線（阿蘇高原線）は一致7に対し0.2kmの矛盾が2つあるだけで
// 棄却されており、その結果 熊本〜大分が公式148.0kmに対し143.8kmとなって、
// 実額3,740円が3,300円になっていた（記事の累計は熊本で148.0kmに達し、
// JR九州のガイドブックの公表値と完全に一致する）。
// いまは大小を問わず「一致が矛盾の3倍以上」で判定する。
describe("extractStationKm: 矛盾は大小を問わず比で判定する", () => {
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

  it("1km未満の矛盾も、一致が3倍以上あれば許す（棄却するほうが失うキロが大きい）", () => {
    const r = extractStationKm([chain], {
      stationNames: names,
      sections: [...agreeing, { from: "甲", to: "丁", officialKm: 10.3 }],
    });
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]?.contradicted).toBe(1);
  });

  it("一致が矛盾の3倍に届かなければ、矛盾が小さくても採用しない", () => {
    const r = extractStationKm([chain], {
      stationNames: names,
      sections: [
        { from: "甲", to: "乙", officialKm: 3.0 },
        { from: "甲", to: "丙", officialKm: 7.3 },
        { from: "甲", to: "丁", officialKm: 10.3 },
      ],
    });
    expect(r.edgeKm.size).toBe(0);
    expect(r.rejected).toBeGreaterThan(0);
  });
});

// 記事によっては累計が終点側からの並びで降順に載る（石北本線・湖西線・釧網本線）。
// 累計として使えるかは単調かどうかで、向きは関係ない。降順を捨てていたため
// 石北本線は33駅・一致12の列を「単調×」で落としていた。
describe("extractStationKm: 降順の累計も読む", () => {
  const descending = [
    ["駅名", "累計"],
    ["丁駅", "10.0"],
    ["丙駅", "7.5"],
    ["乙駅", "3.0"],
    ["甲駅", "0.0"],
  ];

  it("降順の累計から隣接駅間の距離を出す", () => {
    const r = extractStationKm([descending], {
      stationNames: names,
      sections,
    });
    expect(r.edgeKm.get(edgeKey("甲", "乙"))).toBeCloseTo(3.0);
    expect(r.edgeKm.get(edgeKey("乙", "丙"))).toBeCloseTo(4.5);
    expect(r.edgeKm.get(edgeKey("丙", "丁"))).toBeCloseTo(2.5);
  });

  it("2つの累計がくっついたセルは先頭の累計を読む（「49.535.3*」は49.5）", () => {
    // 路線図の表は分岐駅で本線と支線の累計を1セルに並べ、先頭が本線側になる
    // （函館本線の森駅は本線49.5・砂原支線35.3、桑園駅は1.6と札沼線の0.0）。
    // 数字として先頭から読むと49.535になり、東森–森が16.03kmに化けた。
    // 読まずに捨てると、分岐駅（桑園）が並びから抜けて前後が直結する
    const glued = [
      ["駅名", "累計"],
      ["甲駅", "0.0"],
      ["乙駅", "3.0"],
      ["丙駅", "7.52.0*"],
      ["丁駅", "10.0"],
    ];
    const r = extractStationKm([glued], {
      stationNames: names,
      sections: [{ from: "甲", to: "丁", officialKm: 10.0 }],
    });
    expect(r.edgeKm.get(edgeKey("乙", "丙"))).toBeCloseTo(4.5);
    expect(r.edgeKm.get(edgeKey("丙", "丁"))).toBeCloseTo(2.5);
  });

  it("「*」の付いた累計（支線の起点から）は本線の並びに混ぜない", () => {
    // 路線図の表は支線の駅に支線の起点からの累計を「33.5*」の形で書く。
    // 本線の累計と一緒に読むと、支線の駅と本線の駅が隣り合って見える
    // （函館本線の東森33.5*と森49.5で、東森–森が16.0kmになった。実際は1.8km）
    const branch = [
      ["駅名", "累計"],
      ["甲駅", "0.0"],
      ["乙駅", "3.0"],
      ["戊駅", "1.5*"],
      ["丙駅", "7.5"],
      ["丁駅", "10.0"],
    ];
    const r = extractStationKm([branch], {
      stationNames: new Set([...names, "戊"]),
      sections: [{ from: "甲", to: "丁", officialKm: 10.0 }],
    });
    expect(r.edgeKm.get(edgeKey("乙", "丙"))).toBeCloseTo(4.5);
    expect(r.edgeKm.has(edgeKey("戊", "丙"))).toBe(false);
  });

  it("上下する列（駅間）は降順としても読まない", () => {
    const gaps = [
      ["駅名", "駅間"],
      ["甲駅", "0.0"],
      ["乙駅", "3.0"],
      ["丙駅", "4.5"],
      ["丁駅", "2.5"],
    ];
    const r = extractStationKm([gaps], { stationNames: names, sections });
    expect(r.edgeKm.size).toBe(0);
  });
});

// 路線記事の駅一覧は、先頭や末尾に接続路線の区間を混ぜることがある。石北本線の
// 累計列は「旭川3.7 → 旭川四条1.9 → 新旭川0.0」（宗谷本線区間の降順）のあと
// 「新旭川0.0 → … → 網走234.0」と続くV字で、列ごと捨てて33駅を落としていた。
describe("extractStationKm: 列の中の最長の単調部分を使う", () => {
  it("先頭に別路線の区間が混じった累計列でも読む", () => {
    const vShaped = [
      ["駅名", "累計"],
      ["庚駅", "3.7"], // 接続路線の区間（降順）
      ["己駅", "1.9"],
      ["甲駅", "0.0"], // ここから本題の路線（昇順）
      ["乙駅", "3.0"],
      ["丙駅", "7.5"],
      ["丁駅", "10.0"],
    ];
    const r = extractStationKm([vShaped], {
      stationNames: new Set([...names, "己", "庚"]),
      sections,
    });
    expect(r.edgeKm.get(edgeKey("甲", "乙"))).toBeCloseTo(3.0);
    expect(r.edgeKm.get(edgeKey("丙", "丁"))).toBeCloseTo(2.5);
    // 別路線ぶんは最長の単調部分に入らないので出さない
    expect(r.edgeKm.get(edgeKey("己", "庚"))).toBeUndefined();
  });
});
