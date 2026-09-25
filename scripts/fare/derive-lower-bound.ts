// 実額行列だけを持つ事業者の「下界専用」距離帯表を作り直す。
//
//   npx tsx scripts/fare/derive-lower-bound.ts [--write] [--operator=しなの鉄道]
//
// --write を付けなければ何も書かず、コミット済みの表との差だけを表示する。
//
// なぜ要るか: これらの表は公表営業キロではなく data/graph.json の駅間距離で
// 帯を切ってある（探索が calculator に渡すのがこの距離なので、公表営業キロで
// 切ると境界付近で下界が破れる）。しなの鉄道は最小の余裕が2mしかなく、
// 駅間距離が動くと壊れる。実際に station-km.json を広げたとき富山地鉄の
// 新宮川→電鉄富山が破れた（15.100km で表720円 > 実額700円）。
//
// したがって build-graph.ts を走らせたらこれも走らせる。手で直すと次も壊れる。
import { readFileSync, writeFileSync } from "node:fs";
import { deriveLowerBoundTable, type KmFare } from "@/lib/fare/lower-bound";
import { fareOverrideSchema, fareRuleSchema } from "@/lib/fare/types";
import { buildOperatorKmTable } from "@/lib/graph/operator-distance";
import type { RailGraph } from "@/lib/graph/types";

// 対象は「運賃を実額行列から引き、距離表は枝刈りの下界にしか使わない」事業者だけ。
// 山陽電鉄の表は公表された運賃表そのものなので、ここで作り直してはいけない。
const TARGETS = [
  { rule: "chitetsu", override: "chitetsu", operator: "富山地方鉄道" },
  { rule: "shinano", override: "shinano", operator: "しなの鉄道" },
];

function main(write: boolean, onlyOperator: string | undefined): void {
  const graph = JSON.parse(
    readFileSync("data/graph.json", "utf8"),
  ) as RailGraph;

  for (const target of TARGETS) {
    if (onlyOperator !== undefined && target.operator !== onlyOperator)
      continue;
    const rulePath = `data/fare-rules/${target.rule}.json`;
    const rule = fareRuleSchema.parse(
      JSON.parse(readFileSync(rulePath, "utf8")),
    );
    const override = fareOverrideSchema.parse(
      JSON.parse(
        readFileSync(`data/fare-overrides/${target.override}.json`, "utf8"),
      ),
    );

    // 運賃を引く距離は運賃計算キロ。営業キロで作ると擬制キロのある事業者で破れる
    const kmOf = buildOperatorKmTable(graph, target.operator, {
      useFareKm: true,
    });
    const pairs: KmFare[] = [];
    let unmatched = 0;
    for (const p of override.pairs) {
      const km = kmOf(p.from, p.to);
      if (km === null || km <= 0) {
        unmatched++;
        continue;
      }
      pairs.push({ km, fare: p.fare });
    }

    const derived = deriveLowerBoundTable(pairs);
    // 下界であることの確認。生成した表を信用せず、全ペアで引き直す
    let violated = 0;
    for (const p of pairs) {
      const band = derived.table.find(([maxKm]) => p.km <= maxKm);
      const fare =
        band?.[1] ??
        derived.beyond.baseFare +
          Math.max(0, p.km - derived.beyond.fromKm) * derived.beyond.ratePerKm;
      if (fare > p.fare) violated++;
    }

    const same =
      JSON.stringify([rule.table, rule.beyond]) ===
      JSON.stringify([derived.table, derived.beyond]);
    process.stdout.write(
      `${target.operator}: ペア${pairs.length}（距離が引けない ${unmatched}）` +
        ` 帯${rule.table.length}→${derived.table.length} 下界を破るペア ${violated}` +
        ` ${same ? "コミット済みと同一" : "差あり"}\n`,
    );
    if (violated > 0) {
      process.stdout.write("  下界を破る表は書き出さない\n");
      continue;
    }
    if (same || !write) continue;

    const next = {
      ...rule,
      table: derived.table,
      beyond: derived.beyond,
    };
    writeFileSync(rulePath, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(`  書き出し: ${rulePath}\n`);
  }
}

main(
  process.argv.includes("--write"),
  process.argv.find((a) => a.startsWith("--operator="))?.slice(11),
);
