import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { RailGraph } from "@/lib/graph/types";
import {
  createFareCalculator,
  type FareCalculator,
} from "@/lib/fare/calculator";
import {
  fareOverrideSchema,
  fareRuleSchema,
  type FareOverride,
  type FareRule,
} from "@/lib/fare/types";

export interface GraphStore {
  graph: RailGraph;
  calc: FareCalculator;
}

export function createGraphStore(
  graph: RailGraph,
  rules: FareRule[],
  overrides?: FareOverride[],
): GraphStore {
  return { graph, calc: createFareCalculator(rules, overrides) };
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
    cached = createGraphStore(graph, rules, overrides);
  }
  return cached;
}
