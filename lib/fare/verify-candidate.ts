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
  /**
   * 駅を1つずらした版の逆行率が、正データの何倍を超えたら
   * 「この事業者には距離検査が効く」とみなすか。
   */
  sensitivityRatio?: number;
}

export interface Finding {
  check: string;
  severity: "error" | "warn";
  message: string;
  samples: string[];
}

// 正データでも特定運賃のぶんだけ逆行するため 0 にはできない。手元の6事業者の
// 実測では正データの最大が 9.09%(北陸鉄道)、駅を1つずらすと 51〜92% に跳ねる。
const DEFAULT_THRESHOLD = 0.2;
// ずらした版がこの倍率を超えて悪化しないなら、距離では運賃を区別できていない。
// 実測では万葉線(均一運賃)が 1.8倍、他の5事業者は 5.6〜139倍とはっきり分かれる。
const DEFAULT_SENSITIVITY_RATIO = 3;
// 倍率だけだと正データの逆行率が 0 に近いときに過敏になるので下限を置く。
const SENSITIVITY_FLOOR = 0.05;
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

/** 駅ごとに「その駅を含み、距離が取れるペア」を集める */
function buildFans(
  pairs: CandidatePair[],
  kmBetween: VerifyContext["kmBetween"],
): Map<string, { km: number; fare: number }[]> {
  const fans = new Map<string, { km: number; fare: number }[]>();
  for (const p of pairs) {
    const km = kmBetween(p.from, p.to);
    if (km === null) continue;
    for (const station of [p.from, p.to]) {
      const fan = fans.get(station) ?? [];
      fan.push({ km, fare: p.fare });
      fans.set(station, fan);
    }
  }
  return fans;
}

/** 駅ごとの逆行率を出す。行がずれると、その行の運賃だけが別の駅のものになる */
function inversionRates(
  pairs: CandidatePair[],
  kmBetween: VerifyContext["kmBetween"],
): { station: string; rate: number; n: number }[] {
  const fans = buildFans(pairs, kmBetween);
  const rates: { station: string; rate: number; n: number }[] = [];
  for (const [station, fan] of fans) {
    if (fan.length < 3) continue;
    const comparable = (fan.length * (fan.length - 1)) / 2;
    if (comparable === 0) continue;
    const sorted = [...fan].sort((a, b) => a.km - b.km);
    rates.push({
      station,
      rate: countInversions(sorted) / comparable,
      n: fan.length,
    });
  }
  return rates;
}

const maxRate = (rates: { rate: number }[]) =>
  rates.reduce((m, r) => (r.rate > m ? r.rate : m), 0);

/**
 * 発駅のラベルを距離順に1つずらした版を作る。PDF の行と駅の対応を
 * 1つ取り違えた状態にあたる。これを自分で作って比べることで、
 * 「この事業者に距離検査が効くのか」をデータだけから判定できる。
 */
function shiftStationLabels(
  pairs: CandidatePair[],
  kmBetween: VerifyContext["kmBetween"],
): CandidatePair[] | null {
  const stations = [...new Set(pairs.flatMap((p) => [p.from, p.to]))];
  const anchor = stations[0];
  if (anchor === undefined) return null;
  const ordered = stations
    .map((s) => ({ s, d: s === anchor ? 0 : kmBetween(anchor, s) }))
    .filter((x): x is { s: string; d: number } => x.d !== null)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.s);
  if (ordered.length < 4) return null;
  const moved = new Map<string, string>();
  ordered.forEach((s, i) => {
    moved.set(s, ordered[(i + 1) % ordered.length] as string);
  });
  return pairs.map((p) => ({ ...p, from: moved.get(p.from) ?? p.from }));
}

function checkDistanceMonotonicity(
  pairs: CandidatePair[],
  ctx: VerifyContext,
): Finding[] {
  const threshold = ctx.monotonicityThreshold ?? DEFAULT_THRESHOLD;
  const ratio = ctx.sensitivityRatio ?? DEFAULT_SENSITIVITY_RATIO;

  const rates = inversionRates(pairs, ctx.kmBetween);
  if (rates.length === 0) return [];
  const offenders = rates
    .filter((r) => r.rate > threshold)
    .sort((a, b) => b.rate - a.rate);
  if (offenders.length > 0) {
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

  // 通ったからといって検証できたとは限らない。均一運賃やゾーン運賃の事業者は
  // 距離を変えても運賃が動かないので、行がずれてもこの検査では見抜けない。
  // 「所見なし」を「検証できた」と誤読させないため、無力であることを明示する。
  const shifted = shiftStationLabels(pairs, ctx.kmBetween);
  if (shifted) {
    const base = maxRate(rates);
    const worst = maxRate(inversionRates(shifted, ctx.kmBetween));
    if (worst <= Math.max(base * ratio, SENSITIVITY_FLOOR)) {
      return [
        {
          check: "distance-check-ineffective",
          severity: "warn",
          message:
            "運賃が距離をほとんど区別しないため、距離単調性では行ズレを検出できない。別の方法で検証すること",
          samples: [
            `正データの逆行 ${(base * 100).toFixed(2)}% / 駅を1つずらしても ${(worst * 100).toFixed(2)}%`,
            `運賃の種類 ${new Set(pairs.map((p) => p.fare)).size} 種`,
          ],
        },
      ];
    }
  }

  // 表全体では距離が効いていても、均一運賃の路線を併営している事業者では
  // その路線の駅だけ検証されないまま通ってしまう（実例: 東京都交通局は
  // 地下鉄4線が距離制、都電荒川線が均一170円で、両者をまたぐ運賃ペアが無い。
  // 全体で見ると地下鉄のペアに薄められて荒川線の870ペアが素通りする）。
  // 駅単位で見て、運賃が1種類しかない駅は距離では検証できないと明示する。
  const blind = [...buildFans(pairs, ctx.kmBetween)]
    .filter(([, fan]) => fan.length >= 3)
    .map(([station, fan]) => ({
      station,
      fares: new Set(fan.map((x) => x.fare)).size,
      n: fan.length,
    }))
    .filter((x) => x.fares <= 1);
  if (blind.length === 0) return [];
  return [
    {
      check: "unverifiable-stations",
      severity: "warn",
      message: `運賃が1種類しかなく、距離では検証できない駅がある: ${blind.length} 駅`,
      samples: blind
        .slice(0, MAX_SAMPLES)
        .map((b) => `${b.station}: ${b.n} ペアすべて同額`),
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
