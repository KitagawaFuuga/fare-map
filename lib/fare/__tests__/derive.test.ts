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
