import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fareRuleSchema, type FareRule } from "@/lib/fare/types";

// JRの地方交通線の表（FareRule.localTable）。乗車区間がすべて地方交通線のとき、
// 探索は換算キロで幹線の表を引く代わりにこれを営業キロで引く。
const rule = (id: string): FareRule =>
  fareRuleSchema.parse(
    JSON.parse(readFileSync(`data/fare-rules/${id}.json`, "utf8")),
  );
const look = (table: [number, number][], km: number): number | undefined =>
  table.find(([maxKm]) => km <= maxKm)?.[1];

const central = rule("jr-central");
const west = rule("jr-west");
const east = rule("jr-east");
const hokkaido = rule("jr-hokkaido");

describe("JR地方交通線の表", () => {
  it("JR西日本の地方交通線の表はJR東海（基準額表）と同一", () => {
    expect(west.localTable).toEqual(central.localTable);
  });

  it("JR東日本の地方交通線の表は、基準額に地方交通線の加算額を足したもの", () => {
    // kijun_kasan_futsuu.pdf p2「普通旅客運賃の加算額表【地方交通線】」（73kmまで）
    const kasan = [10, 10, 10, 20, 20, 20, 20, 30, 40, 40, 50, 50, 60, 70];
    const own = east.localTable ?? [];
    const base = central.localTable ?? [];
    expect(own).toHaveLength(kasan.length);
    own.forEach(([km, fare], i) => {
      expect(km).toBe(base[i]?.[0]);
      expect(fare - (base[i]?.[1] ?? 0)).toBe(kasan[i]);
    });
  });

  it("本州の地方交通線の表は200km、JR北海道は800kmまで", () => {
    expect(central.localTable?.at(-1)).toEqual([200, 3740]);
    expect(hokkaido.localTable).toHaveLength(49);
    expect(hokkaido.localTable?.at(-1)).toEqual([800, 12650]);
  });

  // 抽出で金額の列が1行ずれると、帯と金額の対応が丸ごと狂う（PDFのテキスト抽出で
  // 56km帯から1行ずれた版があり、換算キロの近似との差が最大770円になっていた）。
  // 地方交通線の表は幹線の表を換算キロで引いた額に近いはずなので、差の上限で気づける
  it.each([
    ["JR東海", central],
    ["JR北海道", hokkaido],
  ] as const)(
    "%s の地方交通線の表は、換算キロで幹線の表を引いた額から大きく離れない",
    (_name, r) => {
      const local = r.localTable ?? [];
      const maxKm = local.at(-1)?.[0] ?? 0;
      for (let km = 1; km <= maxKm; km++) {
        const fare = look(local, km) ?? 0;
        const trunk = look(r.table, Math.round(km * 11) / 10) ?? Infinity;
        expect(Math.abs(trunk - fare)).toBeLessThanOrEqual(550);
      }
    },
  );

  it.each([
    ["JR東海", central],
    ["JR東日本", east],
    ["JR北海道", hokkaido],
  ] as const)("%s の地方交通線の表は距離について単調", (_name, r) => {
    const local = r.localTable ?? [];
    for (let i = 1; i < local.length; i++) {
      expect(local[i]![1]).toBeGreaterThanOrEqual(local[i - 1]![1]);
    }
  });
});
