// 実額行列だけを持つ事業者のための「下界専用」距離帯表を作る。
//
// なぜ要るか: 営業キロだけでは運賃が決まらない事業者がある（富山地方鉄道は
// 同じ12.1kmに700円の区間と720円の区間がある）。運賃そのものは
// data/fare-overrides/ の実額行列から引くので距離帯表は不要だが、
// lib/search/reachable.ts の枝刈りは「この距離ならこれ以上は安くならない」という
// 下界を要る。実運賃より高い表を置くと正しい経路を刈ってしまうため、
// どのペアの実運賃も上回らない階段を作る。
//
// 距離は data/graph.json の駅間距離（座標から求めて実営業キロで補正した値）で
// 作る。探索が calculator に渡すのはこの距離なので、公表営業キロで帯を切ると
// 境界付近で下界が破れる。グラフを再生成して駅間距離が動くと壊れうるので、
// これは手で書かずに scripts/fare/derive-lower-bound.ts で作り直す。
export interface KmFare {
  km: number;
  fare: number;
}

export interface LowerBoundTable {
  table: [number, number][];
  beyond: { fromKm: number; baseFare: number; ratePerKm: number };
}

// 帯の中に収まる範囲で、いちばん桁の少ない値に丸める（表を読めるようにするため）
function shortest(value: number, min: number, max: number): number {
  for (let digits = 3; digits <= 9; digits++) {
    const scale = 10 ** digits;
    const rounded = Math.round(value * scale) / scale;
    if (min <= rounded && rounded < max) return rounded;
  }
  return value;
}

export function deriveLowerBoundTable(pairs: KmFare[]): LowerBoundTable {
  if (pairs.length === 0)
    return { table: [], beyond: { fromKm: 0, baseFare: 0, ratePerKm: 0 } };

  // 距離は1m単位に丸めてから帯を作る。丸めないと、1e-14 しか違わない2つの距離に
  // 別の運賃が付いているときに境界が実距離とぴったり同値になり、距離を足す順序が
  // 違うだけ（探索とスクリプトは別々にダイクストラを回す）で帯が1つずれて下界が
  // 破れる。丸めで動くのは最大0.5mで、境界は帯の間に0.5m以上取るので覆いは切れない
  const minByKm = new Map<number, number>();
  for (const p of pairs) {
    const km = Math.round(p.km * 1000) / 1000;
    const cur = minByKm.get(km);
    if (cur === undefined || p.fare < cur) minByKm.set(km, p.fare);
  }
  const kms = [...minByKm.keys()].sort((a, b) => a - b);

  // L(km) = min{ある距離km以上の全ペアの運賃}。下界になる単調非減少関数のうち
  // 最大のもの。長いほうが安いペアがあれば短い側の帯もそこまで下がる
  const lower = new Map<number, number>();
  let suffix = Infinity;
  for (let i = kms.length - 1; i >= 0; i--) {
    const km = kms[i]!;
    suffix = Math.min(suffix, minByKm.get(km) ?? Infinity);
    lower.set(km, suffix);
  }

  // 同じ運賃が続くところを1つの帯に畳む
  const bands: { max: number; min: number; fare: number }[] = [];
  for (const km of kms) {
    const fare = lower.get(km) ?? 0;
    const last = bands[bands.length - 1];
    if (last !== undefined && last.fare === fare) last.max = km;
    else bands.push({ max: km, min: km, fare });
  }

  // 境界は帯の最大kmと次の帯の最小kmの中間。距離が少し動いても破れないように
  // 余裕を取る（同じ距離で運賃が違うペアがあると余裕0の境界も出る）
  const table = bands.map<[number, number]>((b, i) => {
    const next = bands[i + 1];
    if (next === undefined) return [b.max, b.fare];
    const mid = (b.max + next.min) / 2;
    return [shortest(mid, b.max, next.min), b.fare];
  });

  const lastKm = kms[kms.length - 1] ?? 0;
  return {
    table,
    beyond: { fromKm: lastKm, baseFare: lower.get(lastKm) ?? 0, ratePerKm: 0 },
  };
}
