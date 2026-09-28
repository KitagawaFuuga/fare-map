import type { FareOverride, FareRule, FareZone } from "@/lib/fare/types";

// この3社をまたぐ乗車だけ、会社境界で分割せず通し運賃で計算する（docs/search-design.md）
export const HONSHU_OPERATORS = new Set(["JR東日本", "JR東海", "JR西日本"]);

// 基準額表は JR東海・JR西日本の単独運賃表と同一（各 source.note 参照）
const HONSHU_BASE_OPERATOR = "JR東海";
// 加算額表は実在の事業者名と衝突しない合成名で登録してある
const HONSHU_KASAN_OPERATOR = "__jr-honshu-kasan";

export interface FareCalculator {
  estimate(
    operator: string,
    km: number,
    fromName?: string,
    toName?: string,
  ): number;
  // 探索の枝刈り用。「この先どう乗り継いでも これより安くならない」額を返す。
  // fromName を渡すと下界を締められる（根拠と限界: docs/search-design.md）
  lowerBound(operator: string, km: number, fromName?: string): number;
  // stationName がその事業者の override 駅ペアに登場するか。
  // 探索はこれで状態をマージしてよいか判定する（docs/search-design.md）
  isOverrideAnchor(operator: string, stationName: string | undefined): boolean;
  // stationName が属する区間運賃（data/fare-zones.json）の id。無ければ undefined。
  // 区間内の起点からの運賃は着駅しだいで区間の表になるので、探索は区間外の起点と
  // 状態をまとめてはいけない（lib/search/reachable.ts の originBucketKey）
  zoneOf(operator: string, stationName: string | undefined): string | undefined;
  // 通し運賃 = 基準額(総営業キロ) + 加算額(eastKm)。eastKm は呼び出し側が
  // 東京〜熱海の特例を適用した後の値を渡す（docs/search-design.md）
  estimateHonshuThrough(totalKm: number, eastKm: number): number;
  // 上記の下界。加算額は常に0以上なので基準額だけ返せば安全
  honshuThroughBaseFare(totalKm: number): number;
}

// 方向を問わず引けるよう並べ替えてから繋ぐ。区切りは駅名に現れない文字
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("\u0000");
}

export function createFareCalculator(
  rules: FareRule[],
  overrides?: FareOverride[],
  zones?: FareZone[],
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
  // 駅ごとの最小値。事業者単位より必ず大きいか等しいので下界が締まる
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

  // 事業者ごとの区間運賃。発着の両駅が区間内なら、事業者の表の代わりに引く
  const zoneByOperator = new Map<
    string,
    { zone: FareZone; stations: Set<string> }
  >();
  for (const z of zones ?? []) {
    if (zoneByOperator.has(z.operator))
      throw new Error(`${z.operator} に区間運賃が2つある（1事業者1区間まで）`);
    zoneByOperator.set(z.operator, { zone: z, stations: new Set(z.stations) });
  }
  const inZone = (operator: string, name: string | undefined) =>
    name !== undefined &&
    (zoneByOperator.get(operator)?.stations.has(name) ?? false);

  function tableFare(operator: string, km: number): number {
    return fareFromTable(byOperator.get(operator) ?? fb, km);
  }

  function fareFromTable(
    rule: Pick<FareRule, "table" | "beyond">,
    km: number,
  ): number {
    if (km <= 0) return 0;
    // maxKm 昇順なので「km <= maxKm の最初の行」を二分探索で探せる（昇順は zod が強制）
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
      const z = zoneByOperator.get(operator);
      if (
        z !== undefined &&
        inZone(operator, fromName) &&
        inZone(operator, toName)
      )
        return fareFromTable(z.zone, km);
      return tableFare(operator, km);
    },
    lowerBound(operator, km, fromName) {
      // 発駅が区間内なら、着駅しだいで区間の表（事業者の表以下）になりうる
      const z = zoneByOperator.get(operator);
      const table =
        z !== undefined && inZone(operator, fromName)
          ? Math.min(fareFromTable(z.zone, km), tableFare(operator, km))
          : tableFare(operator, km);
      if (fromName !== undefined) {
        const stationMin = minOverrideByOperatorStation
          .get(operator)
          ?.get(fromName);
        if (stationMin === undefined) {
          // この区間はどの駅で降りても override を引けないので、距離表が有効な下界
          return table;
        }
        // この駅を含む override の最小値まで締める（事業者全体の最小値以上なので安全）
        return Math.min(table, stationMin);
      }
      const minOverride = minOverrideByOperator.get(operator) ?? Infinity;
      return Math.min(table, minOverride);
    },
    zoneOf(operator, stationName) {
      return inZone(operator, stationName)
        ? zoneByOperator.get(operator)?.zone.id
        : undefined;
    },
    isOverrideAnchor(operator, stationName) {
      if (stationName === undefined) return false;
      return (
        overrideStationsByOperator.get(operator)?.has(stationName) ?? false
      );
    },
    estimateHonshuThrough(totalKm, eastKm) {
      if (totalKm <= 0) return 0;
      if (!byOperator.has(HONSHU_BASE_OPERATOR)) {
        throw new Error(
          `JR本州3社通し運賃の基準額表(${HONSHU_BASE_OPERATOR})が見つかりません`,
        );
      }
      const base = tableFare(HONSHU_BASE_OPERATOR, totalKm);
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
