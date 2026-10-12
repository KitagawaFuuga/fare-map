import type { SpecialCity } from "@/lib/fare/special-cities";
import type { FareOverride, FareRule, FareZone } from "@/lib/fare/types";

// この3社をまたぐ乗車だけ、会社境界で分割せず通し運賃で計算する（docs/search-design.md）
export const HONSHU_OPERATORS = new Set(["JR東日本", "JR東海", "JR西日本"]);

// 基準額表は JR東海・JR西日本の単独運賃表と同一（各 source.note 参照）
const HONSHU_BASE_OPERATOR = "JR東海";
// 加算額表は実在の事業者名と衝突しない合成名で登録してある
const HONSHU_KASAN_OPERATOR = "__jr-honshu-kasan";
// 特定都区市内の区域を事業者ごとにまとめるとき、通し運賃に効く区域のまとまりの名前
const HONSHU_CITY_GROUP = "__jr-honshu";

export interface FareCalculator {
  // localKm は区間がすべて地方交通線のときの営業キロ。渡すと地方交通線の表を引く
  // （FareRule.localTable。表を持たない事業者・表の範囲外では無視する）
  estimate(
    operator: string,
    km: number,
    fromName?: string,
    toName?: string,
    localKm?: number,
  ): number;
  // 探索の枝刈り用。「この先どう乗り継いでも これより安くならない」額を返す。
  // fromName を渡すと下界を締められる（根拠と限界: docs/search-design.md）
  lowerBound(
    operator: string,
    km: number,
    fromName?: string,
    localKm?: number,
  ): number;
  // 地方交通線の表を持つ事業者か。探索はこれで地方交通線だけの区間を区別する
  hasLocalTable(operator: string): boolean;
  // stationName がその事業者の override 駅ペアに登場するか。
  // 探索はこれで状態をマージしてよいか判定する（docs/search-design.md）
  isOverrideAnchor(operator: string, stationName: string | undefined): boolean;
  // stationName が属する区間運賃（data/fare-zones.json）の id。無ければ undefined。
  // 区間内の起点からの運賃は着駅しだいで区間の表になるので、探索は区間外の起点と
  // 状態をまとめてはいけない（lib/search/reachable.ts の originBucketKey）
  zoneOf(operator: string, stationName: string | undefined): string | undefined;
  // stationName が属する特定都区市内の区域の id（東京都区内と山手線内のように複数なら
  // 連結）。区域外なら undefined。区域内の起点からの運賃は中心駅からの距離で引くので、
  // 探索は区域外の起点と状態をまとめてはいけない（lib/search/reachable.ts）。
  // honshuThrough なら本州3社の通し運賃に効く区域で判定する。
  // maxFare は残りの予算。規則が効く最短の距離（minKm）の運賃がこれを超える区域は
  // 予算内の着駅に効かないので除く（探索が状態を無駄に分けないため）
  specialCityKeyOf(
    operator: string,
    stationName: string | undefined,
    honshuThrough: boolean,
    maxFare: number,
  ): string | undefined;
  // 通し運賃 = 基準額(総営業キロ) + 加算額(eastKm)。eastKm は呼び出し側が
  // 東京〜熱海の特例を適用した後の値を渡す（docs/search-design.md）。
  // fromName/toName は通しの発着駅。特定都区市内の読み替えは基準額にだけ効かせる
  estimateHonshuThrough(
    totalKm: number,
    eastKm: number,
    fromName?: string,
    toName?: string,
  ): number;
  // 上記の下界。加算額は常に0以上なので基準額だけ返せば安全
  honshuThroughBaseFare(totalKm: number, fromName?: string): number;
}

// 特定都区市内の規則が効く距離か（第86条は minKm 超、第87条は minKm 超 maxKm 以下）
function cityApplies(city: SpecialCity, km: number): boolean {
  return km > city.minKm && km <= (city.maxKm ?? Infinity);
}

// 方向を問わず引けるよう並べ替えてから繋ぐ。区切りは駅名に現れない文字
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("\u0000");
}

export function createFareCalculator(
  rules: FareRule[],
  overrides?: FareOverride[],
  zones?: FareZone[],
  specialCities?: SpecialCity[],
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

  // 特定都区市内（docs/search-design.md「特定都区市内」）。事業者ごとと、本州3社の
  // 通し運賃用（HONSHU_CITY_GROUP）にまとめる
  // radius は区域の駅が中心駅から最も離れている距離（着駅側の読み替えで縮む上限）
  const citiesByGroup = new Map<
    string,
    { city: SpecialCity; stations: Set<string>; radius: number }[]
  >();
  for (const city of specialCities ?? []) {
    const groups = HONSHU_OPERATORS.has(city.operator)
      ? [city.operator, HONSHU_CITY_GROUP]
      : [city.operator];
    for (const g of groups) {
      // 通し運賃は3社をまたいで測った距離で読み替える
      const view: SpecialCity =
        g === HONSHU_CITY_GROUP
          ? { ...city, centerKm: city.throughCenterKm ?? city.centerKm }
          : city;
      let radius = 0;
      for (const s of view.stations)
        radius = Math.max(radius, view.centerKm.get(s) ?? 0);
      const list = citiesByGroup.get(g) ?? [];
      list.push({ city: view, stations: new Set(view.stations), radius });
      citiesByGroup.set(g, list);
    }
  }
  // 駅名 → その駅を含む区域。探索は辺を緩めるたびに運賃を引くので、ほとんどの駅
  // （区域外）で区域を総なめせずに済むよう索引にしておく
  const citiesByStation = new Map<
    string,
    Map<string, { city: SpecialCity; stations: Set<string>; radius: number }[]>
  >();
  for (const [g, list] of citiesByGroup) {
    const byName = new Map<
      string,
      { city: SpecialCity; stations: Set<string>; radius: number }[]
    >();
    for (const entry of list)
      for (const name of entry.stations)
        byName.set(name, [...(byName.get(name) ?? []), entry]);
    citiesByStation.set(g, byName);
  }
  // 距離がこれ以下の区間は区域を調べずに済む（探索で最も多い短い区間を素通り
  // させるため）。cityReach: 読み替えた距離は「実際の距離＋規則が効く側の区域の
  // 半径」を超えないので、どの区域でも minKm − 半径 に届かなければ規則は効かない。
  // lowerReach: 下界の距離は最短の minKm を下回らない
  const cityReachByGroup = new Map<string, number>();
  const lowerReachByGroup = new Map<string, number>();
  for (const [g, list] of citiesByGroup) {
    let reach = Infinity;
    let minKm = Infinity;
    for (const { city, radius } of list) {
      reach = Math.min(reach, city.minKm - radius);
      minKm = Math.min(minKm, city.minKm);
    }
    cityReachByGroup.set(g, reach);
    lowerReachByGroup.set(g, minKm);
  }
  const cityKeyByStation = new Map<string, Map<string, string>>();
  for (const [g, byName] of citiesByStation)
    cityKeyByStation.set(
      g,
      new Map(
        [...byName].map(([name, list]) => [
          name,
          list.map(({ city }) => city.id).join("+"),
        ]),
      ),
    );

  // 特定都区市内の規則で読み替えた距離。適用されなければ undefined。
  // 乗車経路は分からないので、中心駅からの距離を「実際の距離から発駅〜中心駅を
  // 引いた値」と「中心駅から着駅までの最短距離」の大きいほうで近似する。
  // 前者は発駅から区域の外へ向かう経路、後者は発駅が中心駅より着駅寄りの場合に合う
  function specialCityKm(
    group: string,
    km: number,
    fromName: string | undefined,
    toName: string | undefined,
  ): number | undefined {
    if (km <= (cityReachByGroup.get(group) ?? Infinity)) return undefined;
    const byName = citiesByStation.get(group);
    if (byName === undefined || fromName === undefined || toName === undefined)
      return undefined;
    const fromCities = byName.get(fromName);
    const toCities = byName.get(toName);
    if (fromCities === undefined && toCities === undefined) return undefined;
    let origin: { city: SpecialCity; km: number } | undefined;
    let dest: { city: SpecialCity; km: number } | undefined;
    // 発着とも同じ区域内なら規則の対象外
    for (const { city, stations } of fromCities ?? []) {
      const dFrom = city.centerKm.get(fromName);
      const dTo = city.centerKm.get(toName);
      if (dFrom === undefined || dTo === undefined || stations.has(toName))
        continue;
      const k = Math.max(km - dFrom, dTo);
      if (cityApplies(city, k)) {
        origin = { city, km: k };
        break;
      }
    }
    for (const { city, stations } of toCities ?? []) {
      const dFrom = city.centerKm.get(fromName);
      const dTo = city.centerKm.get(toName);
      if (dFrom === undefined || dTo === undefined || stations.has(fromName))
        continue;
      const k = Math.max(km - dTo, dFrom);
      if (cityApplies(city, k)) {
        dest = { city, km: k };
        break;
      }
    }
    if (origin !== undefined && dest !== undefined) {
      // 発着とも区域内なら中心駅どうし
      const between = origin.city.centerKm.get(dest.city.center);
      // 第86条は中心駅どうしが200kmを超えるときだけ。そうでなければ読み替えない
      if (
        origin.city.center === dest.city.center ||
        between === undefined ||
        between <= Math.max(origin.city.minKm, dest.city.minKm)
      )
        return undefined;
      const fromRadius = origin.city.centerKm.get(fromName) ?? 0;
      const toRadius = dest.city.centerKm.get(toName) ?? 0;
      return Math.max(km - fromRadius - toRadius, between);
    }
    return origin?.km ?? dest?.km;
  }

  // 下界用。読み替えで距離が縮んでも、この距離より短くはならない。区域が無ければ
  // undefined。specialCityKm の3通りの読み替えそれぞれについて、この先どこで
  // 降りても下回らない距離を出して最小を取る（km はこの先伸びる一方なので使える）:
  //   発駅側 max(km − 発駅〜中心駅, minKm)
  //   着駅側 max(km − 区域の半径, 中心駅〜発駅, minKm)（発駅を含まない区域）
  //   両方   max(km − 発駅〜中心駅 − 着駅側の区域の半径, 中心駅どうし)
  // 各項は max(km − shrink, floor) の形なので、発駅ごとに (shrink, floor) の組を
  // 一度だけ作って使い回す。minFloor は floor の最小（km がこれ以下なら読み替えても
  // km を下回らないので、下界を緩める必要がない）
  interface LowerTerms {
    terms: [number, number][];
    minFloor: number;
  }
  const lowerTermsCache = new Map<string, Map<string, LowerTerms>>();
  function lowerTermsOf(group: string, fromName: string): LowerTerms {
    let byFrom = lowerTermsCache.get(group);
    if (byFrom === undefined) {
      byFrom = new Map();
      lowerTermsCache.set(group, byFrom);
    }
    const hit = byFrom.get(fromName);
    if (hit !== undefined) return hit;
    const list = citiesByGroup.get(group) ?? [];
    const terms: [number, number][] = [];
    for (const { city, stations, radius } of list) {
      const dFrom = city.centerKm.get(fromName);
      if (dFrom === undefined) continue;
      if (!stations.has(fromName)) {
        terms.push([radius, Math.max(dFrom, city.minKm)]);
        continue;
      }
      terms.push([dFrom, city.minKm]);
      for (const other of list) {
        if (other.stations.has(fromName)) continue;
        const between = city.centerKm.get(other.city.center);
        // 中心駅どうしが minKm 以下なら specialCityKm は読み替えない
        if (between !== undefined)
          terms.push([
            dFrom + other.radius,
            Math.max(between, city.minKm, other.city.minKm),
          ]);
      }
    }
    // 縮み幅が大きく floor も低い項があれば、その項のほうが常に小さいので落とす
    const kept = terms.filter(
      ([shrink, floor], i) =>
        !terms.some(
          ([s2, f2], j) =>
            j !== i &&
            s2 >= shrink &&
            f2 <= floor &&
            (s2 > shrink || f2 < floor || j < i),
        ),
    );
    const entry = {
      terms: kept,
      minFloor: Math.min(...kept.map(([, floor]) => floor)),
    };
    byFrom.set(fromName, entry);
    return entry;
  }

  function specialCityLowerKm(
    group: string,
    km: number,
    fromName: string | undefined,
  ): number | undefined {
    // 下界の距離は minKm 以上なので、km がそれ以下なら緩める必要がない
    if (km <= (lowerReachByGroup.get(group) ?? Infinity)) return undefined;
    const list = citiesByGroup.get(group);
    if (list === undefined) return undefined;
    if (fromName === undefined) {
      // 発駅が分からなければ、発駅側も最大の半径だけ縮みうる
      let maxRadius = 0;
      let minKm = Infinity;
      for (const { city, radius } of list) {
        maxRadius = Math.max(maxRadius, radius);
        minKm = Math.min(minKm, city.minKm);
      }
      return Math.max(km - 2 * maxRadius, minKm);
    }
    const { terms, minFloor } = lowerTermsOf(group, fromName);
    if (km <= minFloor) return undefined;
    let low = Infinity;
    for (const [shrink, floor] of terms)
      low = Math.min(low, Math.max(km - shrink, floor));
    return low;
  }

  function tableFare(operator: string, km: number): number {
    return fareFromTable(byOperator.get(operator) ?? fb, km);
  }

  // 地方交通線の表で引いた運賃。表を持たない事業者、表の範囲外なら undefined
  function localFare(operator: string, localKm: number): number | undefined {
    const table = byOperator.get(operator)?.localTable;
    if (table === undefined || localKm <= 0) return undefined;
    return table.find((row) => localKm <= row[0])?.[1];
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
    estimate(operator, km, fromName, toName, localKm) {
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
      const cityKm = specialCityKm(operator, km, fromName, toName);
      if (cityKm !== undefined) return tableFare(operator, cityKm);
      if (localKm !== undefined) {
        const local = localFare(operator, localKm);
        if (local !== undefined) return local;
      }
      return tableFare(operator, km);
    },
    lowerBound(operator, km, fromName, localKm) {
      // 発駅が区間内なら、着駅しだいで区間の表（事業者の表以下）になりうる
      const z = zoneByOperator.get(operator);
      let table =
        z !== undefined && inZone(operator, fromName)
          ? Math.min(fareFromTable(z.zone, km), tableFare(operator, km))
          : tableFare(operator, km);
      // 地方交通線だけの区間は、そのまま進めば地方交通線の表、幹線に入れば
      // 幹線の表（距離が伸びるので今の額以上）になる。安いほうが下界。
      // 地方交通線の表のほうが高い帯（本州の7〜10km）もあるので min を取る
      if (localKm !== undefined) {
        const local = localFare(operator, localKm);
        if (local !== undefined) table = Math.min(table, local);
      }
      const cityLowKm = specialCityLowerKm(operator, km, fromName);
      if (cityLowKm !== undefined && cityLowKm < km)
        table = Math.min(table, tableFare(operator, cityLowKm));
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
    specialCityKeyOf(operator, stationName, honshuThrough, maxFare) {
      if (stationName === undefined) return undefined;
      const group = honshuThrough ? HONSHU_CITY_GROUP : operator;
      const list = citiesByStation.get(group)?.get(stationName);
      if (list === undefined) return undefined;
      // 規則が効くなら距離は minKm を超えるので、運賃は minKm の運賃以上
      const tableOperator = honshuThrough ? HONSHU_BASE_OPERATOR : operator;
      const usable = list.filter(
        ({ city }) => tableFare(tableOperator, city.minKm) <= maxFare,
      );
      if (usable.length === list.length)
        return cityKeyByStation.get(group)?.get(stationName);
      if (usable.length === 0) return undefined;
      return usable.map(({ city }) => city.id).join("+");
    },
    hasLocalTable(operator) {
      return byOperator.get(operator)?.localTable !== undefined;
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
    estimateHonshuThrough(totalKm, eastKm, fromName, toName) {
      if (totalKm <= 0) return 0;
      if (!byOperator.has(HONSHU_BASE_OPERATOR)) {
        throw new Error(
          `JR本州3社通し運賃の基準額表(${HONSHU_BASE_OPERATOR})が見つかりません`,
        );
      }
      const base = tableFare(
        HONSHU_BASE_OPERATOR,
        specialCityKm(HONSHU_CITY_GROUP, totalKm, fromName, toName) ?? totalKm,
      );
      if (!byOperator.has(HONSHU_KASAN_OPERATOR)) {
        throw new Error(
          `JR本州3社通し運賃の加算額表(${HONSHU_KASAN_OPERATOR})が見つかりません`,
        );
      }
      return base + tableFare(HONSHU_KASAN_OPERATOR, eastKm);
    },
    honshuThroughBaseFare(totalKm, fromName) {
      if (totalKm <= 0) return 0;
      if (!byOperator.has(HONSHU_BASE_OPERATOR)) {
        throw new Error(
          `JR本州3社通し運賃の基準額表(${HONSHU_BASE_OPERATOR})が見つかりません`,
        );
      }
      const lowKm = specialCityLowerKm(HONSHU_CITY_GROUP, totalKm, fromName);
      return lowKm !== undefined && lowKm < totalKm
        ? tableFare(HONSHU_BASE_OPERATOR, lowKm)
        : tableFare(HONSHU_BASE_OPERATOR, totalKm);
    },
  };
}
