import type { FareOverride, FareRule } from "@/lib/fare/types";

// JR本州3社（東日本・東海・西日本）をまたぐ乗車の場合、会社境界で運賃を
// 分割せず「基準額＋加算額」の通し運賃方式を使う（2026年3月14日改定で新設）。
// この3社間の切り替えだけを特別扱いし、三島会社（北海道・四国・九州）や
// 私鉄との切り替えは対象外（従来どおり区間を確定して初乗りからやり直す）。
// 三島会社は加算額表の数値が未確認のため対象外とした
// （詳細: .superpowers/sdd/2026-08-24-fare-accuracy/task-9-report.md）。
export const HONSHU_OPERATORS = new Set(["JR東日本", "JR東海", "JR西日本"]);

// 通し運賃の「基準額」表として使う代表事業者。基準額表は JR東海・JR西日本の
// 単独運賃表（改定前から据え置き）と同一の値であることが確認済み
// （data/fare-rules/jr-central.json, jr-west.json の source.note 参照）。
const HONSHU_BASE_OPERATOR = "JR東海";
// 「加算額」表（JR東日本区間の営業キロに対する上乗せ額）は、実在のどの事業者名
// とも衝突しない合成事業者名で data/fare-rules/jr-honshu-kasan.json に登録する。
const HONSHU_KASAN_OPERATOR = "__jr-honshu-kasan";

export interface FareCalculator {
  estimate(
    operator: string,
    km: number,
    fromName?: string,
    toName?: string,
  ): number;
  // 探索の枝刈り用。この事業者・この距離で「今後どう乗り継いでも絶対に
  // これより安くはならない」運賃の下界を返す（override 込みで安全側に見積もる）。
  // fromName を渡すと isOverrideAnchor と同じ論拠で下界を締められる:
  // fromName がその事業者の override 駅ペアのどちらにも登場しない場合、この区間は
  // どの駅で降りても override を絶対に引けないため、距離表の運賃（km について
  // 単調非減少）がそのまま有効な下界になる。fromName を渡さない、または anchor の
  // 場合は override が効く可能性があるので、距離表運賃とその事業者の override
  // 最安値の小さいほうを返す（この場合、下界は事業者単位の override 最安値で
  // 頭打ちになり km について単調増加しなくなる点に注意。停止性は下界の単調性では
  // なく、budget が有限で運賃が整数であることに依っている。詳細は
  // lib/search/reachable.ts のコメント参照）。
  lowerBound(operator: string, km: number, fromName?: string): number;
  // stationName がその事業者の override 駅ペアのどちらか一方に登場するか。
  // 登場しない駅を区間の起点にしている限り、この区間はどの駅で降りても override を
  // 引けない（override は fromName が登録ペアのどちらかと一致する場合にしか
  // マッチしないため）。探索側はこれを使って「区間の起点駅を区別する必要が無い
  // （=状態を安全にマージしてよい）」ケースを判定し、状態空間の爆発を防ぐ。
  isOverrideAnchor(operator: string, stationName: string | undefined): boolean;
  // JR本州3社をまたぐ通し運賃 = 基準額（総営業キロで基準額表を1回引いた額）
  // + 加算額（JR東日本区間の営業キロ分。ただし総営業キロが100kmを超える場合は
  // 0円）。加算額が100km超で0になる理由の一次資料は確認できておらず、
  // 実測3件（新宿→豊橋293.6km・東京→名古屋366km帯・東京→大阪556km帯、
  // いずれも基準額のみで実運賃と一致）から採用した規則。詳細・限界は
  // task-9-report.md 参照。
  estimateHonshuThrough(totalKm: number, eastKm: number): number;
  // 上記の下界。加算額は常に0以上なので基準額のみを返せば安全
  // （距離が伸びても単調非減少で、絶対にこれを下回らない）。
  honshuThroughBaseFare(totalKm: number): number;
}

// 事業者ごとの特定運賃（駅ペア単位）を方向を問わず引けるようにするためのキー生成。
// 区間全体（乗車区間の始点・終点）に対してのみ適用し、途中駅ペアには適用しない。
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("\u0000");
}

export function createFareCalculator(
  rules: FareRule[],
  overrides?: FareOverride[],
): FareCalculator {
  const byOperator = new Map<string, FareRule>();
  let fallback: FareRule | undefined;
  for (const r of rules) {
    if (r.operators.length === 0) fallback = r;
    for (const op of r.operators) byOperator.set(op, r);
  }
  if (!fallback)
    throw new Error("フォールバック運賃ルール (operators: []) が必要");
  const fb = fallback;

  const overrideByOperator = new Map<string, Map<string, number>>();
  const minOverrideByOperator = new Map<string, number>();
  const overrideStationsByOperator = new Map<string, Set<string>>();
  // 下界の締め上げ用: 事業者ごとに「その駅を含む override ペアの最小運賃」。
  // 事業者単位の最小値（minOverrideByOperator）より必ず大きいか等しいので、
  // anchor 駅がわかっている場合はこちらを使うほうが下界が締まる。
  const minOverrideByOperatorStation = new Map<string, Map<string, number>>();
  for (const o of overrides ?? []) {
    const map = overrideByOperator.get(o.operator) ?? new Map<string, number>();
    const stations =
      overrideStationsByOperator.get(o.operator) ?? new Set<string>();
    const byStation =
      minOverrideByOperatorStation.get(o.operator) ?? new Map<string, number>();
    let min = minOverrideByOperator.get(o.operator) ?? Infinity;
    const bumpStationMin = (station: string, fare: number) => {
      const cur = byStation.get(station) ?? Infinity;
      if (fare < cur) byStation.set(station, fare);
    };
    for (const p of o.pairs) {
      map.set(pairKey(p.from, p.to), p.fare);
      stations.add(p.from);
      stations.add(p.to);
      if (p.fare < min) min = p.fare;
      bumpStationMin(p.from, p.fare);
      bumpStationMin(p.to, p.fare);
    }
    overrideByOperator.set(o.operator, map);
    overrideStationsByOperator.set(o.operator, stations);
    minOverrideByOperator.set(o.operator, min);
    minOverrideByOperatorStation.set(o.operator, byStation);
  }

  function tableFare(operator: string, km: number): number {
    if (km <= 0) return 0;
    const rule = byOperator.get(operator) ?? fb;
    // table は maxKm 昇順（fare/types.ts のスキーマコメント参照）なので二分探索できる。
    // 「km <= maxKm を満たす最初の行」を探す＝線形走査と同じ結果。
    const table = rule.table;
    let lo = 0;
    let hi = table.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const row = table[mid];
      if (row !== undefined && km <= row[0]) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    if (lo < table.length) {
      const row = table[lo];
      if (row !== undefined) return row[1];
    }
    const { fromKm, baseFare, ratePerKm } = rule.beyond;
    return Math.ceil((baseFare + (km - fromKm) * ratePerKm) / 10) * 10;
  }

  return {
    estimate(operator, km, fromName, toName) {
      if (km <= 0) return 0;
      if (fromName !== undefined && toName !== undefined) {
        const overridden = overrideByOperator
          .get(operator)
          ?.get(pairKey(fromName, toName));
        if (overridden !== undefined) return overridden;
      }
      return tableFare(operator, km);
    },
    lowerBound(operator, km, fromName) {
      const table = tableFare(operator, km);
      if (fromName !== undefined) {
        const stationMin = minOverrideByOperatorStation
          .get(operator)
          ?.get(fromName);
        if (stationMin === undefined) {
          // fromName が override 駅ペアのどちらにも登場しない = この区間は
          // どの駅で降りても override を絶対に引けない。距離表運賃だけが
          // 有効な下界であり、これは km について単調非減少（下界が頭打ちしない）。
          return table;
        }
        // fromName を含む override ペアの最小値まで締める（事業者全体の最小値
        // より必ず大きいか等しい＝下界としてより厳しくても安全）。
        return Math.min(table, stationMin);
      }
      const minOverride = minOverrideByOperator.get(operator) ?? Infinity;
      return Math.min(table, minOverride);
    },
    isOverrideAnchor(operator, stationName) {
      if (stationName === undefined) return false;
      return overrideStationsByOperator.get(operator)?.has(stationName) ?? false;
    },
    estimateHonshuThrough(totalKm, eastKm) {
      if (totalKm <= 0) return 0;
      if (!byOperator.has(HONSHU_BASE_OPERATOR)) {
        throw new Error(
          `JR本州3社通し運賃の基準額表(${HONSHU_BASE_OPERATOR})が見つかりません`,
        );
      }
      const base = tableFare(HONSHU_BASE_OPERATOR, totalKm);
      if (totalKm > 100) return base;
      if (!byOperator.has(HONSHU_KASAN_OPERATOR)) {
        throw new Error(
          `JR本州3社通し運賃の加算額表(${HONSHU_KASAN_OPERATOR})が見つかりません`,
        );
      }
      return base + tableFare(HONSHU_KASAN_OPERATOR, eastKm);
    },
    honshuThroughBaseFare(totalKm) {
      if (totalKm <= 0) return 0;
      if (!byOperator.has(HONSHU_BASE_OPERATOR)) {
        throw new Error(
          `JR本州3社通し運賃の基準額表(${HONSHU_BASE_OPERATOR})が見つかりません`,
        );
      }
      return tableFare(HONSHU_BASE_OPERATOR, totalKm);
    },
  };
}
