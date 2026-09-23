// 運賃表の候補データを採用してよいか判定する。
//
// 公式運賃表(三角表)の PDF は駅名がフォント内蔵エンコードで読めないことが多く、
// 行と列の対応を取り違えても値としては「それらしく」出てしまう
// （scripts/fare/extract/README.md の実例: 富山地方鉄道で行が1つずれると
//   荻生→宇奈月温泉が 740円 ではなく 840円 になる）。
// PDF の中だけで閉じた検査ではこの取り違えを原理的に見抜けないため、
// グラフの駅座標という独立した情報を使う距離単調性を軸に据える。

export interface CandidatePair {
  from: string;
  to: string;
  fare: number;
}

export interface FareCandidate {
  operator: string;
  pairs: CandidatePair[];
}

export interface VerifyContext {
  /** 事業者内の駅間キロ。取れない組は null */
  kmBetween(a: string, b: string): number | null;
  /** 公式に存在する運賃額の一覧。渡されたときだけ所属を検査する */
  allowedFares?: number[];
  /**
   * 距離に逆行する組の割合がこれを超えた駅をエラーにする。
   * 特定運賃があると正しい表でも多少は逆行するため 0 にはできない。
   */
  monotonicityThreshold?: number;
}

export interface Finding {
  check: string;
  severity: "error" | "warn";
  message: string;
  samples: string[];
}

const DEFAULT_THRESHOLD = 0.1;
const MAX_SAMPLES = 5;

const pairKey = (a: string, b: string) => [a, b].sort().join("\u0000");
const show = (key: string) => key.split("\u0000").join("–");

function checkSymmetry(pairs: CandidatePair[]): Finding[] {
  const fares = new Map<string, Set<number>>();
  for (const p of pairs) {
    const key = pairKey(p.from, p.to);
    const set = fares.get(key) ?? new Set<number>();
    set.add(p.fare);
    fares.set(key, set);
  }
  const conflicts = [...fares.entries()].filter(([, s]) => s.size > 1);
  if (conflicts.length === 0) return [];
  return [
    {
      check: "symmetry",
      severity: "error",
      message: `同じ駅ペアに複数の運賃がある: ${conflicts.length} 組`,
      samples: conflicts
        .slice(0, MAX_SAMPLES)
        .map(([key, s]) => `${show(key)}: ${[...s].join(" / ")}円`),
    },
  ];
}

function checkMissingPairs(pairs: CandidatePair[]): Finding[] {
  const stations = [...new Set(pairs.flatMap((p) => [p.from, p.to]))];
  const present = new Set(pairs.map((p) => pairKey(p.from, p.to)));
  const expected = (stations.length * (stations.length - 1)) / 2;
  if (present.size >= expected) return [];

  const missing: string[] = [];
  for (let i = 0; i < stations.length && missing.length < MAX_SAMPLES; i++) {
    for (
      let j = i + 1;
      j < stations.length && missing.length < MAX_SAMPLES;
      j++
    ) {
      const key = pairKey(stations[i] as string, stations[j] as string);
      if (!present.has(key)) missing.push(show(key));
    }
  }
  return [
    {
      check: "missing-pairs",
      severity: "warn",
      message: `${stations.length} 駅なら ${expected} ペアのはずが ${present.size} ペアしかない`,
      samples: missing,
    },
  ];
}

function checkAllowedFares(
  pairs: CandidatePair[],
  allowed: number[] | undefined,
): Finding[] {
  if (!allowed) return [];
  const set = new Set(allowed);
  const bad = [...new Set(pairs.map((p) => p.fare))].filter((f) => !set.has(f));
  if (bad.length === 0) return [];
  return [
    {
      check: "fare-not-allowed",
      severity: "error",
      message: `公式の運賃額一覧に無い値がある: ${bad.length} 種`,
      samples: bad.slice(0, MAX_SAMPLES).map((f) => `${f}円`),
    },
  ];
}

/** 距離順に並べた運賃列の逆行数。ties は逆行に数えない */
function countInversions(sorted: { km: number; fare: number }[]): number {
  let inversions = 0;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (!a || !b) continue;
      // 距離が等しい組は順序に意味が無いので数えない
      if (a.km === b.km) continue;
      if (a.fare > b.fare) inversions++;
    }
  }
  return inversions;
}

function checkDistanceMonotonicity(
  pairs: CandidatePair[],
  ctx: VerifyContext,
): Finding[] {
  const threshold = ctx.monotonicityThreshold ?? DEFAULT_THRESHOLD;
  // 駅ごとに「その駅を含むペア」を集める。行がずれると、その行の運賃だけが
  // 別の駅のものになるため、駅単位で見ると逆行が一点に集中する。
  const fans = new Map<string, { km: number; fare: number }[]>();
  for (const p of pairs) {
    const km = ctx.kmBetween(p.from, p.to);
    if (km === null) continue;
    for (const station of [p.from, p.to]) {
      const fan = fans.get(station) ?? [];
      fan.push({ km, fare: p.fare });
      fans.set(station, fan);
    }
  }

  const offenders: { station: string; rate: number; n: number }[] = [];
  for (const [station, fan] of fans) {
    if (fan.length < 3) continue;
    const sorted = [...fan].sort((a, b) => a.km - b.km);
    const comparable = (fan.length * (fan.length - 1)) / 2;
    if (comparable === 0) continue;
    const rate = countInversions(sorted) / comparable;
    if (rate > threshold) offenders.push({ station, rate, n: fan.length });
  }
  if (offenders.length === 0) return [];

  offenders.sort((a, b) => b.rate - a.rate);
  return [
    {
      check: "distance-monotonicity",
      severity: "error",
      message: `距離が離れるほど安くなる組が多い駅がある: ${offenders.length} 駅（閾値 ${(threshold * 100).toFixed(0)}%）`,
      samples: offenders
        .slice(0, MAX_SAMPLES)
        .map(
          (o) =>
            `${o.station}: 逆行 ${(o.rate * 100).toFixed(1)}% (${o.n} ペア)`,
        ),
    },
  ];
}

export function verifyFareCandidate(
  candidate: FareCandidate,
  ctx: VerifyContext,
): Finding[] {
  return [
    ...checkSymmetry(candidate.pairs),
    ...checkMissingPairs(candidate.pairs),
    ...checkAllowedFares(candidate.pairs, ctx.allowedFares),
    ...checkDistanceMonotonicity(candidate.pairs, ctx),
  ];
}
