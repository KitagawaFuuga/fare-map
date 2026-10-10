import { z } from "zod";

// 全国鉄道運行本数データ（data/raw/kilometrage.csv, CC BY 4.0）の区間営業キロは、
// 距離補正（lib/graph/calibrate.ts）と駅間キロの検証（lib/graph/station-km.ts）の
// 両方で正解として使う。したがって1行の誤りが両方に効く。一次資料と食い違うことを
// 確認した行だけを差し替える。定義と出典は data/kilometrage-corrections.json。
export const kilometrageCorrectionsSchema = z.object({
  corrections: z.array(
    z.object({
      operator: z.string(),
      from: z.string(),
      to: z.string(),
      /** 差し替える前のCSVの値。一致条件に入れて、CSVが直ったら効かなくする */
      csvKm: z.number().positive(),
      officialKm: z.number().positive(),
      note: z.string(),
    }),
  ),
  source: z.object({
    url: z.string(),
    fetchedAt: z.string(),
    note: z.string(),
  }),
});

export type KilometrageCorrections = z.infer<
  typeof kilometrageCorrectionsSchema
>;
export type KilometrageCorrection =
  KilometrageCorrections["corrections"][number];

const key = (operator: string, a: string, b: string): string =>
  [operator, ...[a, b].sort()].join("\u0000");

/**
 * 区間営業キロを差し替える関数を作る。
 * 差し替えるのは事業者・駅ペア・元の値がすべて一致したときだけ。
 */
export function buildKilometrageFix(
  corrections: KilometrageCorrection[],
): (operator: string, from: string, to: string, km: number) => number {
  const byPair = new Map<string, KilometrageCorrection>();
  for (const c of corrections) byPair.set(key(c.operator, c.from, c.to), c);
  return (operator, from, to, km) => {
    const hit = byPair.get(key(operator, from, to));
    if (hit === undefined) return km;
    // 元の値が変わっていたら差し替えない（CSVが直った可能性があるため）
    return Math.abs(hit.csvKm - km) < 1e-9 ? hit.officialKm : km;
  };
}

// 駅一覧の表から読んだ駅間キロ（data/station-km.json）の訂正。表の構造のせいで誤った値を
// 読み、一致の検査でも弾けなかったものだけを、一次資料の値に差し替える。
// 実例: 予讃線の表は累計の列の途中から「伊予長浜経由」の値に切り替わり、新谷（内子経由の
// 237.3）と伊予大洲（伊予長浜経由の249.5）の差12.2kmを駅間として読んでいた（正しくは5.9km）。
// 抽出した値（extractedKm）を一致条件に入れて、記事や読み取りが変われば効かなくする。
export const stationKmCorrectionsSchema = z.object({
  corrections: z.array(
    z.object({
      operator: z.string(),
      from: z.string(),
      to: z.string(),
      extractedKm: z.number().positive(),
      officialKm: z.number().positive(),
      note: z.string(),
    }),
  ),
});

export function buildStationKmFix(
  corrections: z.infer<typeof stationKmCorrectionsSchema>["corrections"],
): (operator: string, from: string, to: string, km: number) => number {
  return buildKilometrageFix(
    corrections.map((c) => ({ ...c, csvKm: c.extractedKm })),
  );
}
