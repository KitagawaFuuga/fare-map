import { z } from "zod";

// グラフ側（駅データ.jp）の事業者名は通称で、実営業キロ側（全国鉄道運行本数データ）は
// 登記上の社名。東京メトロ＝東京地下鉄、京急電鉄＝京浜急行電鉄、南海電鉄＝南海電気鉄道。
// 合わないと34事業者・1,528レールエッジが「正解に使える区間が無い」で棄却され、
// 距離補正も全国中央値に落ちる。定義と裏取りは data/operator-aliases.json。
export const operatorAliasesSchema = z.object({
  aliases: z.array(
    z.object({
      graph: z.string(),
      csv: z.string(),
      // 両端がそのグラフ事業者の駅であるCSV行の数。対応が正しいことの裏取り
      sections: z.number().int().positive(),
    }),
  ),
  source: z.object({
    url: z.string(),
    fetchedAt: z.string(),
    note: z.string(),
  }),
});

export type OperatorAliases = z.infer<typeof operatorAliasesSchema>;
export type OperatorAliasEntry = OperatorAliases["aliases"][number];

/** グラフ側の事業者名を、実営業キロ側の事業者名に直す */
export function csvOperatorOf(
  aliases: OperatorAliasEntry[],
  graphOperator: string,
): string {
  return aliases.find((a) => a.graph === graphOperator)?.csv ?? graphOperator;
}
