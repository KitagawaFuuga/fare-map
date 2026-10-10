// 事業者の中で、駅と駅の最短の営業キロをグラフから測る（実額照合で、照合先が示す
// 区間ごとの営業キロと突き合わせるため）。経由駅を並べると区間ごとに測って足す。
//
//   npx tsx scripts/analysis/segment-km.ts JR北海道 新旭川 旭川 札幌
import { readFileSync } from "node:fs";
import type { RailGraph } from "@/lib/graph/types";
import { stationGroupsOf } from "./station-groups";

const [operator, ...stops] = process.argv.slice(2);
if (operator === undefined || stops.length < 2) {
  throw new Error("使い方: segment-km.ts <事業者> <駅1> <駅2> [<駅3> ...]");
}
const graph = JSON.parse(readFileSync("data/graph.json", "utf8")) as RailGraph;

// 乗換でつながったノードを1駅とした隣接表。駅名でまとめると同名の別駅
// （東京と秋田の大久保）がつながってしまう（station-groups.ts）
const groupOf = stationGroupsOf(graph, operator);
const adj = new Map<string, Map<string, number>>();
for (const e of graph.edges) {
  if (e.kind !== "rail" || e.operator !== operator) continue;
  const a = groupOf(e.from);
  const b = groupOf(e.to);
  if (a === b) continue;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const m = adj.get(x) ?? new Map<string, number>();
    m.set(y, Math.min(m.get(y) ?? Infinity, e.km));
    adj.set(x, m);
  }
}

// 駅名からその駅のグループを引く。同名の別駅があれば全部を候補にする
const groupsNamed = (name: string) =>
  new Set(
    Object.values(graph.nodes)
      .filter((n) => n.operator === operator && n.name === name)
      .map((n) => groupOf(n.id)),
  );

function shortest(fromName: string, toName: string): number {
  const targets = groupsNamed(toName);
  const dist = new Map<string, number>(
    [...groupsNamed(fromName)].map((g) => [g, 0] as const),
  );
  const done = new Set<string>();
  for (;;) {
    let u: string | undefined;
    let best = Infinity;
    for (const [k, d] of dist)
      if (!done.has(k) && d < best) {
        best = d;
        u = k;
      }
    if (u === undefined) return Infinity;
    if (targets.has(u)) return best;
    done.add(u);
    for (const [v, w] of adj.get(u) ?? []) {
      if (best + w < (dist.get(v) ?? Infinity)) dist.set(v, best + w);
    }
  }
}

let total = 0;
for (let i = 1; i < stops.length; i++) {
  const km = shortest(stops[i - 1]!, stops[i]!);
  total += km;
  process.stdout.write(`${stops[i - 1]}→${stops[i]}: ${km.toFixed(1)}km\n`);
}
process.stdout.write(`合計: ${total.toFixed(1)}km\n`);
