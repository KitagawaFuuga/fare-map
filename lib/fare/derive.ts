// 実運賃の観測点「(営業キロ, 運賃)」の集合から、対キロ区間制の距離帯テーブルを復元する。
//
// 各社の公式運賃表はPDFの形式がばらばらで、駅名が読めなかったり行が折り返しで
// 崩れたりする。一方で「全駅ペアの運賃と営業キロ」さえ拾えれば、駅名が分からなくても
// 距離帯は決まる。この関数はその復元と、復元結果が本当に観測点を再現するかの
// 自己検証を担う。
//
// 自己検証が重要な理由: PDFの解析を誤ると運賃が静かに間違う（実際に北総鉄道と
// 長良川鉄道で行と駅の対応を誤りかけた）。観測点が「距離の単調非減少な階段関数」に
// 乗らない場合は解析ミスか、そもそも対キロ制でないかのどちらかなので、
// テーブルを出さずに問題として報告する。

export interface KmFarePair {
  km: number;
  fare: number;
}

export interface DerivedBand {
  maxKm: number;
  fare: number;
  // この帯の上限が取りうる範囲 [この帯で観測した最大キロ, 次の帯で観測した最小キロ)。
  // 範囲に整数がちょうど1つだけ含まれるとき pinned=true（上限が一意に決まった）。
  boundaryRange: [number, number] | null;
  pinned: boolean;
  observed: number; // この帯を支える観測点の数
}

export interface DeriveResult {
  ok: boolean;
  table: [number, number][];
  bands: DerivedBand[];
  problems: string[];
  pairCount: number;
  // 上限が一意に決まらなかった帯の数。0 でなければ観測点を増やすべき
  unpinned: number;
}

// derive した table を lib/fare/calculator.ts の tableFare と同じ規則で引く。
// 復元結果が観測点を再現するかの検証に使う（calculator を import すると
// FareRule 全体を組み立てる必要があるため、ここでは同じ規則を最小限で再現する）。
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
      pairCount: 0,
      unpinned: 0,
    };
  }

  // 同一キロで運賃が食い違う観測点は、対キロ制では起こりえない。
  // 解析ミスか、特定運賃・加算運賃が混ざっているかのどちらか。
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

  // 運賃ごとの観測キロの最小・最大
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

    // 上限は [cur.max, next.min) のどこか。この範囲の整数を候補にする
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

  // 復元したテーブルが観測点を全部再現するかの自己検証。
  // ここが通らないテーブルは採用してはいけない。
  let mismatches = 0;
  for (const p of clean) {
    if (lookup(table, p.km) !== p.fare) mismatches++;
  }
  if (mismatches > 0) {
    problems.push(
      `復元したテーブルが観測点 ${mismatches}/${clean.length} 件を再現しない`,
    );
  }

  const unpinned = bands.filter((b) => !b.pinned).length;
  return {
    ok: problems.length === 0,
    table,
    bands,
    problems,
    pairCount: clean.length,
    unpinned,
  };
}
