import type { FareOverride, FareRule } from "@/lib/fare/types";

export interface FareCalculator {
  estimate(
    operator: string,
    km: number,
    fromName?: string,
    toName?: string,
  ): number;
  // その事業者に駅ペア単位の特定運賃（override）が登録されているか。
  // 探索側が「区間の起点駅」を区別すべき事業者を絞り込むために使う
  // （区別を全事業者に広げると状態空間が爆発するため）。
  hasOverride(operator: string): boolean;
  // stationName がその事業者の override 駅ペアのどちらか一方に登場するか。
  // 登場しない駅を区間の起点にしている限り、この区間は将来も override を
  // 引けないため「起点駅の違い」を区別する必要が無い。JR のように事業者自体は
  // override 対象でも路線網が広大な場合に、区別対象を該当駅だけへ絞り込み
  // 状態空間の爆発を防ぐために使う。
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
  const overrideStationsByOperator = new Map<string, Set<string>>();
  for (const o of overrides ?? []) {
    const map = overrideByOperator.get(o.operator) ?? new Map<string, number>();
    const stations =
      overrideStationsByOperator.get(o.operator) ?? new Set<string>();
    for (const p of o.pairs) {
      map.set(pairKey(p.from, p.to), p.fare);
      stations.add(p.from);
      stations.add(p.to);
    }
    overrideByOperator.set(o.operator, map);
    overrideStationsByOperator.set(o.operator, stations);
  }

  return {
    hasOverride(operator) {
      return overrideByOperator.has(operator);
    },
    isOverrideAnchor(operator, stationName) {
      if (stationName === undefined) return false;
      return overrideStationsByOperator.get(operator)?.has(stationName) ?? false;
    },
    estimate(operator, km, fromName, toName) {
      if (km <= 0) return 0;
      if (fromName !== undefined && toName !== undefined) {
        const overridden = overrideByOperator
          .get(operator)
          ?.get(pairKey(fromName, toName));
        if (overridden !== undefined) return overridden;
      }
      const rule = byOperator.get(operator) ?? fb;
      for (const [maxKm, fare] of rule.table) {
        if (km <= maxKm) return fare;
      }
      const { fromKm, baseFare, ratePerKm } = rule.beyond;
      return Math.ceil((baseFare + (km - fromKm) * ratePerKm) / 10) * 10;
    },
  };
}
