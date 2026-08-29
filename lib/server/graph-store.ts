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

let cached: GraphStore | undefined;

export function getGraphStore(): GraphStore {
  if (!cached) {
    const graph = JSON.parse(
      readFileSync(path.join(process.cwd(), "data/graph.json"), "utf8"),
    ) as RailGraph;
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
