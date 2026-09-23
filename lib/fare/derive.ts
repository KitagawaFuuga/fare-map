// 観測点「(営業キロ, 運賃)」の集合から距離帯テーブルを復元する。駅名が読めないPDFでも
// 全駅ペアの運賃とキロさえ拾えれば帯は決まる。解析ミスは運賃を静かに間違えるので、
// 観測点が単調非減少な階段関数に乗らなければ表を出さず problems に報告する。

export interface KmFarePair {
  km: number;
  fare: number;
}

export interface DerivedBand {
  maxKm: number;
  fare: number;
  // 上限の取りうる範囲 [この帯の最大キロ, 次の帯の最小キロ)。整数が1つなら pinned
  boundaryRange: [number, number] | null;
  pinned: boolean;
  observed: number; // この帯を支える観測点の数
}

export interface DeriveResult {
  ok: boolean;
  table: [number, number][];
  bands: DerivedBand[];
  problems: string[];
  // ok は false にしないが、そのまま採用すると危険な兆候
  warnings: string[];
  pairCount: number;
  // 上限が一意に決まらなかった帯の数。0 でなければ観測点を増やすべき
  unpinned: number;
}

// calculator.ts の tableFare と同じ引き方。FareRule を組まずに自己検証したいので再掲
function lookup(table: [number, number][], km: number): number | undefined {
  for (const row of table) {
    if (km <= row[0]) return row[1];
  }
  return undefined;
}

export function deriveFareTable(pairs: KmFarePair[]): DeriveResult {
  const problems: string[] = [];
  const clean = pairs.filter((p) => Number.isFinite(p.km) && p.km > 0);
  if (clean.length === 0) {
    return {
      ok: false,
      table: [],
      bands: [],
      problems: ["観測点が0件"],
      warnings: [],
      pairCount: 0,
      unpinned: 0,
    };
  }

  // 対キロ制では起こりえない。解析ミスか、特定運賃が混ざっている
  const fareByKm = new Map<number, Set<number>>();
  for (const p of clean) {
    const set = fareByKm.get(p.km) ?? new Set<number>();
    set.add(p.fare);
    fareByKm.set(p.km, set);
  }
  for (const [km, fares] of fareByKm) {
    if (fares.size > 1) {
      problems.push(
        `同じ ${km}km に複数の運賃 (${[...fares].sort((a, b) => a - b).join(", ")})`,
      );
    }
  }

  const byFare = new Map<number, { min: number; max: number; count: number }>();
  for (const p of clean) {
    const cur = byFare.get(p.fare);
    if (cur === undefined) {
      byFare.set(p.fare, { min: p.km, max: p.km, count: 1 });
    } else {
      cur.min = Math.min(cur.min, p.km);
      cur.max = Math.max(cur.max, p.km);
      cur.count++;
    }
  }

  const fares = [...byFare.keys()].sort((a, b) => a - b);
  const bands: DerivedBand[] = [];
  for (let i = 0; i < fares.length; i++) {
    const fare = fares[i];
    if (fare === undefined) continue;
    const cur = byFare.get(fare);
    if (cur === undefined) continue;
    const nextFare = fares[i + 1];
    const next = nextFare === undefined ? undefined : byFare.get(nextFare);

    if (next === undefined) {
      // 最終帯。上限は観測した最大キロをそのまま使う（これ以上は情報が無い）
      bands.push({
        maxKm: cur.max,
        fare,
        boundaryRange: null,
        pinned: false,
        observed: cur.count,
      });
      continue;
    }

    if (cur.max >= next.min) {
      // 安い運賃の観測キロが、高い運賃の観測キロ以上まで伸びている＝階段関数でない
      problems.push(
        `帯が重なっている: ${fare}円 が ${cur.max}km まであるのに ` +
          `${nextFare}円 が ${next.min}km から始まる`,
      );
      continue;
    }

    const lo = cur.max;
    const hi = next.min;
    const firstInt = Math.ceil(lo);
    const candidates: number[] = [];
    for (let v = firstInt; v < hi; v++) candidates.push(v);

    // 範囲に整数が無ければ、観測した最大キロをそのまま上限にする（観測点は再現できる）
    const maxKm = candidates.length > 0 ? candidates[0]! : cur.max;
    bands.push({
      maxKm,
      fare,
      boundaryRange: [lo, hi],
      pinned: candidates.length === 1,
      observed: cur.count,
    });
  }

  const table: [number, number][] = bands.map((b) => [b.maxKm, b.fare]);

  // 自己検証。ここが通らない表は採用してはいけない
  let mismatches = 0;
  for (const p of clean) {
    if (lookup(table, p.km) !== p.fare) mismatches++;
  }
  if (mismatches > 0) {
    problems.push(
      `復元したテーブルが観測点 ${mismatches}/${clean.length} 件を再現しない`,
    );
  }

  // 以下は ok を落とさない警告。観測点が粗い/少ないと自己検証は通ってしまう
  // （2点なら必ず通る）。踏んだ実例は derive.test.ts にテストとして残してある
  const warnings: string[] = [];
  if (clean.length < 6 || bands.length < 3) {
    warnings.push(
      `観測点が ${clean.length} 点・帯が ${bands.length} 本しかない。` +
        `この規模では自己検証はほぼ無条件に通るため、復元結果を信用してはいけない`,
    );
  }
  for (const b of bands) {
    if (b.boundaryRange === null || b.pinned) continue;
    const [lo, hi] = b.boundaryRange;
    const gap = hi - lo;
    if (gap >= 2) {
      warnings.push(
        `${b.fare}円 の上限が ${lo}〜${hi}km の範囲に絞れていない。` +
          `この間に別の帯が隠れている可能性がある`,
      );
    }
  }
  if (bands.some((b) => b.observed <= 1)) {
    warnings.push(
      "観測点が1点しかない帯がある。単一の起点からのデータだけで復元していないか確認すること",
    );
  }

  const unpinned = bands.filter((b) => !b.pinned).length;
  return {
    ok: problems.length === 0,
    table,
    bands,
    problems,
    warnings,
    pairCount: clean.length,
    unpinned,
  };
}
