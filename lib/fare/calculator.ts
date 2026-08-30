import type { FareOverride, FareRule } from "@/lib/fare/types";

export interface FareCalculator {
  estimate(
    operator: string,
    km: number,
    fromName?: string,
    toName?: string,
  ): number;
  // 探索の枝刈り用。この事業者・この距離で「今後どう乗り継いでも絶対に
  // これより安くはならない」運賃の下界を返す（override 込みで安全側に見積もる）。
  // 運賃表は km について単調非減少なので現在の km での距離表運賃は有効な下界になり、
  // override はその事業者に登録された最安値を下界候補として加味する
  // （override は駅名ペアのみで判定され km に依存しないため、将来この事業者の
  // どこかで override が適用されても、その事業者の最安 override 値を下回ることはない）。
  lowerBound(operator: string, km: number): number;
  // stationName がその事業者の override 駅ペアのどちらか一方に登場するか。
  // 登場しない駅を区間の起点にしている限り、この区間はどの駅で降りても override を
  // 引けない（override は fromName が登録ペアのどちらかと一致する場合にしか
  // マッチしないため）。探索側はこれを使って「区間の起点駅を区別する必要が無い
  // （=状態を安全にマージしてよい）」ケースを判定し、状態空間の爆発を防ぐ。
  isOverrideAnchor(operator: string, stationName: string | undefined): boolean;
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
  for (const o of overrides ?? []) {
    const map = overrideByOperator.get(o.operator) ?? new Map<string, number>();
    const stations =
      overrideStationsByOperator.get(o.operator) ?? new Set<string>();
    let min = minOverrideByOperator.get(o.operator) ?? Infinity;
    for (const p of o.pairs) {
      map.set(pairKey(p.from, p.to), p.fare);
      stations.add(p.from);
      stations.add(p.to);
      if (p.fare < min) min = p.fare;
    }
    overrideByOperator.set(o.operator, map);
    overrideStationsByOperator.set(o.operator, stations);
    minOverrideByOperator.set(o.operator, min);
  }

  function tableFare(operator: string, km: number): number {
    if (km <= 0) return 0;
    const rule = byOperator.get(operator) ?? fb;
    for (const [maxKm, fare] of rule.table) {
      if (km <= maxKm) return fare;
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
    lowerBound(operator, km) {
      const minOverride = minOverrideByOperator.get(operator) ?? Infinity;
      return Math.min(tableFare(operator, km), minOverride);
    },
    isOverrideAnchor(operator, stationName) {
      if (stationName === undefined) return false;
      return overrideStationsByOperator.get(operator)?.has(stationName) ?? false;
    },
  };
}
