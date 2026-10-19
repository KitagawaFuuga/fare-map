// JR各社から駅ペアを無作為に選び、アプリの探索で出した運賃を並べる（実額照合の標本）。
// 照合先の実額はこのスクリプトでは取らない。
//
//   npx tsx scripts/analysis/sample-jr-pairs.ts [--per=5] [--seed=2]
import { readdirSync, readFileSync } from "node:fs";
import { createFareCalculator } from "@/lib/fare/calculator";
import {
  fareOverrideSchema,
  fareRuleSchema,
  fareZoneSchema,
} from "@/lib/fare/types";
import type { RailGraph } from "@/lib/graph/types";
import { findReachable } from "@/lib/search/reachable";

const arg = (name: string, fallback: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : Number(hit.split("=")[1]);
};
const PER = arg("per", 5);
const SEED = arg("seed", 2);
const OPERATORS = [
  "JR北海道",
  "JR東日本",
  "JR東海",
  "JR西日本",
  "JR四国",
  "JR九州",
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

const rules = readdirSync("data/fare-rules").map((f) =>
  fareRuleSchema.parse(
    JSON.parse(readFileSync(`data/fare-rules/${f}`, "utf8")),
  ),
);
const overrides = readdirSync("data/fare-overrides").map((f) =>
  fareOverrideSchema.parse(
    JSON.parse(readFileSync(`data/fare-overrides/${f}`, "utf8")),
  ),
);
const zones = (
  JSON.parse(readFileSync("data/fare-zones.json", "utf8")) as {
    zones: unknown[];
  }
).zones.map((z) => fareZoneSchema.parse(z));
const calc = createFareCalculator(rules, overrides, zones);
const graph = JSON.parse(readFileSync("data/graph.json", "utf8")) as RailGraph;

for (const op of OPERATORS) {
  // その事業者の辺と、その事業者のノード間の乗換だけを残す（他社経由の安い経路を除く）
  const nodes = Object.fromEntries(
    Object.entries(graph.nodes).filter(([, n]) => n.operator === op),
  );
  const sub: RailGraph = {
    nodes,
    edges: graph.edges.filter(
      (e) => nodes[e.from] !== undefined && nodes[e.to] !== undefined,
    ),
  };
  const names = [...new Set(Object.values(nodes).map((n) => n.name))];
  const idsOf = (name: string) =>
    Object.values(nodes)
      .filter((n) => n.name === name)
      .map((n) => n.id);
  let found = 0;
  while (found < PER) {
    const from = names[Math.floor(rand() * names.length)]!;
    const to = names[Math.floor(rand() * names.length)]!;
    if (from === to) continue;
    const reached = findReachable(sub, calc, idsOf(from)[0]!, 100000);
    const targets = new Set(idsOf(to));
    const fares = reached.filter((r) => targets.has(r.id)).map((r) => r.fare);
    if (fares.length === 0) continue; // 自社線だけではつながらない組
    found++;
    process.stdout.write(`${op}\t${from}\t${to}\t${Math.min(...fares)}\n`);
  }
}
