import { describe, expect, it } from "vitest";
import { deriveFareTable, type KmFarePair } from "@/lib/fare/derive";

const p = (km: number, fare: number): KmFarePair => ({ km, fare });

describe("deriveFareTable", () => {
  it("観測点が階段関数に乗るなら距離帯を復元する", () => {
    const r = deriveFareTable([
      p(1.0, 170),
      p(2.0, 170),
      p(2.1, 180),
      p(4.0, 180),
      p(4.2, 210),
      p(4.9, 210),
    ]);
    expect(r.ok).toBe(true);
    expect(r.table).toEqual([
      [2, 170],
      [4, 180],
      [4.9, 210],
    ]);
  });

  it("復元したテーブルは観測点をすべて再現する（自己検証）", () => {
    const pairs = [
      p(0.7, 170),
      p(3.7, 300),
      p(2.9, 210),
      p(5.2, 370),
      p(4.9, 300),
      p(6.4, 370),
    ];
    const r = deriveFareTable(pairs);
    expect(r.ok).toBe(true);
    // 帯の境界が観測点の間に入るので、どの観測点も元の運賃に戻るはず
    for (const { km, fare } of pairs) {
      const row = r.table.find(([maxKm]) => km <= maxKm);
      expect(row?.[1]).toBe(fare);
    }
  });

  // 実データでの失敗はこの形で現れる。北総鉄道のPDFで行と駅の対応を誤ったとき、
  // 「1.3kmが280円、3.8kmが190円」のような逆転が出た。
  it("安い運賃が高い運賃より遠くまで伸びていたら問題として報告する", () => {
    const r = deriveFareTable([p(1.3, 280), p(3.8, 190), p(5.0, 280)]);
    expect(r.ok).toBe(false);
    expect(r.problems.join("")).toMatch(/帯が重なっている/);
  });

  it("同じキロに複数の運賃があれば問題として報告する", () => {
    const r = deriveFareTable([p(5.0, 200), p(5.0, 300)]);
    expect(r.ok).toBe(false);
    expect(r.problems.join("")).toMatch(/複数の運賃/);
  });

  it("境界の候補が整数1つに絞れたら pinned になる", () => {
    // 2.9km=210円 と 3.7km=300円 → 境界は [2.9, 3.7) で整数は 3 のみ
    const r = deriveFareTable([p(2.9, 210), p(3.7, 300)]);
    expect(r.bands[0]?.pinned).toBe(true);
    expect(r.bands[0]?.maxKm).toBe(3);
  });

  it("境界の候補が複数あるなら pinned にせず観測点不足として数える", () => {
    // 2.0km=210円 と 5.5km=300円 → 境界候補は 2,3,4,5 の4つ
    const r = deriveFareTable([p(2.0, 210), p(5.5, 300)]);
    expect(r.bands[0]?.pinned).toBe(false);
    expect(r.bands[0]?.boundaryRange).toEqual([2.0, 5.5]);
    expect(r.unpinned).toBeGreaterThan(0);
  });

  it("最終帯は上限を観測した最大キロにする（それ以上の情報が無いため）", () => {
    const r = deriveFareTable([p(2.0, 170), p(18.0, 550), p(17.1, 550)]);
    const last = r.table[r.table.length - 1];
    expect(last).toEqual([18.0, 550]);
  });

  it("観測点が0件なら ok=false", () => {
    expect(deriveFareTable([]).ok).toBe(false);
  });

  it("キロが0以下の観測点は無視する", () => {
    const r = deriveFareTable([p(0, 170), p(-1, 170), p(2.0, 170)]);
    expect(r.pairCount).toBe(1);
  });

  // 実データでの再現。埼玉高速鉄道の公式駅別運賃表から拾った観測点で、
  // 帯の境界が 3/5/7/9/11/13 km に決まることを確認する
  // （data/fare-rules/saitama-kosoku.json と一致するか）。
  it("埼玉高速鉄道の実観測点から data/fare-rules と同じ表を復元できる", () => {
    const r = deriveFareTable([
      p(1.0, 210),
      p(2.4, 210),
      p(3.5, 270),
      p(4.6, 270),
      p(5.9, 310),
      p(6.3, 310),
      p(7.1, 350),
      p(8.7, 350),
      p(10.0, 400),
      p(10.3, 400),
      p(12.2, 440),
      p(14.6, 480),
    ]);
    expect(r.ok).toBe(true);
    expect(r.table).toEqual([
      [3, 210],
      [5, 270],
      [7, 310],
      [9, 350],
      [11, 400],
      [13, 440],
      [14.6, 480],
    ]);
  });
});

// 富山地方鉄道で実際に踏んだ失敗の再現。単一の起点（電鉄富山）からの観測点だけで
// 復元すると、その起点から到達しない距離の帯がまるごと抜け落ちる。自己検証は
// 通ってしまうので、警告として別に報告する必要がある。
describe("deriveFareTable の警告（観測点の粗さ）", () => {
  it("観測点の間隔が広い帯は、間に別の帯が隠れている可能性として警告する", () => {
    // 49.5km=1980円 と 53.3km=2160円 しか観測していないと、間の
    // 50.8km=2020円（実在する）を見落とす
    const r = deriveFareTable([
      { km: 48.7, fare: 1880 },
      { km: 49.5, fare: 1980 },
      { km: 53.3, fare: 2160 },
    ]);
    expect(r.ok).toBe(true); // 自己検証自体は通ってしまう
    expect(r.warnings.join("")).toMatch(/隠れている可能性/);
  });

  it("観測点が密なら警告は出ない", () => {
    const r = deriveFareTable([
      { km: 2.9, fare: 210 },
      { km: 3.7, fare: 300 },
      { km: 4.9, fare: 300 },
      { km: 5.2, fare: 370 },
      { km: 6.4, fare: 370 },
      { km: 7.1, fare: 440 },
      { km: 8.9, fare: 440 },
      { km: 9.1, fare: 520 },
      { km: 10.0, fare: 520 },
    ]);
    expect(r.warnings.filter((w) => w.includes("隠れている"))).toEqual([]);
  });
});

// 秩父鉄道の認可資料PDFでテキスト抽出が崩れ、拾えた2点から
// 「211kmまで45円」という無意味な表ができたのに ok=true になった。
// 観測点が少ないと自己検証は無条件に通るので、別途警告する必要がある。
describe("deriveFareTable の警告（観測点が少なすぎる）", () => {
  it("観測点が数点しかないときは信用できない旨を警告する", () => {
    const r = deriveFareTable([
      { km: 211, fare: 45 },
      { km: 4, fare: 45 },
    ]);
    expect(r.ok).toBe(true); // 自己検証は通ってしまう
    expect(r.warnings.join("")).toMatch(/信用してはいけない/);
  });

  it("観測点が十分あれば少なすぎ警告は出ない", () => {
    const r = deriveFareTable([
      { km: 1, fare: 200 },
      { km: 2, fare: 200 },
      { km: 4, fare: 300 },
      { km: 5, fare: 300 },
      { km: 7, fare: 400 },
      { km: 8, fare: 400 },
      { km: 10, fare: 500 },
    ]);
    expect(r.warnings.filter((w) => w.includes("信用してはいけない"))).toEqual(
      [],
    );
  });
});

const tooFew = (points: number, bands: number) =>
  `観測点が ${points} 点・帯が ${bands} 本しかない。` +
  `この規模では自己検証はほぼ無条件に通るため、復元結果を信用してはいけない`;
const hidden = (fare: number, lo: number, hi: number) =>
  `${fare}円 の上限が ${lo}〜${hi}km の範囲に絞れていない。` +
  `この間に別の帯が隠れている可能性がある`;
const single =
  "観測点が1点しかない帯がある。単一の起点からのデータだけで復元していないか確認すること";

describe("deriveFareTable の結果の中身", () => {
  it("観測点が0件なら、空の表と問題1件だけを返す", () => {
    expect(deriveFareTable([p(0, 170)])).toEqual({
      ok: false,
      table: [],
      bands: [],
      problems: ["観測点が0件"],
      warnings: [],
      pairCount: 0,
      unpinned: 0,
    });
  });

  it("帯ごとに上限・範囲・pinned・観測点の数を返す（運賃の順は入力順によらない）", () => {
    const r = deriveFareTable([
      p(5.5, 300),
      p(1.0, 170),
      p(4.0, 210),
      p(2.5, 170),
      p(3.2, 210),
      p(6.0, 300),
      p(1.5, 170),
    ]);
    expect(r).toEqual({
      ok: true,
      table: [
        [3, 170],
        [4, 210],
        [6, 300],
      ],
      bands: [
        // 2.5〜3.2 の整数は 3 だけ
        {
          maxKm: 3,
          fare: 170,
          boundaryRange: [2.5, 3.2],
          pinned: true,
          observed: 3,
        },
        // 4.0〜5.5 の整数は 4 と 5
        {
          maxKm: 4,
          fare: 210,
          boundaryRange: [4.0, 5.5],
          pinned: false,
          observed: 2,
        },
        {
          maxKm: 6,
          fare: 300,
          boundaryRange: null,
          pinned: false,
          observed: 2,
        },
      ],
      problems: [],
      warnings: [],
      pairCount: 7,
      unpinned: 2,
    });
  });

  it("次の帯の最小キロが整数なら、それは候補に入れない", () => {
    // 2.5〜4 の候補は 3 だけ（4 は次の帯の観測点なので上限になれない）
    const r = deriveFareTable([p(2.5, 170), p(4, 210)]);
    expect(r.bands[0]).toEqual({
      maxKm: 3,
      fare: 170,
      boundaryRange: [2.5, 4],
      pinned: true,
      observed: 1,
    });
  });

  it("範囲に整数が無ければ、観測した最大キロを上限にする", () => {
    const r = deriveFareTable([p(2.1, 170), p(2.9, 210)]);
    expect(r.table).toEqual([
      [2.1, 170],
      [2.9, 210],
    ]);
    expect(r.bands[0]?.pinned).toBe(false);
    expect(r.problems).toEqual([]);
  });
});

describe("deriveFareTable の問題の報告", () => {
  it("同じキロの複数の運賃は、数の小さい順に並べて報告する", () => {
    const r = deriveFareTable([p(3, 1000), p(3, 200), p(3, 30)]);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain("同じ 3km に複数の運賃 (30, 200, 1000)");
  });

  it("安い運賃の最大キロと高い運賃の最小キロが同じでも、重なりとして報告する", () => {
    const r = deriveFareTable([p(1, 170), p(3, 170), p(3.5, 180), p(5, 180)]);
    expect(r.ok).toBe(true);
    const touching = deriveFareTable([
      p(1, 170),
      p(3, 170),
      p(3, 180),
      p(5, 180),
    ]);
    expect(touching.problems).toContain(
      "帯が重なっている: 170円 が 3km まであるのに 180円 が 3km から始まる",
    );
  });

  it("重なった帯を落とした表が観測点を再現しなければ、その件数を報告する", () => {
    const r = deriveFareTable([p(1, 170), p(3, 170), p(2, 180), p(4, 180)]);
    expect(r).toEqual({
      ok: false,
      table: [[4, 180]],
      bands: [
        {
          maxKm: 4,
          fare: 180,
          boundaryRange: null,
          pinned: false,
          observed: 2,
        },
      ],
      problems: [
        "帯が重なっている: 170円 が 3km まであるのに 180円 が 2km から始まる",
        "復元したテーブルが観測点 2/4 件を再現しない",
      ],
      warnings: [tooFew(4, 1)],
      pairCount: 4,
      unpinned: 1,
    });
  });
});

describe("deriveFareTable の警告の境目", () => {
  // 3本の帯で各2点、上限は 2・4 に1つずつ決まる
  const six = [
    p(1, 170),
    p(2, 170),
    p(2.5, 210),
    p(4, 210),
    p(4.5, 300),
    p(5, 300),
  ];

  it("観測点6点・帯3本なら少なすぎ警告は出さない", () => {
    expect(deriveFareTable(six).warnings).toEqual([]);
  });

  it("観測点が5点なら、帯が3本でも少なすぎ警告を出す", () => {
    const r = deriveFareTable(six.slice(1));
    expect(r.warnings).toContain(tooFew(5, 3));
  });

  it("帯が2本なら、観測点が6点でも少なすぎ警告を出す", () => {
    const r = deriveFareTable([
      p(1, 170),
      p(1.5, 170),
      p(2, 170),
      p(2.5, 210),
      p(3, 210),
      p(3.5, 210),
    ]);
    expect(r.warnings).toEqual([tooFew(6, 2)]);
  });

  it("上限の範囲がちょうど2kmなら、隠れた帯の警告を出す", () => {
    const r = deriveFareTable([
      ...six.slice(0, 2),
      p(4, 210),
      p(4.2, 210),
      ...six.slice(4),
    ]);
    expect(r.warnings).toEqual([hidden(170, 2, 4)]);
  });

  it("上限の範囲が2km未満なら、絞れていなくても隠れた帯の警告は出さない", () => {
    const r = deriveFareTable([
      ...six.slice(0, 2),
      p(3.5, 210),
      p(4, 210),
      ...six.slice(4),
    ]);
    expect(r.bands[0]?.pinned).toBe(false); // 2 と 3 が候補
    expect(r.warnings).toEqual([]);
  });

  it("観測点が1点の帯が1本でもあれば警告を出す", () => {
    const r = deriveFareTable([...six, p(6, 400)]);
    expect(r.warnings).toEqual([single]);
  });
});
