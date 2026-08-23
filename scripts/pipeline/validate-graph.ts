import { readFileSync } from "node:fs";
import type { RailGraph } from "@/lib/graph/types";
import { validateGraph } from "@/lib/graph/validate";

const graph = JSON.parse(readFileSync("data/graph.json", "utf8")) as RailGraph;
const problems = validateGraph(graph);
if (problems.length > 0) {
  console.warn(`${problems.length} 件の問題:`);
  for (const p of problems.slice(0, 50)) console.warn(`  ${p}`);
  process.exitCode = 1;
} else {
  process.stdout.write("OK\n");
}
