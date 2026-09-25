// 運賃計算に使う距離が営業キロと違う事業者のための計算。
//
// 名鉄は線区ごとに擬制率をかけた「運賃計算キロ程」で運賃を決める
// （A線区=名古屋本線はそのまま、B線区は15%増、C線区は25%増。出典は
//  data/fare-distance-classes.json）。営業キロのまま引くと運賃が安く出る。
// 例: 名鉄名古屋→犬山は営業キロ27.9kmだと28km帯の570円になるが、
// 運賃計算キロは 2.2 + 25.7×1.15 = 31.8 → 32km帯の630円が正しい。
//
// 実行時の運賃計算器は路線を知らないため、これは生成時に使う。

export interface FareLeg {
  km: number;
  /** その線区の擬制率。1.0 なら営業キロそのまま */
  rate: number;
}

// 0.1+0.2 が 0.30000000000000004 になる類の誤差で 1km 増えないよう、
// 切り上げる前に小数第3位で丸める（営業キロは小数第1位までしか公表されない）
const EPSILON_DIGITS = 3;

/** 運賃計算キロ程。擬制率をかけて合計してから 1km 単位に切り上げる */
export function fareCalcKm(legs: FareLeg[]): number {
  if (legs.length === 0) return 0;
  const total = legs.reduce((sum, leg) => sum + leg.km * leg.rate, 0);
  return Math.ceil(Number(total.toFixed(EPSILON_DIGITS)));
}
