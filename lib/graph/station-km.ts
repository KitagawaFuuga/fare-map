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

import { buildNameLookup, matchKey } from "@/lib/graph/station-name";

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
  /** 採用した (表, 列) と、それが説明できた区間の数・食い違った数 */
  accepted: {
    table: number;
    column: number;
    matched: number;
    contradicted: number;
  }[];
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

/**
 * 脚注・記号・かっこ書きを落として、グラフ側の駅名表記に寄せる。
 *
 * 記号は駅名の後ろに付く（「伊勢中川駅#」「京都駅↷」「乙駅※」）ので、記号を先に
 * 落とさないと末尾の「駅」を外せず、その行がまるごと突き合わせから漏れる。
 * 記号の種類は記事ごとに増えるため列挙で追いかけず、末尾にある
 * 「かな・漢字・英数字以外」をまとめて落とす。
 */
export function normalizeStationName(raw: string): string {
  const trailingJunk =
    /[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9ー]+$/u;
  // 首都圏・関西圏の駅一覧は駅名のうしろに特定都区市内の記号を置く
  // （根岸線は「横浜駅 浜」、大阪環状線は「大阪駅 阪」）。記号は漢字なので
  // 下の trailingJunk では外れず、末尾の「駅」も外せないまま行ごと漏れる。
  // 「〜駅」＋空白＋3文字以内、でセルが終わる形だけを落とす。接続路線の欄に入る
  // 「甲駅 - 乙駅間は複線」のような文はこの形にならないので巻き込まない
  const cityMarker = /^(.+?駅)[\s　]+[^\s　]{1,3}$/u;
  // 路線図テンプレートの表は駅名セルの頭に駅ナンバリングを置く
  // （東京メトロ有楽町線は「Y-01 和光市駅」）。英字1〜3＋任意のハイフン＋数字が
  // 空白で区切られて先頭にある形だけを落とす。駅名そのものがこの形になることは
  // 無い（「Ｂ６」のような駅名は全角で、空白でも区切られない）
  const stationNumber = /^[A-Za-z]{1,3}[-‐–]?[0-9]{1,3}[\s　]+(?=.)/u;
  return raw
    .replace(/\[[^\]]*\]/g, "")
    .replace(stationNumber, "")
    .replace(cityMarker, "$1")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim()
    .replace(trailingJunk, "")
    .replace(/駅$/, "")
    .replace(trailingJunk, "")
    .trim();
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
  lookup: Map<string, string>,
  tableIndex: number,
): Chain | null {
  const points: { station: string; km: number }[] = [];
  for (const row of table) {
    // 行の中で最初にグラフの駅名と一致したセルを駅名とみなす。
    // 信号場・貨物駅の行はどのセルも一致しないので自然に落ちる。
    // 記事とグラフで表記が揺れる（箱根ヶ崎/箱根ケ崎など）ので、
    // 突き合わせは lib/graph/station-name.ts の鍵で行い、採るのはグラフ側の表記
    const station = row
      .map((cell) => lookup.get(matchKey(normalizeStationName(cell))))
      .find((n) => n !== undefined && n !== "");
    if (station === undefined) continue;
    const km = numberIn(row[column] ?? "");
    if (km === null) continue;
    // 同じ駅が2回出る表（環状線の起終点など）は後ろを捨てる
    if (points.some((p) => p.station === station)) continue;
    points.push({ station, km });
  }
  if (points.length < MIN_STATIONS) return null;
  const run = longestMonotoneRun(points);
  if (run === null) return null;
  return { table: tableIndex, column, points: run };
}

// 正しい列でも数個だけ正解と食い違うことがある。累計の差は「その路線に沿った
// 距離」だが、正解の営業キロは運賃の経路（＝最短）なので、環状線を遠回りに回った
// 区間や短絡線がある区間では両者が一致しない。実例: 山手線は東京-田町が公表4.6km
// （東海道線経由）に対し表は遠回りの29.9kmで、これ1つで30駅ぶんの表を落としていた。
//
// 一方、列の取り違えは必ず「一致0」になる。全国の表を調べると、矛盾を含む340列は
// すべて一致0で、一致がありつつ矛盾もある列は57列しかなかった。したがって
// 「矛盾0」ではなく「一致が矛盾より十分多い」を条件にする。
/**
 * 累計として読める最長の連続部分を返す。読めなければ null。
 *
 * 累計は単調になるので、上下する列（駅間）はここで落ちる。ただし列全体に単調性を
 * 要求してはいけない。路線記事の駅一覧は先頭や末尾に接続路線の区間を混ぜることが
 * あり、石北本線の累計列は「旭川3.7 → 新旭川0.0」（宗谷本線の降順）のあと
 * 「新旭川0.0 → 網走234.0」と続くV字になっている。
 *
 * 向きも問わない。終点側からの累計が降順に並ぶ記事がある（湖西線・釧網本線）ので、
 * 降順なら昇順に並べ替えて返す。
 */
function longestMonotoneRun(
  points: { station: string; km: number }[],
): { station: string; km: number }[] | null {
  let best: { station: string; km: number }[] | null = null;
  for (const direction of [1, -1]) {
    let start = 0;
    for (let i = 1; i <= points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const broken =
        cur === undefined ||
        prev === undefined ||
        (cur.km - prev.km) * direction < 0;
      if (!broken) continue;
      const run = points.slice(start, i);
      const first = run[0];
      const last = run[run.length - 1];
      // 端が同じ値なら距離の情報が無い
      if (
        run.length >= MIN_STATIONS &&
        first !== undefined &&
        last !== undefined &&
        first.km !== last.km &&
        (best === null || run.length > best.length)
      ) {
        best = direction === 1 ? run : [...run].reverse();
      }
      start = i;
    }
  }
  return best;
}

const MATCH_RATIO = 3;
// 経路が違えばキロは大きく変わる。これ未満の差は別経路では説明がつかないので、
// 資料の食い違い（または列の取り違え）として棄却する。実データでは別経路による
// 矛盾が 1.2〜25.3km、資料の食い違いが 0.2〜0.8km で、間が空いていた。
const ROUTE_DIFF_KM = 1.0;

/**
 * この並びが説明できた区間の数と、食い違った駅ペア。
 *
 * small が1つでもあれば失格。large は MATCH_RATIO の比で判定する。
 */
function scoreChain(
  chain: Chain,
  known: Map<string, number>,
  tolerance: number,
): { matched: number; large: Set<string>; small: number } {
  let matched = 0;
  let small = 0;
  const large = new Set<string>();
  for (let i = 0; i < chain.points.length; i++) {
    for (let j = i + 1; j < chain.points.length; j++) {
      const a = chain.points[i];
      const b = chain.points[j];
      if (a === undefined || b === undefined) continue;
      const key = edgeKey(a.station, b.station);
      const expected = known.get(key);
      if (expected === undefined) continue;
      const gap = Math.abs(b.km - a.km - expected);
      if (gap <= tolerance) matched++;
      else if (gap >= ROUTE_DIFF_KM) large.add(key);
      else small++;
    }
  }
  return { matched, large, small };
}

/**
 * 採用した並びから、その中の全駅ペアの距離を正解に足す。
 *
 * 食い違ったペアを除く必要は無い。食い違ったということは既に正解を持っている
 * ということなので、下の !known.has で自然に残る（環状線の遠回りのような値で
 * 上書きしない）。
 */
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
  const lookup = buildNameLookup(options.stationNames);
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
      let best: {
        chain: Chain;
        matched: number;
        contradicted: Set<string>;
      } | null = null;
      for (let column = 0; column < width; column++) {
        const chain = readChain(table, column, lookup, tableIndex);
        if (chain === null) continue;
        const { matched, large, small } = scoreChain(chain, known, tolerance);
        if (matched === 0 || small > 0) continue;
        if (matched < large.size * MATCH_RATIO) continue;
        if (best === null || matched > best.matched)
          best = { chain, matched, contradicted: large };
      }
      if (best === null) continue;

      pending.delete(tableIndex);
      acceptedThisRound++;
      result.accepted.push({
        table: tableIndex,
        column: best.chain.column,
        matched: best.matched,
        contradicted: best.contradicted.size,
      });
      addKnownPairs(best.chain, known);
      const points = best.chain.points;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        if (prev === undefined || cur === undefined) continue;
        const key = edgeKey(prev.station, cur.station);
        const km = Number((cur.km - prev.km).toFixed(2));
        // 食い違ったペアは出さない（環状線の遠回りなど、路線に沿った距離が
        // 公表営業キロと違う区間）。先に入ったほうを残す
        if (best.contradicted.has(key)) continue;
        if (!result.edgeKm.has(key)) result.edgeKm.set(key, km);
      }
    }
    if (acceptedThisRound === 0) break;
  }
  result.rejected = pending.size;
  return result;
}
