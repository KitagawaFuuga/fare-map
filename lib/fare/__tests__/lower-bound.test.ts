import { describe, expect, it } from "vitest";
import { deriveLowerBoundTable } from "@/lib/fare/lower-bound";

describe("deriveLowerBoundTable", () => {
  it("帯の境界を隣の帯との中間に置く（距離が動いても破れにくくする）", () => {
    expect(
      deriveLowerBoundTable([
        { km: 1, fare: 100 },
        { km: 2, fare: 200 },
        { km: 3, fare: 300 },
      ]).table,
    ).toEqual([
      [1.5, 100],
      [2.5, 200],
      [3, 300],
    ]);
  });

  it("同じ距離で運賃が違うペアがあれば安いほうを採る", () => {
    expect(
      deriveLowerBoundTable([
        { km: 2, fare: 200 },
        { km: 2, fare: 180 },
      ]).table,
    ).toEqual([[2, 180]]);
  });

  it("長いほうが安いペアがあれば短い側の帯も下げる（単調非減少にする）", () => {
    expect(
      deriveLowerBoundTable([
        { km: 1, fare: 300 },
        { km: 2, fare: 100 },
      ]).table,
    ).toEqual([[2, 100]]);
  });

  it("どのペアの実運賃も上回らない", () => {
    const pairs = [
      { km: 1.2, fare: 200 },
      { km: 3.4, fare: 200 },
      { km: 3.4, fare: 260 },
      { km: 5.6, fare: 240 },
      { km: 9.9, fare: 700 },
    ];
    const { table } = deriveLowerBoundTable(pairs);
    for (const p of pairs) {
      const band = table.find(([maxKm]) => p.km <= maxKm);
      expect(band?.[1] ?? 0, `${p.km}km`).toBeLessThanOrEqual(p.fare);
    }
  });

  it("beyond は最長ペアの運賃で固定する（それ以上の距離は無い）", () => {
    expect(
      deriveLowerBoundTable([
        { km: 1, fare: 100 },
        { km: 8.5, fare: 400 },
      ]).beyond,
    ).toEqual({ fromKm: 8.5, baseFare: 400, ratePerKm: 0 });
  });

  it("table は maxKm の厳密な昇順（fareRuleSchema の前提）", () => {
    const { table } = deriveLowerBoundTable([
      { km: 1, fare: 100 },
      { km: 1.0001, fare: 100 },
      { km: 2, fare: 200 },
      { km: 4, fare: 300 },
    ]);
    for (let i = 1; i < table.length; i++) {
      expect(table[i]![0]).toBeGreaterThan(table[i - 1]![0]);
    }
  });

  it("ペアが無ければ空の表を返す", () => {
    expect(deriveLowerBoundTable([])).toEqual({
      table: [],
      beyond: { fromKm: 0, baseFare: 0, ratePerKm: 0 },
    });
  });
});

describe("deriveLowerBoundTable の帯境界の丸め", () => {
  it("3桁が隣の帯に食い込むときだけ桁を増やす", () => {
    // 10.001 と 10.002 の中間は 10.0015。3桁に丸めると 10.002 で次の帯の
    // 最小kmと同値になり、厳密な昇順が崩れる
    expect(
      deriveLowerBoundTable([
        { km: 10.001, fare: 300 },
        { km: 10.002, fare: 400 },
        { km: 12, fare: 500 },
      ]).table[0],
    ).toEqual([10.0015, 300]);
  });
});

describe("deriveLowerBoundTable の距離の丸め", () => {
  // 帯の境界が実距離とぴったり同値になると、距離を足す順序が違うだけで
  // （探索とスクリプトは別々にダイクストラを回す）帯が1つずれて下界が破れる
  it("1e-14 しか違わない2つの距離は同じ帯に入れ、安いほうを採る", () => {
    const { table } = deriveLowerBoundTable([
      { km: 55.89999999999999, fare: 1250 },
      { km: 55.9, fare: 1260 },
    ]);
    expect(table).toEqual([[55.9, 1250]]);
  });

  it("帯の境界は最小1m以上の余裕を持つ", () => {
    const { table } = deriveLowerBoundTable([
      { km: 10.0001, fare: 300 },
      { km: 10.0009, fare: 400 },
      { km: 12, fare: 500 },
    ]);
    for (const [maxKm] of table) {
      expect(String(maxKm).replace(/^\d+\.?/, "").length).toBeLessThanOrEqual(
        4,
      );
    }
  });
});
