import { z } from "zod";

export const fareRuleSchema = z.object({
  id: z.string(),
  operators: z.array(z.string()), // 空配列 = フォールバック
  table: z.array(z.tuple([z.number(), z.number()])), // [kmまで, 運賃円] 昇順
  beyond: z.object({ fromKm: z.number(), baseFare: z.number(), ratePerKm: z.number() }),
});
export type FareRule = z.infer<typeof fareRuleSchema>;
