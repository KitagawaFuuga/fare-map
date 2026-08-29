import { z } from "zod";

export const fareRuleSchema = z.object({
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
export type FareRule = z.infer<typeof fareRuleSchema>;

export const fareOverrideSchema = z.object({
  operator: z.string(),
  pairs: z.array(
    z.object({
      from: z.string(), // 駅名（graph.json の name と一致させる）
      to: z.string(),
      fare: z.number().int().positive(),
    }),
  ),
  source: z.object({ url: z.string(), fetchedAt: z.string(), note: z.string() }),
});
export type FareOverride = z.infer<typeof fareOverrideSchema>;
