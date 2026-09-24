// 路線記事の駅一覧（表）から、隣接駅間の営業キロを取り出す。
//
// 駅一覧の表は「駅間」「累計（起点A から）」「累計（起点B から）」のように
// 数値の列が複数並ぶことがあり（実例: 内房線は蘇我からと千葉からが並ぶ）、
// 列を1本取り違えると営業キロが全部狂う。表の中だけを見ても
// どの列が正しいかは決められないので、外部の実営業キロ（区間単位）を
// 正解として突き合わせ、合った列だけを採用する。
//
// 出すのは累計値ではなく隣接駅間の距離。累計は起点の取り方で値が変わるが、
// 差はどの列を採っても同じで、運賃計算に要るのも差のほうである。

export interface KmSection {
  from: string;
  to: string;
  officialKm: number;
}

export interface StationKmOptions {
  /** この路線に属する駅名（グラフ側の表記） */
  stationNames: Set<string>;
  /** 正解として使う実営業キロ。空なら何も採用しない */
  sections: KmSection[];
  /** 区間キロとの許容差。既定 0.15km（資料間の丸め差を吸収する幅） */
  toleranceKm?: number;
}

export interface StationKmResult {
  /** 隣接駅間の営業キロ。キーは駅名2つを並べ替えて NUL で繋いだもの */
  edgeKm: Map<string, number>;
  /** 採用した (表, 列) と、それが説明できた区間の数 */
  accepted: { table: number; column: number; matched: number }[];
  /** 検証で落とした (表, 列) の数 */
  rejected: number;
  /** 正解に使える区間が無く、判断そのものができなかった */
  unverifiable: boolean;
}

const DEFAULT_TOLERANCE_KM = 0.15;
// 2駅でも、実営業キロの区間と一致することが採用条件なので取り違えは起きにくい。
// 路線記事は区間ごとに表が分かれることがあり、末尾の表が2駅だけのこともある
const MIN_STATIONS = 2;

export const edgeKey = (a: string, b: string): string =>
  [a, b].sort().join("\u0000");

/** 脚注・記号・かっこ書きを落として、グラフ側の駅名表記に寄せる */
export function normalizeStationName(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[※＊*†‡]/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim()
    .replace(/駅$/, "");
}

function numberIn(cell: string): number | null {
  const m = /-?\d+(?:\.\d+)?/.exec(cell.replace(/,/g, ""));
  if (m === null) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

interface Chain {
  table: number;
  column: number;
  points: { station: string; km: number }[];
}

/** 表の1列を「駅名 → 累計キロ」の並びとして読む。読めなければ null */
function readChain(
  table: string[][],
  column: number,
  stationNames: Set<string>,
  tableIndex: number,
): Chain | null {
  const points: { station: string; km: number }[] = [];
  for (const row of table) {
    // 行の中で最初にグラフの駅名と一致したセルを駅名とみなす。
    // 信号場・貨物駅の行はどのセルも一致しないので自然に落ちる。
    const station = row
      .map(normalizeStationName)
      .find((n) => n !== "" && stationNames.has(n));
    if (station === undefined) continue;
    const km = numberIn(row[column] ?? "");
    if (km === null) continue;
    // 同じ駅が2回出る表（環状線の起終点など）は後ろを捨てる
    if (points.some((p) => p.station === station)) continue;
    points.push({ station, km });
  }
  if (points.length < MIN_STATIONS) return null;
  // 累計なら単調非減少になる。駅間の列はここで落ちる
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (prev === undefined || cur === undefined) return null;
    if (cur.km < prev.km) return null;
  }
  // 全部同じ値なら距離の情報が無い
  if (points[0]?.km === points[points.length - 1]?.km) return null;
  return { table: tableIndex, column, points };
}

/** この並びが正解の駅間距離をいくつ説明できるか。矛盾が1つでもあれば失格 */
function scoreChain(
  chain: Chain,
  known: Map<string, number>,
  tolerance: number,
): number | null {
  let matched = 0;
  for (let i = 0; i < chain.points.length; i++) {
    for (let j = i + 1; j < chain.points.length; j++) {
      const a = chain.points[i];
      const b = chain.points[j];
      if (a === undefined || b === undefined) continue;
      const expected = known.get(edgeKey(a.station, b.station));
      if (expected === undefined) continue;
      if (Math.abs(b.km - a.km - expected) > tolerance) return null;
      matched++;
    }
  }
  return matched;
}

/** 採用した並びから、その中の全駅ペアの距離を正解に足す */
function addKnownPairs(chain: Chain, known: Map<string, number>): void {
  for (let i = 0; i < chain.points.length; i++) {
    for (let j = i + 1; j < chain.points.length; j++) {
      const a = chain.points[i];
      const b = chain.points[j];
      if (a === undefined || b === undefined) continue;
      const key = edgeKey(a.station, b.station);
      if (!known.has(key)) known.set(key, Math.abs(b.km - a.km));
    }
  }
}

export function extractStationKm(
  tables: string[][][],
  options: StationKmOptions,
): StationKmResult {
  const tolerance = options.toleranceKm ?? DEFAULT_TOLERANCE_KM;
  const result: StationKmResult = {
    edgeKm: new Map(),
    accepted: [],
    rejected: 0,
    unverifiable: options.sections.length === 0,
  };
  if (result.unverifiable) return result;

  // 正解の駅間距離。最初は実営業キロの区間だけで、表を1つ採用するたびに
  // その表から読めた駅ペアを足す。路線記事は区間ごとに表が分かれ、実営業キロの
  // 区間が1つも載っていない表が出るため、採用済みの表を正解として伝播させる。
  const known = new Map<string, number>();
  for (const s of options.sections) {
    known.set(edgeKey(s.from, s.to), s.officialKm);
  }

  const pending = new Set(tables.keys());
  // 伝播するので、1周では決まらない。何も採用できなくなるまで回す
  for (let round = 0; round < tables.length + 1 && pending.size > 0; round++) {
    let acceptedThisRound = 0;
    for (const tableIndex of [...pending]) {
      const table = tables[tableIndex];
      if (table === undefined) {
        pending.delete(tableIndex);
        continue;
      }
      const width = Math.max(0, ...table.map((r) => r.length));
      // 1つの表の中で複数の列が通ることがある（累計が2本ある表）。
      // 差はどちらも同じなので、説明できた組が最多の列を1本だけ採る。
      let best: { chain: Chain; matched: number } | null = null;
      for (let column = 0; column < width; column++) {
        const chain = readChain(
          table,
          column,
          options.stationNames,
          tableIndex,
        );
        if (chain === null) continue;
        const matched = scoreChain(chain, known, tolerance);
        if (matched === null || matched === 0) continue;
        if (best === null || matched > best.matched) best = { chain, matched };
      }
      if (best === null) continue;

      pending.delete(tableIndex);
      acceptedThisRound++;
      result.accepted.push({
        table: tableIndex,
        column: best.chain.column,
        matched: best.matched,
      });
      addKnownPairs(best.chain, known);
      const points = best.chain.points;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        if (prev === undefined || cur === undefined) continue;
        const key = edgeKey(prev.station, cur.station);
        const km = Number((cur.km - prev.km).toFixed(2));
        // 採用済みと食い違う表は scoreChain で落ちているので、ここに来る値は
        // 既存と一致する。先に入ったほうを残す
        if (!result.edgeKm.has(key)) result.edgeKm.set(key, km);
      }
    }
    if (acceptedThisRound === 0) break;
  }
  result.rejected = pending.size;
  return result;
}
