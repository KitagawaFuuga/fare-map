import { z } from "zod";

// lib/fare/calculator.ts の tableFare は table が maxKm の厳密な昇順であることを
// 前提に二分探索する。同値も不可: 二分探索は「km <= maxKm を満たす最初の行」を
// 一意に定めることに依っており、maxKm が重複すると探索順序と挿入順序が食い違う
// 場合に線形走査と異なる行を返しうる。ここで壊れたデータを弾かないと、探索は
// エラーにならず静かに違う運賃を返す。
const fareRuleShape = z.object({
  id: z.string(),
  operators: z.array(z.string()), // 空配列 = フォールバック
  table: z.array(z.tuple([z.number(), z.number()])), // [kmまで, 運賃円] 昇順
  beyond: z.object({
    fromKm: z.number(),
    baseFare: z.number(),
    ratePerKm: z.number(),
  }),
  source: z
    .object({
      url: z.string(),
      fetchedAt: z.string(),
      note: z.string(),
    })
    .optional(),
});

export const fareRuleSchema = fareRuleShape.superRefine((rule, ctx) => {
  for (let i = 1; i < rule.table.length; i++) {
    const prev = rule.table[i - 1];
    const cur = rule.table[i];
    if (prev === undefined || cur === undefined) continue;
    if (prev[0] >= cur[0]) {
      ctx.addIssue({
        code: "custom",
        path: ["table", i, 0],
        message:
          `fareRuleSchema: table は maxKm の厳密な昇順である必要があります ` +
          `(id="${rule.id}"): table[${i - 1}].maxKm=${prev[0]} >= table[${i}].maxKm=${cur[0]}`,
      });
    }
  }
});
export type FareRule = z.infer<typeof fareRuleShape>;

export const fareOverrideSchema = z.object({
  operator: z.string(),
  pairs: z.array(
    z.object({
      from: z.string(), // 駅名（graph.json の name と一致させる）
      to: z.string(),
      fare: z.number().int().positive(),
    }),
  ),
  source: z.object({
    url: z.string(),
    fetchedAt: z.string(),
    note: z.string(),
  }),
});
export type FareOverride = z.infer<typeof fareOverrideSchema>;

// 事業者の一部の区間だけに使う別の運賃表。発着の両駅がこの区間内にあるとき、
// 事業者の運賃表の代わりに引く（特定運賃がある組はそちらが優先）。
// 実例: JR西日本「大阪附近の電車特定区間」。区間内相互の移動は幹線より安い表になる
// （71〜80kmは幹線1,340円に対し1,300円）。
//
// 発着の両駅で判定するのは、JRが大都市近郊区間の運賃を最短経路で計算するため。
// 最短経路がいったん区間外へ出るような組はまれで、そこだけは幹線になるべきところを
// 区間の表で引く（安く出る）。
export const fareZoneSchema = z
  .object({
    id: z.string(),
    operator: z.string(),
    /** 区間内の駅名（graph.json の表記） */
    stations: z.array(z.string()).min(1),
    table: z.array(z.tuple([z.number(), z.number()])),
    beyond: z.object({
      fromKm: z.number(),
      baseFare: z.number(),
      ratePerKm: z.number(),
    }),
    source: z.object({
      url: z.string(),
      fetchedAt: z.string(),
      note: z.string(),
    }),
  })
  .superRefine((zone, ctx) => {
    // tableFare は二分探索するので、運賃表と同じく厳密な昇順を要求する
    for (let i = 1; i < zone.table.length; i++) {
      const prev = zone.table[i - 1];
      const cur = zone.table[i];
      if (prev !== undefined && cur !== undefined && prev[0] >= cur[0]) {
        ctx.addIssue({
          code: "custom",
          path: ["table", i, 0],
          message: `fareZoneSchema: table は maxKm の厳密な昇順である必要があります (id="${zone.id}")`,
        });
      }
    }
  });
export type FareZone = z.infer<typeof fareZoneSchema>;
