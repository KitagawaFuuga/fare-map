import { z } from "zod";

// 加算運賃。新線の建設費に充てるため、特定の路線に乗った距離に応じて
// 普通運賃に上乗せされる（例: 近鉄の鳥羽線・けいはんな線・吉野線・湯の山線・志摩線）。
//
// 距離帯運賃表は事業者単位で引くため、路線単位でかかるこれは実行時には扱えない。
// scripts/fare/ingest/apply-surcharges.ts が生成時に「距離帯の額＋加算額」を
// 計算して data/fare-overrides/ に実額として書き出す。
//
// 入れないと運賃が実額より安く出る。到達できない駅を到達できると言う側の誤りなので、
// 「まだ正確でない」では済まない類のずれになる。

const surchargeShape = z.object({
  id: z.string(),
  operator: z.string(),
  /** 加算の対象になる路線名（graph.json の lineName と一致させる） */
  lines: z.array(z.string()),
  /**
   * 対象が路線の一部だけのときの駅名。指定すると、両端がこの集合に入る
   * 区間の距離だけを数える（けいはんな線は長田〜生駒の開業区間だけが対象）
   */
  stations: z.array(z.string()).optional(),
  /** [何kmまで, 加算額] の昇順 */
  table: z.array(z.tuple([z.number(), z.number()])),
  /** 表を超える距離の加算額 */
  beyond: z.number(),
  source: z
    .object({ url: z.string(), fetchedAt: z.string(), note: z.string() })
    .optional(),
});

export const surchargeSchema = surchargeShape.superRefine((s, ctx) => {
  for (let i = 1; i < s.table.length; i++) {
    const prev = s.table[i - 1];
    const cur = s.table[i];
    if (prev === undefined || cur === undefined) continue;
    if (prev[0] >= cur[0]) {
      ctx.addIssue({
        code: "custom",
        path: ["table", i, 0],
        message: `surchargeSchema: table は昇順である必要があります (id="${s.id}")`,
      });
    }
  }
});

export type Surcharge = z.infer<typeof surchargeShape>;

/** 加算対象の路線に乗った距離 km に対する加算額 */
export function surchargeAmount(surcharge: Surcharge, km: number): number {
  // 対象の線に乗っていなければ加算は無い
  if (!(km > 0)) return 0;
  for (const [maxKm, amount] of surcharge.table) {
    if (km <= maxKm) return amount;
  }
  return surcharge.beyond;
}
