import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { RailGraph } from "@/lib/graph/types";
import {
  createFareCalculator,
  type FareCalculator,
} from "@/lib/fare/calculator";
import {
  buildSpecialCities,
  specialCitiesFileSchema,
} from "@/lib/fare/special-cities";
import {
  fareOverrideSchema,
  fareRuleSchema,
  fareZoneSchema,
  type FareOverride,
  type FareRule,
  type FareZone,
} from "@/lib/fare/types";

export interface GraphStore {
  graph: RailGraph;
  calc: FareCalculator;
}

export function createGraphStore(
  graph: RailGraph,
  rules: FareRule[],
  overrides?: FareOverride[],
  zones?: FareZone[],
  specialCities?: unknown,
): GraphStore {
  // 特定都区市内は中心駅からの距離をグラフで測るので、グラフと一緒に組み立てる
  const cities =
    specialCities === undefined
      ? undefined
      : buildSpecialCities(graph, specialCitiesFileSchema.parse(specialCities));
  return {
    graph,
    calc: createFareCalculator(rules, overrides, zones, cities),
  };
}

// data/graph.json は約3MBあり、読み込みと JSON.parse だけで数百ミリ秒かかる。
// リクエストのたびに読むと検索の実時間がそれだけで埋まるため、プロセス内で
// 1度だけ構築して使い回す（Next.js のサーバープロセスが生きている間は保持される）。
let cached: GraphStore | undefined;

export function getGraphStore(): GraphStore {
  if (!cached) {
    const graph = JSON.parse(
      readFileSync(path.join(process.cwd(), "data/graph.json"), "utf8"),
    ) as RailGraph;
    // 運賃表・特定運賃は safeParse ではなく parse（＝不正なら即例外）を使う。
    // 自前のデータファイルが壊れている場合は静かに動き続けるより起動時に
    // 落ちたほうがよい（運賃表の並び順が崩れると二分探索が無警告で違う運賃を返す。
    // 詳細は lib/fare/types.ts のコメント参照）。
    const dir = path.join(process.cwd(), "data/fare-rules");
    const rules = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) =>
        fareRuleSchema.parse(
          JSON.parse(readFileSync(path.join(dir, f), "utf8")),
        ),
      );
    const overridesDir = path.join(process.cwd(), "data/fare-overrides");
    const overrides = readdirSync(overridesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) =>
        fareOverrideSchema.parse(
          JSON.parse(readFileSync(path.join(overridesDir, f), "utf8")),
        ),
      );
    // 区間運賃（JR西日本の電車特定区間）。発着の両駅が区間内なら事業者の表の代わりに引く
    const zones = (
      JSON.parse(
        readFileSync(path.join(process.cwd(), "data/fare-zones.json"), "utf8"),
      ) as { zones: unknown[] }
    ).zones.map((z) => fareZoneSchema.parse(z));
    // JRの特定都区市内・東京山手線内。区域内の駅からの長距離は中心駅から計算する
    const specialCities: unknown = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "data/special-cities.json"),
        "utf8",
      ),
    );
    cached = createGraphStore(graph, rules, overrides, zones, specialCities);
  }
  return cached;
}
