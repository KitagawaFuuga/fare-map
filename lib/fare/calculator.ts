import type { FareRule } from "@/lib/fare/types";

export interface FareCalculator {
  estimate(operator: string, km: number): number;
}

export function createFareCalculator(rules: FareRule[]): FareCalculator {
  const byOperator = new Map<string, FareRule>();
  let fallback: FareRule | undefined;
  for (const r of rules) {
    if (r.operators.length === 0) fallback = r;
    for (const op of r.operators) byOperator.set(op, r);
  }
  if (!fallback)
    throw new Error("フォールバック運賃ルール (operators: []) が必要");
  const fb = fallback;

  return {
    estimate(operator, km) {
      if (km <= 0) return 0;
      const rule = byOperator.get(operator) ?? fb;
      for (const [maxKm, fare] of rule.table) {
        if (km <= maxKm) return fare;
      }
      const { fromKm, baseFare, ratePerKm } = rule.beyond;
      return Math.ceil((baseFare + (km - fromKm) * ratePerKm) / 10) * 10;
    },
  };
}
